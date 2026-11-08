import { type Campaign, campaignSchema } from '@boiler-room/schema';
import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
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
import type { ApiContext } from './context.ts';
import { ApiError, notFound } from './errors.ts';

/** A founder can have this many films in the works at once. It bounds what a mistake can cost. */
export const MAX_FILMS_IN_PROGRESS = 5;

/** A delivered film can be revised this many times. Each one costs a new render. */
export const MAX_REVISIONS_PER_FILM = 3;

const IN_PROGRESS = ['queued', 'working', 'needs_you'] as const;
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
  /** True for a film the SimulatedPipeline made. Every screen labels it. */
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
  const campaign = parseCampaign(film.campaignJson);
  const host = displayHost(film.url);
  return {
    id: film.id,
    url: film.url,
    host,
    title: campaign ? `${campaign.brand.name} launch` : host,
    status: film.status,
    stage: film.stage,
    pipeline: film.pipeline,
    simulated: film.pipeline === 'simulated',
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

  const inProgress = await ctx.db
    .select({ id: films.id })
    .from(films)
    .where(and(eq(films.accountId, ctx.account.id), inArray(films.status, [...IN_PROGRESS])))
    .limit(MAX_FILMS_IN_PROGRESS);
  if (inProgress.length >= MAX_FILMS_IN_PROGRESS) {
    throw new ApiError(
      429,
      'too_many_films',
      `You have ${MAX_FILMS_IN_PROGRESS} films in the works. Finish one before you start another.`,
    );
  }

  // Start the run first, so a pipeline that is down leaves no film behind.
  const id = newId('flm');
  const kind = ctx.pipelineKind;
  const { runId } = await ctx.pipelineFor(kind).start({ filmId: id, url: parsed.url });
  const now = ctx.now();
  await ctx.db.insert(films).values({
    id,
    accountId: ctx.account.id,
    createdBy: ctx.principal.userId,
    url: parsed.url,
    status: 'queued',
    stage: 'research',
    pipeline: kind,
    pipelineRunId: runId,
    createdAt: now,
    updatedAt: now,
  });
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
  const inProgress = await ctx.db
    .select({ id: films.id })
    .from(films)
    .where(and(eq(films.accountId, ctx.account.id), inArray(films.status, [...IN_PROGRESS])))
    .limit(MAX_FILMS_IN_PROGRESS);
  if (inProgress.length >= MAX_FILMS_IN_PROGRESS) {
    throw new ApiError(
      429,
      'too_many_films',
      `You have ${MAX_FILMS_IN_PROGRESS} films in the works. Finish one before you ask for a revision.`,
    );
  }

  await ctx.pipelineFor(film.pipeline).requestRevision(film.pipelineRunId, {
    version: input.version,
    note: input.note,
  });
  const now = ctx.now();
  try {
    await ctx.db.batch([
      ctx.db.insert(revisions).values({
        id: newId('rev'),
        filmId: id,
        scriptVersion: input.version,
        note: input.note,
        requestedBy: ctx.principal.userId,
        requestedAt: now,
      }),
      // A finished film is not synced, so put it back in the works for the crew's events to land.
      ctx.db
        .update(films)
        .set({ status: 'working', stage: 'script', updatedAt: now })
        .where(and(eq(films.id, id), eq(films.status, 'done'))),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      throw new ApiError(409, 'already_asked', 'You already asked for changes to this version.');
    }
    throw error;
  }
  return getFilmDetail(ctx, id);
}

// ---------- Internals ----------

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
): { hookId: string | null; ctaId: string | null; formats: Format[] } {
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
  if (issues.length > 0) {
    throw new ApiError(400, 'invalid_choice', 'Some choices are not in this script.', issues);
  }
  return { hookId: review.hookId, ctaId: review.ctaId, formats };
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
