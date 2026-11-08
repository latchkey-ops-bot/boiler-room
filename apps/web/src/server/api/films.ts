import { type Campaign, campaignSchema } from '@boiler-room/schema';
import { and, asc, desc, eq, notInArray, type SQL, sql } from 'drizzle-orm';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import {
  approvals,
  type Deliverable,
  deliverables,
  type Film,
  type FilmEvent,
  filmEvents,
  films,
  revisions,
} from '../../db/schema.ts';
import { displayHost, FORMATS, type Format } from '../../lib/film.ts';
import { parseFilmUrl } from '../../lib/film-url.ts';
import { type Channel, parseChannels } from '../../lib/launch.ts';
import { newId } from '../ids.ts';
import { parseFormats } from '../pipeline/index.ts';
import { capRefusal, realFilmCaps } from '../runner/caps.ts';
import { runnerReady } from '../runner/config.ts';
import type { ApiContext } from './context.ts';
import { ApiError, notFound } from './errors.ts';

/** A founder can have this many films in the works at once. It bounds what a mistake can cost. */
export const MAX_FILMS_IN_PROGRESS = 5;

/** A delivered film can be revised this many times. Each one costs a new render. */
export const MAX_REVISIONS_PER_FILM = 3;

const FINISHED = ['done', 'failed'] as const;

// ---------- Inputs: routes validate bodies against these with readJson ----------

export const createFilmInput = z.strictObject({ url: z.string().max(4096) });

const versionField = z.int().positive();

export const reviewScriptInput = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('approve'),
    version: versionField,
    hookId: z.string().max(64).nullable(),
    ctaId: z.string().max(64).nullable(),
    formats: z.array(z.enum(FORMATS)).min(1).max(FORMATS.length),
    /** Claims nobody had confirmed, which the customer says are right. */
    confirmedClaimIds: z.array(z.string().max(64)).max(64).default([]),
  }),
  z.strictObject({
    decision: z.literal('send_back'),
    version: versionField,
    note: z.string().trim().min(1, 'Write a note for the Director.').max(2000),
  }),
]);

export const showcaseInput = z.strictObject({ optIn: z.boolean() });

export const revisionInput = z.strictObject({
  version: versionField,
  note: z.string().trim().min(1, 'Tell the Account Manager what to change.').max(2000),
});

export type CreateFilmInput = z.infer<typeof createFilmInput>;
export type ReviewScriptInput = z.infer<typeof reviewScriptInput>;
export type ShowcaseInput = z.infer<typeof showcaseInput>;
export type RevisionInput = z.infer<typeof revisionInput>;

// ---------- Views: what the API returns ----------

export interface FilmView {
  id: string;
  url: string;
  host: string;
  title: string;
  status: Film['status'];
  stage: Film['stage'];
  pipeline: Film['pipeline'];
  /**
   * True for a film the SimulatedPipeline made, or a real film whose computer ran the stand-in film
   * command instead of the crew. Every screen labels it, and it never goes on the showcase.
   */
  simulated: boolean;
  scriptVersion: number;
  chosenHook: string | null;
  chosenCta: string | null;
  formats: Format[];
  showcaseOptIn: boolean;
  /** The founder's launch day, `YYYY-MM-DD`, or null until they set it. */
  launchDate: string | null;
  /** Where the founder will post the film. */
  launchChannels: Channel[];
  createdAt: string;
  updatedAt: string;
}

export interface FilmEventView {
  id: string;
  seq: number;
  at: string;
  agent: FilmEvent['agent'];
  kind: FilmEvent['kind'];
  stage: FilmEvent['stage'];
  status: FilmEvent['status'];
  message: string;
}

export interface DeliverableView {
  id: string;
  format: Format;
  hookId: string | null;
  ctaId: string | null;
  fileName: string;
  contentType: string;
  bytes: number | null;
  durationSeconds: number | null;
  /** The script version this file was cut from. 0 on files from before versions were kept. */
  scriptVersion: number;
  /** Null when there is no file to download, as for a simulated film. */
  downloadUrl: string | null;
  /** The same file for the player: shown inline, and seekable. Null when there is no file. */
  playUrl: string | null;
}

export interface ApprovalView {
  scriptVersion: number;
  decision: 'approved' | 'changes_requested';
  note: string | null;
  /** Claims the customer confirmed when they approved this version. */
  confirmedClaimIds: string[];
  decidedAt: string;
}

export interface RevisionView {
  /** The delivered version the customer asked to change. */
  scriptVersion: number;
  note: string;
  requestedAt: string;
}

export interface FilmDetail {
  film: FilmView;
  campaign: Campaign | null;
  events: FilmEventView[];
  approvals: ApprovalView[];
  /** Newest cut first. A revised film keeps the files of every earlier cut. */
  deliverables: DeliverableView[];
  revisions: RevisionView[];
}

export function filmView(film: Film): FilmView {
  const host = displayHost(film.url);
  return {
    id: film.id,
    url: film.url,
    host,
    // The site the founder typed, from start to finish. The film never changes name mid-way.
    title: host,
    status: film.status,
    stage: film.stage,
    pipeline: film.pipeline,
    simulated: film.pipeline === 'simulated' || film.standIn,
    scriptVersion: film.scriptVersion,
    chosenHook: film.chosenHook,
    chosenCta: film.chosenCta,
    formats: parseFormats(film.formatsJson),
    showcaseOptIn: film.showcaseOptIn,
    launchDate: film.launchDate,
    launchChannels: parseChannels(film.launchChannelsJson),
    createdAt: film.createdAt.toISOString(),
    updatedAt: film.updatedAt.toISOString(),
  };
}

function eventView(event: FilmEvent): FilmEventView {
  return {
    id: event.id,
    seq: event.seq,
    at: event.at.toISOString(),
    agent: event.agent,
    kind: event.kind,
    stage: event.stage,
    status: event.status,
    message: event.message,
  };
}

function deliverableView(row: Deliverable): DeliverableView {
  const downloadUrl = row.r2Key ? `/api/films/${row.filmId}/deliverables/${row.id}` : null;
  return {
    id: row.id,
    format: row.format,
    hookId: row.hookId,
    ctaId: row.ctaId,
    fileName: row.fileName,
    contentType: row.contentType,
    bytes: row.bytes,
    durationSeconds: row.durationSeconds,
    scriptVersion: row.scriptVersion,
    downloadUrl,
    playUrl: downloadUrl ? `${downloadUrl}?inline=1` : null,
  };
}

export function parseCampaign(json: string | null): Campaign | null {
  if (!json) return null;
  try {
    const parsed = campaignSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---------- Handlers ----------

export async function listFilms(ctx: ApiContext): Promise<{ films: FilmView[] }> {
  const rows = await ctx.db
    .select()
    .from(films)
    .where(eq(films.accountId, ctx.account.id))
    .orderBy(desc(films.createdAt))
    .limit(100);
  const synced = await Promise.all(
    rows.map((film, index) => (index < 10 ? syncFilm(ctx, film) : film)),
  );
  return { films: synced.map(filmView) };
}

export async function createFilm(ctx: ApiContext, input: CreateFilmInput): Promise<FilmDetail> {
  const parsed = parseFilmUrl(input.url);
  if (!parsed.ok) {
    throw new ApiError(400, 'invalid_url', parsed.reason, [
      { path: 'url', message: parsed.reason },
    ]);
  }

  // Reserve the film's row first, in one statement that also checks the cap, so parallel requests
  // cannot all pass the check. Only then start the run: a request over the cap never reaches the
  // pipeline, where a real run costs money.
  const id = newId('flm');
  const kind = ctx.pipelineKind;
  const now = ctx.now();
  // A real film costs money, so it also has to fit the real-film caps: films at work per founder,
  // films holding the crew's Researcher, and dollars per founder and per environment per day.
  const real = kind === 'naive' && runnerReady(ctx.runnerConfig);
  const scope = { accountId: ctx.account.id, userId: ctx.principal.userId, now: now.getTime() };
  const reserved = await ctx.db.run(sql`
    insert into films (id, account_id, created_by, url, status, stage, pipeline, created_at, updated_at)
    select ${id}, ${ctx.account.id}, ${ctx.principal.userId}, ${parsed.url}, 'queued', 'research',
      ${kind}, ${now.getTime()}, ${now.getTime()}
    where ${inProgressCount(ctx, now)} < ${MAX_FILMS_IN_PROGRESS}
      ${real ? sql`and ${realFilmCaps(ctx.runnerConfig, scope)}` : sql``}`);
  if (reserved.meta.changes !== 1) {
    const refusal = real ? await capRefusal(ctx.db, ctx.runnerConfig, scope) : null;
    if (refusal) throw refusal;
    throw new ApiError(
      429,
      'too_many_films',
      `You have ${MAX_FILMS_IN_PROGRESS} films in the works. Finish one before you start another.`,
    );
  }

  let runId: string;
  try {
    ({ runId } = await ctx.pipelineFor(kind).start({ filmId: id, url: parsed.url }));
  } catch (error) {
    // A pipeline that is down leaves no film behind.
    await ctx.db.delete(films).where(eq(films.id, id));
    throw error;
  }
  await ctx.db.update(films).set({ pipelineRunId: runId }).where(eq(films.id, id));
  return getFilmDetail(ctx, id);
}

export async function getFilmDetail(ctx: ApiContext, id: string): Promise<FilmDetail> {
  const film = await syncFilm(ctx, await ownFilm(ctx, id));
  const [events, decisions, files, asked] = await Promise.all([
    ctx.db.select().from(filmEvents).where(eq(filmEvents.filmId, id)).orderBy(asc(filmEvents.seq)),
    ctx.db
      .select()
      .from(approvals)
      .where(eq(approvals.filmId, id))
      .orderBy(asc(approvals.scriptVersion)),
    ctx.db
      .select()
      .from(deliverables)
      .where(eq(deliverables.filmId, id))
      .orderBy(desc(deliverables.scriptVersion), asc(deliverables.variantKey)),
    ctx.db
      .select()
      .from(revisions)
      .where(eq(revisions.filmId, id))
      .orderBy(asc(revisions.scriptVersion)),
  ]);
  return {
    film: filmView(film),
    campaign: parseCampaign(film.campaignJson),
    events: events.map(eventView),
    approvals: decisions.map((row) => ({
      scriptVersion: row.scriptVersion,
      decision: row.decision,
      note: row.note,
      confirmedClaimIds: parseIds(row.confirmedClaimsJson),
      decidedAt: row.decidedAt.toISOString(),
    })),
    deliverables: files.map(deliverableView),
    revisions: asked.map((row) => ({
      scriptVersion: row.scriptVersion,
      note: row.note,
      requestedAt: row.requestedAt.toISOString(),
    })),
  };
}

export async function reviewScript(
  ctx: ApiContext,
  id: string,
  review: ReviewScriptInput,
): Promise<FilmDetail> {
  const film = await syncFilm(ctx, await ownFilm(ctx, id));
  if (film.status !== 'needs_you' || film.stage !== 'approval') {
    throw new ApiError(409, 'not_awaiting_approval', 'The script is not waiting for you.');
  }
  if (review.version !== film.scriptVersion) {
    throw new ApiError(
      409,
      'stale_version',
      `You are looking at version ${review.version}. Version ${film.scriptVersion} is the latest.`,
    );
  }
  if (!film.pipelineRunId) throw new ApiError(409, 'not_started', 'This film has not started.');
  const pipeline = ctx.pipelineFor(film.pipeline);
  const now = ctx.now();

  if (review.decision === 'approve') {
    const choice = checkChoice(parseCampaign(film.campaignJson), review);
    await pipeline.approveScript(film.pipelineRunId, { version: review.version, ...choice });
    const formatsJson = JSON.stringify(choice.formats);
    await recordDecision(ctx, [
      ctx.db.insert(approvals).values({
        id: newId('apr'),
        filmId: id,
        scriptVersion: review.version,
        decision: 'approved',
        chosenHook: choice.hookId,
        chosenCta: choice.ctaId,
        formatsJson,
        confirmedClaimsJson: JSON.stringify(choice.confirmedClaimIds),
        decidedBy: ctx.principal.userId,
        decidedAt: now,
      }),
      ctx.db
        .update(films)
        .set({ chosenHook: choice.hookId, chosenCta: choice.ctaId, formatsJson, updatedAt: now })
        .where(eq(films.id, id)),
    ]);
  } else {
    await pipeline.sendBackScript(film.pipelineRunId, {
      version: review.version,
      note: review.note,
    });
    await recordDecision(ctx, [
      ctx.db.insert(approvals).values({
        id: newId('apr'),
        filmId: id,
        scriptVersion: review.version,
        decision: 'changes_requested',
        note: review.note,
        decidedBy: ctx.principal.userId,
        decidedAt: now,
      }),
      ctx.db.update(films).set({ updatedAt: now }).where(eq(films.id, id)),
    ]);
  }
  return getFilmDetail(ctx, id);
}

export async function setShowcase(
  ctx: ApiContext,
  id: string,
  { optIn }: ShowcaseInput,
): Promise<FilmView> {
  const film = await syncFilm(ctx, await ownFilm(ctx, id));
  if (optIn && film.status !== 'done') {
    throw new ApiError(409, 'not_delivered', 'You can show a film once it is delivered.');
  }
  const [updated] = await ctx.db
    .update(films)
    .set({ showcaseOptIn: optIn, updatedAt: ctx.now() })
    .where(and(eq(films.id, id), eq(films.accountId, ctx.account.id)))
    .returning();
  if (!updated) throw notFound();
  return filmView(updated);
}

export async function listDeliverables(
  ctx: ApiContext,
  id: string,
): Promise<{ deliverables: DeliverableView[] }> {
  await syncFilm(ctx, await ownFilm(ctx, id));
  const rows = await ctx.db
    .select()
    .from(deliverables)
    .where(eq(deliverables.filmId, id))
    .orderBy(desc(deliverables.scriptVersion), asc(deliverables.variantKey));
  return { deliverables: rows.map(deliverableView) };
}

/**
 * Streams a finished file from R2. `inline` serves it for the player instead of as a download, and
 * `range` (a Range header) answers with just those bytes, so the player can seek.
 */
export async function downloadDeliverable(
  ctx: ApiContext,
  id: string,
  deliverableId: string,
  options: { inline?: boolean; range?: string | null } = {},
): Promise<Response> {
  await ownFilm(ctx, id);
  const row = await ctx.db.query.deliverables.findFirst({
    where: and(eq(deliverables.id, deliverableId), eq(deliverables.filmId, id)),
  });
  if (!row) throw new ApiError(404, 'not_found', 'There is no file here.');
  if (!row.r2Key) {
    throw new ApiError(404, 'no_file', 'This is a simulated film, so it has no file to download.');
  }
  const headers = new Headers();
  headers.set('content-type', row.contentType);
  headers.set(
    'content-disposition',
    `${options.inline ? 'inline' : 'attachment'}; filename="${row.fileName.replace(/"/g, '')}"`,
  );
  headers.set('cache-control', 'private, no-store');
  headers.set('accept-ranges', 'bytes');

  if (options.range) {
    const head = await ctx.films.head(row.r2Key);
    if (!head) throw new ApiError(404, 'not_found', 'The file is missing from storage.');
    const bytes = parseByteRange(options.range, head.size);
    if (bytes === 'unsatisfiable') {
      headers.set('content-range', `bytes */${head.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (bytes) {
      const part = await ctx.films.get(row.r2Key, {
        range: { offset: bytes.start, length: bytes.end - bytes.start + 1 },
      });
      if (!part) throw new ApiError(404, 'not_found', 'The file is missing from storage.');
      headers.set('content-range', `bytes ${bytes.start}-${bytes.end}/${head.size}`);
      headers.set('content-length', String(bytes.end - bytes.start + 1));
      return new Response(part.body, { status: 206, headers });
    }
  }

  const object = await ctx.films.get(row.r2Key);
  if (!object) throw new ApiError(404, 'not_found', 'The file is missing from storage.');
  if (object.size) headers.set('content-length', String(object.size));
  return new Response(object.body, { headers });
}

/**
 * One `bytes=` range from a Range header, clamped to the file. Null when the header is not one
 * range we serve, so the whole file goes out instead, as RFC 9110 allows.
 */
export function parseByteRange(
  header: string,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return null;
  if (from === '') {
    // The last N bytes.
    const suffix = Number(to);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (start >= size) return 'unsatisfiable';
  if (end < start) return null;
  return { start, end };
}

/**
 * The customer asks for changes to their delivered film. The Account Manager takes the note to the
 * crew, and the film goes back to the script: the next version waits for the customer's approval
 * before anything renders. The files already delivered stay downloadable.
 */
export async function requestRevision(
  ctx: ApiContext,
  id: string,
  input: RevisionInput,
): Promise<FilmDetail> {
  const film = await syncFilm(ctx, await ownFilm(ctx, id));
  if (film.status !== 'done') {
    throw new ApiError(
      409,
      'not_delivered',
      'You can ask for a revision once the film is delivered.',
    );
  }
  if (input.version !== film.scriptVersion) {
    throw new ApiError(
      409,
      'stale_version',
      `You are looking at version ${input.version}. Version ${film.scriptVersion} is the latest.`,
    );
  }
  if (!film.pipelineRunId) throw new ApiError(409, 'not_started', 'This film has not started.');

  const earlier = await ctx.db
    .select({ id: revisions.id })
    .from(revisions)
    .where(eq(revisions.filmId, id))
    .limit(MAX_REVISIONS_PER_FILM);
  if (earlier.length >= MAX_REVISIONS_PER_FILM) {
    throw new ApiError(
      409,
      'too_many_revisions',
      `This film has had ${MAX_REVISIONS_PER_FILM} revisions, the most one film can have. Start a new video for a fresh take.`,
    );
  }
  // Reserve first, in one transaction: put the film back in the works only while the account is
  // under the cap, and record the request only if that happened. Then tell the pipeline, and undo
  // the reservation if it refuses. A request over the cap never reaches the pipeline.
  const now = ctx.now();
  const revisionId = newId('rev');
  let changed: number;
  try {
    // D1's own batch: Drizzle cannot batch raw SQL, and a D1 batch is one transaction.
    const [update] = await ctx.db.$client.batch([
      d1Statement(
        ctx,
        sql`update films set status = 'working', stage = 'script', updated_at = ${now.getTime()}
          where id = ${id} and account_id = ${ctx.account.id} and status = 'done'
            and ${inProgressCount(ctx, now)} < ${MAX_FILMS_IN_PROGRESS}`,
      ),
      d1Statement(
        ctx,
        sql`insert into revisions (id, film_id, script_version, note, requested_by, requested_at)
          select ${revisionId}, ${id}, ${input.version}, ${input.note}, ${ctx.principal.userId},
            ${now.getTime()}
          where (select status from films where id = ${id}) = 'working'`,
      ),
    ]);
    changed = update?.meta.changes ?? 0;
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      throw new ApiError(409, 'already_asked', 'You already asked for changes to this version.');
    }
    throw error;
  }
  if (changed !== 1) {
    const current = await ownFilm(ctx, id);
    if (current.status !== 'done') {
      throw new ApiError(409, 'already_asked', 'You already asked for changes to this version.');
    }
    throw new ApiError(
      429,
      'too_many_films',
      `You have ${MAX_FILMS_IN_PROGRESS} films in the works. Finish one before you ask for a revision.`,
    );
  }

  try {
    await ctx.pipelineFor(film.pipeline).requestRevision(film.pipelineRunId, {
      version: input.version,
      note: input.note,
    });
  } catch (error) {
    await ctx.db.batch([
      ctx.db.delete(revisions).where(eq(revisions.id, revisionId)),
      ctx.db
        .update(films)
        .set({ status: 'done', stage: film.stage, updatedAt: film.updatedAt })
        .where(and(eq(films.id, id), eq(films.status, 'working'))),
    ]);
    throw error;
  }
  return getFilmDetail(ctx, id);
}

// ---------- Internals ----------

/**
 * Films in the works for this account, as SQL, for the cap. A founder's films in every account
 * count, so a new Clerk organisation does not bring 5 more. A row whose run never started (its
 * request died between reserving the row and starting the run) stops counting after 5 minutes.
 */
function inProgressCount(ctx: ApiContext, now: Date) {
  return sql`(select count(*) from films
    where status in ('queued', 'working', 'needs_you')
      and (account_id = ${ctx.account.id} or created_by = ${ctx.principal.userId})
      and (pipeline_run_id is not null or created_at > ${now.getTime() - STALE_RESERVATION_MS}))`;
}

/** How long a reserved film may wait for its run to start before the cap ignores it. */
const STALE_RESERVATION_MS = 5 * 60_000;

const dialect = new SQLiteAsyncDialect();

/** A Drizzle `sql` template as a D1 statement, for `$client.batch`. */
function d1Statement(ctx: ApiContext, query: SQL): D1PreparedStatement {
  const { sql: text, params } = dialect.sqlToQuery(query);
  return ctx.db.$client.prepare(text).bind(...params);
}

/** The film, if it belongs to the caller's account. Someone else's film is a 404, not a 403. */
export async function ownFilm(ctx: ApiContext, id: string): Promise<Film> {
  if (!/^flm_[0-9a-z]{20}$/.test(id)) throw notFound();
  const film = await ctx.db.query.films.findFirst({
    where: and(eq(films.id, id), eq(films.accountId, ctx.account.id)),
  });
  if (!film) throw notFound();
  return film;
}

/**
 * Brings a film up to date with its pipeline run: stores new crew events, the stage and status,
 * the latest script, and the files once it is delivered. A finished film is left alone.
 */
export async function syncFilm(ctx: ApiContext, film: Film): Promise<Film> {
  if (!film.pipelineRunId || (FINISHED as readonly string[]).includes(film.status)) return film;
  const pipeline = ctx.pipelineFor(film.pipeline);
  const last = await ctx.db
    .select({ pipelineEventId: filmEvents.pipelineEventId })
    .from(filmEvents)
    .where(eq(filmEvents.filmId, film.id))
    .orderBy(desc(filmEvents.seq))
    .limit(1);
  const [status, events] = await Promise.all([
    pipeline.status(film.pipelineRunId),
    pipeline.events(film.pipelineRunId, { after: last[0]?.pipelineEventId }),
  ]);
  const files = status.status === 'done' ? await pipeline.deliverables(film.pipelineRunId) : [];

  let campaignJson = film.campaignJson;
  if (status.campaign) {
    const checked = campaignSchema.safeParse(status.campaign);
    if (checked.success) campaignJson = JSON.stringify(checked.data);
    else console.error(`Film ${film.id}: the pipeline sent a campaign that fails the schema`);
  }

  const now = ctx.now();
  const changed =
    events.length > 0 ||
    files.length > 0 ||
    status.status !== film.status ||
    status.stage !== film.stage ||
    status.scriptVersion !== film.scriptVersion ||
    campaignJson !== film.campaignJson;
  if (!changed) return film;

  const statements = [
    ...events.map((event) =>
      ctx.db
        .insert(filmEvents)
        .values({
          id: newId('evt'),
          filmId: film.id,
          pipelineEventId: event.id,
          seq: event.seq,
          at: event.at,
          agent: event.agent,
          kind: event.kind,
          stage: event.stage,
          status: event.status,
          message: event.message,
        })
        .onConflictDoNothing(),
    ),
    ...files.map((file) =>
      ctx.db
        .insert(deliverables)
        .values({ id: newId('dlv'), filmId: film.id, ...file, createdAt: now })
        .onConflictDoNothing(),
    ),
  ];
  const update = ctx.db
    .update(films)
    .set({
      status: status.status,
      stage: status.stage,
      scriptVersion: status.scriptVersion,
      campaignJson,
      updatedAt: now,
    })
    .where(and(eq(films.id, film.id), notInArray(films.status, [...FINISHED])))
    .returning();
  const results = await ctx.db.batch([update, ...statements]);
  const [updated] = results[0] as Film[];
  return updated ?? film;
}

function checkChoice(
  campaign: Campaign | null,
  review: Extract<ReviewScriptInput, { decision: 'approve' }>,
): { hookId: string | null; ctaId: string | null; formats: Format[]; confirmedClaimIds: string[] } {
  if (!campaign) throw new ApiError(409, 'no_script', 'There is no script to approve yet.');
  const issues: { path: string; message: string }[] = [];
  const hooks = campaign.variants.hooks.map((hook) => hook.id);
  if (review.hookId !== null && !hooks.includes(review.hookId)) {
    issues.push({ path: 'hookId', message: 'Pick an opening from this script.' });
  }
  const ctas = campaign.variants.ctas.map((cta) => cta.id);
  if (review.ctaId === null ? ctas.length > 0 : !ctas.includes(review.ctaId)) {
    issues.push({ path: 'ctaId', message: 'Pick a call to action from this script.' });
  }
  const formats = [...new Set(review.formats)];
  if (formats.some((format) => !campaign.variants.formats.includes(format))) {
    issues.push({ path: 'formats', message: 'Pick shapes this script is cut for.' });
  }
  const claimIds = new Set(campaign.claims.map((claim) => claim.id));
  if (review.confirmedClaimIds.some((id) => !claimIds.has(id))) {
    issues.push({ path: 'confirmedClaimIds', message: 'Confirm only claims in this script.' });
  }
  if (issues.length > 0) {
    throw new ApiError(400, 'invalid_choice', 'Some choices are not in this script.', issues);
  }
  // Every number in the film must be one the crew checked or the customer confirmed.
  const confirmed = new Set(review.confirmedClaimIds);
  const pending = unconfirmedClaims(campaign, review.hookId);
  const open = pending.filter((claim) => !confirmed.has(claim.id));
  if (open.length > 0) {
    throw new ApiError(
      409,
      'unconfirmed_claims',
      open.length === 1
        ? `Confirm "${open[0]?.text}" or ask for it to be removed before you approve.`
        : `Confirm ${open.length} claims or ask for them to be removed before you approve.`,
      open.map((claim) => ({ path: 'confirmedClaimIds', message: claim.text })),
    );
  }
  return {
    hookId: review.hookId,
    ctaId: review.ctaId,
    formats,
    // Only the claims that needed it: the ones in this cut that nobody had confirmed.
    confirmedClaimIds: pending.map((claim) => claim.id),
  };
}

/**
 * Claims the film would show or say that nobody has confirmed yet: cited by any scene of the film
 * as it would be cut with opening `hookId`, and not `approved` in the campaign.
 */
export function unconfirmedClaims(campaign: Campaign, hookId: string | null): Campaign['claims'] {
  const hook = hookId ? campaign.variants.hooks.find((item) => item.id === hookId) : undefined;
  const scenes = hook ? [hook, ...campaign.scenes.slice(1)] : campaign.scenes;
  const cited = new Set(
    scenes.flatMap((scene) => [
      ...scene.text.flatMap((item) => item.claimIds),
      ...(scene.voiceover?.claimIds ?? []),
    ]),
  );
  return campaign.claims.filter((claim) => claim.status !== 'approved' && cited.has(claim.id));
}

function parseIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

type Statement = Parameters<ApiContext['db']['batch']>[0][number];

/** Writes a decision. A second decision on the same version is refused. */
async function recordDecision(ctx: ApiContext, statements: Statement[]): Promise<void> {
  try {
    await ctx.db.batch(statements as [Statement, ...Statement[]]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      throw new ApiError(409, 'already_decided', 'You already decided on this version.');
    }
    throw error;
  }
}
