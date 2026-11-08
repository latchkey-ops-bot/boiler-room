import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client.ts';
import { deliverables, films } from '../src/db/schema.ts';
import type { Principal } from '../src/server/api/context.ts';
import { ApiError } from '../src/server/api/errors.ts';
import {
  createFilm,
  createFilmInput,
  downloadDeliverable,
  getFilmDetail,
  listDeliverables,
  listFilms,
  MAX_FILMS_IN_PROGRESS,
  reviewScript,
  reviewScriptInput,
  setShowcase,
} from '../src/server/api/films.ts';
import { json, readJson } from '../src/server/api/http.ts';
import { makeRoute } from '../src/server/api/route.ts';
import { showcaseFilms } from '../src/server/showcase.ts';
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
function newUser(orgId: string | null = null): Principal {
  users += 1;
  return { userId: `user_test_${users}`, orgId };
}

async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status, code });
}

const approve = {
  decision: 'approve' as const,
  version: 1,
  hookId: null,
  ctaId: 'start-free',
  formats: ['16:9' as const, '1:1' as const],
};

describe('films API', () => {
  it('creates a film from a URL, queued at research, on the simulated pipeline', async () => {
    const clock = testClock();
    const ctx = await contextFor(newUser(), proxy.env, clock.now);
    const detail = await createFilm(ctx, { url: 'nova.com' });
    expect(detail.film).toMatchObject({
      url: 'https://nova.com/',
      host: 'nova.com',
      status: 'working',
      stage: 'research',
      pipeline: 'simulated',
      simulated: true,
      scriptVersion: 0,
    });
    expect(detail.film.id).toMatch(/^flm_[0-9a-z]{20}$/);
    expect(detail.events.map((event) => event.agent)).toEqual(['coordinator']);
  });

  it('refuses a URL that is not a public website', async () => {
    const ctx = await contextFor(newUser(), proxy.env, testClock().now);
    await expectApiError(createFilm(ctx, { url: 'http://169.254.169.254/' }), 400, 'invalid_url');
    await expectApiError(createFilm(ctx, { url: 'localhost:3000' }), 400, 'invalid_url');
    expect((await listFilms(ctx)).films).toEqual([]);
  });

  it('limits how many films one account has in the works', async () => {
    const ctx = await contextFor(newUser(), proxy.env, testClock().now);
    for (let i = 0; i < MAX_FILMS_IN_PROGRESS; i++) await createFilm(ctx, { url: `site${i}.com` });
    await expectApiError(createFilm(ctx, { url: 'one-more.com' }), 429, 'too_many_films');
  });

  it('answers 503 and stores nothing when the Naive pipeline is not wired', async () => {
    const ctx = await contextFor(newUser(), proxy.env, testClock().now, 'naive');
    await expect(createFilm(ctx, { url: 'nova.com' })).rejects.toThrow('not connected');
    expect((await listFilms(ctx)).films).toEqual([]);
  });

  it("scopes every film to its owner: someone else's film is a 404", async () => {
    const clock = testClock();
    const owner = await contextFor(newUser(), proxy.env, clock.now);
    const stranger = await contextFor(newUser(), proxy.env, clock.now);
    const { film } = await createFilm(owner, { url: 'nova.com' });

    expect((await listFilms(stranger)).films).toEqual([]);
    await expectApiError(getFilmDetail(stranger, film.id), 404, 'not_found');
    await expectApiError(listDeliverables(stranger, film.id), 404, 'not_found');
    await expectApiError(setShowcase(stranger, film.id, { optIn: false }), 404, 'not_found');
    await expectApiError(
      reviewScript(stranger, film.id, { decision: 'send_back', version: 1, note: 'x' }),
      404,
      'not_found',
    );
    await expectApiError(getFilmDetail(owner, 'flm_not-an-id'), 404, 'not_found');
  });

  it('shares films within a Clerk organisation, and not with personal accounts', async () => {
    const clock = testClock();
    const alice = await contextFor(newUser('org_acme'), proxy.env, clock.now);
    const bob = await contextFor(newUser('org_acme'), proxy.env, clock.now);
    const bobAlone = await contextFor(
      { userId: bob.principal.userId, orgId: null },
      proxy.env,
      clock.now,
    );
    const { film } = await createFilm(alice, { url: 'acme.com' });

    expect(alice.account.id).toBe(bob.account.id);
    expect((await listFilms(bob)).films.map((item) => item.id)).toEqual([film.id]);
    expect((await listFilms(bobAlone)).films).toEqual([]);
  });

  it('runs the whole film: crew events, approval, delivery and files', async () => {
    const clock = testClock();
    const ctx = await contextFor(newUser(), proxy.env, clock.now);
    const { film } = await createFilm(ctx, { url: 'nova.com' });

    // Approving before the script is ready is refused.
    await expectApiError(reviewScript(ctx, film.id, approve), 409, 'not_awaiting_approval');

    clock.advance(31);
    let detail = await getFilmDetail(ctx, film.id);
    expect(detail.film).toMatchObject({ status: 'needs_you', stage: 'approval', scriptVersion: 1 });
    expect(detail.film.title).toBe('Nova launch');
    expect(detail.campaign?.brand.name).toBe('Nova');
    expect(detail.events).toHaveLength(9);
    expect(detail.events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);

    // Reading again stores no duplicate events.
    expect((await getFilmDetail(ctx, film.id)).events).toHaveLength(9);

    await expectApiError(
      reviewScript(ctx, film.id, { ...approve, version: 2 }),
      409,
      'stale_version',
    );
    await expectApiError(
      reviewScript(ctx, film.id, { ...approve, ctaId: 'made-up' }),
      400,
      'invalid_choice',
    );
    await expectApiError(
      reviewScript(ctx, film.id, { ...approve, hookId: 'made-up' }),
      400,
      'invalid_choice',
    );

    detail = await reviewScript(ctx, film.id, approve);
    expect(detail.film).toMatchObject({
      status: 'working',
      stage: 'art_direction',
      chosenHook: null,
      chosenCta: 'start-free',
      formats: ['16:9', '1:1'],
    });
    expect(detail.approvals).toEqual([
      expect.objectContaining({ scriptVersion: 1, decision: 'approved', note: null }),
    ]);
    await expectApiError(reviewScript(ctx, film.id, approve), 409, 'not_awaiting_approval');
    await expectApiError(setShowcase(ctx, film.id, { optIn: true }), 409, 'not_delivered');

    clock.advance(41);
    detail = await getFilmDetail(ctx, film.id);
    expect(detail.film).toMatchObject({ status: 'done', stage: 'delivery' });
    expect(detail.deliverables.map((file) => file.format)).toEqual(['16:9', '1:1']);
    expect(detail.deliverables.every((file) => file.downloadUrl === null)).toBe(true);
    expect((await listDeliverables(ctx, film.id)).deliverables).toHaveLength(2);

    const [first] = detail.deliverables;
    await expectApiError(downloadDeliverable(ctx, film.id, first?.id ?? ''), 404, 'no_file');

    // A delivered film can go on the showcase, but a simulated one never shows there.
    expect((await setShowcase(ctx, film.id, { optIn: true })).showcaseOptIn).toBe(true);
    expect((await showcaseFilms(ctx.db)).map((item) => item.id)).not.toContain(film.id);
  });

  it('sends a script back with a note and gets version 2', async () => {
    const clock = testClock();
    const ctx = await contextFor(newUser(), proxy.env, clock.now);
    const { film } = await createFilm(ctx, { url: 'nova.com' });
    clock.advance(31);

    let detail = await reviewScript(ctx, film.id, {
      decision: 'send_back',
      version: 1,
      note: 'Say teams, not customers.',
    });
    expect(detail.film).toMatchObject({ status: 'working', stage: 'script' });
    expect(detail.approvals[0]).toMatchObject({
      decision: 'changes_requested',
      note: 'Say teams, not customers.',
    });

    clock.advance(9);
    detail = await getFilmDetail(ctx, film.id);
    expect(detail.film).toMatchObject({ status: 'needs_you', scriptVersion: 2 });
    detail = await reviewScript(ctx, film.id, { ...approve, version: 2 });
    expect(detail.film.status).toBe('working');
  });

  it('streams a real file from R2 to its owner', async () => {
    const clock = testClock();
    const ctx = await contextFor(newUser(), proxy.env, clock.now);
    const db = getDb(proxy.env.DB);
    const now = clock.now();
    await db.insert(films).values({
      id: 'flm_aaaaaaaaaaaaaaaaaaaa',
      accountId: ctx.account.id,
      createdBy: ctx.principal.userId,
      url: 'https://real.com/',
      status: 'done',
      stage: 'delivery',
      pipeline: 'naive',
      pipelineRunId: 'run_1',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(deliverables).values({
      id: 'dlv_1',
      filmId: 'flm_aaaaaaaaaaaaaaaaaaaa',
      variantKey: '16:9.main.start',
      format: '16:9',
      fileName: 'real-16x9.mp4',
      contentType: 'video/mp4',
      r2Key: 'films/flm_aaaaaaaaaaaaaaaaaaaa/real-16x9.mp4',
      createdAt: now,
    });
    await proxy.env.FILMS.put('films/flm_aaaaaaaaaaaaaaaaaaaa/real-16x9.mp4', 'not really a video');

    const response = await downloadDeliverable(ctx, 'flm_aaaaaaaaaaaaaaaaaaaa', 'dlv_1');
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="real-16x9.mp4"',
    );
    expect(await response.text()).toBe('not really a video');

    // Delivered, real and opted in: it is on the showcase.
    await setShowcase(ctx, 'flm_aaaaaaaaaaaaaaaaaaaa', { optIn: true });
    expect((await showcaseFilms(db)).map((item) => item.id)).toContain('flm_aaaaaaaaaaaaaaaaaaaa');
  });
});

describe('route wrapper', () => {
  const clock = testClock();
  const routeFor = (principal: Principal | null) =>
    makeRoute({
      principal: async () => principal,
      bindings: () => ({ DB: proxy.env.DB, FILMS: proxy.env.FILMS, PIPELINE: 'simulated' }),
      clock: clock.now,
    });

  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request('https://app.test/api/films', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });

  it('answers 401 to a signed-out caller', async () => {
    const handler = routeFor(null)(async (ctx) => json(await listFilms(ctx)));
    const response = await handler(new Request('https://app.test/api/films'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Sign in first.' },
    });
  });

  it('validates the body', async () => {
    const handler = routeFor(newUser())(async (ctx, request) =>
      json(await createFilm(ctx, await readJson(request, createFilmInput)), { status: 201 }),
    );
    expect((await handler(post('{"url":"nova.com"}'))).status).toBe(201);
    expect((await handler(post('not json'))).status).toBe(400);
    expect((await handler(post('{"url":"nova.com","admin":true}'))).status).toBe(400);
    expect((await handler(post('{"url":"ftp://nova.com"}'))).status).toBe(400);
    expect(
      (await handler(post('{"url":"nova.com"}', { 'content-type': 'text/plain' }))).status,
    ).toBe(415);
    expect((await handler(post(JSON.stringify({ url: 'x'.repeat(20_000) })))).status).toBe(413);
  });

  it('refuses a write from another site', async () => {
    const handler = routeFor(newUser())(async () => json({ ok: true }));
    const response = await handler(post('{}', { origin: 'https://evil.example' }));
    expect(response.status).toBe(403);
    expect((await handler(post('{}', { origin: 'https://app.test' }))).status).toBe(200);
  });

  it('reports a bad review body with the field that is wrong', async () => {
    const handler = routeFor(newUser())(async (_ctx, request) =>
      json(await readJson(request, reviewScriptInput)),
    );
    const response = await handler(post('{"decision":"send_back","version":1,"note":"   "}'));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { issues: { path: string }[] } };
    expect(body.error.issues[0]?.path).toBe('note');
  });

  it('hides unexpected errors', async () => {
    const handler = routeFor(newUser())(async () => {
      throw new Error('secret detail');
    });
    const response = await handler(new Request('https://app.test/api/films'));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret detail');
  });
});
