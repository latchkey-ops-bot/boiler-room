/**
 * The two halves of a real film together: the real runner from `services/film-runner`, with the
 * stand-in film command, against the website's own routes (`runnerFetch`, as `worker.ts` serves
 * them), on a local D1 and R2 with a fake Naive. Each half used to be tested only against its own
 * fake of the other, and the two did not fit: the bootstrap was written where the runner never
 * looked, and the runner's hello, script and error events were refused.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunnerEvent } from '@boiler-room/film-runner/contract';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { filmRuns, runEvents, runFiles } from '../src/db/schema.ts';
import type { Principal } from '../src/server/api/context.ts';
import { createFilm, getFilmDetail, reviewScript } from '../src/server/api/films.ts';
import { BOOTSTRAP_PATH } from '../src/server/runner/contract.ts';
import type { runnerEvent } from '../src/server/runner/events.ts';
import { runnerFetch } from '../src/server/runner/worker-routes.ts';
import { startWorkerEnv } from './helpers.ts';
import { type Harness, HOME, runnerHarness } from './runner-helpers.ts';

/**
 * Every event the runner can send is one the website's schema takes. A field the runner adds or
 * changes that the website does not take fails the typecheck here.
 */
type WebEvent = z.input<typeof runnerEvent>;
const _everyRunnerEventFits = (event: RunnerEvent): WebEvent => event;
void _everyRunnerEventFits;

/**
 * The runner, loaded at run time: it is Node code, and this app's typecheck has the Workers types,
 * which cannot hold Node's child processes. `services/film-runner` typechecks it on its own.
 */
interface RunnerClass {
  new (options: {
    runDir: string;
    config: ReturnType<typeof computer>['config'];
    fetch: typeof fetch;
    log: (line: string) => void;
    swapon: boolean;
    baseBackoffMs: number;
    maxBackoffMs: number;
    drainMs: number;
    tailPollMs: number;
  }): { run(): Promise<number> };
}
const RUNNER_MODULE = fileURLToPath(
  new URL('../../../services/film-runner/src/runner.ts', import.meta.url),
);
const loadRunner = async () =>
  ((await import(/* @vite-ignore */ RUNNER_MODULE)) as { Runner: RunnerClass }).Runner;

type Proxy = Awaited<ReturnType<typeof startWorkerEnv>>;
let proxy: Proxy;
beforeAll(async () => {
  proxy = await startWorkerEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});

let users = 0;
const newUser = (): Principal => {
  users += 1;
  return { userId: `user_contract_${users}`, orgId: null };
};
const ROOMY = {
  MAX_REAL_GLOBAL: '100',
  MAX_REAL_PER_ACCOUNT: '100',
  ACCOUNT_DAILY_CAP_USD: '1000',
  GLOBAL_DAILY_CAP_USD: '1000',
  RUNNER_ALLOW_STANDIN: 'true',
};
const RUNNER_COMMIT = 'a'.repeat(40);
const FILM_COMMIT = 'b'.repeat(40);

/** The computer's home on this machine, with the stand-in's runner config. */
function computer() {
  const home = mkdtempSync(join(tmpdir(), 'br-film-home-'));
  const runDir = join(home, 'br-run');
  mkdirSync(runDir, { recursive: true });
  return {
    home,
    runDir,
    config: {
      adapter: 'standin' as const,
      runnerCommit: RUNNER_COMMIT,
      filmCommit: FILM_COMMIT,
      filmDir: join(home, 'boiler-room'),
      swapfile: null,
      envFile: join(home, '.boiler-room.env'),
      standinPaceMs: 0,
    },
  };
}

/** The bootstrap the website wrote with `fs/write`, put where Naive would have put it. */
function deliverBootstrap(harness: Harness, computerId: string, home: string): string {
  const path = `${HOME}/${BOOTSTRAP_PATH}`;
  const text = harness.naive.written.get(`${computerId}:${path}`);
  if (!text) throw new Error(`The website wrote no ${path}`);
  expect(harness.naive.dirs.has(`${computerId}:${HOME}/br-run`)).toBe(true);
  writeFileSync(join(home, BOOTSTRAP_PATH), text);
  return text;
}

/** One launch of the real runner, its calls served by the website's own routes. */
async function launch(harness: Harness, where: ReturnType<typeof computer>) {
  const lines: string[] = [];
  const fetchShim = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const headers = new Headers(init?.headers);
    const body = init?.body as Uint8Array | undefined;
    if (body) headers.set('content-length', String(body.byteLength));
    const request = new Request(url, { ...init, headers });
    const response = await runnerFetch(
      request,
      harness.bindings,
      { waitUntil: () => undefined },
      harness.deps,
    );
    await harness.flush();
    return response;
  };
  const Runner = await loadRunner();
  const runner = new Runner({
    runDir: where.runDir,
    config: where.config,
    fetch: fetchShim as typeof fetch,
    log: (line) => lines.push(line),
    swapon: false,
    baseBackoffMs: 5,
    maxBackoffMs: 20,
    drainMs: 5000,
    tailPollMs: 20,
  });
  const code = await runner.run();
  return { code, lines };
}

async function realFilm(harness: Harness, user: Principal) {
  const ctx = await harness.context(user);
  const detail = await createFilm(ctx, { url: 'nova.com' });
  await harness.flush();
  const run = await harness.db.query.filmRuns.findFirst({
    where: eq(filmRuns.filmId, detail.film.id),
  });
  if (!run?.computerId) throw new Error('No computer was made.');
  return { ctx, film: detail.film, run, computerId: run.computerId };
}

const runOf = (harness: Harness, runId: string) =>
  harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, runId) });

describe('the real runner against the website', () => {
  it('makes a stand-in film from start to delivery, paused for the approval, and labelled', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, {
      realUsers: [user.userId],
      vars: {
        ...ROOMY,
        RUNNER_COMMIT,
        RUNNER_FILM_COMMIT: FILM_COMMIT,
        NAIVE_RUNNER_KEY: `sk_test_${'r'.repeat(40)}`,
      },
      start: new Date().toISOString(),
    });
    const { ctx, film, run, computerId } = await realFilm(harness, user);
    const where = computer();

    // The script phase.
    const sent = deliverBootstrap(harness, computerId, where.home);
    expect(JSON.parse(sent).naiveKey).toBe(`sk_test_${'r'.repeat(40)}`);
    const script = await launch(harness, where);
    expect(script.code, script.lines.join('\n')).toBe(0);
    expect(existsSync(join(where.home, BOOTSTRAP_PATH))).toBe(false);
    await harness.flush();
    const paused = await runOf(harness, run.id);
    expect(paused).toMatchObject({
      state: 'awaiting_approval',
      computerState: 'paused',
      adapter: 'standin',
      scriptVersion: 1,
    });
    expect(paused?.exitedAt).not.toBeNull();
    let detail = await getFilmDetail(ctx, film.id);
    // A stand-in is no real film: it carries the simulated label.
    expect(detail.film).toMatchObject({ status: 'needs_you', stage: 'approval', simulated: true });
    expect(detail.events.some((event) => event.message.includes('stand-in'))).toBe(true);
    expect(detail.events.some((event) => event.message.startsWith('Stand-in:'))).toBe(true);
    expect(detail.events.at(-1)?.message).toContain('1 claim needs you to confirm it.');

    // The founder approves; the computer comes back and the render phase runs.
    await reviewScript(ctx, film.id, {
      decision: 'approve',
      version: 1,
      hookId: null,
      ctaId: 'start-free',
      formats: ['16:9', '9:16'],
      confirmedClaimIds: ['pricing'],
    });
    await harness.flush();
    expect((await runOf(harness, run.id))?.state).toBe('launching');
    deliverBootstrap(harness, computerId, where.home);
    const render = await launch(harness, where);
    expect(render.code, render.lines.join('\n')).toBe(0);
    await harness.flush();

    // Delivered, with the MP4s in R2 as the computer made them, and nothing left on Naive.
    const ended = await runOf(harness, run.id);
    expect(ended).toMatchObject({ state: 'ended', computerState: 'destroyed', checkpointId: null });
    expect(ended?.deliveredAt).not.toBeNull();
    expect(harness.naive.live()).toEqual([]);
    detail = await getFilmDetail(ctx, film.id);
    expect(detail.film).toMatchObject({ status: 'done', simulated: true });
    expect(detail.deliverables.map((file) => file.format).sort()).toEqual(['16:9', '9:16']);
    const mp4s = await harness.db
      .select()
      .from(runFiles)
      .where(eq(runFiles.runId, run.id))
      .then((rows) => rows.filter((row) => row.kind === 'mp4'));
    for (const row of mp4s) {
      const object = await harness.bindings.FILMS.get(row.r2Key);
      const bytes = new Uint8Array(await (object as R2ObjectBody).arrayBuffer());
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);
      const made = readFileSync(
        join(where.runDir, 'film', 'renders', `${row.variantKey?.replaceAll(':', 'x')}.mp4`),
      );
      expect(bytes.byteLength).toBe(made.byteLength);
    }

    // No key in anything the website stored, and none left on the computer's disk.
    const stored = JSON.stringify(
      await harness.db.select().from(runEvents).where(eq(runEvents.runId, run.id)),
    );
    expect(stored).not.toContain(JSON.parse(sent).key);
    expect(stored).not.toContain('r'.repeat(40));
    expect(existsSync(join(where.runDir, 'naive.env'))).toBe(false);
  });

  it('fails a runner on other commits at once, with its reason, instead of relaunching it', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, {
      realUsers: [user.userId],
      vars: { ...ROOMY, RUNNER_COMMIT: 'c'.repeat(40) },
      start: new Date().toISOString(),
    });
    const { run, computerId } = await realFilm(harness, user);
    const where = computer();
    deliverBootstrap(harness, computerId, where.home);
    const { code } = await launch(harness, where);
    expect(code).toBe(23);
    await harness.flush();
    expect(await runOf(harness, run.id)).toMatchObject({
      state: 'ended',
      failureCode: 'runner_outdated',
      launchAttempts: 1,
    });
    expect(harness.naive.live()).toEqual([]);
  });

  it('refuses a stand-in where only the real film command may make a film', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, {
      realUsers: [user.userId],
      vars: { ...ROOMY, RUNNER_ALLOW_STANDIN: 'false' },
      start: new Date().toISOString(),
    });
    const { run, computerId } = await realFilm(harness, user);
    const where = computer();
    deliverBootstrap(harness, computerId, where.home);
    expect((await launch(harness, where)).code).toBe(23);
    await harness.flush();
    expect(await runOf(harness, run.id)).toMatchObject({
      state: 'ended',
      failureCode: 'runner_standin',
    });
  });
});
