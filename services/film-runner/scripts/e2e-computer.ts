/**
 * `pnpm runner:e2e --snapshot snp_...`: one stand-in film on a real Naive computer, through every
 * launcher call the website makes, with the pause for approval in the middle.
 *
 * A computer has no inbound network, so the callback receiver (`test/receiver.ts`, which checks
 * signatures, hashes and replays as the website will) runs on the film computer itself, at
 * 127.0.0.1. Everything else is as the website will do it:
 *
 *  1. create the computer from the base snapshot, wait until it runs, read its home
 *  2. write bootstrap.json with fs/write, launch the runner detached: phase script
 *  3. the runner posts hello, events and the campaign, then runner.exit
 *  4. checkpoint (snapshot), then pause
 *  5. resume, write a new bootstrap.json, launch: phase render with the customer's approval
 *  6. the runner uploads the MP4s and stills, posts delivered and runner.exit
 *  7. optionally fork the checkpoint once (a late approval's path) and check it boots
 *  8. destroy the computers, delete the checkpoint, and print a report
 *
 * The signing secret is made here, sent with fs/write, and never printed. Uses the admin key from
 * `~/.boiler-room.env` unless `--key-env` names another entry, such as the website's scoped key.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  type Bootstrap,
  deriveRunKey,
  type Instructions,
  type RunnerEvent,
} from '../src/contract.ts';
import {
  checkpointComputer,
  computerHome,
  createFilmComputer,
  deleteSnapshot,
  destroyComputer,
  exec,
  getComputer,
  launchRunner,
  makeDir,
  naiveApi,
  pauseComputer,
  readFile,
  resumeComputer,
  waitRunning,
  writeBootstrap,
  writeFile,
} from '../src/launcher.ts';
import type { ReceiverState } from '../test/receiver.ts';
import { chargedUsd, requireEnv, stamp } from './lib.ts';

const { values } = parseArgs({
  options: {
    snapshot: { type: 'string' },
    'key-env': { type: 'string', default: 'NAIVE_API_KEY' },
    url: { type: 'string', default: 'https://linear.app/' },
    'fork-checkpoint': { type: 'boolean', default: false },
  },
});
const snapshotId = values.snapshot;
if (!snapshotId?.startsWith('snp_')) throw new Error('--snapshot snp_... is needed.');
const api = naiveApi({ key: requireEnv(values['key-env'] as string) });

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const newId = (prefix: string) =>
  `${prefix}_${Array.from(randomBytes(20), (byte) => ALPHABET[byte % 32]).join('')}`;
const filmId = newId('flm');
const runId = newId('run');
const master = randomBytes(32).toString('base64url');
const PORT = 8787;

const computers = new Map<string, number>();
const snapshots = new Set<string>();
const timings: Record<string, number> = {};
const spent: Array<{ id: string; usd: number }> = [];

async function timed<T>(name: string, step: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await step();
  timings[name] = (Date.now() - started) / 1000;
  stamp(`${name}: ${timings[name].toFixed(1)} s`);
  return result;
}

async function cleanUp() {
  for (const [id, createdMs] of computers) {
    try {
      await destroyComputer(api, id);
      spent.push({ id, usd: chargedUsd(createdMs, Date.now()) });
      computers.delete(id);
      stamp(`destroyed ${id}`);
    } catch (error) {
      stamp(`could not destroy ${id}: ${String(error)}. Destroy it by hand.`);
    }
  }
  for (const id of snapshots) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await deleteSnapshot(api, id);
        snapshots.delete(id);
        stamp(`deleted checkpoint ${id}`);
        break;
      } catch (error) {
        if (attempt === 5) stamp(`could not delete ${id}: ${String(error)}. Delete it by hand.`);
        else await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    cleanUp().finally(() => process.exit(130));
  });
}

function instructions(phase: 'script' | 'render'): Instructions {
  return {
    phase,
    mode: 'customer',
    url: values.url as string,
    scriptVersion: phase === 'render' ? 1 : 0,
    approval:
      phase === 'render'
        ? {
            version: 1,
            hookId: null,
            ctaId: 'start-free',
            formats: ['16:9', '9:16'],
            confirmedClaimIds: ['pricing'],
          }
        : null,
    revise: null,
    maxCrewUsd: 2,
    spentCrewUsd: 0,
    deadlineAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    stop: false,
  };
}

async function startReceiver(computerId: string) {
  const command = `cd "$HOME/film-runner" && (curl -s -o /dev/null http://127.0.0.1:${PORT}/ && echo already) || (setsid -f node test/receiver.ts --dir "$HOME/br-e2e" --port ${PORT} </dev/null >>"$HOME/br-e2e/receiver.log" 2>&1; sleep 1; echo started)`;
  const result = await exec(api, computerId, command, 30_000);
  stamp(`receiver: ${result.stdout.trim()}`);
}

async function state(computerId: string, home: string): Promise<ReceiverState> {
  return JSON.parse(await readFile(api, computerId, `${home}/br-e2e/state.json`)) as ReceiverState;
}

async function waitForExit(
  computerId: string,
  home: string,
  phase: string,
  timeoutMs = 10 * 60_000,
) {
  const deadline = Date.now() + timeoutMs;
  let shown = 0;
  for (;;) {
    let current: ReceiverState | null = null;
    try {
      current = await state(computerId, home);
    } catch {
      current = null;
    }
    if (current) {
      for (const event of current.events.slice(shown)) {
        const text =
          'message' in event
            ? ` ${event.message}`
            : event.type === 'artifact'
              ? ` ${event.kind} ${event.name}`
              : '';
        if (event.type !== 'runner.heartbeat') stamp(`  ${event.seq} ${event.type}${text}`);
      }
      shown = current.events.length;
      const exit = current.events.find(
        (event): event is Extract<RunnerEvent, { type: 'runner.exit' }> =>
          event.type === 'runner.exit' && event.phase === phase,
      );
      if (exit) return { exit, state: current };
    }
    if (Date.now() > deadline) {
      const log = await exec(
        api,
        computerId,
        'tail -n 40 "$HOME/br-run/runner.log" "$HOME/br-e2e/receiver.log"',
        30_000,
      );
      throw new Error(`No runner.exit for ${phase} in time.\n${log.stdout}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

async function bootstrapFor(): Promise<Bootstrap> {
  return {
    v: 1,
    filmId,
    runId,
    callbackBase: `http://127.0.0.1:${PORT}/api/runner/v1`,
    key: await deriveRunKey(master, filmId, runId),
    issuedAt: Math.floor(Date.now() / 1000),
  };
}

async function main() {
  stamp(`film ${filmId}, run ${runId}, from ${snapshotId}`);
  const computer = await timed('create to running', async () => {
    const created = await createFilmComputer(api, {
      env: 'e2e',
      filmId,
      runId,
      attempt: 1,
      snapshotId: snapshotId as string,
    });
    computers.set(created.id, Date.now());
    return waitRunning(api, created.id);
  });
  const id = computer.id;
  const home = await computerHome(api, id);

  // The receiver's secrets and settings, by fs/write only.
  await makeDir(api, id, `${home}/br-e2e`);
  await writeFile(api, id, `${home}/br-e2e/master`, master);
  await writeFile(api, id, `${home}/br-e2e/film.json`, JSON.stringify({ filmId, runId }));
  await writeFile(
    api,
    id,
    `${home}/br-e2e/instructions.json`,
    JSON.stringify(instructions('script')),
  );
  await startReceiver(id);

  await writeBootstrap(api, id, home, await bootstrapFor());
  const launch1 = await timed('launch exec (script)', () => launchRunner(api, id));
  stamp(`launch answered: ${launch1.stdout.trim()} in ${launch1.duration_ms ?? '?'} ms`);
  const script = await timed('script phase', () => waitForExit(id, home, 'script'));
  if (script.exit.exitCode !== 0)
    throw new Error(`The script phase exited ${script.exit.exitCode}.`);

  // The approval gate: checkpoint, then pause. A paused computer bills nothing.
  const checkpoint = await timed('checkpoint', () => checkpointComputer(api, id));
  snapshots.add(checkpoint.snapshot_id);
  await timed('pause', () => pauseComputer(api, id));
  const paused = await getComputer(api, id);
  stamp(`computer is ${paused.status}`);

  // The customer approves.
  await timed('resume', async () => {
    await resumeComputer(api, id);
    return waitRunning(api, id);
  });
  const alive = await exec(
    api,
    id,
    `pgrep -f "test/receiver.ts" >/dev/null && echo alive || echo gone`,
    30_000,
  );
  stamp(`after the pause, the receiver process is ${alive.stdout.trim()}`);
  await writeFile(
    api,
    id,
    `${home}/br-e2e/instructions.json`,
    JSON.stringify(instructions('render')),
  );
  await startReceiver(id);
  await writeBootstrap(api, id, home, await bootstrapFor());
  await timed('launch exec (render)', () => launchRunner(api, id));
  const render = await timed('render phase', () => waitForExit(id, home, 'render'));
  if (render.exit.exitCode !== 0)
    throw new Error(`The render phase exited ${render.exit.exitCode}.`);

  // Check what arrived against what is on the computer.
  const sums = await exec(
    api,
    id,
    'cd "$HOME/br-run/film" && sha256sum renders/*.mp4 campaign.json',
    30_000,
  );
  const onDisk = new Map(
    sums.stdout
      .trim()
      .split('\n')
      .map((line) => line.split(/\s+/))
      .map(([sum, file]) => [file?.split('/').pop() ?? '', sum ?? '']),
  );
  const mp4s = render.state.files.filter((file) => file.kind === 'mp4');
  const matches = mp4s.every((file) => onDisk.get(file.name) === file.sha256);
  const bootstrapLeft = await exec(
    api,
    id,
    'test -e "$HOME/br-run/bootstrap.json" && echo present || echo deleted',
    30_000,
  );
  const runnerLog = await exec(api, id, 'cat "$HOME/br-run/runner.log"', 30_000);

  let forkReport: { readySeconds: number; hasRunDir: boolean } | null = null;
  if (values['fork-checkpoint']) {
    const forkStarted = Date.now();
    const fork = await createFilmComputer(api, {
      env: 'e2e',
      filmId,
      runId,
      attempt: 2,
      snapshotId: checkpoint.snapshot_id,
    });
    computers.set(fork.id, Date.now());
    await waitRunning(api, fork.id);
    const check = await exec(
      api,
      fork.id,
      'test -f "$HOME/br-run/film/campaign.json" && echo kept || echo missing',
      30_000,
    );
    forkReport = {
      readySeconds: (Date.now() - forkStarted) / 1000,
      hasRunDir: check.stdout.includes('kept'),
    };
    stamp(
      `a fork of the checkpoint booted in ${forkReport.readySeconds.toFixed(1)} s, run dir ${check.stdout.trim()}`,
    );
  }

  await cleanUp();
  const report = {
    filmId,
    runId,
    snapshotId,
    computerId: id,
    timings,
    events: render.state.events.length,
    eventTypes: [...new Set(render.state.events.map((event) => event.type))],
    files: render.state.files.map(({ kind, name, bytes, variant }) => ({
      kind,
      name,
      bytes,
      variant,
    })),
    rejected: render.state.rejected,
    mp4ShaMatch: matches,
    bootstrapAfterRun: bootstrapLeft.stdout.trim(),
    keyInRunnerLog: runnerLog.stdout.includes(await deriveRunKey(master, filmId, runId)),
    receiverSurvivedPause: alive.stdout.includes('alive'),
    forkOfCheckpoint: forkReport,
    leftOver: { computers: [...computers.keys()], checkpoints: [...snapshots] },
    spentUsd: Number(spent.reduce((sum, item) => sum + item.usd, 0).toFixed(4)),
  };
  mkdirSync('out', { recursive: true });
  writeFileSync(`out/e2e-${filmId}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  const ok =
    matches &&
    report.rejected.length === 0 &&
    !report.keyInRunnerLog &&
    report.bootstrapAfterRun === 'deleted';
  if (!ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    stamp(`failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => cleanUp());
