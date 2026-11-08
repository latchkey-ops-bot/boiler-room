// The real-film secrets, for staging only. Each is read from its STAGING_ name and nothing else:
// the unscoped NAIVE_API_KEY in the env file is the founder's admin key, and falling back to it
// would hand the Worker every scope in the org. Values are never printed.

/** Worker secret name, env-file name, and whether a sync may go on without it. */
export const RUNNER_SECRETS = [
  { name: 'NAIVE_WEB_KEY', from: 'STAGING_NAIVE_WEB_KEY', optional: false },
  { name: 'RUNNER_SIGNING_SECRET', from: 'STAGING_RUNNER_SIGNING_SECRET', optional: false },
  // Empty until the founder has signed in once and his Clerk user id is known.
  { name: 'REAL_FILM_USERS', from: 'STAGING_REAL_FILM_USERS', optional: true },
];

/** The only scopes the website's Naive key may hold. */
export const WEB_KEY_SCOPES = ['billing:read', 'computers:write'];

/**
 * Which real-film secrets to set on `env`, and what is wrong. `problems` stop the sync; an empty
 * `values` with no problems means real films stay off there.
 */
export function runnerSecretsFor(vars, env) {
  if (env !== 'staging') return { values: [], skipped: [], problems: [] };
  const read = (name) => {
    const value = vars.get(name) ?? '';
    return value.trim() === '' ? null : value.trim();
  };
  const found = RUNNER_SECRETS.map((secret) => ({ ...secret, value: read(secret.from) }));
  if (found.every((secret) => secret.value === null)) {
    return { values: [], skipped: found.map((secret) => secret.from), problems: [] };
  }
  const problems = found
    .filter((secret) => secret.value === null && !secret.optional)
    .map((secret) => `${secret.from} is missing`);
  const webKey = found.find((secret) => secret.name === 'NAIVE_WEB_KEY')?.value;
  const admin = read('NAIVE_API_KEY');
  if (webKey && admin && webKey === admin) {
    problems.push('STAGING_NAIVE_WEB_KEY is the admin key. Mint a scoped key for the website.');
  }
  const signing = found.find((secret) => secret.name === 'RUNNER_SIGNING_SECRET')?.value;
  if (signing && signing.length < 32) {
    problems.push('STAGING_RUNNER_SIGNING_SECRET is shorter than 32 characters.');
  }
  return {
    values: found
      .filter((secret) => secret.value !== null)
      .map((secret) => [secret.name, secret.value]),
    skipped: found.filter((secret) => secret.value === null).map((secret) => secret.from),
    problems,
  };
}

/** True when `scopes` is exactly the website key's scopes. */
export function scopesMatch(scopes) {
  return (
    Array.isArray(scopes) &&
    scopes.length === WEB_KEY_SCOPES.length &&
    [...scopes].sort().every((scope, i) => scope === WEB_KEY_SCOPES[i])
  );
}

/**
 * Asks Naive what the key may do, with the key in a header and never on a command line. Answers
 * null when the scopes are right, or the problem.
 */
export async function checkWebKey(
  key,
  { fetch: get = fetch, baseUrl = 'https://api.vetta.sh' } = {},
) {
  let response;
  try {
    response = await get(`${baseUrl}/v1/me`, {
      headers: {
        authorization: `Bearer ${key}`,
        'vetta-version': '2026-09-30',
        accept: 'application/json',
      },
    });
  } catch {
    return 'Naive could not be reached to check STAGING_NAIVE_WEB_KEY.';
  }
  if (!response.ok) return `Naive refused STAGING_NAIVE_WEB_KEY (${response.status}).`;
  const identity = await response.json().catch(() => null);
  if (!scopesMatch(identity?.scopes)) {
    return `STAGING_NAIVE_WEB_KEY must hold exactly ${WEB_KEY_SCOPES.join(' and ')}.`;
  }
  return null;
}
