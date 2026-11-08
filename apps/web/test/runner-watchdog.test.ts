import sample from '@boiler-room/schema/examples/nova.campaign.json';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filmRuns, runnerControl, runnerNonces } from '../src/db/schema.ts';
import type { Principal } from '../src/server/api/context.ts';
import { createFilm, getFilmDetail } from '../src/server/api/films.ts';
import { blockMicroUsd, FILM_COMPUTER } from '../src/server/runner/config.ts';
import { watchdogTick } from '../src/server/runner/watchdog.ts';
import { startWorkerEnv } from './helpers.ts';
import { body, type Harness, runnerClient, runnerHarness } from './runner-helpers.ts';

type Proxy = Awaited<ReturnType<typeof startWorkerEnv>>;
let proxy: Proxy;

beforeAll(async () => {
  proxy = await startWorkerEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});

const ROOMY = {
  MAX_REAL_GLOBAL: '100',
  MAX_REAL_PER_ACCOUNT: '100',
  ACCOUNT_DAILY_CAP_USD: '1000',
  GLOBAL_DAILY_CAP_USD: '1000',
};

let users = 0;
const newUser = (): Principal => {
  users += 1;
  return { userId: `user_watchdog_${users}`, orgId: null };
};

async function realFilm(harness: Harness, user: Principal) {
  const ctx = await harness.context(user);
  const { film } = await createFilm(ctx, { url: 'nova.com' });
  await harness.flush();
  const run = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.filmId, film.id) });
  if (!run) throw new Error('no run');
  const runner =
    run.state === 'launching'
      ? runnerClient(harness, harness.naive.bootstrap(run.computerId as string))
      : null;
  return { ctx, film, run, runner };
}

const runOf = (harness: Harness, id: string) =>
  harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, id) });

/** A tick of the cron, with its `waitUntil` work run to the end. */
async function tick(harness: Harness) {
  const report = await watchdogTick(harness.deps());
  await harness.flush();
  return report;
}

/** Advances the clock in steps, with the runner's heartbeat in each, and a tick after each. */
async function work(harness: Harness, runId: string, minutes: number) {
  for (let i = 0; i < minutes; i++) {
    harness.clock.advance(60);
    await harness.db
      .update(filmRuns)
      .set({ heartbeatAt: harness.clock.now().getTime() })
      .where(eq(filmRuns.id, runId));
    await tick(harness);
  }
}

describe('the watchdog', () => {
  it('fails a film whose runner went silent, and destroys its computer', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { ctx, film, run, runner } = await realFilm(harness, user);
    await runner?.hello('script');
    harness.clock.advance(4 * 60);
    await tick(harness);
    expect((await runOf(harness, run.id))?.state).toBe('script_running');
    harness.clock.advance(2 * 60);
    const report = await tick(harness);
    expect(report.actions.join('\n')).toContain('runner_silent');
    expect(await runOf(harness, run.id)).toMatchObject({
      state: 'ended',
      failureCode: 'runner_silent',
    });
    expect(harness.naive.live()).toEqual([]);
    const detail = await getFilmDetail(ctx, film.id);
    expect(detail.film.status).toBe('failed');
    expect(detail.events.at(-1)?.message).toContain('stopped answering');
  });

  it('relaunches a runner that never said hello, then gives up and destroys the computer', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { run } = await realFilm(harness, user);
    const launches = () => harness.naive.calls.filter((call) => call.op === 'exec').length;
    expect(launches()).toBe(1);
    harness.clock.advance(2 * 60);
    await tick(harness);
    expect(launches()).toBe(1);
    harness.clock.advance(61);
    await tick(harness);
    expect(launches()).toBe(2);
    harness.clock.advance(3 * 60 + 1);
    await tick(harness);
    expect(launches()).toBe(3);
    harness.clock.advance(3 * 60 + 1);
    await tick(harness);
    expect(await runOf(harness, run.id)).toMatchObject({
      state: 'ended',
      failureCode: 'computer_start_timeout',
    });
    expect(harness.naive.live()).toEqual([]);
  });

  it('fails a film whose computer never started running', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    harness.naive.createStatus = 'creating';
    const { run } = await realFilm(harness, user);
    expect(run.state).toBe('provisioning');
    harness.clock.advance(11 * 60);
    await tick(harness);
    expect(await runOf(harness, run.id)).toMatchObject({
      state: 'ended',
      failureCode: 'computer_start_timeout',
    });
    expect(harness.naive.live()).toEqual([]);
  });

  it('stops a film past its phase deadline, then destroys the computer 90 seconds later', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, {
      realUsers: [user.userId],
      vars: { ...ROOMY, FILM_CAP_USD: '100' },
    });
    const { run, runner } = await realFilm(harness, user);
    await runner?.hello('script');
    await work(harness, run.id, 61);
    expect(await runOf(harness, run.id)).toMatchObject({
      state: 'stopping',
      stopReason: 'phase_timeout',
    });
    // The runner learns it on its next call.
    const answer = await runner?.events('script', [{ type: 'runner.heartbeat' }]);
    expect((await body(answer as Response)).control).toEqual({
      stop: true,
      reason: 'phase_timeout',
    });
    harness.clock.advance(91);
    await tick(harness);
    expect(await runOf(harness, run.id)).toMatchObject({
      state: 'ended',
      failureCode: 'phase_timeout',
    });
    expect(harness.naive.live()).toEqual([]);
  });

  it('counts compute by the 10-minute block and stops a film at its cap', async () => {
    const user = newUser();
    // $0.20: the fourth block ($0.0552 each) crosses it.
    const harness = runnerHarness(proxy, {
      realUsers: [user.userId],
      vars: { ...ROOMY, FILM_CAP_USD: '0.20' },
    });
    const { run, runner } = await realFilm(harness, user);
    await runner?.hello('script');
    const block = blockMicroUsd(FILM_COMPUTER);
    expect(block).toBe(55_200);
    await tick(harness);
    expect((await runOf(harness, run.id))?.costComputeMicroUsd).toBe(block);
    await work(harness, run.id, 10);
    expect((await runOf(harness, run.id))?.costComputeMicroUsd).toBe(2 * block);
    await work(harness, run.id, 20);
    const stopped = await runOf(harness, run.id);
    expect(stopped?.costComputeMicroUsd).toBe(4 * block);
    expect(stopped).toMatchObject({ state: 'stopping', stopReason: 'cost_cap' });
  });

  it("stops a film at once when the crew's own spend reaches the cap", async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { run, runner } = await realFilm(harness, user);
    await runner?.hello('script');
    const answer = await runner?.events('script', [
      { type: 'cost', step: 'researcher', microUsd: 2_500_000, totalMicroUsd: 2_500_000 },
    ]);
    expect((await body(answer as Response)).control).toEqual({ stop: true, reason: 'cost_cap' });
    expect((await runOf(harness, run.id))?.state).toBe('stopping');
    // A resent cost changes nothing: spend is the highest total reported.
    await runner?.events('script', [
      { type: 'cost', step: 'researcher', microUsd: 1, totalMicroUsd: 100 },
    ]);
    expect((await runOf(harness, run.id))?.costCrewMicroUsd).toBe(2_500_000);
  });

  it('destroys a paused computer before Naive’s 12 hours, keeps the checkpoint, and closes the film after 3 days', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { ctx, film, run, runner } = await realFilm(harness, user);
    await runner?.hello('script');
    const upload = await runner?.upload(
      { kind: 'campaign', version: '1' },
      new TextEncoder().encode(JSON.stringify(sample)),
      'application/json',
    );
    const { fileId } = (await body(upload as Response)) as { fileId: string };
    await runner?.events('script', [
      { type: 'script_ready', version: 1, campaignFileId: fileId, unconfirmedClaims: [] },
      { type: 'runner.exit', exitCode: 0, signal: null, durationMs: 1 },
    ]);
    await harness.flush();
    const paused = await runOf(harness, run.id);
    expect(paused).toMatchObject({ state: 'awaiting_approval', computerState: 'paused' });

    // Paused, it costs nothing: no compute is counted.
    harness.clock.advance(60 * 60);
    await tick(harness);
    expect((await runOf(harness, run.id))?.costComputeMicroUsd).toBe(paused?.costComputeMicroUsd);

    harness.clock.advance(10 * 3600 + 120);
    await tick(harness);
    const near = await runOf(harness, run.id);
    expect(near).toMatchObject({ state: 'awaiting_approval', computerState: 'destroyed' });
    expect(near?.checkpointId).toBe(paused?.checkpointId);
    expect(harness.naive.snapshots.has(paused?.checkpointId as string)).toBe(true);
    expect((await getFilmDetail(ctx, film.id)).film.status).toBe('needs_you');

    harness.clock.advance(72 * 3600);
    await tick(harness);
    expect(await runOf(harness, run.id)).toMatchObject({
      state: 'ended',
      failureCode: 'approval_expired',
    });
    expect(harness.naive.snapshots.size).toBe(0);
    expect((await getFilmDetail(ctx, film.id)).film.status).toBe('failed');
  });

  it('destroys film computers that no live film owns, and leaves others alone', async () => {
    const harness = runnerHarness(proxy, { vars: ROOMY });
    const old = new Date(harness.clock.now().getTime() - 11 * 60_000).toISOString();
    const fresh = harness.clock.now().toISOString();
    harness.naive.computers.set('cmp_stray', {
      id: 'cmp_stray',
      name: 'br-film-staging-flm_gone0000000000000000',
      status: 'running',
      snapshot_id: 'snp_base',
      created_at: old,
    });
    harness.naive.computers.set('cmp_new', {
      id: 'cmp_new',
      name: 'br-film-staging-flm_soon0000000000000000',
      status: 'running',
      snapshot_id: 'snp_base',
      created_at: fresh,
    });
    harness.naive.computers.set('cmp_other', {
      id: 'cmp_other',
      name: 'br-researcher-computer',
      status: 'running',
      snapshot_id: null,
      created_at: old,
    });
    harness.naive.computers.set('cmp_prod', {
      id: 'cmp_prod',
      name: 'br-film-production-flm_x000000000000000000',
      status: 'running',
      snapshot_id: null,
      created_at: old,
    });
    await tick(harness);
    expect(harness.naive.computers.get('cmp_stray')?.status).toBe('destroyed');
    expect(harness.naive.computers.get('cmp_new')?.status).toBe('running');
    expect(harness.naive.computers.get('cmp_other')?.status).toBe('running');
    expect(harness.naive.computers.get('cmp_prod')?.status).toBe('running');
  });

  it('forgets nonces after 15 minutes', async () => {
    const harness = runnerHarness(proxy, { vars: ROOMY });
    const now = harness.clock.now().getTime();
    await harness.db.insert(runnerNonces).values([
      { nonce: 'f'.repeat(32), filmId: 'flm_x', seenAt: now - 16 * 60_000 },
      { nonce: 'e'.repeat(32), filmId: 'flm_x', seenAt: now - 14 * 60_000 },
    ]);
    await tick(harness);
    const left = await harness.db.select().from(runnerNonces);
    expect(left.map((row) => row.nonce)).toContain('e'.repeat(32));
    expect(left.map((row) => row.nonce)).not.toContain('f'.repeat(32));
  });

  it('halts every real film when the Naive balance falls by more than the day’s cap', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, {
      realUsers: [user.userId],
      vars: { ...ROOMY, GLOBAL_DAILY_CAP_USD: '5.25' },
      start: '2026-11-20T12:00:00.000Z',
    });
    const { run, runner } = await realFilm(harness, user);
    await runner?.hello('script');
    await tick(harness);
    harness.naive.balance -= 6_000_000;
    harness.clock.advance(60);
    await harness.db
      .update(filmRuns)
      .set({ heartbeatAt: harness.clock.now().getTime() })
      .where(eq(filmRuns.id, run.id));
    const report = await tick(harness);
    expect(report.actions.join('\n')).toContain('tripwire');
    expect((await runOf(harness, run.id))?.state).toBe('stopping');
    const control = await harness.db.query.runnerControl.findFirst({
      where: eq(runnerControl.id, 'global'),
    });
    expect(control?.halted).toBe(true);
    await harness.db.delete(runnerControl);
  });
});

describe('a launch that cannot happen', () => {
  it('fails at once, and counts no more compute, when the computer is gone before the launch', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    harness.naive.createStatus = 'creating';
    const { run } = await realFilm(harness, user);
    expect(run.state).toBe('provisioning');
    // Naive lost the computer before it ever ran (a host failure, say).
    const computer = harness.naive.computers.get(run.computerId as string);
    if (computer) computer.status = 'destroyed';
    harness.clock.advance(60);
    await tick(harness);
    const failed = await runOf(harness, run.id);
    expect(failed).toMatchObject({ state: 'ended', failureCode: 'computer_failed' });
    expect(failed?.computerState).toBe('destroyed');
    const charged = failed?.costComputeMicroUsd;
    harness.clock.advance(60 * 60);
    await tick(harness);
    expect((await runOf(harness, run.id))?.costComputeMicroUsd).toBe(charged);
  });

  it('fails a film whose launch fails before its computer answers, after its tries', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    harness.naive.failNext('inspect', 502, 'bad_gateway');
    const { film } = await createFilm(await harness.context(user), { url: 'nova.com' });
    await harness.flush();
    const run = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.filmId, film.id) });
    if (!run) throw new Error('no run');
    // The try is counted though `inspect` failed before anything was written.
    expect(await runOf(harness, run.id)).toMatchObject({ state: 'launching', launchAttempts: 1 });
    for (let minute = 0; minute < 12; minute++) {
      harness.naive.failNext('inspect', 502, 'bad_gateway');
      harness.clock.advance(60);
      await tick(harness);
    }
    expect(await runOf(harness, run.id)).toMatchObject({
      state: 'ended',
      failureCode: 'computer_start_timeout',
      launchAttempts: 3,
    });
    expect(harness.naive.live()).toEqual([]);
  });

  it('fails a run left launching when no new try could begin', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { run } = await realFilm(harness, user);
    // As if its advance() kept stopping short: no try is counted, and launchedAt stays old.
    await harness.db.update(filmRuns).set({ computerId: null }).where(eq(filmRuns.id, run.id));
    harness.clock.advance(5 * 60);
    await tick(harness);
    expect((await runOf(harness, run.id))?.state).toBe('launching');
    harness.clock.advance(2 * 60);
    await tick(harness);
    expect(await runOf(harness, run.id)).toMatchObject({
      failureCode: 'computer_start_timeout',
    });
  });

  it('stops counting compute for a computer Naive no longer has, and fails the film at work on it', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { run, runner } = await realFilm(harness, user);
    await runner?.hello();
    harness.naive.computers.delete(run.computerId as string);
    harness.clock.advance(60);
    await harness.db
      .update(filmRuns)
      .set({ heartbeatAt: harness.clock.now().getTime() })
      .where(eq(filmRuns.id, run.id));
    const report = await tick(harness);
    expect(report.actions.join('\n')).toContain('is gone from Naive');
    expect(await runOf(harness, run.id)).toMatchObject({ state: 'failed', runningSince: null });
    await tick(harness);
    expect(await runOf(harness, run.id)).toMatchObject({
      state: 'ended',
      failureCode: 'computer_failed',
      computerState: 'destroyed',
      runningSince: null,
    });
  });
});
