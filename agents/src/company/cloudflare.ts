import { readSecret } from '../naive/client.ts';

/**
 * The keys the web app's deploy scripts read, and the file they go in on the engineering lead's
 * computer. The scripts read `~/.boiler-room.env` (`ENV_FILE` in apps/web/scripts/lib/env.mjs), so
 * the file has that name there too. Only the keys below go in it: nothing else from the founder's
 * env file reaches an agent's computer this way, and never a Clerk secret key.
 */
export const CLOUDFLARE_KEYS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] as const;

/**
 * The Clerk publishable key the build inlines (`BUILD_VARS` in apps/web/scripts/lib/env.mjs). It is
 * public by design: Next puts it in the browser's JavaScript. `pnpm web:deploy:staging` stops at
 * the build without it, and `pnpm web:deploy:production` without its `PRODUCTION_` copy.
 */
export const PUBLISHABLE_KEY = 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY';
export const PRODUCTION_PUBLISHABLE_KEY = `PRODUCTION_${PUBLISHABLE_KEY}`;

/** The file, relative to the home folder, so a shell command names it as `~/.boiler-room.env`. */
export const DEPLOY_ENV_FILE = '.boiler-room.env';

const PUBLISHABLE = /^pk_(test|live)_[A-Za-z0-9+/]+=*$/;
const FORMATS: Record<string, RegExp> = {
  CLOUDFLARE_API_TOKEN: /^[A-Za-z0-9_-]{20,}$/,
  CLOUDFLARE_ACCOUNT_ID: /^[a-f0-9]{32}$/,
  [PUBLISHABLE_KEY]: PUBLISHABLE,
  [PRODUCTION_PUBLISHABLE_KEY]: PUBLISHABLE,
};

type Read = (name: string) => string;

/** A key the founder's file may not have: `null` when it is missing or empty. */
function optional(read: Read, name: string): string | null {
  try {
    return read(name) || null;
  } catch {
    return null;
  }
}

/** One line of the lead's file: the name it is written as, the founder's name it came from, and its value. */
export interface DeployEnvEntry {
  name: string;
  from: string;
  value: string;
}

/**
 * What goes in the lead's `~/.boiler-room.env`, in order:
 * - the two Cloudflare keys;
 * - staging's publishable key, as `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. It is the value the deploy
 *   scripts take for staging from the founder's file (`valueFor` in apps/web/scripts/lib/env.mjs):
 *   `STAGING_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` when that is set, else the unscoped key;
 * - production's, as `PRODUCTION_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, only when the founder's file
 *   has it. Production takes no other name, so until the founder sets it (docs/deploy.md, "First
 *   production release") a release stops at the build with `production not provisioned`, and the
 *   next `company:sync` after it is set writes it.
 * Every value must have its key's shape. One that does not is refused by name, never printed.
 */
export function deployEnvEntries(read: Read = readSecret): DeployEnvEntry[] {
  const entries: DeployEnvEntry[] = CLOUDFLARE_KEYS.map((name) => ({
    name,
    from: name,
    value: read(name),
  }));
  const stagingName = `STAGING_${PUBLISHABLE_KEY}`;
  const staged = optional(read, stagingName);
  const staging = staged ?? optional(read, PUBLISHABLE_KEY);
  if (!staging) {
    throw new Error(
      `${PUBLISHABLE_KEY} is missing from the env file: the lead's staging build needs it.`,
    );
  }
  entries.push({
    name: PUBLISHABLE_KEY,
    from: staged ? stagingName : PUBLISHABLE_KEY,
    value: staging,
  });
  const production = optional(read, PRODUCTION_PUBLISHABLE_KEY);
  if (production) {
    entries.push({
      name: PRODUCTION_PUBLISHABLE_KEY,
      from: PRODUCTION_PUBLISHABLE_KEY,
      value: production,
    });
  }
  for (const entry of entries) {
    if (!FORMATS[entry.name]?.test(entry.value))
      throw new Error(`${entry.from} has an unexpected format.`);
  }
  return entries;
}

/** The names `deployEnvEntries` writes, in order. Reads the founder's file, never prints a value. */
export function deployEnvKeys(read: Read = readSecret): string[] {
  return deployEnvEntries(read).map((entry) => entry.name);
}

/** The content of `~/.boiler-room.env` for the lead: `deployEnvEntries`, and nothing else. */
export function deployEnvFile(read: Read = readSecret): string {
  const lines = [
    '# Written by pnpm company:sync. Cloudflare keys and Clerk publishable keys for the pnpm web:* scripts only.',
  ];
  for (const entry of deployEnvEntries(read)) lines.push(`${entry.name}=${entry.value}`);
  return `${lines.join('\n')}\n`;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Whether Cloudflare says the token is active, checked from this machine. The token goes in a
 * request header only. A user token answers on `/user/tokens/verify`; an account token on
 * `/accounts/<id>/tokens/verify`. `null` when neither answer proves it either way.
 */
export async function cloudflareTokenActive(
  read: (name: string) => string = readSecret,
  fetchFn: Fetch = fetch,
): Promise<boolean | null> {
  const token = read('CLOUDFLARE_API_TOKEN');
  const account = read('CLOUDFLARE_ACCOUNT_ID');
  const urls = [
    'https://api.cloudflare.com/client/v4/user/tokens/verify',
    `https://api.cloudflare.com/client/v4/accounts/${account}/tokens/verify`,
  ];
  let refused = false;
  for (const url of urls) {
    const response = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } }).catch(
      () => null,
    );
    if (!response) continue;
    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      result?: { status?: string };
    } | null;
    if (response.status === 200 && body?.success) return body.result?.status === 'active';
    if ([400, 401, 403].includes(response.status)) refused = true;
  }
  return refused ? false : null;
}
