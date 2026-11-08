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
  const env = argv[2];
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
 */
export function valueFor(vars, name, env) {
  const scoped = env ? vars.get(`${env.toUpperCase()}_${name}`) : undefined;
  const value = scoped || vars.get(name) || process.env[name] || '';
  return value === '' ? null : value;
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

/** Runs a command in the app folder and waits. Throws on a non-zero exit unless `allowFail`. */
export function run(command, args, { env = {}, input, allowFail = false, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: APP_DIR,
    env: { ...process.env, ...env },
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

/** Runs a command and streams its output, also returning it, so a script can read a URL from it. */
export function runTee(command, args, { env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: APP_DIR,
      env: { ...process.env, ...env },
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

/**
 * Production is the founder's: every production script stops here unless a person types
 * "production" at the terminal. No flag or variable skips it.
 */
export async function guardProduction(env, action) {
  if (env !== 'production') return;
  console.log(`\nYou are about to ${action} in PRODUCTION.`);
  const ok = await confirm('Only the founder releases to production.', 'production');
  if (!ok) fail('Stopped. Nothing in production was changed.');
}
