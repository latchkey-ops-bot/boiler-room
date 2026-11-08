#!/usr/bin/env node
// pnpm web:runner:keys:staging mint [--runner-key]
// pnpm web:runner:keys:staging probe [--runner-key]
//
// mint: with the admin NAIVE_API_KEY in the env file, mints the website's own Naive key (exactly
// computers:write and billing:read) into STAGING_NAIVE_WEB_KEY, and makes a signing secret in
// STAGING_RUNNER_SIGNING_SECRET. With --runner-key, also the runner's key (exactly the seven
// scopes of RUNNER_KEY_SCOPES in lib/runner-secrets.mjs) into STAGING_NAIVE_RUNNER_KEY. It never
// replaces a key that is already there, and prints only key ids.
//
// probe: runs every Naive call the website makes for a film (`HttpNaiveApi`, the real class) once
// with STAGING_NAIVE_WEB_KEY, on a throwaway 1 vCPU computer, then destroys it and its snapshot.
// Run it before `pnpm web:secrets:sync:staging`: a call the key cannot make is found here, not on
// a founder's film. It costs one 10-minute block of the smallest computer, about $0.01.
//
// probe --runner-key: checks that STAGING_NAIVE_RUNNER_KEY holds exactly the seven scopes, then
// makes every Naive call the film command makes on a film computer with it (lib/runner-probe.mjs):
// the crew check, sessions, files, br-researcher's computer and the balance. It starts no session
// and generates no image, and says whether Naive lets the key generate images. About $0.01, for
// br-researcher's computer, resumed and paused again, and only while no session of it is live.
//
// Staging only. Production keys are the founder's to mint.
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { HttpNaiveApi, NaiveApiError } from '../src/server/runner/naive-api.ts';
import { ENV_FILE, fail, readEnvFile } from './lib/env.mjs';
import {
  MINTED,
  newSigningSecret,
  PROBE_CALLS,
  RUNNER_KEY_SCOPES,
  upsertEnvLine,
  WEB_KEY_SCOPES,
} from './lib/runner-keys.mjs';
import { probeRunnerKey, RUNNER_PROBE_CALLS } from './lib/runner-probe.mjs';
import { checkRunnerKey, checkWebKey } from './lib/runner-secrets.mjs';

const BASE_URL = 'https://api.vetta.sh';
const [env, command] = process.argv.slice(2);
if (env !== 'staging') fail('Name staging: production keys are the founder’s to mint.');
if (command !== 'mint' && command !== 'probe') fail('Say mint or probe.');

const vars = readEnvFile();

function writeEnv(name, value) {
  const text = readFileSync(ENV_FILE, 'utf8');
  const mode = statSync(ENV_FILE).mode & 0o777;
  writeFileSync(ENV_FILE, upsertEnvLine(text, name, value), { mode });
  chmodSync(ENV_FILE, mode & 0o700);
}

async function mintKey(admin, name, scopes) {
  const response = await fetch(`${BASE_URL}/v1/api_keys`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${admin}`,
      'vetta-version': '2026-09-30',
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({ name, scopes }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.secret !== 'string') {
    fail(`Naive would not mint ${name} (${response.status} ${body?.error?.code ?? ''}).`);
  }
  return body;
}

if (command === 'mint') {
  const admin = vars.get('NAIVE_API_KEY');
  if (!admin) fail(`${ENV_FILE} has no NAIVE_API_KEY to mint with.`);
  const wanted = [{ env: MINTED.web, name: 'br-web-staging', scopes: WEB_KEY_SCOPES }];
  if (process.argv.includes('--runner-key')) {
    wanted.push({ env: MINTED.runner, name: 'br-runner-staging', scopes: RUNNER_KEY_SCOPES });
  }
  for (const key of wanted) {
    if (vars.get(key.env)) {
      console.log(`${key.env} is already set; left as it is.`);
      continue;
    }
    const minted = await mintKey(admin, key.name, key.scopes);
    writeEnv(key.env, minted.secret);
    console.log(`Minted ${minted.id} (${key.name}: ${minted.scopes.join(', ')}) into ${key.env}.`);
  }
  if (vars.get(MINTED.signing)) {
    console.log(`${MINTED.signing} is already set; left as it is.`);
  } else {
    writeEnv(MINTED.signing, newSigningSecret());
    console.log(`Wrote a new 64-character ${MINTED.signing}.`);
  }
  process.exit(0);
}

if (process.argv.includes('--runner-key')) {
  const runnerKey = vars.get(MINTED.runner);
  if (!runnerKey) fail(`${ENV_FILE} has no ${MINTED.runner}. The founder mints it.`);
  const problem = await checkRunnerKey(runnerKey);
  if (problem) fail(problem);
  console.log(`${MINTED.runner} holds exactly ${RUNNER_KEY_SCOPES.join(', ')}.\n`);
  const probed = await probeRunnerKey(runnerKey, { baseUrl: BASE_URL, log: console.log });
  console.log('');
  console.table(
    probed.results.map(({ call, ok, how, detail }) => ({
      call,
      scope: RUNNER_PROBE_CALLS.find((each) => each.call === call)?.scope ?? '',
      ok,
      how,
      detail: detail ?? '',
    })),
  );
  const { images } = probed;
  console.log(
    images.available === false
      ? `\nImage generation: unavailable (${images.detail}). The Art Director records "image generation unavailable" and goes on with captured pictures.`
      : images.available
        ? `\nImage generation: allowed (${images.detail}).`
        : `\nImage generation: not known (${images.detail}).`,
  );
  if (probed.balanceDeltaMicroUsd !== null)
    console.log(
      `The organization's balance moved $${(probed.balanceDeltaMicroUsd / 1e6).toFixed(4)} meanwhile, other agents' spend included.`,
    );
  if (probed.left.length)
    console.error(`Left changed on Naive, check by hand: ${probed.left.join('; ')}.`);
  if (probed.missing.length > 0 || probed.left.length > 0)
    fail(`${MINTED.runner} could not make: ${probed.missing.join(', ') || 'see above'}.`);
  console.log(`\n${MINTED.runner} can make every call the film command makes on a film computer.`);
  process.exit(0);
}

// probe
const key = vars.get(MINTED.web);
if (!key) fail(`${ENV_FILE} has no ${MINTED.web}. Run mint first.`);
const scopes = await checkWebKey(key);
if (scopes) fail(scopes);
const naive = new HttpNaiveApi({ key, baseUrl: BASE_URL });
const results = [];
let computerId = null;
let snapshotId = null;
const step = async (name, run) => {
  const started = Date.now();
  try {
    const value = await run();
    results.push({ call: name, ok: true, ms: Date.now() - started });
    return value;
  } catch (error) {
    const detail = error instanceof NaiveApiError ? `${error.status} ${error.code}` : String(error);
    results.push({ call: name, ok: false, ms: Date.now() - started, detail });
    throw error;
  }
};
const waitFor = async (status) => {
  for (let i = 0; i < 60; i++) {
    const computer = await naive.getComputer(computerId);
    if (computer.status === status) return computer;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${computerId} did not become ${status}.`);
};
let failed = false;
try {
  const created = await step('createComputer', () =>
    naive.createComputer(
      { name: 'br-film-staging-keyprobe', vcpu: 1, memory_mb: 1024, disk_gb: 10 },
      `keyprobe-${Date.now()}`,
    ),
  );
  computerId = created.id;
  await step('getComputer', () => waitFor('running'));
  await step('listComputers', () => naive.listComputers({ limit: 10 }));
  const home = await step('home', () => naive.home(computerId));
  await step('mkdir', () => naive.mkdir(computerId, `${home}/br-run`));
  await step('writeFile', () =>
    naive.writeFile(computerId, `${home}/br-run/probe.txt`, 'no secret here\n'),
  );
  const exec = await step('exec', () =>
    naive.exec(computerId, 'cat "$HOME/br-run/probe.txt" >/dev/null && echo probed', 20_000),
  );
  if (exec.exit_code !== 0) throw new Error(`exec exited ${exec.exit_code}`);
  snapshotId = (await step('snapshot', () => naive.snapshot(computerId))).snapshot_id;
  await step('pause', () => naive.pause(computerId));
  await waitFor('paused');
  await step('resume', () => naive.resume(computerId));
  await waitFor('running');
  await step('deleteComputer', () => naive.deleteComputer(computerId));
  computerId = null;
  for (let i = 0; i < 10; i++) {
    try {
      await step('deleteSnapshot', () => naive.deleteSnapshot(snapshotId));
      snapshotId = null;
      break;
    } catch (error) {
      if (!(error instanceof NaiveApiError && error.status === 409) || i === 9) throw error;
      results.pop();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  await step('balanceMicroUsd', () => naive.balanceMicroUsd());
} catch (error) {
  failed = true;
  console.error(`The probe stopped: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (computerId) await naive.deleteComputer(computerId).catch(() => undefined);
  if (snapshotId) await naive.deleteSnapshot(snapshotId).catch(() => undefined);
}
console.table(results);
const missing = PROBE_CALLS.filter((call) => !results.some((r) => r.call === call && r.ok));
if (failed || missing.length > 0) {
  fail(
    `${MINTED.web} could not make: ${missing.join(', ')}.` +
      (computerId || snapshotId ? ' Something was left on Naive: check it by hand.' : ''),
  );
}
console.log(`\n${MINTED.web} can make every call the website makes for a film.`);
