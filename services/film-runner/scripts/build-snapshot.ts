/**
 * `pnpm runner:snapshot`: builds the base snapshot every film computer is forked from, and prints
 * its id.
 *
 *   pnpm runner:snapshot [--film-ref feat/crew-agents | --film-commit <sha>]
 *                        [--runner-commit <sha>] [--adapter auto|film|standin] [--no-fork-test]
 *
 * 1. A builder computer at the film size (4 vCPU, 8 GiB, 20 GB).
 * 2. The setup from `recipe.ts`, started detached and polled, so no exec outlasts Naive's 600 s:
 *    Chrome libraries and fonts, swap, pnpm, both checkouts, dependencies, the Remotion browser,
 *    and `~/.film-runner.json`.
 * 3. The runner's Naive key, when the env file has `NAIVE_RUNNER_KEY`, written with `fs/write` to
 *    `~/.boiler-room.env` as `NAIVE_API_KEY=...` and made private. It never goes through a command.
 * 4. The ready check, a clean-up, the snapshot, and the builder destroyed.
 * 5. A fork of the snapshot runs the ready check again, and is destroyed.
 *
 * Uses the admin `NAIVE_API_KEY` from `~/.boiler-room.env`; never prints it. Both commits must be on
 * origin: the computer clones the public repo over https.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  type Computer,
  checkpointComputer,
  computerHome,
  destroyComputer,
  exec,
  execDetached,
  FILM_COMPUTER_SIZE,
  naiveApi,
  waitDetached,
  waitRunning,
  writeFile,
} from '../src/launcher.ts';
import {
  assertPushed,
  chargedUsd,
  envValue,
  git,
  remoteHead,
  repoUrl,
  requireEnv,
  stamp,
} from './lib.ts';
import { CLEAN_SCRIPT, readyCheck, setupScript } from './recipe.ts';

const { values } = parseArgs({
  options: {
    'film-ref': { type: 'string', default: 'feat/crew-agents' },
    'film-commit': { type: 'string' },
    'runner-commit': { type: 'string' },
    adapter: { type: 'string', default: 'auto' },
    'no-fork-test': { type: 'boolean', default: false },
  },
});

const adapter = values.adapter as 'auto' | 'film' | 'standin';
if (!['auto', 'film', 'standin'].includes(adapter))
  throw new Error('--adapter is auto, film or standin.');

const runnerCommit = values['runner-commit'] ?? git('rev-parse', 'HEAD');
const filmCommit = values['film-commit'] ?? remoteHead(values['film-ref'] as string);
assertPushed(runnerCommit);
assertPushed(filmCommit);
const url = repoUrl();
const api = naiveApi({ key: requireEnv('NAIVE_API_KEY') });
const runnerKey = envValue('NAIVE_RUNNER_KEY');

const live = new Map<string, Computer & { createdMs: number }>();
const spent: Array<{ name: string; usd: number }> = [];

async function destroy(id: string) {
  const computer = live.get(id);
  await destroyComputer(api, id);
  if (computer) {
    spent.push({ name: computer.name, usd: chargedUsd(computer.createdMs, Date.now()) });
    live.delete(id);
  }
  stamp(`destroyed ${id}`);
}

async function cleanUp() {
  for (const id of [...live.keys()]) {
    try {
      await destroy(id);
    } catch (error) {
      stamp(
        `could not destroy ${id}: ${error instanceof Error ? error.message : String(error)}. Destroy it by hand.`,
      );
    }
  }
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    stamp(`${signal}: destroying the computers this build made`);
    cleanUp().finally(() => process.exit(130));
  });
}

async function create(name: string, snapshotId?: string) {
  const computer = await api.request<Computer>('POST', '/v1/computers', {
    name,
    ...FILM_COMPUTER_SIZE,
    ...(snapshotId ? { snapshot_id: snapshotId } : {}),
  });
  live.set(computer.id, { ...computer, createdMs: Date.now() });
  stamp(`created ${computer.id} (${name})`);
  await waitRunning(api, computer.id);
  stamp(`${computer.id} is running`);
  return computer.id;
}

async function ready(computerId: string, allowRunDir = false) {
  const result = await exec(api, computerId, readyCheck({ allowRunDir }), 300_000);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.exit_code !== 0 || !result.stdout.includes('READY')) {
    throw new Error(
      `The ready check failed on ${computerId} (exit ${result.exit_code}):\n${output.slice(-3000)}`,
    );
  }
  return result.stdout.trim();
}

async function main() {
  const started = Date.now();
  stamp(
    `runner ${runnerCommit.slice(0, 12)}, crew ${filmCommit.slice(0, 12)}, adapter ${adapter}, from ${url}`,
  );
  stamp(
    runnerKey
      ? 'the runner key from NAIVE_RUNNER_KEY goes into the snapshot'
      : 'no NAIVE_RUNNER_KEY in the env file: the snapshot holds no Naive key, which only the stand-in can run without',
  );

  const builder = await create(`br-film-base-${runnerCommit.slice(0, 12)}`);
  const home = await computerHome(api, builder);
  const setupStarted = Date.now();
  await execDetached(
    api,
    builder,
    home,
    'br-build',
    'setup',
    setupScript({ repoUrl: url, filmCommit, runnerCommit, adapter }),
  );
  let lastTail = '';
  const setup = await waitDetached(api, builder, 'br-build', 'setup', {
    timeoutMs: 30 * 60_000,
    intervalMs: 15_000,
    onTail: (tail) => {
      const line = tail
        .split('\n')
        .filter((item) => item.startsWith('setup:') && item !== 'setup: working')
        .at(-1);
      if (line && line !== lastTail) {
        lastTail = line;
        stamp(line);
      }
    },
  });
  if (setup.exitCode !== 0)
    throw new Error(`The setup failed (exit ${setup.exitCode}):\n${setup.tail}`);
  const setupSeconds = (Date.now() - setupStarted) / 1000;
  stamp(`setup took ${setupSeconds.toFixed(0)} s`);

  if (runnerKey) {
    await writeFile(api, builder, `${home}/.boiler-room.env`, `NAIVE_API_KEY=${runnerKey}\n`);
    const chmod = await exec(
      api,
      builder,
      'chmod 600 "$HOME/.boiler-room.env" && echo private',
      30_000,
    );
    if (!chmod.stdout.includes('private')) throw new Error('Could not make the key file private.');
    stamp('wrote the runner key to ~/.boiler-room.env (mode 600)');
  }

  const builderReady = await ready(builder);
  stamp(`ready on the builder:\n${builderReady}`);
  const adapterLine = /adapter (film|standin)/.exec(builderReady)?.[1] ?? 'unknown';
  const clean = await exec(api, builder, CLEAN_SCRIPT, 60_000);
  if (!clean.stdout.includes('cleaned'))
    throw new Error(`The clean-up failed: ${clean.stderr.slice(-500)}`);

  const snapshotStarted = Date.now();
  const { snapshot_id: snapshotId } = await checkpointComputer(api, builder);
  const snapshotSeconds = (Date.now() - snapshotStarted) / 1000;
  stamp(`snapshot ${snapshotId} in ${snapshotSeconds.toFixed(1)} s`);
  await destroy(builder);

  let fork: { readySeconds: number; output: string } | null = null;
  if (!values['no-fork-test']) {
    const forkStarted = Date.now();
    const forkId = await create(`br-film-forktest-${runnerCommit.slice(0, 12)}`, snapshotId);
    const output = await ready(forkId);
    fork = { readySeconds: (Date.now() - forkStarted) / 1000, output };
    stamp(`a fork was ready in ${fork.readySeconds.toFixed(1)} s`);
    await destroy(forkId);
  }

  const record = {
    snapshotId,
    runnerCommit,
    filmCommit,
    adapter: adapterLine,
    runnerKey: Boolean(runnerKey),
    size: FILM_COMPUTER_SIZE,
    builtAt: new Date().toISOString(),
    setupSeconds,
    snapshotSeconds,
    forkReadySeconds: fork?.readySeconds ?? null,
    totalSeconds: (Date.now() - started) / 1000,
    spentUsd: Number(spent.reduce((sum, item) => sum + item.usd, 0).toFixed(4)),
    computers: spent,
  };
  mkdirSync('out', { recursive: true });
  writeFileSync(`out/snapshot-${snapshotId}.json`, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
  console.log(
    `\nRUNNER_SNAPSHOT_ID=${snapshotId}\nRUNNER_COMMIT=${runnerCommit}\nRUNNER_FILM_COMMIT=${filmCommit}`,
  );
}

main()
  .catch(async (error) => {
    stamp(`failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanUp();
  });
