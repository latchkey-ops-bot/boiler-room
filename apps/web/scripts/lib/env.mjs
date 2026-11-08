// Shared by the deploy scripts. Secrets are read from the env file at run time and handed to child
// processes through their environment or stdin. They are never printed, logged, written to a
// committed file or put on a command line, where `ps` and shell history would show them.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_DIR = join(APP_DIR, '..', '..');

/** Where the founder keeps the keys. Override with BR_ENV_FILE. */
export const ENV_FILE = process.env.BR_ENV_FILE ?? join(homedir(), '.boiler-room.env');

export const ENVIRONMENTS = ['staging', 'production'];

/** Secrets the Worker reads at run time. `wrangler secret put` sets each one per environment. */
export const WORKER_SECRETS = ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'];

/** Values the Next build inlines. Public by design, but still read from the env file. */
export const BUILD_VARS = ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'];

export function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** The environment named on the command line: staging or production. */
export function environmentArg(argv = process.argv) {
  const env = scriptArgs(argv).positionals[0];
  if (!ENVIRONMENTS.includes(env)) fail(`Name an environment: ${ENVIRONMENTS.join(' or ')}.`);
  return env;
}

/** Parses KEY=VALUE lines. Quotes around a value are removed; comments and blanks are skipped. */
export function parseEnvFile(text) {
  const vars = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    vars.set(match[1], value);
  }
  return vars;
}

export function readEnvFile(path = ENV_FILE) {
  if (!existsSync(path)) return new Map();
  return parseEnvFile(readFileSync(path, 'utf8'));
}

/**
 * A value for one environment. `STAGING_CLERK_SECRET_KEY` wins over `CLERK_SECRET_KEY` for staging,
 * so staging and production can use different Clerk instances. Empty counts as missing.
 *
 * Production takes only `PRODUCTION_<NAME>`, with no fallback: the unscoped keys are the
 * development instance's, and falling back to them would quietly put production on it.
 */
export function valueFor(vars, name, env) {
  if (env === 'production') {
    const value = vars.get(`PRODUCTION_${name}`) || process.env[`PRODUCTION_${name}`] || '';
    return value === '' ? null : value;
  }
  const scoped = env ? vars.get(`${env.toUpperCase()}_${name}`) : undefined;
  const value = scoped || vars.get(name) || process.env[name] || '';
  return value === '' ? null : value;
}

/** Clerk development-instance keys start with these. Production must never get one. */
const CLERK_TEST_PREFIXES = ['sk_test_', 'pk_test_'];

/**
 * Names of production values that are Clerk development keys. Only the prefix is read; the value
 * is never printed.
 */
export function developmentKeysIn(values) {
  return values
    .filter(
      ([, value]) =>
        typeof value === 'string' && CLERK_TEST_PREFIXES.some((p) => value.startsWith(p)),
    )
    .map(([name]) => name);
}

/** Stops a production build or secret sync that would use a Clerk development key. */
export function refuseDevelopmentKeys(env, values) {
  if (env !== 'production') return;
  const names = developmentKeysIn(values);
  if (names.length > 0) {
    fail(
      `${names.map((name) => `PRODUCTION_${name}`).join(', ')} ${names.length === 1 ? 'is a' : 'are'} ` +
        "Clerk development key (sk_test_ or pk_test_). Production needs the production instance's keys.",
    );
  }
}

/** The Cloudflare token and account, or null when the founder has not added them yet. */
export function cloudflareCredentials(vars) {
  const token = valueFor(vars, 'CLOUDFLARE_API_TOKEN');
  const account = valueFor(vars, 'CLOUDFLARE_ACCOUNT_ID');
  return token && account ? { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } : null;
}

export function requireCloudflare(vars) {
  const credentials = cloudflareCredentials(vars);
  if (!credentials) {
    fail(
      `CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not set in ${ENV_FILE}. ` +
        'See docs/deploy.md, "Credentials".',
    );
  }
  return credentials;
}

/**
 * Variables a child keeps from this shell, when they are set. The children build and run the
 * repo's code (`next build` runs `next.config.ts` and the app, OpenNext runs its config, wrangler
 * reads `wrangler.jsonc`), which agents' pull requests wrote, and a person's shell can hold any
 * key. So a child gets only these, and whatever the script hands it on purpose, such as the
 * Cloudflare keys. `HOME` stays: wrangler, pnpm and Next keep their config and caches under it.
 */
export const CHILD_ENV_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'CI',
];

/**
 * A child's environment: `CHILD_ENV_KEYS` from this process, then `extra`. Nothing else from
 * `process.env` reaches the child.
 *
 * @param {Record<string, string>} [extra]
 * @param {Record<string, string | undefined>} [from]
 * @returns {Record<string, string>}
 */
export function childEnv(extra = {}, from = process.env) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const key of CHILD_ENV_KEYS) {
    const value = from[key];
    if (typeof value === 'string') env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * Runs a command in the app folder and waits, with `childEnv(env)`. Throws on a non-zero exit
 * unless `allowFail`.
 */
export function run(command, args, { env = {}, input, allowFail = false, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: APP_DIR,
    env: childEnv(env),
    input,
    stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    fail(`${command} ${args.join(' ')} exited with ${result.status}.`);
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

/**
 * Runs a command with `childEnv(env)` and streams its output, also returning it, so a script can
 * read a URL from it.
 */
export function runTee(command, args, { env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: APP_DIR,
      env: childEnv(env),
      stdio: ['inherit', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      process.stdout.write(chunk);
    });
    child.on('close', (status) => resolve({ status: status ?? 1, stdout: out }));
  });
}

/** `pnpm exec <bin>` from the app's own node_modules: wrangler, next, opennextjs-cloudflare. */
export function bin(name, args, options) {
  return run('pnpm', ['exec', name, ...args], options);
}

/**
 * Runs git in the repo. It keeps this shell's environment: git runs none of the repo's code, and
 * a fetch needs the person's own git config and credentials.
 */
export function git(args) {
  const result = spawnSync('git', args, { cwd: REPO_DIR, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Asks a yes-or-no question on a terminal. Without a terminal, the answer is no. */
export async function confirm(question, expected) {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} Type "${expected}" to go on: `);
  rl.close();
  return answer.trim() === expected;
}

/** Flags that take a value. Every other `--flag` is a switch. */
const VALUE_FLAGS = new Set(['--release-card']);

/**
 * The arguments after the script name: the positionals in order, and the flags. A value flag reads
 * `--name value` or `--name=value`, and is `''` when no value follows it.
 *
 * @param {string[]} [argv]
 * @returns {{ positionals: string[], flags: Record<string, string | true> }}
 */
export function scriptArgs(argv = process.argv) {
  const rest = argv.slice(2);
  /** @type {string[]} */
  const positionals = [];
  /** @type {Record<string, string | true>} */
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (!VALUE_FLAGS.has(name)) {
      flags[name.slice(2)] = true;
    } else if (eq !== -1) {
      flags[name.slice(2)] = arg.slice(eq + 1);
    } else if (rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) {
      flags[name.slice(2)] = rest[++i];
    } else {
      flags[name.slice(2)] = '';
    }
  }
  return { positionals, flags };
}

/** A board card id, as `board_read` names it. */
export const CARD_ID = /^crd_[a-z0-9]{8,64}$/;

/**
 * The `RELEASE` card named by `--release-card <crd_...>`: null when the flag is absent, and a
 * refusal when it is there without a card id.
 *
 * @param {string[]} [argv]
 * @returns {{ card: string | null, refusal?: string }}
 */
export function releaseCardArg(argv = process.argv) {
  const { flags } = scriptArgs(argv);
  if (!('release-card' in flags)) return { card: null };
  const card = flags['release-card'];
  if (typeof card !== 'string' || !CARD_ID.test(card)) {
    return {
      card: null,
      refusal: `--release-card needs the RELEASE card's id (crd_ and lowercase letters or digits), not "${String(card).slice(0, 40)}".`,
    };
  }
  return { card };
}

/**
 * @typedef {{ dirty: boolean, head: string | null, mainTip: string | null }} Tree
 */

/**
 * The git state a release is judged on: whether the tree is clean, HEAD, and the tip of main.
 *
 * @returns {Tree}
 */
export function readTree() {
  git(['fetch', 'origin', '--quiet']);
  return {
    dirty: git(['status', '--porcelain']) !== '',
    head: git(['rev-parse', 'HEAD']),
    mainTip: git(['rev-parse', 'origin/main']),
  };
}

/**
 * The production scripts a `RELEASE` card may run without a terminal, and whether each must run
 * from the tip of `origin/main`. Provisioning and secrets stay the founder's, at a terminal.
 */
export const RELEASE_ACTIONS = { deploy: true, migrate: true, rollback: false };

/**
 * Decides how a production step may go on. Pure, so every refusal is tested:
 *
 * - `none`: not production, nothing to ask.
 * - `confirm`: a person at a terminal, who must type "production".
 * - `release`: the release agent, which has no terminal, on the `RELEASE` card it names with
 *   `--release-card`. Only for `RELEASE_ACTIONS`, and for deploy and migrate only from a clean tree
 *   at the tip of `origin/main`.
 * - `refuse`, with the reason.
 *
 * No environment variable turns on the release path: only the flag does, so it shows in the
 * command and in the version's message.
 *
 * @param {{ env: string, step?: string, card?: string | null, refusal?: string, tree?: Tree,
 *   isTTY?: boolean }} input
 * @returns {{ mode: 'none' | 'confirm' } | { mode: 'release', card: string } |
 *   { mode: 'refuse', reason: string }}
 */
export function productionDecision({ env, step, card, refusal, tree, isTTY }) {
  if (refusal) return { mode: 'refuse', reason: refusal };
  if (env !== 'production') {
    if (card) {
      return {
        mode: 'refuse',
        reason: `--release-card is for production only. ${env} needs no card.`,
      };
    }
    return { mode: 'none' };
  }
  if (!card) {
    if (isTTY) return { mode: 'confirm' };
    return {
      mode: 'refuse',
      reason:
        'Production needs a person to type "production" at a terminal, or the release agent\'s --release-card <crd_...>. There is no terminal and no card. Nothing in production was changed.',
    };
  }
  if (step === undefined || !Object.hasOwn(RELEASE_ACTIONS, step)) {
    return {
      mode: 'refuse',
      reason: `--release-card covers ${Object.keys(RELEASE_ACTIONS).join(', ')} only. This step is the founder's, at a terminal. Nothing in production was changed.`,
    };
  }
  if (RELEASE_ACTIONS[/** @type {keyof typeof RELEASE_ACTIONS} */ (step)]) {
    if (!tree) return { mode: 'refuse', reason: 'The git state was not read.' };
    if (!tree.mainTip) {
      return { mode: 'refuse', reason: 'origin/main could not be read. Fetch it and try again.' };
    }
    if (tree.dirty) {
      return {
        mode: 'refuse',
        reason: 'The working tree has changes. A release runs only from a clean tree.',
      };
    }
    if (tree.head !== tree.mainTip) {
      return {
        mode: 'refuse',
        reason: `HEAD (${String(tree.head).slice(0, 12)}) is not origin/main (${tree.mainTip.slice(0, 12)}). A release runs only from the tip of origin/main: git checkout --detach origin/main.`,
      };
    }
  }
  return { mode: 'release', card };
}

/**
 * Production is guarded. A person goes on only by typing "production" at the terminal. The release
 * agent has no terminal, so it names its `RELEASE` card with `--release-card crd_...` instead, and
 * `productionDecision` allows that only for a deploy, a migration or a rollback, and for the first
 * two only from a clean tree at the tip of `origin/main`. The deploy then also refuses pending
 * migrations, and rolls back by itself when the smoke check fails. Returns the card, or null.
 *
 * @param {string} env
 * @param {string} action
 * @param {{ step?: string, argv?: string[] }} [options]
 * @returns {Promise<string | null>}
 */
export async function guardProduction(env, action, { step, argv = process.argv } = {}) {
  const { card, refusal } = releaseCardArg(argv);
  const needsTree =
    env === 'production' &&
    card !== null &&
    step !== undefined &&
    RELEASE_ACTIONS[/** @type {keyof typeof RELEASE_ACTIONS} */ (step)] === true;
  const decision = productionDecision({
    env,
    step,
    card,
    refusal,
    tree: needsTree ? readTree() : undefined,
    isTTY: Boolean(process.stdin.isTTY),
  });
  if (decision.mode === 'refuse') fail(decision.reason);
  if (decision.mode === 'none') return null;
  if (decision.mode === 'release') {
    console.log(
      `\nRelease card ${decision.card}: about to ${action} in PRODUCTION, with no terminal.`,
    );
    return decision.card;
  }
  console.log(`\nYou are about to ${action} in PRODUCTION.`);
  const ok = await confirm('This changes production for every customer.', 'production');
  if (!ok) fail('Stopped. Nothing in production was changed.');
  return null;
}

/**
 * Whether `wrangler d1 migrations list` says the database has migrations it has not run.
 *
 * @param {string} listOutput
 */
export function migrationsPending(listOutput) {
  return !String(listOutput).includes('No migrations to apply');
}

/**
 * The version serving the most traffic, from `wrangler deployments status --json`: the one a
 * rollback goes back to. Null when there is no deployment yet or the output is not that JSON.
 *
 * @param {string} statusJson
 * @returns {string | null}
 */
export function liveVersionId(statusJson) {
  try {
    const status = JSON.parse(statusJson);
    const versions = Array.isArray(status?.versions) ? status.versions : [];
    const top = [...versions]
      .filter((item) => typeof item?.version_id === 'string')
      .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))[0];
    return top?.version_id ?? null;
  } catch {
    return null;
  }
}

/**
 * What a release deploy does after its smoke check. A pass ends it. A failure, or no URL to check,
 * rolls production back to the version that was live before the deploy and checks that one, and
 * the release fails either way. With no earlier version there is nothing to go back to, which the
 * failure says. The rollback and smoke check are passed in, so every outcome is tested.
 *
 * @param {{ smokeOk: boolean, url: string | undefined, previous: string | null,
 *   rollBack: (versionId: string) => Promise<boolean>, smokeAgain: () => Promise<boolean> }} input
 * @returns {Promise<{ ok: boolean, rolledBack: boolean, message: string }>}
 */
export async function settleRelease({ smokeOk, url, previous, rollBack, smokeAgain }) {
  if (smokeOk && url) return { ok: true, rolledBack: false, message: 'Smoke check passed.' };
  const why = url ? 'the smoke check failed' : 'no URL was found to smoke check';
  if (!previous) {
    return {
      ok: false,
      rolledBack: false,
      message: `Deployed, but ${why}, and production had no earlier version to roll back to. The new version is live: fix it or deploy again.`,
    };
  }
  const rolled = await rollBack(previous);
  if (!rolled) {
    return {
      ok: false,
      rolledBack: false,
      message: `Deployed, but ${why}, and the rollback to ${previous} failed. Run pnpm web:rollback:production ${previous} --release-card <card> now.`,
    };
  }
  const healthy = url ? await smokeAgain() : false;
  return {
    ok: false,
    rolledBack: true,
    message: `Deployed, but ${why}. Rolled production back to ${previous}${url ? `, whose smoke check ${healthy ? 'passed' : 'also failed'}` : ''}.`,
  };
}
