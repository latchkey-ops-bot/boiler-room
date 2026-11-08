// The real-film secrets, for staging only. Each is read from its STAGING_ name and nothing else:
// the unscoped NAIVE_API_KEY in the env file is the founder's admin key, and falling back to it
// would hand the Worker every scope in the org. Values are never printed.

/** Worker secret name, env-file name, and whether a sync may go on without it. */
export const RUNNER_SECRETS = [
  { name: 'NAIVE_WEB_KEY', from: 'STAGING_NAIVE_WEB_KEY', optional: false },
  { name: 'RUNNER_SIGNING_SECRET', from: 'STAGING_RUNNER_SIGNING_SECRET', optional: false },
  // Empty until the founder has signed in once and his Clerk user id is known.
  { name: 'REAL_FILM_USERS', from: 'STAGING_REAL_FILM_USERS', optional: true },
  // The film command's key, which the website sends with each launch. The stand-in needs none.
  { name: 'NAIVE_RUNNER_KEY', from: 'STAGING_NAIVE_RUNNER_KEY', optional: true },
];

/** The only scopes the website's Naive key may hold. */
export const WEB_KEY_SCOPES = ['billing:read', 'computers:write'];

/**
 * The runner's key, sent to the film command with each launch: exactly what the film command
 * calls with `--phase script|render`, `--render local` and `--no-sync`, as Naive's 403s name each
 * route's scope. Not `agents:write`: the command never changes an agent or pushes a skill, and
 * Naive puts image generation (`POST /v1/media/images`) under it too, so the Art Director goes on
 * with captured pictures. `computers:write` has no resource binding: it reaches every computer in
 * the organization, so no other computer there may hold a secret.
 */
export const RUNNER_KEY_SCOPES = [
  // `agents.list` and `skills.listVersions`: the `--no-sync` check that the crew is this build's.
  'agents:read',
  // `sessions.list`, `get` and the event stream: who holds the Researcher, and each stage's turns.
  'sessions:read',
  // `sessions.create`, `send`, `interrupt` and `cancel`: the four crew agents' sessions.
  'sessions:write',
  // `files.list`, `get` and downloads: the capture tool, page evidence and captured pictures.
  'files:read',
  // `files.upload` and `delete`: the capture tool, and the frames Quality Check is shown.
  'files:write',
  // `computers.list`, `get`, `resume`, `exec` and `pause`: br-researcher's computer, paused after.
  'computers:write',
  // `credits.show` and `agents.spend`: each stage's balance before and after, and its spend.
  'billing:read',
];

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
  const runnerKey = found.find((secret) => secret.name === 'NAIVE_RUNNER_KEY')?.value;
  if (runnerKey && admin && runnerKey === admin) {
    problems.push('STAGING_NAIVE_RUNNER_KEY is the admin key. Mint a scoped key for the runner.');
  }
  if (runnerKey && webKey && runnerKey === webKey) {
    problems.push('STAGING_NAIVE_RUNNER_KEY is the website key. The runner gets its own.');
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

/** True when `scopes` is exactly `wanted` (the website key's scopes unless given). */
export function scopesMatch(scopes, wanted = WEB_KEY_SCOPES) {
  const sorted = [...wanted].sort();
  return (
    Array.isArray(scopes) &&
    scopes.length === sorted.length &&
    [...scopes].sort().every((scope, i) => scope === sorted[i])
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

/**
 * Asks Naive what the runner's key may do. Null when it holds exactly `RUNNER_KEY_SCOPES`, or the
 * problem: one scope fewer stops a film part way, and one more is more than a film computer that
 * reads customers' sites should hold.
 */
export async function checkRunnerKey(
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
    return 'Naive could not be reached to check STAGING_NAIVE_RUNNER_KEY.';
  }
  if (!response.ok) return `Naive refused STAGING_NAIVE_RUNNER_KEY (${response.status}).`;
  const identity = await response.json().catch(() => null);
  const scopes = Array.isArray(identity?.scopes) ? identity.scopes : [];
  if (scopesMatch(scopes, RUNNER_KEY_SCOPES)) return null;
  const extra = scopes.filter((scope) => !RUNNER_KEY_SCOPES.includes(scope));
  const missing = RUNNER_KEY_SCOPES.filter((scope) => !scopes.includes(scope));
  return `STAGING_NAIVE_RUNNER_KEY must hold exactly ${RUNNER_KEY_SCOPES.join(', ')}${extra.length ? `; it also holds ${extra.join(', ')}` : ''}${missing.length ? `; it lacks ${missing.join(', ')}` : ''}.`;
}

/** The one contract file, relative to the repo. */
export const CONTRACT_FILE = 'services/film-runner/src/contract.ts';

/**
 * Why a deploy would talk to runners it cannot understand, or null. The base snapshot runs the
 * runner at `RUNNER_COMMIT`; the contract it was built with must be the one being deployed, byte
 * for byte, or every real film fails at its hello. `show(commit, path)` reads a file at a commit.
 */
export function contractDrift(vars, workingContract, show) {
  const commit = vars.RUNNER_COMMIT ?? '';
  if (!vars.RUNNER_SNAPSHOT_ID) return null;
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    return 'RUNNER_SNAPSHOT_ID is set but RUNNER_COMMIT is not a full commit.';
  }
  const built = show(commit, CONTRACT_FILE);
  if (built === null) return `${commit.slice(0, 12)} is not here. Run git fetch origin.`;
  // Byte for byte, but for the trailing newline `git show` output loses.
  return built.trimEnd() === workingContract.trimEnd()
    ? null
    : `${CONTRACT_FILE} differs from the one the snapshot's runner (${commit.slice(0, 12)}) was built with. Rebuild the snapshot, or deploy that contract.`;
}
