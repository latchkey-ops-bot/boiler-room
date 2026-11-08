import { and, asc, desc, eq, inArray, isNotNull, max, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { deliverables, filmEvents, films } from '../db/schema.ts';
import { displayHost, type Format } from '../lib/film.ts';
import { parseCampaign } from './api/films.ts';

export interface ShowcaseFilm {
  id: string;
  host: string;
  brand: string;
  headline: string | null;
  background: string;
  foreground: string;
  deliveredAt: string;
  /** Boiler Room's own launch film. It always goes first. */
  house: boolean;
  /** Where the public can watch it, or null when no file is stored. */
  videoPath: string | null;
}

/** The shape the wall plays, in order of preference: its frames are 16:9. */
const PLAY_ORDER: readonly Format[] = ['16:9', '1:1', '9:16'];

/**
 * The public launch wall: delivered films whose founders opted in. Simulated films never appear,
 * because the showcase is for real films only.
 *
 * Boiler Room's own film goes first, as the founder decided. It is chosen by who owns it, never by
 * its URL: pass Boiler Room's own account as `houseAccountId` (the `BR_HOUSE_ACCOUNT_ID` var), and
 * that account's newest film on the wall leads it, however old it is. No other account's film is
 * ever marked as ours.
 */
export async function showcaseFilms(
  db: Db,
  { limit = 24, houseAccountId = null }: { limit?: number; houseAccountId?: string | null } = {},
): Promise<ShowcaseFilm[]> {
  const shown = and(
    eq(films.showcaseOptIn, true),
    eq(films.status, 'done'),
    ne(films.pipeline, 'simulated'),
    eq(films.standIn, false),
    eq(films.sample, false),
  );
  const house = houseAccountId
    ? await db
        .select()
        .from(films)
        .where(and(shown, eq(films.accountId, houseAccountId)))
        .orderBy(desc(films.updatedAt))
        .limit(1)
    : [];
  const newest = await db
    .select()
    .from(films)
    .where(shown)
    .orderBy(desc(films.updatedAt))
    .limit(limit);
  const rows = [...house, ...newest.filter((film) => film.id !== house[0]?.id)].slice(0, limit);
  if (rows.length === 0) return [];

  const ids = rows.map((film) => film.id);
  const [files, deliveries] = await Promise.all([
    db
      .select({ filmId: deliverables.filmId, scriptVersion: deliverables.scriptVersion })
      .from(deliverables)
      .where(and(inArray(deliverables.filmId, ids), isNotNull(deliverables.r2Key))),
    // When the crew delivered it. `updatedAt` also moves when the founder opts in, later.
    db
      .select({ filmId: filmEvents.filmId, at: max(filmEvents.at) })
      .from(filmEvents)
      .where(and(inArray(filmEvents.filmId, ids), eq(filmEvents.kind, 'delivered')))
      .groupBy(filmEvents.filmId),
  ]);

  return rows.map((film) => {
    const campaign = parseCampaign(film.campaignJson);
    const headline =
      campaign?.scenes[0]?.text.find((item) => item.role === 'headline')?.value ?? null;
    const playable = files.some(
      (file) => file.filmId === film.id && file.scriptVersion === film.scriptVersion,
    );
    const delivered = deliveries.find((row) => row.filmId === film.id)?.at ?? film.updatedAt;
    return {
      id: film.id,
      host: displayHost(film.url),
      brand: campaign?.brand.name ?? displayHost(film.url),
      headline,
      background: campaign?.brand.colors.background ?? '#0B2E40',
      foreground: campaign?.brand.colors.foreground ?? '#FFFFFF',
      deliveredAt: delivered.toISOString(),
      house: film.id === house[0]?.id,
      videoPath: playable ? `/api/showcase/${film.id}/video` : null,
    };
  });
}

/**
 * Streams the film a visitor watches on the wall: the 16:9 file if there is one. Only a film that
 * is on the showcase is served, so opting out takes it down. Answers byte ranges, which Safari
 * needs to play a video at all.
 */
export async function showcaseVideo(
  db: Db,
  bucket: R2Bucket,
  id: string,
  request: Request,
): Promise<Response> {
  const missing = () =>
    new Response('There is no film here.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  if (!/^flm_[0-9a-z]{20}$/.test(id)) return missing();
  const film = await db.query.films.findFirst({
    where: and(
      eq(films.id, id),
      eq(films.showcaseOptIn, true),
      eq(films.status, 'done'),
      ne(films.pipeline, 'simulated'),
      eq(films.standIn, false),
      eq(films.sample, false),
    ),
  });
  if (!film) return missing();
  // The cut the founder has now. Earlier cuts stay downloadable for them, but the wall never plays
  // a version they asked to change.
  const rows = await db
    .select()
    .from(deliverables)
    .where(
      and(
        eq(deliverables.filmId, id),
        eq(deliverables.scriptVersion, film.scriptVersion),
        isNotNull(deliverables.r2Key),
      ),
    )
    .orderBy(asc(deliverables.variantKey));
  const file = PLAY_ORDER.map((format) => rows.find((row) => row.format === format)).find(Boolean);
  if (!file?.r2Key) return missing();

  const rangeHeader = request.headers.get('range');
  const headers = new Headers();
  headers.set('content-type', file.contentType);
  headers.set('accept-ranges', 'bytes');
  // Short, so a founder who opts out is off visitors' screens within a minute.
  headers.set('cache-control', 'public, max-age=60');

  if (rangeHeader) {
    const head = await bucket.head(file.r2Key);
    if (!head) return missing();
    const span = parseRange(rangeHeader, head.size);
    if (span === 'unsatisfiable') {
      headers.set('content-range', `bytes */${head.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (span) {
      const length = span.end - span.start + 1;
      const part = await bucket.get(file.r2Key, { range: { offset: span.start, length } });
      if (!part) return missing();
      headers.set('etag', part.httpEtag);
      headers.set('content-range', `bytes ${span.start}-${span.end}/${head.size}`);
      headers.set('content-length', String(length));
      return new Response(part.body, { status: 206, headers });
    }
  }

  const object = await bucket.get(file.r2Key);
  if (!object) return missing();
  headers.set('etag', object.httpEtag);
  headers.set('content-length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

/**
 * The bytes a `Range` header asks for, in a file of `size` bytes. Null means serve the whole file,
 * which HTTP allows for any range a server does not support, such as several ranges at once.
 */
export function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | null | 'unsatisfiable' {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size === 0) return null;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return end < start ? null : { start, end };
}

/** True once at least one real film is on the wall. The nav shows Showcase only then. */
export async function hasShowcaseFilms(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: films.id })
    .from(films)
    .where(
      and(
        eq(films.showcaseOptIn, true),
        eq(films.status, 'done'),
        ne(films.pipeline, 'simulated'),
        eq(films.standIn, false),
        eq(films.sample, false),
      ),
    )
    .limit(1);
  return row !== undefined;
}
