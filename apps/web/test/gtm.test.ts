import sample from '@boiler-room/schema/examples/nova.campaign.json';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts, filmRuns, films, gtmOrders } from '../src/db/schema.ts';
import { getFilmDetail, ownFilm, setShowcase } from '../src/server/api/films.ts';
import { fileLinkValid, signFileLink, tokenMatches } from '../src/server/gtm/auth.ts';
import { gtmFetch } from '../src/server/gtm/routes.ts';
import type { GtmDeps } from '../src/server/gtm/samples.ts';
import { showcaseFilms } from '../src/server/showcase.ts';
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

const TOKEN = 'gtm-test-token-0123456789abcdefghijklmnop';
const BASE = 'https://staging.test';
const ROOMY = {
  MAX_REAL_GLOBAL: '100',
  MAX_REAL_PER_ACCOUNT: '100',
  ACCOUNT_DAILY_CAP_USD: '1000',
  GLOBAL_DAILY_CAP_USD: '1000',
};
const campaignBytes = new TextEncoder().encode(JSON.stringify(sample));

let houses = 0;
/** A fresh house account, so each test's caps start empty. */
async function house(harness: Harness): Promise<string> {
  houses += 1;
  const id = `acc_house${String(houses).padStart(15, '0')}`;
  await harness.db.insert(accounts).values({
    id,
    kind: 'user',
    clerkUserId: `user_house_${houses}`,
    createdAt: harness.clock.now(),
  });
  return id;
}

function setup(options: { vars?: Record<string, string>; token?: string | null } = {}) {
  const harness = runnerHarness(proxy, { vars: { ...ROOMY, ...options.vars } });
  let houseId: string | null = null;
  const deps = (): GtmDeps => ({
    runner: harness.deps(),
    houseAccountId: houseId,
    token: options.token === undefined ? TOKEN : (options.token ?? ''),
  });
  const call = async (
    method: string,
    path: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    };
    return gtmFetch(
      new Request(`${BASE}${path}`, init),
      harness.bindings,
      { waitUntil() {} },
      deps,
    );
  };
  return {
    harness,
    call,
    async withHouse() {
      houseId = await house(harness);
      return houseId;
    },
  };
}

const order = (key: string, extra: Record<string, unknown> = {}) => ({
  url: 'https://nova.com/',
  idempotency_key: key,
  budget_micro_usd: 1_000_000,
  lead_ref: 'ld-7k2m9q',
  ...extra,
});

/** Drives the sample's runner through research, the script, the 16:9 cut, QC and delivery. */
async function deliver(harness: Harness, filmId: string, qc: 'pass' | 'fail' = 'pass') {
  await harness.flush();
  const run = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.filmId, filmId) });
  const runner = runnerClient(harness, harness.naive.bootstrap(run?.computerId as string));
  expect((await runner.hello('all')).status).toBe(200);
  const upload = await runner.upload(
    { kind: 'campaign', version: '1' },
    campaignBytes,
    'application/json',
  );
  const { fileId } = (await body(upload)) as { fileId: string };
  await runner.events('all', [
    { type: 'cost', step: 'researcher', microUsd: 200_000, totalMicroUsd: 200_000 },
    { type: 'script_ready', version: 1, campaignFileId: fileId, unconfirmedClaims: [] },
  ]);
  const mp4 = new TextEncoder().encode('sample video bytes');
  expect(
    (
      await runner.upload(
        { kind: 'mp4', version: '1', variant: '16:9.main.start-free' },
        mp4,
        'video/mp4',
      )
    ).status,
  ).toBe(200);
  await runner.events('all', [
    { type: 'qc', format: '16:9', verdict: qc, routable: 0, issues: [] },
    { type: 'delivered', version: 1, variants: ['16:9.main.start-free'] },
    { type: 'runner.exit', exitCode: 0, signal: null, durationMs: 1 },
  ]);
  await harness.flush();
  return run;
}

describe('the GTM token', () => {
  it('matches only the configured token, compared by hash, and never a short one', async () => {
    expect(await tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(await tokenMatches(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(await tokenMatches(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(await tokenMatches(null, TOKEN)).toBe(false);
    // A token under 32 characters counts as unset, even when both sides agree.
    expect(await tokenMatches('short', 'short')).toBe(false);
  });

  it('refuses a request without the token, and turns the routes off without a secret', async () => {
    const { call } = setup();
    expect(
      (await call('GET', '/api/gtm/v1/requests', undefined, { authorization: '' })).status,
    ).toBe(401);
    expect(
      (await call('GET', '/api/gtm/v1/requests', undefined, { authorization: `Bearer ${TOKEN}0` }))
        .status,
    ).toBe(401);
    const off = setup({ token: null });
    const response = await off.call('GET', '/api/gtm/v1/requests');
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({ error: { code: 'gtm_off' } });
  });

  it('signs file links for ten minutes only', async () => {
    const sig = await signFileLink(TOKEN, 'flm_x', 1_000_600);
    expect(await fileLinkValid(TOKEN, 'flm_x', 1_000_600, sig, 1_000_000)).toBe(true);
    expect(await fileLinkValid(TOKEN, 'flm_x', 1_000_600, sig, 1_000_601)).toBe(false);
    expect(await fileLinkValid(TOKEN, 'flm_y', 1_000_600, sig, 1_000_000)).toBe(false);
    expect(await fileLinkValid(`${TOKEN}x`, 'flm_x', 1_000_600, sig, 1_000_000)).toBe(false);
    // A link that claims to last longer than ten minutes is refused, signed or not.
    const long = await signFileLink(TOKEN, 'flm_x', 1_000_601);
    expect(await fileLinkValid(TOKEN, 'flm_x', 1_000_601, long, 1_000_000)).toBe(false);
  });
});

describe('ordering a sample', () => {
  it('needs the house account', async () => {
    const { call } = setup();
    const response = await call('POST', '/api/gtm/v1/films', order('k-none'));
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({ error: { code: 'no_house_account' } });
  });

  it('makes a real sample film of the house account, with no approval pause, once per key', async () => {
    const { harness, call, withHouse } = setup();
    const houseId = await withHouse();
    const first = await call('POST', '/api/gtm/v1/films', order('film:nova.com:2026-11-08'));
    expect(first.status).toBe(201);
    const { id } = (await body(first)) as { id: string };
    const again = await call('POST', '/api/gtm/v1/films', order('film:nova.com:2026-11-08'));
    expect(again.status).toBe(200);
    expect(await body(again)).toEqual({ id });

    const film = await harness.db.query.films.findFirst({ where: eq(films.id, id) });
    expect(film).toMatchObject({
      accountId: houseId,
      sample: true,
      pipeline: 'naive',
      showcaseOptIn: false,
    });
    const run = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.filmId, id) });
    // The executor's budget is the film's whole cap: below the website's $2.50, never above.
    expect(run).toMatchObject({ mode: 'sample', phase: 'all', costCapMicroUsd: 1_000_000 });
    const big = await call(
      'POST',
      '/api/gtm/v1/films',
      order('k-big', { budget_micro_usd: 9_000_000 }),
    );
    const bigRun = await harness.db.query.filmRuns.findFirst({
      where: eq(filmRuns.filmId, ((await body(big)) as { id: string }).id),
    });
    expect(bigRun?.costCapMicroUsd).toBe(2_500_000);

    const status = await call('GET', `/api/gtm/v1/films/${id}`);
    const view = (await body(status)) as { state: string };
    // The run has its computer and is launching.
    expect(['queued', 'working']).toContain(view.state);
    expect(view).toMatchObject({
      orderId: id,
      qc: 'pending',
      simulated: false,
      costMicroUsd: null,
      script: null,
    });
  });

  it('holds samples to the website caps', async () => {
    const { harness, call, withHouse } = setup({ vars: { MAX_REAL_PER_ACCOUNT: '1' } });
    // Every sample has one creator, the executor, so the earlier tests' samples count too: end them.
    await harness.db.update(filmRuns).set({ state: 'ended' });
    await harness.db.update(films).set({ status: 'done' });
    await withHouse();
    expect((await call('POST', '/api/gtm/v1/films', order('k-cap-1'))).status).toBe(201);
    const refused = await call('POST', '/api/gtm/v1/films', order('k-cap-2'));
    expect(refused.status).toBe(429);
    expect(await body(refused)).toMatchObject({ error: { code: 'too_many_films' } });
    const daily = setup({ vars: { ACCOUNT_DAILY_CAP_USD: '0.50' } });
    await daily.withHouse();
    const over = await daily.call('POST', '/api/gtm/v1/films', order('k-day'));
    expect(await body(over)).toMatchObject({ error: { code: 'daily_cap' } });
  });

  it('refuses a bad body, and orders nothing without the real-film runner', async () => {
    const { call, withHouse } = setup();
    await withHouse();
    expect((await call('POST', '/api/gtm/v1/films', { url: 'nova.com' })).status).toBe(400);
    expect(
      (await call('POST', '/api/gtm/v1/films', order('k-bad', { lead_ref: 'Quillbox Inc.' })))
        .status,
    ).toBe(400);
    expect(
      (await call('POST', '/api/gtm/v1/films', order('k-low', { budget_micro_usd: 400_000 })))
        .status,
    ).toBe(400);
    const off = setup({ vars: { RUNNER_SNAPSHOT_ID: '' } });
    await off.withHouse();
    const response = await off.call('POST', '/api/gtm/v1/films', order('k-off'));
    expect(await body(response)).toMatchObject({ error: { code: 'crew_off' } });
  });
});

describe('a delivered sample', () => {
  it('reports ready, QC passed and its cost, then shares a labelled film page', async () => {
    const { harness, call, withHouse } = setup();
    await withHouse();
    const { id } = (await body(await call('POST', '/api/gtm/v1/films', order('k-deliver')))) as {
      id: string;
    };
    // Not shareable before delivery.
    expect((await call('POST', `/api/gtm/v1/films/${id}/share`)).status).toBe(409);
    await deliver(harness, id);

    const status = (await body(await call('GET', `/api/gtm/v1/films/${id}`))) as Record<
      string,
      unknown
    >;
    expect(status).toMatchObject({ state: 'ready', qc: 'pass', simulated: false, failure: null });
    expect(status.costMicroUsd).toBeGreaterThanOrEqual(200_000);
    expect(String(status.script)).toContain(sample.scenes[0]?.text[0]?.value ?? '?');

    const shared = (await body(await call('POST', `/api/gtm/v1/films/${id}/share`))) as {
      page_url: string;
      share_id: string;
    };
    expect(shared.page_url).toBe(`${BASE}/f/${shared.share_id}`);
    expect(await body(await call('POST', `/api/gtm/v1/films/${id}/share`))).toEqual(shared);

    // The page: unindexed, labelled a free sample, and says the startup did not ask for it.
    const page = await call('GET', `/f/${shared.share_id}`, undefined, { authorization: '' });
    expect(page.status).toBe(200);
    expect(page.headers.get('x-robots-tag')).toContain('noindex');
    const text = await page.text();
    expect(text).toContain('Free sample');
    expect(text).toContain('nova.com did not ask for it and is not affiliated with Boiler Room');
    expect(text).toContain('name="robots" content="noindex');
    const video = await call('GET', `/f/${shared.share_id}/video`, undefined, {
      authorization: '',
      range: 'bytes=0-5',
    });
    expect(video.status).toBe(206);
    expect(await video.text()).toBe('sample');

    // The file link works without the bearer, and only as signed.
    const file = (await body(await call('GET', `/api/gtm/v1/films/${id}/file`))) as {
      url: string;
      bytes: number;
      sha256: string;
      contentType: string;
    };
    expect(file).toMatchObject({ contentType: 'video/mp4', bytes: 18 });
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    const path = file.url.slice(BASE.length);
    expect((await call('GET', path, undefined, { authorization: '' })).status).toBe(200);
    expect(
      (
        await call('GET', path.replace(/sig=[0-9a-f]+/, `sig=${'f'.repeat(64)}`), undefined, {
          authorization: '',
        })
      ).status,
    ).toBe(403);
    harness.clock.advance(601);
    expect((await call('GET', path, undefined, { authorization: '' })).status).toBe(403);
  });

  it('reports a failed QC as fail, so GTM never uses it', async () => {
    const { harness, call, withHouse } = setup();
    await withHouse();
    const { id } = (await body(await call('POST', '/api/gtm/v1/films', order('k-qcfail')))) as {
      id: string;
    };
    await deliver(harness, id, 'fail');
    expect(await body(await call('GET', `/api/gtm/v1/films/${id}`))).toMatchObject({ qc: 'fail' });
  });

  it('is seen by the house account and the link holder only, and never on the showcase', async () => {
    const { harness, call, withHouse } = setup();
    const houseId = await withHouse();
    const { id } = (await body(await call('POST', '/api/gtm/v1/films', order('k-private')))) as {
      id: string;
    };
    await deliver(harness, id);
    // Another founder's account cannot find it.
    const stranger = await harness.context({ userId: 'user_stranger', orgId: null });
    await expect(ownFilm(stranger, id)).rejects.toMatchObject({ status: 404 });
    // Boiler Room's own account sees it, and cannot put it on the showcase.
    const houseRow = await harness.db.query.accounts.findFirst({ where: eq(accounts.id, houseId) });
    const own = await harness.context({ userId: houseRow?.clerkUserId as string, orgId: null });
    expect((await getFilmDetail(own, id)).film.id).toBe(id);
    await expect(setShowcase(own, id, { optIn: true })).rejects.toMatchObject({ code: 'sample' });
    // Even forced on, the wall leaves it off.
    await harness.db.update(films).set({ showcaseOptIn: true }).where(eq(films.id, id));
    const wall = await showcaseFilms(harness.db, { houseAccountId: houseId });
    expect(wall.map((item) => item.id)).not.toContain(id);
    // The token reaches samples only, never the house account's own films.
    const ownFilmId = 'flm_houseownfilm0000000';
    await harness.db.insert(films).values({
      id: `${ownFilmId}0`.slice(0, 24),
      accountId: houseId,
      createdBy: houseRow?.clerkUserId as string,
      url: 'https://boilerroom.example/',
      status: 'done',
      stage: 'delivery',
      pipeline: 'naive',
      createdAt: harness.clock.now(),
      updatedAt: harness.clock.now(),
    });
    expect((await call('GET', `/api/gtm/v1/films/${`${ownFilmId}0`.slice(0, 24)}`)).status).toBe(
      404,
    );
  });

  it('withdraws: the page answers 410, the files are gone, and it stops counting', async () => {
    const { harness, call, withHouse } = setup();
    await withHouse();
    const { id } = (await body(await call('POST', '/api/gtm/v1/films', order('k-withdraw')))) as {
      id: string;
    };
    await deliver(harness, id);
    const { share_id } = (await body(await call('POST', `/api/gtm/v1/films/${id}/share`))) as {
      share_id: string;
    };
    expect(
      (await call('POST', `/api/gtm/v1/films/${id}/withdraw`, { reason: 'manual' })).status,
    ).toBe(200);
    expect(
      (await call('POST', `/api/gtm/v1/films/${id}/withdraw`, { reason: 'manual' })).status,
    ).toBe(200);
    expect((await call('GET', `/f/${share_id}`, undefined, { authorization: '' })).status).toBe(
      410,
    );
    expect(
      (await call('GET', `/f/${share_id}/video`, undefined, { authorization: '' })).status,
    ).toBe(410);
    expect(await body(await call('GET', `/api/gtm/v1/films/${id}`))).toMatchObject({
      state: 'withdrawn',
    });
    expect((await harness.bindings.FILMS.list({ prefix: `films/${id}/` })).objects).toEqual([]);
    expect((await call('GET', `/api/gtm/v1/films/${id}/file`)).status).toBe(410);
    const row = await harness.db.query.gtmOrders.findFirst({ where: eq(gtmOrders.filmId, id) });
    expect(row?.withdrawReason).toBe('manual');
  });

  it('stops a sample still at work when it is withdrawn', async () => {
    const { harness, call, withHouse } = setup();
    await withHouse();
    const { id } = (await body(await call('POST', '/api/gtm/v1/films', order('k-stop')))) as {
      id: string;
    };
    await harness.flush();
    await call('POST', `/api/gtm/v1/films/${id}/withdraw`, { reason: 'failed' });
    const run = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.filmId, id) });
    expect(['stopping', 'failed']).toContain(run?.state);
  });

  it('takes a film down from its own page, and queues the removal for the executor', async () => {
    const { harness, call, withHouse } = setup();
    await withHouse();
    const { id } = (await body(await call('POST', '/api/gtm/v1/films', order('k-remove')))) as {
      id: string;
    };
    await deliver(harness, id);
    const { share_id } = (await body(await call('POST', `/api/gtm/v1/films/${id}/share`))) as {
      share_id: string;
    };
    const before = (await body(await call('GET', '/api/gtm/v1/requests'))) as {
      cursor: string | null;
    };
    const removed = await call('POST', `/f/${share_id}/remove`, undefined, { authorization: '' });
    expect(removed.status).toBe(200);
    expect(await removed.text()).toContain('The film is removed');
    expect((await call('GET', `/f/${share_id}`, undefined, { authorization: '' })).status).toBe(
      410,
    );
    expect(
      (await call('POST', `/f/${share_id}/remove`, undefined, { authorization: '' })).status,
    ).toBe(410);
    const after = (await body(
      await call('GET', `/api/gtm/v1/requests${before.cursor ? `?after=${before.cursor}` : ''}`),
    )) as { data: Record<string, unknown>[]; cursor: string };
    expect(after.data).toEqual([
      expect.objectContaining({
        kind: 'removal',
        channel: 'film_page',
        share_id,
        domain: 'nova.com',
        token_hash: null,
      }),
    ]);
    const later = (await body(await call('GET', `/api/gtm/v1/requests?after=${after.cursor}`))) as {
      data: unknown[];
    };
    expect(later.data).toEqual([]);
    // A made-up page is a 404, not a 410.
    expect(
      (await call('GET', '/f/00000000000000000000', undefined, { authorization: '' })).status,
    ).toBe(404);
  });
});
