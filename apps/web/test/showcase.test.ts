import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client.ts';
import { deliverables, filmEvents, films } from '../src/db/schema.ts';
import type { Format, PipelineKind } from '../src/lib/film.ts';
import { parseRange, showcaseFilms, showcaseVideo } from '../src/server/showcase.ts';
import { contextFor, startWorkerEnv } from './helpers.ts';

type Proxy = Awaited<ReturnType<typeof startWorkerEnv>>;
let proxy: Proxy;
let accountId: string;
/** Boiler Room's own account, whose film leads the wall. */
let houseAccountId: string;

beforeAll(async () => {
  proxy = await startWorkerEnv();
  const ctx = await contextFor(
    { userId: 'user_showcase', orgId: null },
    proxy.env,
    () => new Date(),
  );
  accountId = ctx.account.id;
  const house = await contextFor(
    { userId: 'user_house', orgId: null },
    proxy.env,
    () => new Date(),
  );
  houseAccountId = house.account.id;
});
afterAll(async () => {
  await proxy?.dispose();
});

const db = () => getDb(proxy.env.DB);

beforeEach(async () => {
  await db().delete(deliverables);
  await db().delete(filmEvents);
  await db().delete(films);
});

let serial = 0;
/** A film as the pipeline leaves it. Real, delivered and opted in unless the test says otherwise. */
async function film({
  url,
  deliveredAt,
  optIn = true,
  status = 'done',
  pipeline = 'naive',
  owner = accountId,
  scriptVersion = 1,
}: {
  url: string;
  deliveredAt: string;
  optIn?: boolean;
  status?: 'done' | 'working';
  pipeline?: PipelineKind;
  owner?: string;
  scriptVersion?: number;
}): Promise<string> {
  serial += 1;
  const id = `flm_${String(serial).padStart(20, '0')}`;
  const at = new Date(deliveredAt);
  await db()
    .insert(films)
    .values({
      id,
      accountId: owner,
      createdBy: 'user_showcase',
      url,
      status,
      stage: status === 'done' ? 'delivery' : 'motion',
      pipeline,
      pipelineRunId: `run_${serial}`,
      showcaseOptIn: optIn,
      scriptVersion,
      createdAt: at,
      updatedAt: at,
    });
  return id;
}

async function file(
  filmId: string,
  format: Format,
  body: string | null,
  scriptVersion = 1,
): Promise<void> {
  const shape = format.replace(':', 'x');
  const r2Key = body === null ? null : `films/${filmId}/v${scriptVersion}/${shape}.mp4`;
  await db()
    .insert(deliverables)
    .values({
      id: `dlv_${filmId}_${shape}_v${scriptVersion}`,
      filmId,
      scriptVersion,
      variantKey: `${format}.main.start`,
      format,
      fileName: `${format.replace(':', 'x')}.mp4`,
      contentType: 'video/mp4',
      r2Key,
      createdAt: new Date(),
    });
  if (r2Key && body !== null) await proxy.env.FILMS.put(r2Key, body);
}

const get = (headers: Record<string, string> = {}) =>
  new Request('https://boilerroom.example/api/showcase/x/video', { headers });

describe('the launch wall', () => {
  it('is empty until a real film is delivered and opted in', async () => {
    await film({ url: 'https://draft.com/', deliveredAt: '2026-11-01', status: 'working' });
    await film({ url: 'https://shy.com/', deliveredAt: '2026-11-02', optIn: false });
    await film({ url: 'https://demo.com/', deliveredAt: '2026-11-03', pipeline: 'simulated' });
    expect(await showcaseFilms(db())).toEqual([]);
  });

  it('shows real launches newest first', async () => {
    const older = await film({ url: 'https://orbit.com/', deliveredAt: '2026-11-01' });
    const newer = await film({ url: 'https://www.pebble.app/', deliveredAt: '2026-11-05' });
    const wall = await showcaseFilms(db());
    expect(wall.map((item) => item.id)).toEqual([newer, older]);
    expect(wall[0]).toMatchObject({ host: 'pebble.app', brand: 'pebble.app', house: false });
  });

  it("puts Boiler Room's own film first, however old it is", async () => {
    const newest = await film({ url: 'https://orbit.com/', deliveredAt: '2026-11-06' });
    const ours = await film({
      url: 'https://www.boilerroom.example/',
      deliveredAt: '2026-10-01',
      owner: houseAccountId,
    });
    await film({ url: 'https://pebble.app/', deliveredAt: '2026-11-04' });

    const wall = await showcaseFilms(db(), { houseAccountId });
    expect(wall.map((item) => [item.id, item.house])).toEqual([
      [ours, true],
      [newest, false],
      [expect.any(String), false],
    ]);
    // Even when the wall is shorter than the list of newer films.
    expect((await showcaseFilms(db(), { houseAccountId, limit: 1 }))[0]?.id).toBe(ours);
    // Without a house account, nothing is pinned.
    expect((await showcaseFilms(db()))[0]?.id).toBe(newest);
  });

  it("never gives a customer's film the house slot, even a film of our own site", async () => {
    // A customer films the site the wall is served from, on a long workers.dev host.
    const theirs = await film({
      url: 'https://boiler-room-web-production.boilerroom.workers.dev/',
      deliveredAt: '2026-11-06',
    });
    const wall = await showcaseFilms(db(), { houseAccountId });
    expect(wall.map((item) => [item.id, item.house])).toEqual([[theirs, false]]);
  });

  it('dates a film by when the crew delivered it, not when its founder opted in', async () => {
    const id = await film({ url: 'https://orbit.com/', deliveredAt: '2026-11-05T09:00:00.000Z' });
    await db()
      .insert(filmEvents)
      .values({
        id: `evt_${id}`,
        filmId: id,
        pipelineEventId: 'run:9',
        seq: 9,
        at: new Date('2026-11-02T16:30:00.000Z'),
        agent: 'account_manager',
        kind: 'delivered',
        stage: 'delivery',
        status: 'done',
        message: 'Delivered your files.',
      });
    const silent = await film({ url: 'https://pebble.app/', deliveredAt: '2026-11-01' });
    const wall = await showcaseFilms(db());
    expect(wall.find((item) => item.id === id)?.deliveredAt).toBe('2026-11-02T16:30:00.000Z');
    // No delivered event: the film's last change stands in.
    expect(wall.find((item) => item.id === silent)?.deliveredAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('only offers to play a film that has a stored file', async () => {
    const playable = await film({ url: 'https://orbit.com/', deliveredAt: '2026-11-02' });
    const silent = await film({ url: 'https://pebble.app/', deliveredAt: '2026-11-01' });
    await file(playable, '9:16', 'tall');
    await file(silent, '16:9', null);
    const wall = await showcaseFilms(db());
    expect(wall.find((item) => item.id === playable)?.videoPath).toBe(
      `/api/showcase/${playable}/video`,
    );
    expect(wall.find((item) => item.id === silent)?.videoPath).toBeNull();
  });
});

describe('a film on the wall', () => {
  it('plays the 16:9 file to anyone', async () => {
    const id = await film({ url: 'https://orbit.com/', deliveredAt: '2026-11-02' });
    await file(id, '9:16', 'tall film');
    await file(id, '16:9', 'wide film bytes');
    const response = await showcaseVideo(db(), proxy.env.FILMS, id, get());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe('15');
    expect(await response.text()).toBe('wide film bytes');
  });

  it('plays the cut the founder has now, never one they asked to change', async () => {
    const id = await film({
      url: 'https://orbit.com/',
      deliveredAt: '2026-11-02',
      scriptVersion: 2,
    });
    await file(id, '16:9', 'bytes of cut v1', 1);
    await file(id, '16:9', 'bytes of cut v2', 2);
    const response = await showcaseVideo(db(), proxy.env.FILMS, id, get());
    expect(await response.text()).toBe('bytes of cut v2');
  });

  it('offers no video while the newest cut has no stored file', async () => {
    const id = await film({
      url: 'https://orbit.com/',
      deliveredAt: '2026-11-02',
      scriptVersion: 2,
    });
    await file(id, '16:9', 'bytes of cut v1', 1);
    expect((await showcaseFilms(db()))[0]?.videoPath).toBeNull();
    expect((await showcaseVideo(db(), proxy.env.FILMS, id, get())).status).toBe(404);
  });

  it('answers byte ranges, as Safari needs', async () => {
    const id = await film({ url: 'https://orbit.com/', deliveredAt: '2026-11-02' });
    await file(id, '16:9', 'wide film bytes');

    let response = await showcaseVideo(db(), proxy.env.FILMS, id, get({ range: 'bytes=0-3' }));
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-3/15');
    expect(response.headers.get('content-length')).toBe('4');
    expect(await response.text()).toBe('wide');

    response = await showcaseVideo(db(), proxy.env.FILMS, id, get({ range: 'bytes=-5' }));
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('bytes');

    response = await showcaseVideo(db(), proxy.env.FILMS, id, get({ range: 'bytes=99-' }));
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */15');
  });

  it('is gone once its founder opts out, and never serves other films', async () => {
    const id = await film({ url: 'https://orbit.com/', deliveredAt: '2026-11-02' });
    await file(id, '16:9', 'wide film bytes');
    const hidden = await film({ url: 'https://shy.com/', deliveredAt: '2026-11-02', optIn: false });
    await file(hidden, '16:9', 'private');
    const demo = await film({
      url: 'https://demo.com/',
      deliveredAt: '2026-11-02',
      pipeline: 'simulated',
    });
    const silent = await film({ url: 'https://pebble.app/', deliveredAt: '2026-11-02' });
    await file(silent, '16:9', null);

    for (const other of [hidden, demo, silent, 'flm_nope', '../../etc/passwd']) {
      const response = await showcaseVideo(db(), proxy.env.FILMS, other, get());
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }

    await db().update(films).set({ showcaseOptIn: false });
    expect((await showcaseVideo(db(), proxy.env.FILMS, id, get())).status).toBe(404);
  });
});

describe('byte ranges', () => {
  it('reads the single ranges a video player sends', () => {
    expect(parseRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
  });

  it('refuses a range past the end, and serves the whole file for anything else', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=5-1', 100)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseRange('items=0-1', 100)).toBeNull();
    expect(parseRange('bytes=-', 100)).toBeNull();
  });
});
