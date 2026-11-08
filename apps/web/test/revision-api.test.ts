import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client.ts';
import { deliverables, films } from '../src/db/schema.ts';
import type { Principal } from '../src/server/api/context.ts';
import { ApiError } from '../src/server/api/errors.ts';
import {
  createFilm,
  downloadDeliverable,
  getFilmDetail,
  MAX_FILMS_IN_PROGRESS,
  MAX_REVISIONS_PER_FILM,
  parseByteRange,
  requestRevision,
  reviewScript,
  revisionInput,
  setShowcase,
} from '../src/server/api/films.ts';
import { contextFor, startWorkerEnv, testClock } from './helpers.ts';

type Proxy = Awaited<ReturnType<typeof startWorkerEnv>>;
let proxy: Proxy;

beforeAll(async () => {
  proxy = await startWorkerEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});

let users = 0;
function newUser(): Principal {
  users += 1;
  return { userId: `user_revision_${users}`, orgId: null };
}

async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status, code });
}

const approve = (version: number, formats: ('16:9' | '9:16' | '1:1')[] = ['16:9', '1:1']) => ({
  decision: 'approve' as const,
  // The sample's price is cited but nobody has confirmed it: approving vouches for it.
  confirmedClaimIds: ['pricing'],
  version,
  hookId: null,
  ctaId: 'start-free',
  formats,
});

/** A simulated film, delivered: script approved, rendered, files listed. */
async function deliveredFilm() {
  const clock = testClock();
  const ctx = await contextFor(newUser(), proxy.env, clock.now);
  const { film } = await createFilm(ctx, { url: 'nova.com' });
  clock.advance(31);
  await reviewScript(ctx, film.id, approve(1));
  clock.advance(41);
  const detail = await getFilmDetail(ctx, film.id);
  expect(detail.film.status).toBe('done');
  return { clock, ctx, id: film.id };
}

describe('revisions', () => {
  it('sends a delivered film back to the crew and delivers the next cut beside the first', async () => {
    const { clock, ctx, id } = await deliveredFilm();

    let detail = await requestRevision(ctx, id, { version: 1, note: 'Bigger logo at the end.' });
    expect(detail.film).toMatchObject({ status: 'working', stage: 'script', scriptVersion: 1 });
    expect(detail.revisions).toEqual([
      expect.objectContaining({ scriptVersion: 1, note: 'Bigger logo at the end.' }),
    ]);
    expect(detail.events.at(-1)).toMatchObject({ agent: 'customer', kind: 'sent_back' });
    // The first cut stays ready to download while the crew works.
    expect(detail.deliverables.map((file) => [file.format, file.scriptVersion])).toEqual([
      ['16:9', 1],
      ['1:1', 1],
    ]);

    clock.advance(12);
    detail = await getFilmDetail(ctx, id);
    expect(detail.film).toMatchObject({ status: 'needs_you', stage: 'approval', scriptVersion: 2 });
    expect(detail.events.some((event) => event.agent === 'account_manager')).toBe(true);

    detail = await reviewScript(ctx, id, approve(2, ['9:16']));
    clock.advance(41);
    detail = await getFilmDetail(ctx, id);
    expect(detail.film).toMatchObject({ status: 'done', scriptVersion: 2, formats: ['9:16'] });
    // Newest cut first, and the first cut is still there.
    expect(detail.deliverables.map((file) => [file.format, file.scriptVersion])).toEqual([
      ['9:16', 2],
      ['16:9', 1],
      ['1:1', 1],
    ]);
    expect(detail.deliverables[0]?.fileName).toBe('nova-com-9x16-main-v2.mp4');
    expect(detail.deliverables.every((file) => file.playUrl === null)).toBe(true);
  });

  it('only revises a delivered film, on the delivered version, once per version', async () => {
    const clock = testClock();
    const ctx = await contextFor(newUser(), proxy.env, clock.now);
    const { film } = await createFilm(ctx, { url: 'nova.com' });
    clock.advance(31);
    await expectApiError(
      requestRevision(ctx, film.id, { version: 1, note: 'x' }),
      409,
      'not_delivered',
    );

    const delivered = await deliveredFilm();
    await expectApiError(
      requestRevision(delivered.ctx, delivered.id, { version: 2, note: 'x' }),
      409,
      'stale_version',
    );
    await requestRevision(delivered.ctx, delivered.id, { version: 1, note: 'x' });
    await expectApiError(
      requestRevision(delivered.ctx, delivered.id, { version: 1, note: 'again' }),
      409,
      'not_delivered',
    );
  });

  it(`stops at ${MAX_REVISIONS_PER_FILM} revisions on one film`, async () => {
    const { clock, ctx, id } = await deliveredFilm();
    for (let version = 1; version <= MAX_REVISIONS_PER_FILM; version++) {
      await requestRevision(ctx, id, { version, note: `Change ${version}` });
      clock.advance(12);
      await reviewScript(ctx, id, approve(version + 1));
      clock.advance(41);
      expect((await getFilmDetail(ctx, id)).film.status).toBe('done');
    }
    await expectApiError(
      requestRevision(ctx, id, { version: MAX_REVISIONS_PER_FILM + 1, note: 'One more' }),
      409,
      'too_many_revisions',
    );
  });

  it('holds the films-in-the-works cap when revisions arrive at once', async () => {
    const clock = testClock();
    const ctx = await contextFor(newUser(), proxy.env, clock.now);
    const done: string[] = [];
    for (let i = 0; i < 3; i++) done.push((await createFilm(ctx, { url: `done${i}.com` })).film.id);
    clock.advance(31);
    for (const id of done) await reviewScript(ctx, id, approve(1));
    clock.advance(41);
    for (const id of done) expect((await getFilmDetail(ctx, id)).film.status).toBe('done');
    // Four in the works leaves room for one more.
    for (let i = 0; i < MAX_FILMS_IN_PROGRESS - 1; i++) {
      await createFilm(ctx, { url: `busy${i}.com` });
    }
    const results = await Promise.allSettled(
      done.map((id) => requestRevision(ctx, id, { version: 1, note: 'Bigger logo' })),
    );
    const refused = results.filter((result) => result.status === 'rejected');
    expect(results.length - refused.length).toBe(1);
    for (const result of refused) {
      expect(result.reason).toMatchObject({ status: 429, code: 'too_many_films' });
    }
    const statuses = await Promise.all(
      done.map(async (id) => (await getFilmDetail(ctx, id)).film.status),
    );
    expect(statuses.filter((status) => status === 'done')).toHaveLength(2);
  });

  it('puts the film back and keeps no request when the pipeline refuses a revision', async () => {
    const { clock, ctx, id } = await deliveredFilm();
    const naive = await contextFor(ctx.principal, proxy.env, clock.now, 'naive');
    // A simulated film is always made by the simulator, so make this one look like a Naive film.
    await getDb(proxy.env.DB).update(films).set({ pipeline: 'naive' }).where(eq(films.id, id));
    await expect(requestRevision(naive, id, { version: 1, note: 'Bigger logo' })).rejects.toThrow(
      'not connected',
    );
    await getDb(proxy.env.DB).update(films).set({ pipeline: 'simulated' }).where(eq(films.id, id));
    const detail = await getFilmDetail(ctx, id);
    expect(detail.film.status).toBe('done');
    expect(detail.revisions).toEqual([]);
  });

  it("refuses someone else's film", async () => {
    const { id } = await deliveredFilm();
    const stranger = await contextFor(newUser(), proxy.env, testClock().now);
    await expectApiError(
      requestRevision(stranger, id, { version: 1, note: 'x' }),
      404,
      'not_found',
    );
  });

  it('keeps a film off the showcase while it is being revised', async () => {
    const { ctx, id } = await deliveredFilm();
    await requestRevision(ctx, id, { version: 1, note: 'x' });
    await expectApiError(setShowcase(ctx, id, { optIn: true }), 409, 'not_delivered');
  });

  it('wants a note', () => {
    expect(revisionInput.safeParse({ version: 1, note: '   ' }).success).toBe(false);
    expect(revisionInput.safeParse({ version: 1, note: 'Bigger logo' }).success).toBe(true);
    expect(revisionInput.safeParse({ version: 0, note: 'x' }).success).toBe(false);
  });
});

describe('streaming a file to the player', () => {
  it('serves byte ranges inline, so the player can seek', async () => {
    const clock = testClock();
    const ctx = await contextFor(newUser(), proxy.env, clock.now);
    const db = getDb(proxy.env.DB);
    const now = clock.now();
    const filmId = 'flm_bbbbbbbbbbbbbbbbbbbb';
    await db.insert(films).values({
      id: filmId,
      accountId: ctx.account.id,
      createdBy: ctx.principal.userId,
      url: 'https://real.com/',
      status: 'done',
      stage: 'delivery',
      pipeline: 'naive',
      pipelineRunId: 'run_2',
      scriptVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(deliverables).values({
      id: 'dlv_2',
      filmId,
      variantKey: '16:9.main.start',
      format: '16:9',
      fileName: 'real-16x9.mp4',
      contentType: 'video/mp4',
      r2Key: `films/${filmId}/real-16x9.mp4`,
      scriptVersion: 1,
      createdAt: now,
    });
    await proxy.env.FILMS.put(`films/${filmId}/real-16x9.mp4`, '0123456789');

    const detail = await getFilmDetail(ctx, filmId);
    expect(detail.deliverables[0]?.playUrl).toBe(
      `/api/films/${filmId}/deliverables/dlv_2?inline=1`,
    );

    const part = await downloadDeliverable(ctx, filmId, 'dlv_2', {
      inline: true,
      range: 'bytes=2-5',
    });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(part.headers.get('content-length')).toBe('4');
    expect(part.headers.get('content-disposition')).toBe('inline; filename="real-16x9.mp4"');
    expect(await part.text()).toBe('2345');

    const tail = await downloadDeliverable(ctx, filmId, 'dlv_2', { range: 'bytes=-3' });
    expect(await tail.text()).toBe('789');

    const beyond = await downloadDeliverable(ctx, filmId, 'dlv_2', { range: 'bytes=20-' });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe('bytes */10');

    const whole = await downloadDeliverable(ctx, filmId, 'dlv_2');
    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(await whole.text()).toBe('0123456789');
  });

  it('reads one byte range from a Range header', () => {
    expect(parseByteRange('bytes=0-', 10)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange('bytes=4-100', 10)).toEqual({ start: 4, end: 9 });
    expect(parseByteRange('bytes=-4', 10)).toEqual({ start: 6, end: 9 });
    expect(parseByteRange('bytes=-40', 10)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=5-2', 10)).toBeNull();
    expect(parseByteRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(parseByteRange('items=0-1', 10)).toBeNull();
  });
});
