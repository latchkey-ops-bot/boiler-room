import { and, eq, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { type Film, type FilmRun, films, runFiles, runnerNonces } from '../../db/schema.ts';
import { FORMATS, type Format } from '../../lib/film.ts';
import { ApiError } from '../api/errors.ts';
import { errorResponse, json } from '../api/http.ts';
import { newId } from '../ids.ts';
import {
  deriveRunKey,
  deriveWatchdogKey,
  EMPTY_SHA256,
  FILM_ID,
  HEADERS,
  type Instructions,
  MAX_BYTES_PER_FILM,
  MAX_FILES_PER_FILM,
  MAX_SKEW_SECONDS,
  RUN_ID,
  SAMPLE_FORMATS,
  type SignedParts,
  sha256Hex,
  UPLOAD_KINDS,
  type UploadKind,
  verifyParts,
  WATCHDOG_ID,
} from './contract.ts';
import {
  applyEvents,
  applyHello,
  eventsBody,
  expectedVariants,
  helloEvent,
  parseApproval,
} from './events.ts';
import { getRun, logLine, type RunnerDeps } from './runs.ts';
import { ACCEPTS, type RunState } from './states.ts';
import { watchdogTick } from './watchdog.ts';

/** JSON bodies the runner sends. Uploads have their own limits, by kind. */
export const RUNNER_BODY_LIMITS = { hello: 8 * 1024, events: 256 * 1024, watchdog: 1024 } as const;

export interface RunnerRequest {
  deps: RunnerDeps;
  run: FilmRun;
  film: Film;
  /** The JSON body, already checked against its signed hash. Null for GET and uploads. */
  body: unknown;
  /** The run's signing key, as hex. Scrubbed from anything the runner sends to the feed. */
  key: string;
  url: URL;
}

type Handler = (request: Request, ctx: RunnerRequest) => Promise<Response>;

interface RouteSpec {
  /** A JSON body up to this many bytes, or null for none (GET) or a raw upload. */
  jsonLimit: number | null;
}

const unauthorized = () =>
  new ApiError(401, 'unauthorized', 'This request is not signed for this film.');

interface Signed {
  parts: SignedParts;
  signature: string;
}

/** Step 1 of every check: the headers are all there and well formed. Nothing is read yet. */
function readSignedHeaders(
  request: Request,
  url: URL,
  filmId: string,
  runId: string | null,
): Signed {
  const h = (name: string) => request.headers.get(name) ?? '';
  const film = h(HEADERS.film);
  const run = h(HEADERS.run);
  const ts = Number(h(HEADERS.ts));
  const nonce = h(HEADERS.nonce);
  const bodySha256 = h(HEADERS.bodySha256);
  const signature = h(HEADERS.signature);
  const length = request.headers.get('content-length');
  const contentLength = length === null ? 0 : Number(length);
  const watchdog = filmId === WATCHDOG_ID;
  if (
    film !== filmId ||
    (!watchdog && !FILM_ID.test(film)) ||
    (runId === null ? !RUN_ID.test(run) : run !== runId) ||
    !Number.isInteger(ts) ||
    !/^[0-9a-f]{32}$/.test(nonce) ||
    !/^[0-9a-f]{64}$/.test(bodySha256) ||
    !/^v1=[0-9a-f]{64}$/.test(signature) ||
    !Number.isInteger(contentLength) ||
    contentLength < 0
  ) {
    throw new ApiError(
      400,
      'bad_signature_headers',
      'The signature headers are missing or malformed.',
    );
  }
  return {
    parts: {
      method: request.method,
      pathAndQuery: url.pathname + url.search,
      filmId: film,
      runId: run,
      ts,
      nonce,
      bodySha256,
      contentLength,
    },
    signature,
  };
}

function assertFresh(deps: RunnerDeps, ts: number): void {
  const now = Math.floor(deps.now().getTime() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) {
    throw Object.assign(
      new ApiError(401, 'stale', 'The timestamp is too far from the server clock.'),
      {
        serverTime: now,
      },
    );
  }
}

/**
 * Reads a JSON body (or the empty body of a GET) up to `limit` bytes. The signed length is the
 * length actually read, so a missing or wrong Content-Length header cannot shift what was signed.
 * Nothing is written here; the signature and the hash are checked next.
 */
async function readBody(
  request: Request,
  parts: SignedParts,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (parts.contentLength > limit) {
    throw new ApiError(413, 'body_too_large', 'The body is too large.');
  }
  const type = request.headers.get('content-type') ?? '';
  if (parts.method !== 'GET' && !type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send the body as application/json.');
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > limit) throw new ApiError(413, 'body_too_large', 'The body is too large.');
  parts.contentLength = bytes.byteLength;
  return bytes;
}

/** The body against its signed hash, then as JSON. */
async function parseSignedJson(
  bytes: Uint8Array<ArrayBuffer>,
  parts: SignedParts,
): Promise<unknown> {
  if ((await sha256Hex(bytes)) !== parts.bodySha256) {
    throw new ApiError(400, 'body_hash', 'The body does not match its signed hash.');
  }
  if (bytes.byteLength === 0) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, 'invalid_json', 'The body is not valid JSON.');
  }
}

/** Stores the nonce. A second request with it is a replay. */
async function spendNonce(deps: RunnerDeps, filmId: string, nonce: string): Promise<void> {
  const stored = await deps.db
    .insert(runnerNonces)
    .values({ nonce, filmId, seenAt: deps.now().getTime() })
    .onConflictDoNothing();
  if (stored.meta.changes !== 1)
    throw new ApiError(409, 'replay', 'This request was already received.');
}

function refusal(error: unknown, filmId: string, deps: RunnerDeps | null): Response {
  if (error instanceof ApiError && error.status < 500) {
    if (deps)
      logLine(
        deps,
        `runner: refused ${error.code} for film ${FILM_ID.test(filmId) ? filmId : '?'}`,
      );
    if (error.code === 'stale') {
      return json(
        {
          error: { code: error.code, message: error.message },
          serverTime: (error as ApiError & { serverTime?: number }).serverTime,
        },
        { status: 401 },
      );
    }
  }
  return errorResponse(error);
}

/**
 * Wraps a runner route. In order, and nothing is written before the signature passes: the headers,
 * the clock, the run (which must belong to the film in the path), the signature with that run's
 * key, the body against its hash, the nonce, and that the run is the film's current real run. The
 * film's owner comes from the film row; no runner route ever reads one from the request.
 */
export function runnerRoute(getDeps: () => RunnerDeps, spec: RouteSpec, handler: Handler) {
  return async (request: Request, segment: { params: Promise<{ filmId: string }> }) => {
    let deps: RunnerDeps | null = null;
    let filmId = '';
    try {
      deps = getDeps();
      ({ filmId } = await segment.params);
      const url = new URL(request.url);
      const signed = readSignedHeaders(request, url, filmId, null);
      assertFresh(deps, signed.parts.ts);
      const secret = deps.config.signingSecret;
      if (!secret) throw new ApiError(503, 'not_configured', 'Real films are not set up here.');
      // A JSON body is read first, bounded, so its real length is what the signature covers. An
      // upload is not read: its Content-Length is required and signed, and R2 checks its hash.
      const raw =
        spec.jsonLimit !== null || request.method === 'GET'
          ? await readBody(request, signed.parts, spec.jsonLimit ?? 0)
          : null;
      const run = await getRun(deps.db, signed.parts.runId);
      if (!run || run.filmId !== filmId) throw unauthorized();
      const key = await deriveRunKey(secret, filmId, run.id);
      if (!(await verifyParts(key, signed.parts, signed.signature))) throw unauthorized();

      const body = raw ? await parseSignedJson(raw, signed.parts) : null;
      await spendNonce(deps, filmId, signed.parts.nonce);

      const film = await deps.db.query.films.findFirst({ where: eq(films.id, filmId) });
      if (film?.pipeline !== 'naive' || film.pipelineRunId !== run.id) {
        throw new ApiError(409, 'wrong_run', 'This run is not the film’s current run.');
      }
      return await handler(request, { deps, run, film, body, key, url });
    } catch (error) {
      return refusal(error, filmId, deps);
    }
  };
}

function assertState(run: FilmRun, accepted: readonly RunState[]): void {
  if (!accepted.includes(run.state as RunState)) {
    throw new ApiError(409, 'wrong_state', `The run is ${run.state}.`);
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

// ---------- Handlers ----------

/** `POST films/{filmId}/hello`: the runner is up. Answers the server's clock and the phase. */
export const hello: Handler = async (_request, { deps, run, body }) => {
  assertState(run, ACCEPTS.hello);
  const event = parsed(helloEvent, body);
  const updated = await applyHello(deps, run, event);
  return json({ serverTime: Math.floor(deps.now().getTime() / 1000), phase: updated.phase });
};

/** `GET films/{filmId}/instructions`: what the runner is to do. The website is the only source. */
export const instructions: Handler = async (_request, { deps, run, film }) => {
  assertState(run, ACCEPTS.instructions);
  return json(instructionsFor(deps, run, film));
};

export function instructionsFor(deps: RunnerDeps, run: FilmRun, film: Film): Instructions {
  const crewCap = Math.max(0, run.costCapMicroUsd - deps.config.computeReserveMicroUsd);
  const revise = run.reviseJson
    ? (JSON.parse(run.reviseJson) as { version: number; note: string })
    : null;
  return {
    phase: run.phase as Instructions['phase'],
    mode: run.mode,
    url: film.url,
    scriptVersion: run.scriptVersion,
    approval: run.phase === 'render' ? parseApproval(run.approvalJson) : null,
    revise: run.phase === 'script' ? revise : null,
    sampleFormats: run.phase === 'all' ? [...SAMPLE_FORMATS] : null,
    maxCrewUsd: Math.max(0, crewCap - run.costCrewMicroUsd) / 1_000_000,
    spentCrewUsd: run.costCrewMicroUsd / 1_000_000,
    deadlineAt: new Date(run.phaseDeadlineAt ?? deps.now().getTime() + 60 * 60_000).toISOString(),
    stop: run.state === 'stopping',
  };
}

/** `POST films/{filmId}/events`: a batch of what the crew did, in order. */
export const events: Handler = async (_request, { deps, run, body, key }) => {
  assertState(run, ACCEPTS.events);
  const batch = parsed(eventsBody, body);
  if (batch.runId !== run.id) throw new ApiError(400, 'wrong_run', 'The body names another run.');
  return json(await applyEvents(deps, run, batch.events, [key]));
};

/** Upload states, by kind. */
function uploadAllowed(run: FilmRun, kind: UploadKind): boolean {
  if (kind === 'campaign' || kind === 'research') {
    return (
      run.state === 'script_running' || (run.state === 'render_running' && run.phase === 'all')
    );
  }
  return run.state === 'render_running' || run.state === 'delivering';
}

const VARIANT = /^(16:9|9:16|1:1)\.([a-z0-9][a-z0-9-]{0,63})\.([a-z0-9][a-z0-9-]{0,63})$/;

/**
 * R2 stores a stream only when it knows the stream's length. Next can hand a route a body it has
 * wrapped, which loses it, so the signed Content-Length is put back with the Workers runtime's
 * `FixedLengthStream`, which also fails the put if the body is any other length. Outside workerd
 * (the unit tests) there is no such class and the body goes as it is.
 */
function withLength(body: ReadableStream<Uint8Array>, length: number): ReadableStream<Uint8Array> {
  const Fixed = (
    globalThis as {
      FixedLengthStream?: new (length: number) => TransformStream<Uint8Array, Uint8Array>;
    }
  ).FixedLengthStream;
  if (!Fixed) return body;
  const fixed = new Fixed(length);
  body.pipeTo(fixed.writable).catch(() => undefined);
  return fixed.readable;
}

/** A file name the website will store: lower case, safe characters, at most 80. */
export function safeName(name: string): string | null {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 80);
  return clean === '' ? null : clean;
}

/**
 * `PUT films/{filmId}/files?kind=&version=&variant=&name=`: one file, raw, with Content-Length. The
 * body streams into R2 with the signed SHA-256, so R2 refuses a body that does not match it. The
 * website picks the R2 key; the runner never names one.
 */
export const files: Handler = async (request, { deps, run, url }) => {
  const kindParam = url.searchParams.get('kind') ?? '';
  if (!(kindParam in UPLOAD_KINDS)) throw new ApiError(400, 'bad_kind', 'Name a file kind.');
  const kind = kindParam as UploadKind;
  const rule = UPLOAD_KINDS[kind];
  const contentType =
    (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!(rule.contentTypes as readonly string[]).includes(contentType)) {
    throw new ApiError(
      415,
      'unsupported_media_type',
      `A ${kind} file is ${rule.contentTypes.join(' or ')}.`,
    );
  }
  const length = Number(request.headers.get('content-length') ?? 'NaN');
  if (!Number.isInteger(length) || length < 1) {
    throw new ApiError(411, 'length_required', 'Send the file with its Content-Length.');
  }
  if (length > rule.maxBytes)
    throw new ApiError(413, 'file_too_large', `A ${kind} file is at most ${rule.maxBytes} bytes.`);
  if (!uploadAllowed(run, kind)) throw new ApiError(409, 'wrong_state', `The run is ${run.state}.`);

  const version = Number(url.searchParams.get('version') ?? (kind === 'research' ? '0' : 'NaN'));
  const wanted =
    kind === 'research' ? null : kind === 'campaign' ? run.scriptVersion + 1 : run.scriptVersion;
  if (!Number.isInteger(version) || (wanted !== null && (version !== wanted || version < 1))) {
    throw new ApiError(409, 'wrong_version', `This upload is for version ${wanted ?? 0}.`);
  }

  let r2Key: string;
  let variant: string | null = null;
  let format: Format | null = null;
  let name: string;
  const base = `films/${run.filmId}`;
  switch (kind) {
    case 'mp4': {
      variant = url.searchParams.get('variant') ?? '';
      const match = VARIANT.exec(variant);
      const allowed =
        run.mode === 'sample'
          ? Boolean(match) && (SAMPLE_FORMATS as readonly string[]).includes(match?.[1] ?? '')
          : expectedVariants(run, []).includes(variant);
      if (!match || !allowed) throw new ApiError(409, 'not_approved', 'That cut was not approved.');
      format = FORMATS.includes(match[1] as Format) ? (match[1] as Format) : null;
      name = `${variant.replace(':', 'x')}.mp4`;
      r2Key = `${base}/v${version}/${name}`;
      break;
    }
    case 'still':
    case 'quality': {
      const safe = safeName(url.searchParams.get('name') ?? '');
      if (!safe) throw new ApiError(400, 'bad_name', 'Name the file.');
      name = safe;
      r2Key = `${base}/v${version}/${kind === 'still' ? 'stills' : 'quality'}/${name}`;
      break;
    }
    case 'campaign':
      name = 'campaign.json';
      r2Key = `${base}/v${version}/campaign.json`;
      break;
    case 'research':
      name = 'research.json';
      r2Key = `${base}/research.json`;
      break;
    default:
      name = `${kind}.json`;
      r2Key = `${base}/v${version}/${kind}.json`;
  }

  const [totals] = await deps.db
    .select({
      files: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(${runFiles.bytes}), 0)`,
    })
    .from(runFiles)
    .where(and(eq(runFiles.filmId, run.filmId), ne(runFiles.r2Key, r2Key)));
  if (
    (totals?.files ?? 0) + 1 > MAX_FILES_PER_FILM ||
    (totals?.bytes ?? 0) + length > MAX_BYTES_PER_FILM
  ) {
    throw new ApiError(413, 'film_too_large', 'This film holds as many files as it may.');
  }

  const sha256 = request.headers.get(HEADERS.bodySha256) ?? EMPTY_SHA256;
  if (!request.body) throw new ApiError(411, 'length_required', 'Send the file.');
  try {
    await deps.films.put(r2Key, withLength(request.body, length), {
      sha256,
      httpMetadata: { contentType },
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    logLine(
      deps,
      `runner: film ${run.filmId} upload of ${kind} was not stored: ${text.slice(0, 200)}`,
    );
    if (/checksum|sha-?256/i.test(text)) {
      throw new ApiError(
        400,
        'checksum',
        'The file does not match its signed hash, so it was not stored.',
      );
    }
    throw new ApiError(502, 'storage_failed', 'The file could not be stored. Send it again.');
  }
  const [row] = await deps.db
    .insert(runFiles)
    .values({
      id: newId('fil'),
      runId: run.id,
      filmId: run.filmId,
      kind,
      scriptVersion: version,
      variantKey: variant,
      format,
      name,
      r2Key,
      contentType,
      bytes: length,
      sha256,
      createdAt: deps.now().getTime(),
    })
    .onConflictDoUpdate({
      target: runFiles.r2Key,
      set: { runId: run.id, contentType, bytes: length, sha256, createdAt: deps.now().getTime() },
    })
    .returning();
  logLine(deps, `runner: film ${run.filmId} stored ${kind} ${name} (${length} bytes)`);
  return json({ ok: true, fileId: row?.id, bytes: length });
};

/**
 * `POST /api/runner/v1/watchdog`: the cron's tick, signed with the watchdog key. Only the website's
 * own scheduled handler holds that key.
 */
export function watchdogRoute(getDeps: () => RunnerDeps) {
  return async (request: Request): Promise<Response> => {
    let deps: RunnerDeps | null = null;
    try {
      deps = getDeps();
      const url = new URL(request.url);
      const signed = readSignedHeaders(request, url, WATCHDOG_ID, WATCHDOG_ID);
      assertFresh(deps, signed.parts.ts);
      const secret = deps.config.signingSecret;
      if (!secret) throw new ApiError(503, 'not_configured', 'Real films are not set up here.');
      const raw = await readBody(request, signed.parts, RUNNER_BODY_LIMITS.watchdog);
      if (!(await verifyParts(await deriveWatchdogKey(secret), signed.parts, signed.signature))) {
        throw unauthorized();
      }
      await parseSignedJson(raw, signed.parts);
      await spendNonce(deps, WATCHDOG_ID, signed.parts.nonce);
      return json(await watchdogTick(deps));
    } catch (error) {
      return refusal(error, WATCHDOG_ID, deps);
    }
  };
}
