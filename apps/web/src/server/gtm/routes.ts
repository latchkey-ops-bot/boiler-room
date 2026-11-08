/**
 * The GTM executor's routes and a sample's film page, served by `worker.ts` before OpenNext and
 * outside Clerk: the executor has no Clerk session, and a startup opening its film page signs in to
 * nothing.
 *
 *   POST /api/gtm/v1/films                 {url, idempotency_key, budget_micro_usd, lead_ref} → {id}
 *   GET  /api/gtm/v1/films/{id}            → FilmOrderStatus
 *   POST /api/gtm/v1/films/{id}/share      → {page_url, share_id}
 *   GET  /api/gtm/v1/films/{id}/file       → FilmFile, a link that works for 10 minutes
 *   GET  /api/gtm/v1/films/{id}/decisions  → FilmDecisions: the film's decisions feed
 *   POST /api/gtm/v1/films/{id}/withdraw   {reason} → {withdrawn: true}
 *   GET  /api/gtm/v1/requests?after=       → {data, cursor}: removals made on film pages
 *   GET  /api/gtm/v1/files/{id}?exp=&sig=  the signed MP4 link (no bearer: the signature is the key)
 *   GET  /f/{share_id}                      the film page; 410 once withdrawn
 *   GET  /f/{share_id}/video, /download     the 16:9 file, inline or as a download
 *   POST /f/{share_id}/remove               "Remove this film": anyone, no sign-in
 *
 * Every `/api/gtm/v1/` route but the signed file link needs `Authorization: Bearer
 * <GTM_SERVICE_TOKEN>`, compared in constant time. Without the secret, or without
 * `BR_HOUSE_ACCOUNT_ID`, they answer 503 and no sample can be made.
 */
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { z } from 'zod';
import { getDb } from '../../db/client.ts';
import { deliverables, films, gtmOrders } from '../../db/schema.ts';
import { ApiError } from '../api/errors.ts';
import { errorResponse, json } from '../api/http.ts';
import { type RunnerEnv, runnerDeps } from '../runner/deps.ts';
import { readAtMost } from '../runner/routes.ts';
import { parseRange } from '../showcase.ts';
import { bearerOf, fileLinkValid, tokenConfigured, tokenMatches } from './auth.ts';
import { gonePage, missingPage, removedPage, samplePage } from './page.ts';
import {
  type GtmDeps,
  listRequests,
  orderInput,
  orderSample,
  removeByPage,
  SHARE_ID,
  sampleDecisions,
  sampleFile,
  sampleStatus,
  sharedSample,
  shareSample,
  withdrawInput,
  withdrawSample,
} from './samples.ts';

export const GTM_API = '/api/gtm/v1';

/** The bindings the GTM routes read, beyond the runner's. */
export interface GtmEnv extends RunnerEnv {
  /** Secret. The GTM executor's bearer token, at least 32 characters. Unset: the routes are off. */
  GTM_SERVICE_TOKEN?: string;
  /** Boiler Room's own account (`acc_…`): every sample belongs to it. */
  BR_HOUSE_ACCOUNT_ID?: string;
}

const FILM_PAGE = /^\/f\/([0-9a-z]{20})(?:\/(video|download|remove))?$/;
const FILM = /^\/films\/(flm_[0-9a-z]{20})(?:\/(share|file|decisions|withdraw))?$/;
const FILE_LINK = /^\/files\/(flm_[0-9a-z]{20})$/;

/** The largest JSON body a GTM route takes. */
const BODY_LIMIT = 8 * 1024;

/** True for a path these routes serve. */
export function isGtmPath(pathname: string): boolean {
  return pathname === GTM_API || pathname.startsWith(`${GTM_API}/`) || FILM_PAGE.test(pathname);
}

const answer = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, { status });

/** Headers every film page and file answer carries: unindexed, never framed. */
function pageHeaders(type: string): Headers {
  const headers = new Headers();
  headers.set('content-type', type);
  headers.set('x-robots-tag', 'noindex, nofollow');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-content-type-options', 'nosniff');
  return headers;
}

function html(body: string, status = 200): Response {
  const headers = pageHeaders('text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set(
    'content-security-policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  return new Response(body, { status, headers });
}

export function gtmDeps(env: GtmEnv, ctx: { waitUntil(promise: Promise<unknown>): void }) {
  return {
    runner: runnerDeps(env, getDb(env.DB), () => new Date(), {
      waitUntil: (promise) => ctx.waitUntil(promise),
    }),
    houseAccountId: env.BR_HOUSE_ACCOUNT_ID ?? null,
    token: env.GTM_SERVICE_TOKEN?.trim() ?? '',
  };
}

export async function gtmFetch(
  request: Request,
  env: GtmEnv,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  /** Tests pass their own, with a fake Naive and a clock. */
  getDeps: () => GtmDeps = () => gtmDeps(env, ctx),
): Promise<Response> {
  const url = new URL(request.url);
  try {
    const page = FILM_PAGE.exec(url.pathname);
    if (page) return await filmPage(request, getDeps(), page[1] as string, page[2] ?? null);
    const rest = url.pathname.slice(GTM_API.length);
    const link = FILE_LINK.exec(rest);
    if (link) return await signedFile(request, getDeps(), link[1] as string, url);
    return await api(request, getDeps(), rest, url);
  } catch (error) {
    return errorResponse(error);
  }
}

async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send the body as application/json.');
  }
  const bytes = await readAtMost(request, BODY_LIMIT);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, 'invalid_json', 'The body is not valid JSON.');
  }
}

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      'invalid_body',
      'Some fields are missing or wrong.',
      result.error.issues.slice(0, 10).map((issue) => ({
        path: issue.path.join('.') || '$',
        message: issue.message,
      })),
    );
  }
  return result.data;
}

async function api(request: Request, deps: GtmDeps, rest: string, url: URL): Promise<Response> {
  if (!tokenConfigured(deps.token)) {
    return answer(503, 'gtm_off', 'GTM_SERVICE_TOKEN is not set here, so the GTM routes are off.');
  }
  if (!(await tokenMatches(bearerOf(request), deps.token))) {
    return answer(401, 'unauthorized', 'Send the GTM service token as a bearer token.');
  }
  const origin = url.origin;
  const method = request.method;
  if (rest === '/films') {
    if (method !== 'POST') return answer(405, 'method_not_allowed', 'POST an order.');
    const order = await orderSample(deps, parsed(orderInput, await readBody(request)));
    return json({ id: order.id }, { status: order.created ? 201 : 200 });
  }
  if (rest === '/requests') {
    if (method !== 'GET') return answer(405, 'method_not_allowed', 'GET the requests.');
    return json(await listRequests(deps, url.searchParams.get('after')));
  }
  const film = FILM.exec(rest);
  if (!film) return answer(404, 'not_found', 'There is no such route.');
  const id = film[1] as string;
  switch (film[2] ?? null) {
    case null:
      if (method !== 'GET') return answer(405, 'method_not_allowed', 'GET the status.');
      return json(await sampleStatus(deps, id));
    case 'share':
      if (method !== 'POST') return answer(405, 'method_not_allowed', 'POST to share.');
      return json(await shareSample(deps, id, origin));
    case 'file':
      if (method !== 'GET') return answer(405, 'method_not_allowed', 'GET the file link.');
      return json(await sampleFile(deps, id, origin));
    case 'decisions':
      if (method !== 'GET') return answer(405, 'method_not_allowed', 'GET the decisions.');
      return json(await sampleDecisions(deps, id));
    case 'withdraw': {
      if (method !== 'POST') return answer(405, 'method_not_allowed', 'POST to withdraw.');
      const { reason } = parsed(withdrawInput, await readBody(request));
      return json(await withdrawSample(deps, id, reason));
    }
    default:
      return answer(404, 'not_found', 'There is no such route.');
  }
}

/** `GET /api/gtm/v1/files/{id}?exp=&sig=`: the MP4 behind a 10-minute link, for the social provider. */
async function signedFile(
  request: Request,
  deps: GtmDeps,
  filmId: string,
  url: URL,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return answer(405, 'method_not_allowed', 'GET the file.');
  }
  if (!tokenConfigured(deps.token)) return answer(503, 'gtm_off', 'The GTM routes are off.');
  const expires = Number(url.searchParams.get('exp') ?? 'NaN');
  const sig = url.searchParams.get('sig') ?? '';
  const nowSeconds = Math.floor(deps.runner.now().getTime() / 1000);
  if (!(await fileLinkValid(deps.token, filmId, expires, sig, nowSeconds))) {
    return answer(403, 'bad_link', 'This file link is wrong or has expired.');
  }
  const film = await deps.runner.db.query.films.findFirst({
    where: and(eq(films.id, filmId), eq(films.sample, true)),
  });
  const order = film
    ? await deps.runner.db.query.gtmOrders.findFirst({ where: eq(gtmOrders.filmId, filmId) })
    : undefined;
  if (!film || !order || order.withdrawnAt) return answer(404, 'not_found', 'There is no file.');
  const [file] = await deps.runner.db
    .select()
    .from(deliverables)
    .where(
      and(
        eq(deliverables.filmId, filmId),
        eq(deliverables.scriptVersion, film.scriptVersion),
        eq(deliverables.format, '16:9'),
        isNotNull(deliverables.r2Key),
      ),
    )
    .orderBy(asc(deliverables.variantKey))
    .limit(1);
  if (!file?.r2Key) return answer(404, 'not_found', 'There is no file.');
  return streamFile(deps.runner.films, file.r2Key, file.contentType, request, 'inline', 'film.mp4');
}

async function filmPage(
  request: Request,
  deps: GtmDeps,
  shareId: string,
  part: string | null,
): Promise<Response> {
  if (!SHARE_ID.test(shareId)) return html(missingPage(), 404);
  if (part === 'remove') {
    if (request.method !== 'POST') return html(missingPage(), 405);
    const outcome = await removeByPage(deps, shareId);
    if (outcome === 'missing') return html(missingPage(), 404);
    const shared = await sharedSample(deps.runner.db, shareId);
    return outcome === 'removed'
      ? html(removedPage(shared?.host ?? 'this site'))
      : html(gonePage(), 410);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return html(missingPage(), 405);
  const shared = await sharedSample(deps.runner.db, shareId);
  if (!shared) return html(missingPage(), 404);
  if (shared.withdrawn) return html(gonePage(), 410);
  if (part === null) return html(samplePage(shared, shareId));
  if (!shared.file) return html(missingPage(), 404);
  return streamFile(
    deps.runner.films,
    shared.file.r2Key,
    shared.file.contentType,
    request,
    part === 'download' ? 'attachment' : 'inline',
    shared.file.fileName,
  );
}

/** Streams an R2 object, answering one byte range when asked, which Safari needs to play video. */
async function streamFile(
  bucket: R2Bucket,
  key: string,
  contentType: string,
  request: Request,
  disposition: 'inline' | 'attachment',
  fileName: string,
): Promise<Response> {
  const headers = pageHeaders(contentType);
  headers.set('content-disposition', `${disposition}; filename="${fileName.replace(/"/g, '')}"`);
  headers.set('accept-ranges', 'bytes');
  // Short, so a withdrawn film is off screens within a minute.
  headers.set('cache-control', 'private, max-age=60');
  const missing = () => answer(404, 'not_found', 'The file is missing from storage.');
  const range = request.headers.get('range');
  if (range) {
    const head = await bucket.head(key);
    if (!head) return missing();
    const span = parseRange(range, head.size);
    if (span === 'unsatisfiable') {
      headers.set('content-range', `bytes */${head.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (span) {
      const length = span.end - span.start + 1;
      const part = await bucket.get(key, { range: { offset: span.start, length } });
      if (!part) return missing();
      headers.set('content-range', `bytes ${span.start}-${span.end}/${head.size}`);
      headers.set('content-length', String(length));
      return new Response(part.body, { status: 206, headers });
    }
  }
  const object = await bucket.get(key);
  if (!object) return missing();
  headers.set('content-length', String(object.size));
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
}
