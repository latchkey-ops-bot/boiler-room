import sample from '@boiler-room/schema/examples/nova.campaign.json';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client.ts';
import { filmRuns, films, runnerControl } from '../src/db/schema.ts';
import type { Principal } from '../src/server/api/context.ts';
import { createFilm, listFilms, reviewScript } from '../src/server/api/films.ts';
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
// The caps are environment-wide: end everything a test left, so the next starts clean.
afterEach(async () => {
  const db = getDb(proxy.env.DB);
  await db.update(filmRuns).set({ state: 'ended', costCrewMicroUsd: 0 });
  await db.update(films).set({ status: 'done' }).where(eq(films.pipeline, 'naive'));
  await db.delete(runnerControl);
});

let users = 0;
const newUser = (): Principal => {
  users += 1;
  return { userId: `user_caps_${users}`, orgId: null };
};

async function expectRefused(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject({ status, code });
}

const approval = {
  decision: 'approve' as const,
  version: 1,
  hookId: null,
  ctaId: 'start-free',
  formats: ['16:9' as const],
  // The sample script's one claim nobody had confirmed.
  confirmedClaimIds: ['pricing'],
};

const runOf = (harness: Harness, filmId: string) =>
  harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.filmId, filmId) });

/** Takes a film through its script phase to the approval pause. */
async function toApproval(harness: Harness, filmId: string) {
  const run = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.filmId, filmId) });
  const runner = runnerClient(harness, harness.naive.bootstrap(run?.computerId as string));
  await runner.hello('script');
  const upload = await runner.upload(
    { kind: 'campaign', version: '1' },
    new TextEncoder().encode(JSON.stringify(sample)),
    'application/json',
  );
  const { fileId } = (await body(upload)) as { fileId: string };
  await runner.events('script', [
    { type: 'script_ready', version: 1, campaignFileId: fileId, unconfirmedClaims: [] },
    { type: 'runner.exit', exitCode: 0, signal: null, durationMs: 1 },
  ]);
  await harness.flush();
}

describe('who gets a real film', () => {
  it('gives real films only to the founders in REAL_FILM_USERS, once everything is configured', async () => {
    const listed = newUser();
    const harness = runnerHarness(proxy, { realUsers: [listed.userId] });
    const real = await createFilm(await harness.context(listed), { url: 'nova.com' });
    expect(real.film).toMatchObject({ pipeline: 'naive', simulated: false });
    const other = await createFilm(await harness.context(newUser()), { url: 'nova.com' });
    expect(other.film).toMatchObject({ pipeline: 'simulated', simulated: true });

    // No snapshot configured: the listed founder gets simulated films too, and Naive is untouched.
    const unbuilt = runnerHarness(proxy, {
      realUsers: [listed.userId],
      vars: { RUNNER_SNAPSHOT_ID: '' },
    });
    const fallback = await createFilm(await unbuilt.context(listed), { url: 'nova.com' });
    expect(fallback.film.pipeline).toBe('simulated');
    expect(unbuilt.naive.calls).toEqual([]);
  });

  it('drops the film and answers 503 when Naive will not create the computer', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId] });
    harness.naive.failNext('create', 402, 'insufficient_credits');
    const ctx = await harness.context(user);
    // PipelineUnavailableError, which the API answers as 503.
    await expect(createFilm(ctx, { url: 'nova.com' })).rejects.toThrow(
      "The crew can't start right now",
    );
    expect((await listFilms(ctx)).films).toEqual([]);
    const runs = await harness.db.select().from(filmRuns).where(sql`state != 'ended'`);
    expect(runs).toEqual([]);
  });
});

describe('real-film caps', () => {
  it('lets a founder have one real film at work, and a second once the first waits for them', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId] });
    const ctx = await harness.context(user);
    const first = await createFilm(ctx, { url: 'one.com' });
    await harness.flush();
    await expectRefused(createFilm(ctx, { url: 'two.com' }), 429, 'too_many_films');

    // Paused at the approval gate it costs nothing and holds no Researcher.
    await toApproval(harness, first.film.id);
    const second = await createFilm(ctx, { url: 'two.com' });
    expect(second.film.pipeline).toBe('naive');
    await harness.flush();
    await toApproval(harness, second.film.id);
    // Two scripts waiting count at what they spent, not their caps: a third film still fits.
    const third = await createFilm(ctx, { url: 'three.com' });
    expect(third.film.pipeline).toBe('naive');
    await harness.flush();
    expect(harness.naive.calls.filter((call) => call.op === 'create')).toHaveLength(3);
  });

  it('checks the founder’s one film at work again when a waiting script is approved', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId] });
    const ctx = await harness.context(user);
    const waiting = await createFilm(ctx, { url: 'waiting.com' });
    await harness.flush();
    await toApproval(harness, waiting.film.id);
    // While A waits, B starts, as the cap allows: A's computer is paused.
    const working = await createFilm(ctx, { url: 'working.com' });
    await harness.flush();
    expect((await runOf(harness, working.film.id))?.state).toBe('launching');
    // Approving A now would put two of the founder's films at work at once.
    await expectRefused(reviewScript(ctx, waiting.film.id, approval), 429, 'too_many_films');
    expect((await runOf(harness, waiting.film.id))?.state).toBe('awaiting_approval');
    expect(harness.naive.calls.filter((call) => call.op === 'resume')).toHaveLength(0);
    // Once B reaches its own script, A may go on.
    await toApproval(harness, working.film.id);
    await reviewScript(ctx, waiting.film.id, approval);
    await harness.flush();
    expect(await runOf(harness, waiting.film.id)).toMatchObject({
      state: 'launching',
      phase: 'render',
    });
  });

  it('never lets scripts nobody approves block every new film for days', async () => {
    const alice = newUser();
    const bob = newUser();
    const carol = newUser();
    const harness = runnerHarness(proxy, {
      realUsers: [alice.userId, bob.userId, carol.userId],
    });
    for (const [person, url] of [
      [alice, 'alice.com'],
      [bob, 'bob.com'],
    ] as const) {
      const film = await createFilm(await harness.context(person), { url });
      await harness.flush();
      await toApproval(harness, film.film.id);
    }
    // Both scripts wait. Counted at their full caps they would leave no room in staging's $5.25
    // day for 72 hours; at what they spent, Carol's film starts.
    harness.clock.advance(3600);
    const carols = await createFilm(await harness.context(carol), { url: 'carol.com' });
    expect(carols.film.pipeline).toBe('naive');
  });

  it('reserves the rest of a film’s cap when it is approved, and refuses one that does not fit', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId] });
    const ctx = await harness.context(user);
    const film = await createFilm(ctx, { url: 'late.com' });
    await harness.flush();
    await toApproval(harness, film.film.id);
    // Meanwhile another film of the founder's ended having spent $3.00 of the $5.00 day.
    const other = await createFilm(ctx, { url: 'other.com' });
    await harness.db
      .update(filmRuns)
      .set({ state: 'ended', costCrewMicroUsd: 2_600_000, costComputeMicroUsd: 400_000 })
      .where(eq(filmRuns.filmId, other.film.id));
    await harness.db.update(films).set({ status: 'failed' }).where(eq(films.id, other.film.id));
    // The rest of the waiting film's $2.50 does not fit what is left of the day.
    await expectRefused(reviewScript(ctx, film.film.id, approval), 429, 'daily_cap');
    expect((await runOf(harness, film.film.id))?.state).toBe('awaiting_approval');
    // A day later it does.
    harness.clock.advance(24 * 3600 + 60);
    await reviewScript(await harness.context(user), film.film.id, approval);
    await harness.flush();
    expect(await runOf(harness, film.film.id)).toMatchObject({
      state: 'launching',
      phase: 'render',
    });
  });

  it('lets one real film hold the crew’s Researcher at a time, across every founder', async () => {
    const alice = newUser();
    const bob = newUser();
    const harness = runnerHarness(proxy, { realUsers: [alice.userId, bob.userId] });
    await createFilm(await harness.context(alice), { url: 'alice.com' });
    await harness.flush();
    await expectRefused(
      createFilm(await harness.context(bob), { url: 'bob.com' }),
      429,
      'crew_busy',
    );
  });

  it('holds the caps when many founders start at once', async () => {
    const people = Array.from({ length: 6 }, newUser);
    const harness = runnerHarness(proxy, { realUsers: people.map((p) => p.userId) });
    const contexts = await Promise.all(people.map((person) => harness.context(person)));
    const results = await Promise.allSettled(
      contexts.map((ctx, i) => createFilm(ctx, { url: `race${i}.com` })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 429 });
    }
    // A refused start never reaches Naive.
    expect(harness.naive.calls.filter((call) => call.op === 'create')).toHaveLength(1);
  });

  it('counts what ended films really spent against the day, and films at work at their cap', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, {
      realUsers: [user.userId],
      vars: { MAX_REAL_PER_ACCOUNT: '5' },
    });
    const ctx = await harness.context(user);
    const first = await createFilm(ctx, { url: 'spent.com' });
    // It ended having spent $4.00 of the founder's $5.00 day: $2.50 more does not fit.
    await harness.db
      .update(filmRuns)
      .set({ state: 'ended', costCrewMicroUsd: 3_500_000, costComputeMicroUsd: 500_000 })
      .where(eq(filmRuns.filmId, first.film.id));
    await harness.db.update(films).set({ status: 'failed' }).where(eq(films.id, first.film.id));
    await expectRefused(createFilm(ctx, { url: 'again.com' }), 429, 'daily_cap');
    // A day later it no longer counts.
    harness.clock.advance(24 * 3600 + 60);
    const tomorrow = await createFilm(await harness.context(user), { url: 'tomorrow.com' });
    expect(tomorrow.film.pipeline).toBe('naive');
    await harness.flush();
    const rendering = { state: 'render_running', phase: 'render' as const };
    await harness.db.update(filmRuns).set(rendering).where(eq(filmRuns.filmId, tomorrow.film.id));
    // A film at work counts at its full cap however long ago it started: two days on, $2.50 +
    // $2.50 fits the $5.00 day, and a third would not.
    harness.clock.advance(2 * 24 * 3600);
    const next = await createFilm(await harness.context(user), { url: 'later.com' });
    await harness.flush();
    await harness.db.update(filmRuns).set(rendering).where(eq(filmRuns.filmId, next.film.id));
    await expectRefused(
      createFilm(await harness.context(user), { url: 'third.com' }),
      429,
      'daily_cap',
    );
  });

  it('refuses every new real film while the tripwire holds', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId] });
    await harness.db
      .insert(runnerControl)
      .values({ id: 'global', halted: true, haltedReason: 'test', updatedAt: 0 });
    await expectRefused(
      createFilm(await harness.context(user), { url: 'nova.com' }),
      503,
      'crew_paused',
    );
    expect(harness.naive.calls).toEqual([]);
  });
});
