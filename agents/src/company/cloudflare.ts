import { readSecret } from '../naive/client.ts';

/**
 * The Cloudflare keys the web app's deploy scripts use, and the file they go in on the engineering
 * lead's computer. The scripts read `~/.boiler-room.env` (`ENV_FILE` in
 * apps/web/scripts/lib/env.mjs), so the file has that name there too. Only these two keys go in it:
 * nothing else from the founder's env file reaches an agent's computer this way.
 */
export const CLOUDFLARE_KEYS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] as const;

/** The file, relative to the home folder, so a shell command names it as `~/.boiler-room.env`. */
export const DEPLOY_ENV_FILE = '.boiler-room.env';

const FORMATS: Record<(typeof CLOUDFLARE_KEYS)[number], RegExp> = {
  CLOUDFLARE_API_TOKEN: /^[A-Za-z0-9_-]{20,}$/,
  CLOUDFLARE_ACCOUNT_ID: /^[a-f0-9]{32}$/,
};

/**
 * The content of `~/.boiler-room.env` for the lead: the two Cloudflare keys and nothing else. A value
 * with an unexpected shape is refused by name, never printed.
 */
export function deployEnvFile(read: (name: string) => string = readSecret): string {
  const lines = [
    '# Written by pnpm company:sync. Cloudflare keys for the pnpm web:* scripts only.',
  ];
  for (const name of CLOUDFLARE_KEYS) {
    const value = read(name);
    if (!FORMATS[name].test(value)) throw new Error(`${name} has an unexpected format.`);
    lines.push(`${name}=${value}`);
  }
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
