/**
 * The runner end to end on this machine: the real runner and the stand-in film command against the
 * receiver, which checks every signature and hash as the website will.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { type Instructions, RUNNER_EXIT, type RunnerEvent } from '../src/contract.ts';
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
        'signing',
      ]),
    );
  });
});
