// Writes apps/web/.dev.vars, the gitignored file local development reads its keys from. Wrangler
// loads it into the Worker's env for `pnpm web:preview`, and scripts/dev.mjs loads it into
// `next dev`. Never commit it.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  APP_DIR,
  ENV_FILE,
  fail,
  parseEnvFile,
  readEnvFile,
  valueFor,
  WORKER_SECRETS,
} from './env.mjs';

export const DEV_VARS_PATH = join(APP_DIR, '.dev.vars');

export function writeDevVars() {
  const vars = readEnvFile();
  const lines = [
    '# Written by scripts/lib/dev-vars.mjs from the env file. Never commit this file.',
  ];
  lines.push('NEXTJS_ENV=development');
  const missing = [];
  for (const name of WORKER_SECRETS) {
    const value = valueFor(vars, name, 'development');
    if (value === null) missing.push(name);
    else lines.push(`${name}=${value}`);
  }
  if (missing.length > 0) {
    fail(`${missing.join(' and ')} missing from ${ENV_FILE}. Local sign-in needs Clerk's keys.`);
  }
  writeFileSync(DEV_VARS_PATH, `${lines.join('\n')}\n`, { mode: 0o600 });
  chmodSync(DEV_VARS_PATH, 0o600);
  return DEV_VARS_PATH;
}

export function readDevVars() {
  return existsSync(DEV_VARS_PATH)
    ? Object.fromEntries(parseEnvFile(readFileSync(DEV_VARS_PATH, 'utf8')))
    : {};
}
