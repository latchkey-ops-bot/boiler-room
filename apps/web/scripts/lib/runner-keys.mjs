// What `pnpm web:runner:keys` needs that a test can check: the scopes it mints, how it writes the
// env file, and the probe's list of the website's Naive calls. Never prints a key.

import { RUNNER_KEY_SCOPES, WEB_KEY_SCOPES } from './runner-secrets.mjs';

export { RUNNER_KEY_SCOPES, WEB_KEY_SCOPES };

/** The env-file names a staging mint writes. */
export const MINTED = {
  web: 'STAGING_NAIVE_WEB_KEY',
  signing: 'STAGING_RUNNER_SIGNING_SECRET',
  runner: 'STAGING_NAIVE_RUNNER_KEY',
};

/**
 * `text` with `name=value` set: the line replaced where it is, or appended. Other lines, comments
 * and order are kept as they are.
 */
export function upsertEnvLine(text, name, value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Bad name: ${name}`);
  if (/[\s"'#]/.test(value)) throw new Error(`The value for ${name} cannot be written plainly.`);
  const line = `${name}=${value}`;
  const lines = text.split('\n');
  const at = lines.findIndex((each) => new RegExp(`^(?:export\\s+)?${name}\\s*=`).test(each));
  if (at >= 0) {
    lines[at] = line;
    return lines.join('\n');
  }
  const base = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return `${base}${line}\n`;
}

/** A signing secret: 48 random bytes, base64url, so 64 characters. */
export function newSigningSecret(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return Buffer.from(random(48)).toString('base64url');
}

/** Every call `HttpNaiveApi` makes for a film, in the order the probe makes them. */
export const PROBE_CALLS = [
  'createComputer',
  'getComputer',
  'listComputers',
  'home',
  'mkdir',
  'writeFile',
  'exec',
  'snapshot',
  'pause',
  'resume',
  'deleteComputer',
  'deleteSnapshot',
  'balanceMicroUsd',
];
