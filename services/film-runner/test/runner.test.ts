/**
 * The runner end to end on this machine: the real runner and the stand-in film command against the
 * receiver, which checks every signature and hash as the website will.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  type Instructions,
  RUNNER_EXIT,
  type RunnerEvent,
} from '../src/contract.ts';
import { Runner } from '../src/runner.ts';
import {
  FILM_ID,
  instructionsFor,
  MASTER,
  RUN_ID,
  standinConfig,
  tempDir,
  writeBootstrapFile,
} from './helpers.ts';
import { type Receiver, type ReceiverOptions, startReceiver } from './receiver.ts';

const open: Receiver[] = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
});

async function receiver(instructions: () => Instructions, extra: Partial<ReceiverOptions> = {}) {
  const started = await startReceiver({
    master: MASTER,
    filmId: FILM_ID,
    runId: RUN_ID,
    instructions,
    ...extra,
  });
  open.push(started);
  return started;
}

function runner(runDir: string, extra: Partial<ConstructorParameters<typeof Runner>[0]> = {}) {
  const lines: string[] = [];
  const instance = new Runner({
    runDir,
    config: standinConfig(runDir),
    log: (line) => lines.push(line),
    swapon: false,
    baseBackoffMs: 20,
    maxBackoffMs: 100,
    drainMs: 5000,
    ...extra,
  });
  return { instance, lines };
}

const types = (events: RunnerEvent[]) => events.map((event) => event.type);

describe('the runner with the stand-in', () => {
  it('runs the script phase, then the render phase after approval, as two launches', async () => {
    const runDir = tempDir();
    let instructions = instructionsFor('script');
    const site = await receiver(() => instructions);

    const bootstrap = await writeBootstrapFile(runDir, site.callbackBase);
    const first = runner(runDir);
    expect(await first.instance.run()).toBe(RUNNER_EXIT.ok);
    expect(existsSync(join(runDir, 'bootstrap.json'))).toBe(false);

    const scriptEvents = [...site.state.events];
    expect(types(scriptEvents)).toContain('script_ready');
    expect(scriptEvents.at(-1)).toMatchObject({
      type: 'runner.exit',
      exitCode: 0,
      phase: 'script',
    });
    const ready = scriptEvents.find((event) => event.type === 'script_ready');
    const campaign = site.state.files.find((file) => file.kind === 'campaign');
    expect(ready).toMatchObject({
      version: 1,
      campaignFileId: campaign?.fileId,
      unconfirmedClaims: ['pricing'],
    });
    const campaignBytes = readFileSync(join(runDir, 'film', 'campaign.json'));
    expect(campaign?.sha256).toBe(createHash('sha256').update(campaignBytes).digest('hex'));
    expect(site.state.files.map((file) => file.kind)).toEqual(['research', 'campaign']);
    // Every message the feed shows is labelled.
    for (const event of scriptEvents) {
      if ('message' in event && event.type !== 'error') expect(event.message).toMatch(/^Stand-in:/);
    }
    expect(site.state.hellos[0]).toMatchObject({
      type: 'runner.hello',
      adapter: 'standin',
      phase: null,
      launch: 1,
    });

    // The website takes the checkpoint and pauses; on approval it writes a new bootstrap.
    instructions = instructionsFor('render');
    await writeBootstrapFile(runDir, site.callbackBase);
    const second = runner(runDir);
    expect(await second.instance.run()).toBe(RUNNER_EXIT.ok);

    const all = site.state.events;
    const seqs = all.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const delivered = all.find((event) => event.type === 'delivered');
    expect(delivered).toMatchObject({
      version: 1,
      variants: ['16:9.main.start-free', '9:16.main.start-free'],
    });
    const mp4s = site.state.files.filter((file) => file.kind === 'mp4');
    expect(mp4s.map((file) => file.variant)).toEqual([
      '16:9.main.start-free',
      '9:16.main.start-free',
    ]);
    expect(mp4s.every((file) => file.contentType === 'video/mp4' && file.bytes > 1000)).toBe(true);
    expect(site.state.files.filter((file) => file.kind === 'still')).toHaveLength(2);
    expect(site.state.files.map((file) => file.kind)).toEqual(
      expect.arrayContaining(['quality', 'decisions', 'manifest']),
    );
    expect(all.filter((event) => event.type === 'qc')).toHaveLength(2);
    expect(all.at(-1)).toMatchObject({ type: 'runner.exit', exitCode: 0, phase: 'render' });
    expect(JSON.parse(readFileSync(join(runDir, 'approval.json'), 'utf8'))).toMatchObject({
      formats: ['16:9', '9:16'],
    });

    // The key never leaves memory.
    const everything =
      JSON.stringify(site.state) + first.lines.join('\n') + second.lines.join('\n');
    expect(everything).not.toContain(bootstrap.key);
    expect(site.state.rejected).toEqual([]);
  });

  it('runs a sample film in one phase with no pause', async () => {
    const runDir = tempDir();
    const site = await receiver(() => instructionsFor('all'));
    await writeBootstrapFile(runDir, site.callbackBase);
    expect(await runner(runDir).instance.run()).toBe(RUNNER_EXIT.ok);
    const events = site.state.events;
    expect(types(events)).toEqual(expect.arrayContaining(['script_ready', 'delivered']));
    expect(events.find((event) => event.type === 'delivered')).toMatchObject({
      variants: ['16:9.main.start-free'],
    });
  });

  it('keeps going through server errors, and sends each event once', async () => {
    const runDir = tempDir();
    const site = await receiver(() => instructionsFor('script'), {
      failNext: { count: 3, status: 503 },
    });
    await writeBootstrapFile(runDir, site.callbackBase);
    expect(await runner(runDir).instance.run()).toBe(RUNNER_EXIT.ok);
    expect(site.state.rejected.filter((item) => item.status === 503)).toHaveLength(3);
    expect(types(site.state.events)).toContain('script_ready');
  });

  it('stops the film when the website says so, and exits 143', async () => {
    const runDir = tempDir();
    let stop = false;
    const site = await receiver(() => instructionsFor('script'), {
      stop: () => ({ stop, reason: 'cost cap' }),
    });
    await writeBootstrapFile(runDir, site.callbackBase);
    const { instance } = runner(runDir, { config: standinConfig(runDir, { standinPaceMs: 400 }) });
    const done = instance.run();
    stop = true;
    expect(await done).toBe(RUNNER_EXIT.stopped);
    const events = site.state.events;
    expect(events.some((event) => event.type === 'error' && event.code === 'stopped')).toBe(true);
    expect(types(events)).not.toContain('script_ready');
    expect(events.at(-1)).toMatchObject({ type: 'runner.exit', exitCode: 143 });
  });

  it('reports a bad approval as the film command reported it', async () => {
    const runDir = tempDir();
    let instructions = instructionsFor('script');
    const site = await receiver(() => instructions);
    await writeBootstrapFile(runDir, site.callbackBase);
    await runner(runDir).instance.run();
    instructions = instructionsFor('render', {
      approval: { version: 2, hookId: null, ctaId: null, formats: ['16:9'], confirmedClaimIds: [] },
    });
    await writeBootstrapFile(runDir, site.callbackBase);
    expect(await runner(runDir).instance.run()).toBe(2);
    const error = site.state.events.find((event) => event.type === 'error');
    expect(error).toMatchObject({ code: 'bad_input' });
    expect(site.state.events.at(-1)).toMatchObject({ type: 'runner.exit', exitCode: 2 });
  });

  it('gives up after three rejected signatures', async () => {
    const runDir = tempDir();
    const site = await receiver(() => instructionsFor('script'));
    await writeBootstrapFile(
      runDir,
      site.callbackBase,
      {},
      'another-master-secret-that-is-long-enough',
    );
    expect(await runner(runDir).instance.run()).toBe(RUNNER_EXIT.unauthorized);
    expect(site.state.rejected.map((item) => item.code)).toEqual([
      'unauthorized',
      'unauthorized',
      'unauthorized',
    ]);
    expect(site.state.events).toEqual([]);
  });

  it('exits without calling home when there is no bootstrap', async () => {
    const runDir = tempDir();
    expect(await runner(runDir).instance.run()).toBe(RUNNER_EXIT.badBootstrap);
  });

  it('does not start the film when the instructions say stop', async () => {
    const runDir = tempDir();
    const site = await receiver(() => instructionsFor('script', { stop: true }));
    await writeBootstrapFile(runDir, site.callbackBase);
    expect(await runner(runDir).instance.run()).toBe(RUNNER_EXIT.stopped);
    expect(types(site.state.events)).toEqual(['error', 'runner.exit']);
    expect(existsSync(join(runDir, 'film.pid'))).toBe(false);
  });

  it('resends what a launch could not deliver, under the same numbers', async () => {
    const runDir = tempDir();
    const site = await receiver(() => instructionsFor('script'));
    await writeBootstrapFile(runDir, site.callbackBase);
    // A launch that crashed after numbering two events the website never confirmed.
    writeFileSync(join(runDir, 'seq'), '3\n');
    writeFileSync(
      join(runDir, 'outbox.jsonl'),
      `${JSON.stringify({ seq: 1, type: 'runner.heartbeat', at: new Date().toISOString(), phase: 'script', filmPid: null, load1: 0, memUsedMb: 1 })}\n${JSON.stringify({ seq: 2, type: 'runner.heartbeat', at: new Date().toISOString(), phase: 'script', filmPid: null, load1: 0, memUsedMb: 1 })}\n`,
    );
    expect(await runner(runDir).instance.run()).toBe(RUNNER_EXIT.ok);
    expect(site.state.events.slice(0, 2).map((event) => event.seq)).toEqual([1, 2]);
    expect((site.state.hellos[0] as { seq: number }).seq).toBe(3);
  });
});

describe('src/main.ts as the launch command runs it', () => {
  it('runs a phase as a process, reading its config and run dir from the environment', async () => {
    const runDir = tempDir();
    const site = await receiver(() => instructionsFor('script'));
    await writeBootstrapFile(runDir, site.callbackBase);
    const configFile = join(runDir, '..', `${RUN_ID}-config.json`);
    writeFileSync(configFile, JSON.stringify(standinConfig(runDir)));
    const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
    const output: string[] = [];
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [main], {
        env: { ...process.env, BR_RUN_DIR: runDir, FILM_RUNNER_CONFIG: configFile },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk) => output.push(String(chunk)));
      child.stderr.on('data', (chunk) => output.push(String(chunk)));
      child.on('exit', resolve);
    });
    expect(code, output.join('')).toBe(0);
    expect(types(site.state.events)).toContain('script_ready');
  });
});

describe('the self-test the snapshot build runs', () => {
  it('passes on a computer with what a film needs, and says what it checked', () => {
    const dir = tempDir();
    const configFile = join(dir, 'config.json');
    writeFileSync(configFile, JSON.stringify(standinConfig(dir)));
    const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
    const result = spawnSync(process.execPath, [main, '--self-test'], {
      encoding: 'utf8',
      env: { ...process.env, BR_RUN_DIR: join(dir, 'br-run'), FILM_RUNNER_CONFIG: configFile },
    });
    const report = JSON.parse(result.stdout) as {
      selfTest: string;
      checks: Array<{ name: string; ok: boolean }>;
    };
    expect(report.selfTest, result.stdout).toBe('pass');
    expect(result.status).toBe(0);
    expect(report.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'node 24 or later',
        'flock',
        'setsid',
        'config',
        'stand-in film command',
        'no run dir yet',
        'no Naive key on disk',
        'signing',
      ]),
    );
  });

  it('fails on a computer whose disk holds a Naive key', () => {
    const dir = tempDir();
    const envFile = join(dir, 'boiler-room.env');
    writeFileSync(envFile, `NAIVE_API_KEY=sk_live_${'z'.repeat(30)}\n`, { mode: 0o600 });
    const configFile = join(dir, 'config.json');
    writeFileSync(configFile, JSON.stringify(standinConfig(dir, { envFile })));
    const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
    const result = spawnSync(process.execPath, [main, '--self-test'], {
      encoding: 'utf8',
      env: { ...process.env, BR_RUN_DIR: join(dir, 'br-run'), FILM_RUNNER_CONFIG: configFile },
    });
    const report = JSON.parse(result.stdout) as {
      selfTest: string;
      checks: Array<{ name: string; ok: boolean; detail?: string }>;
    };
    expect(report.selfTest).toBe('fail');
    expect(report.checks.find((check) => check.name === 'no Naive key on disk')?.ok).toBe(false);
    expect(result.stdout).not.toContain('z'.repeat(30));
  });
});

describe('what a launch leaves behind for the next one', () => {
  /** Appends events a launch numbered but the website never confirmed. */
  const unconfirmed = (runDir: string, events: Record<string, unknown>[]) => {
    let seq = Number(readFileSync(join(runDir, 'seq'), 'utf8'));
    for (const event of events) {
      writeFileSync(join(runDir, 'outbox.jsonl'), `${JSON.stringify({ seq, ...event })}\n`, {
        flag: 'a',
      });
      seq += 1;
    }
    writeFileSync(join(runDir, 'seq'), `${seq}\n`);
  };

  it("never resends a past phase's events, or a past launch's runner.exit, to the next phase", async () => {
    const runDir = tempDir();
    let instructions = instructionsFor('script');
    const site = await receiver(() => instructions);
    await writeBootstrapFile(runDir, site.callbackBase);
    expect(await runner(runDir).instance.run()).toBe(RUNNER_EXIT.ok);
    const scriptSeqs = site.state.events.map((event) => event.seq);
    // The script launch's last batch, refused while the founder approved: never confirmed.
    const at = new Date().toISOString();
    unconfirmed(runDir, [
      {
        type: 'decision',
        at,
        phase: 'script',
        agent: 'director',
        stage: 'script',
        kind: 'passed',
        message: 'Late.',
      },
      { type: 'runner.exit', at, phase: 'script', exitCode: 0, signal: null, durationMs: 1 },
    ]);
    instructions = instructionsFor('render');
    await writeBootstrapFile(runDir, site.callbackBase);
    expect(await runner(runDir).instance.run()).toBe(RUNNER_EXIT.ok);
    const sent = site.state.events.filter((event) => !scriptSeqs.includes(event.seq));
    expect(sent.some((event) => event.phase === 'script')).toBe(false);
    expect(sent.filter((event) => event.type === 'runner.exit')).toHaveLength(1);
    expect(sent.at(-1)).toMatchObject({ type: 'runner.exit', phase: 'render', exitCode: 0 });
    const dropped = readFileSync(join(runDir, 'outbox.dropped.jsonl'), 'utf8').trim().split('\n');
    expect(dropped.map((line) => JSON.parse(line).type)).toEqual(['runner.exit', 'decision']);
  });

  it('sets aside a batch the website answers 409 wrong_state, so no later launch sends it', async () => {
    const runDir = tempDir();
    let refuse = false;
    const site = await receiver(() => instructionsFor('script'), {
      refuseEvents: (events) => {
        if (events.some((event) => event.type === 'runner.exit')) refuse = true;
        return refuse ? { status: 409, code: 'wrong_state' } : null;
      },
    });
    await writeBootstrapFile(runDir, site.callbackBase);
    // The phase itself finished; only its last batch was refused.
    expect(await runner(runDir).instance.run()).toBe(RUNNER_EXIT.ok);
    const refusedExit = site.state.rejected.filter((item) => item.code === 'wrong_state');
    expect(refusedExit.length).toBeGreaterThan(0);
    const outbox = readFileSync(join(runDir, 'outbox.jsonl'), 'utf8');
    expect(outbox).not.toContain('runner.exit');
    expect(readFileSync(join(runDir, 'outbox.dropped.jsonl'), 'utf8')).toContain('runner.exit');
  });
});

describe('the Naive key the website sends with a launch', () => {
  /** A crew checkout whose `pnpm film` records what it was given, then fails. */
  function fakeCrew(dir: string) {
    const filmDir = join(dir, 'crew');
    mkdirSync(filmDir, { recursive: true });
    writeFileSync(
      join(filmDir, 'package.json'),
      JSON.stringify({ name: 'fake-crew', private: true, scripts: { film: 'node film.mjs' } }),
    );
    writeFileSync(
      join(filmDir, 'film.mjs'),
      `import { readFileSync, statSync, writeFileSync } from 'node:fs';
const file = process.env.BOILER_ROOM_ENV;
writeFileSync(${JSON.stringify(join(dir, 'seen.json'))}, JSON.stringify({
  file, text: readFileSync(file, 'utf8'), mode: statSync(file).mode & 0o777,
}));
process.exit(1);
`,
    );
    return filmDir;
  }

  it('is in a private file only while the film command runs, and nowhere in what is sent', async () => {
    const dir = tempDir();
    const runDir = join(dir, 'br-run');
    const site = await receiver(() => instructionsFor('script'));
    const naiveKey = `sk_live_${'k'.repeat(40)}`;
    await writeBootstrapFile(runDir, site.callbackBase, { naiveKey });
    const { instance, lines } = runner(runDir, {
      config: standinConfig(runDir, { adapter: 'film', filmDir: fakeCrew(dir) }),
    });
    expect(await instance.run()).toBe(1);
    const seen = JSON.parse(readFileSync(join(dir, 'seen.json'), 'utf8'));
    expect(seen).toEqual({
      file: join(runDir, 'naive.env'),
      text: `NAIVE_API_KEY=${naiveKey}\n`,
      mode: 0o600,
    });
    expect(existsSync(join(runDir, 'naive.env'))).toBe(false);
    expect(JSON.stringify(site.state) + lines.join('\n')).not.toContain(naiveKey);
  });

  it('is required by the real film command: without one the run stops before it starts', async () => {
    const dir = tempDir();
    const runDir = join(dir, 'br-run');
    const site = await receiver(() => instructionsFor('script'));
    await writeBootstrapFile(runDir, site.callbackBase);
    const { instance } = runner(runDir, {
      config: standinConfig(runDir, { adapter: 'film', filmDir: fakeCrew(dir) }),
    });
    expect(await instance.run()).toBe(RUNNER_EXIT.badBootstrap);
    expect(site.state.events.find((event) => event.type === 'error')).toMatchObject({
      code: 'no_naive_key',
    });
    expect(existsSync(join(dir, 'seen.json'))).toBe(false);
  });

  it('says hello with the contract version, so the website can refuse a runner on another', async () => {
    const runDir = tempDir();
    const site = await receiver(() => instructionsFor('script'));
    await writeBootstrapFile(runDir, site.callbackBase);
    expect(await runner(runDir).instance.run()).toBe(RUNNER_EXIT.ok);
    expect(site.state.hellos[0]).toMatchObject({ contract: CONTRACT_VERSION, phase: null });
  });
});
