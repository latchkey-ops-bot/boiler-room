import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addDays,
  countdownWords,
  daysBetween,
  formatLaunchDate,
  isLaunchDate,
  localToday,
  parseChannels,
  utcToday,
  videosAtMost,
} from '../src/lib/launch.ts';
import type { Principal } from '../src/server/api/context.ts';
import { ApiError } from '../src/server/api/errors.ts';
import { createFilm, getFilmDetail } from '../src/server/api/films.ts';
import { json, readJson } from '../src/server/api/http.ts';
import { launchPlanInput, setLaunchPlan } from '../src/server/api/launch.ts';
import { makeRoute } from '../src/server/api/route.ts';
import { SAMPLE_CAMPAIGN } from '../src/server/pipeline/simulated.ts';
import { contextFor, startWorkerEnv, testClock } from './helpers.ts';

describe('launch dates', () => {
  it('takes only real calendar dates', () => {
    expect(isLaunchDate('2026-11-18')).toBe(true);
    expect(isLaunchDate('2028-02-29')).toBe(true);
    expect(isLaunchDate('2026-02-29')).toBe(false);
    expect(isLaunchDate('2026-13-01')).toBe(false);
    expect(isLaunchDate('18/11/2026')).toBe(false);
    expect(isLaunchDate('2026-11-18T00:00:00Z')).toBe(false);
  });

  it('counts whole days, across months and clock changes', () => {
    expect(daysBetween('2026-11-07', '2026-11-18')).toBe(11);
    expect(daysBetween('2026-10-20', '2026-11-03')).toBe(14);
    expect(daysBetween('2026-11-18', '2026-11-18')).toBe(0);
    expect(daysBetween('2026-11-19', '2026-11-18')).toBe(-1);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('reads today in UTC and in the viewer’s calendar', () => {
    const late = new Date('2026-11-07T23:30:00Z');
    expect(utcToday(late)).toBe('2026-11-07');
    expect(localToday(new Date(2026, 10, 8, 0, 30))).toBe('2026-11-08');
  });

  it('says the countdown in plain words', () => {
    expect(countdownWords(11)).toEqual({ score: '11', words: 'days to launch' });
    expect(countdownWords(1)).toEqual({ score: '1', words: 'day to launch' });
    expect(countdownWords(0)).toEqual({ score: '0', words: 'Launch day is today' });
    expect(countdownWords(-3)).toEqual({ score: '3', words: 'days since launch' });
  });

  it('writes the date as the dashboard does', () => {
    expect(formatLaunchDate('2026-11-18')).toBe('Wednesday 18 November');
    expect(formatLaunchDate('2026-11-18', true)).toBe('Wed 18 Nov');
  });

  it('keeps known channels, in the landing page’s order', () => {
    expect(parseChannels('["reels","x","myspace"]')).toEqual(['x', 'reels']);
    expect(parseChannels('not json')).toEqual([]);
    expect(parseChannels(null)).toEqual([]);
  });

  it('counts the most videos one approval can make from the campaign', () => {
    // 3 shapes, the main opening or 1 alternate, 2 calls to action.
    expect(videosAtMost(SAMPLE_CAMPAIGN)).toBe(12);
    const plain = { ...SAMPLE_CAMPAIGN, variants: { hooks: [], formats: ['16:9'], ctas: [] } };
    expect(videosAtMost(plain as typeof SAMPLE_CAMPAIGN)).toBe(1);
  });
});

describe('launch plan API', () => {
  type Proxy = Awaited<ReturnType<typeof startWorkerEnv>>;
  let proxy: Proxy;
  let users = 0;
  const newUser = (): Principal => {
    users += 1;
    return { userId: `user_launch_${users}`, orgId: null };
  };

  beforeAll(async () => {
    proxy = await startWorkerEnv();
  });
  afterAll(async () => {
    await proxy?.dispose();
  });

  async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code });
  }

  it('sets the day and channels, and the film carries them', async () => {
    const clock = testClock('2026-11-07T12:00:00.000Z');
    const ctx = await contextFor(newUser(), proxy.env, clock.now);
    const { film } = await createFilm(ctx, { url: 'nova.com' });
    expect(film).toMatchObject({ launchDate: null, launchChannels: [] });

    const saved = await setLaunchPlan(ctx, film.id, {
      date: '2026-11-18',
      channels: ['reels', 'x', 'x'],
    });
    expect(saved).toMatchObject({ launchDate: '2026-11-18', launchChannels: ['x', 'reels'] });
    const detail = await getFilmDetail(ctx, film.id);
    expect(detail.film).toMatchObject({ launchDate: '2026-11-18', launchChannels: ['x', 'reels'] });

    const cleared = await setLaunchPlan(ctx, film.id, { date: null, channels: [] });
    expect(cleared).toMatchObject({ launchDate: null, launchChannels: [] });
  });

  it('refuses a day that has passed or is years away', async () => {
    const clock = testClock('2026-11-07T12:00:00.000Z');
    const ctx = await contextFor(newUser(), proxy.env, clock.now);
    const { film } = await createFilm(ctx, { url: 'nova.com' });
    // A day behind UTC is still today somewhere.
    await setLaunchPlan(ctx, film.id, { date: '2026-11-06', channels: [] });
    await expectApiError(
      setLaunchPlan(ctx, film.id, { date: '2026-11-05', channels: [] }),
      400,
      'launch_in_past',
    );
    await expectApiError(
      setLaunchPlan(ctx, film.id, { date: '2030-01-01', channels: [] }),
      400,
      'launch_too_far',
    );
  });

  it("will not touch someone else's film", async () => {
    const clock = testClock();
    const owner = await contextFor(newUser(), proxy.env, clock.now);
    const stranger = await contextFor(newUser(), proxy.env, clock.now);
    const { film } = await createFilm(owner, { url: 'nova.com' });
    await expectApiError(
      setLaunchPlan(stranger, film.id, { date: '2026-11-18', channels: [] }),
      404,
      'not_found',
    );
    expect((await getFilmDetail(owner, film.id)).film.launchDate).toBeNull();
  });

  it('validates the body: a real date and known channels only', () => {
    expect(launchPlanInput.safeParse({ date: '2026-11-18', channels: ['x'] }).success).toBe(true);
    expect(launchPlanInput.safeParse({ date: null, channels: [] }).success).toBe(true);
    expect(launchPlanInput.safeParse({ date: '2026-02-30', channels: [] }).success).toBe(false);
    expect(launchPlanInput.safeParse({ date: '2026-11-18', channels: ['fax'] }).success).toBe(
      false,
    );
    expect(launchPlanInput.safeParse({ date: '2026-11-18' }).success).toBe(false);
    expect(
      launchPlanInput.safeParse({ date: '2026-11-18', channels: [], extra: true }).success,
    ).toBe(false);
  });

  it('answers through the route wrapper: 401 signed out, 200 with the film', async () => {
    const principal = newUser();
    const bindings = { DB: proxy.env.DB, FILMS: proxy.env.FILMS, PIPELINE: 'simulated' };
    const clock = testClock();
    const ctx = await contextFor(principal, proxy.env, clock.now);
    const { film } = await createFilm(ctx, { url: 'nova.com' });
    const handler = async (
      routeCtx: Parameters<Parameters<ReturnType<typeof makeRoute>>[0]>[0],
      request: Request,
      params: { id: string },
    ) =>
      json({
        film: await setLaunchPlan(routeCtx, params.id, await readJson(request, launchPlanInput)),
      });
    const put = (body: unknown) =>
      new Request(`https://app.test/api/films/${film.id}/launch`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', origin: 'https://app.test' },
        body: JSON.stringify(body),
      });
    const params = { params: Promise.resolve({ id: film.id }) };

    const signedOut = makeRoute({ principal: async () => null, bindings: () => bindings });
    expect((await signedOut(handler)(put({ date: null, channels: [] }), params)).status).toBe(401);

    const signedIn = makeRoute({
      principal: async () => principal,
      bindings: () => bindings,
      clock: clock.now,
    });
    const ok = await signedIn(handler)(put({ date: '2026-11-18', channels: ['linkedin'] }), params);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { film: unknown }).film).toMatchObject({
      launchDate: '2026-11-18',
      launchChannels: ['linkedin'],
    });
    const bad = await signedIn(handler)(put({ date: 'soon', channels: [] }), params);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('invalid_body');
  });
});
