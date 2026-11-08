/**
 * GTM sample films: what `/api/gtm/v1/` does. The GTM executor (agents/src/gtm/, `AppFilmOrder` and
 * `AppGtm`) orders a free sample of a startup's website, follows it through the film runner, and
 * shares its film page once it is delivered. Spec: docs/company/gtm-operations.md section 8.
 *
 * - A sample is an ordinary real film of Boiler Room's own account (`BR_HOUSE_ACCOUNT_ID`), with
 *   `films.sample` set. It runs in the runner's `sample` mode: the GTM lead approved it, so there is
 *   no customer approval pause.
 * - It is held to every cap a founder's real film is: films in the works, the Researcher, and the
 *   per-account and per-environment daily dollars. Its own cap is the executor's budget, never more
 *   than the website's per-film cap.
 * - Nobody but the house account and whoever holds the film page link sees it: it never goes on
 *   the showcase, another account's film lookups never find it, and the token reaches samples only,
 *   never the house account's own films.
 */
import { campaignSchema } from '@boiler-room/schema';
import { and, asc, desc, eq, gt, isNotNull, type SQL, sql } from 'drizzle-orm';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import type { Db } from '../../db/client.ts';
import {
  type Account,
  accounts,
  deliverables,
  type Film,
  filmEvents,
  films,
  type GtmOrder,
  gtmOrders,
  gtmRequests,
  runEvents,
  runFiles,
} from '../../db/schema.ts';
import { displayHost } from '../../lib/film.ts';
import { parseFilmUrl } from '../../lib/film-url.ts';
import type { ApiContext } from '../api/context.ts';
import { ApiError } from '../api/errors.ts';
import { filmsInProgress, MAX_FILMS_IN_PROGRESS, parseCampaign, syncFilm } from '../api/films.ts';
import { newId } from '../ids.ts';
import { createPipeline, type PipelineClient } from '../pipeline/index.ts';
import { capRefusal, realFilmCaps } from '../runner/caps.ts';
import { runnerReady } from '../runner/config.ts';
import { getRun, type RunnerDeps, stopRun } from '../runner/runs.ts';
import { isTerminal } from '../runner/states.ts';
import { FILE_LINK_SECONDS, signFileLink } from './auth.ts';

/** `films.created_by` on every sample: the executor is not a Clerk user. */
export const GTM_CREATOR = 'gtm-executor';

/** What a sample's film page id looks like: 20 characters of base32, about 100 bits. */
export const SHARE_ID = /^[0-9a-z]{20}$/;

export interface GtmDeps {
  runner: RunnerDeps;
  /** `BR_HOUSE_ACCOUNT_ID`: the account every sample belongs to. */
  houseAccountId: string | null;
  /** `GTM_SERVICE_TOKEN`, for signing file links. */
  token: string;
}

// ---------- Inputs ----------

export const orderInput = z.strictObject({
  url: z.string().max(4096),
  idempotency_key: z.string().min(1).max(200),
  budget_micro_usd: z.int().positive().max(100_000_000),
  lead_ref: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
});

export const WITHDRAW_REASONS = ['removal', 'opt_out', 'failed', 'manual'] as const;
export const withdrawInput = z.strictObject({ reason: z.enum(WITHDRAW_REASONS) });

/** What `GET /api/gtm/v1/films/{id}` answers: `FilmOrderStatus` in agents/src/gtm/ports.ts. */
export interface SampleStatus {
  orderId: string;
  state: 'queued' | 'working' | 'ready' | 'failed' | 'withdrawn';
  stage: string | null;
  qc: 'pending' | 'pass' | 'fail';
  simulated: boolean;
  costMicroUsd: number | null;
  failure: string | null;
  script: string | null;
}

/** What `GET /api/gtm/v1/films/{id}/file` answers: `FilmFile` in agents/src/gtm/ports.ts. */
export interface SampleFile {
  url: string;
  expiresAt: string;
  contentType: 'video/mp4';
  bytes: number;
  durationSeconds: number;
  sha256: string;
}

// ---------- The house account ----------

/** The house account, or a 503: no sample can be made until the founder names it. */
export async function houseAccount(deps: GtmDeps): Promise<Account> {
  const id = deps.houseAccountId?.trim();
  const account = id
    ? await deps.runner.db.query.accounts.findFirst({ where: eq(accounts.id, id) })
    : undefined;
  if (!account) {
    throw new ApiError(
      503,
      'no_house_account',
      'BR_HOUSE_ACCOUNT_ID does not name an account here, so no sample can be made.',
    );
  }
  return account;
}

/** The house account as an API context, so samples sync and read like any other film. */
export function houseContext(deps: GtmDeps, account: Account): ApiContext {
  const { runner } = deps;
  const pipelines = new Map<string, PipelineClient>();
  return {
    db: runner.db,
    principal: { userId: GTM_CREATOR, orgId: null },
    account,
    pipelineKind: 'naive',
    runnerConfig: runner.config,
    pipelineFor(kind) {
      let client = pipelines.get(kind);
      if (!client) {
        client = createPipeline(kind, runner.db, runner.now, runner);
        pipelines.set(kind, client);
      }
      return client;
    },
    films: runner.films,
    now: runner.now,
  };
}

/** A sample and its order, by film id. Any other film, even the house account's own, is a 404. */
async function sampleOf(ctx: ApiContext, id: string): Promise<{ film: Film; order: GtmOrder }> {
  const missing = new ApiError(404, 'not_found', 'There is no sample here.');
  if (!/^flm_[0-9a-z]{20}$/.test(id)) throw missing;
  const [row] = await ctx.db
    .select({ film: films, order: gtmOrders })
    .from(films)
    .innerJoin(gtmOrders, eq(gtmOrders.filmId, films.id))
    .where(and(eq(films.id, id), eq(films.accountId, ctx.account.id), eq(films.sample, true)))
    .limit(1);
  if (!row) throw missing;
  return row;
}

// ---------- Ordering ----------

/**
 * Orders a sample of `url`. The same idempotency key answers the same film, however often it is
 * sent. The film's row is reserved in one statement that checks every cap, as a founder's is, and
 * only then does the runner start, so a refused order costs nothing.
 */
export async function orderSample(
  deps: GtmDeps,
  input: z.infer<typeof orderInput>,
): Promise<{ id: string; created: boolean }> {
  const { runner } = deps;
  const account = await houseAccount(deps);
  const existing = await runner.db.query.gtmOrders.findFirst({
    where: eq(gtmOrders.idempotencyKey, input.idempotency_key),
  });
  if (existing) return { id: existing.filmId, created: false };

  const parsed = parseFilmUrl(input.url);
  if (!parsed.ok) {
    throw new ApiError(400, 'invalid_url', parsed.reason, [
      { path: 'url', message: parsed.reason },
    ]);
  }
  if (!runner.naive || !runnerReady(runner.config)) {
    throw new ApiError(
      503,
      'crew_off',
      'Sample films run on the real-film runner, which is not configured here.',
    );
  }
  if (input.budget_micro_usd <= runner.config.computeReserveMicroUsd) {
    throw new ApiError(
      400,
      'budget_too_low',
      `A sample's budget must be more than the ${runner.config.computeReserveMicroUsd} micro-USD kept back for its computer.`,
    );
  }

  const id = newId('flm');
  const now = runner.now();
  const scope = { accountId: account.id, userId: GTM_CREATOR, now: now.getTime() };
  const ctx = houseContext(deps, account);
  let reserved = 0;
  try {
    // One D1 batch is one transaction: the film is reserved under every cap, as a founder's
    // `createFilm` reserves one, and the order row goes in only beside it. A second request with
    // the same key fails the unique index and leaves nothing behind.
    const at = now.getTime();
    const [film] = await runner.db.$client.batch([
      d1(
        runner.db,
        sql`insert into films (id, account_id, created_by, url, status, stage, pipeline, sample,
            created_at, updated_at)
          select ${id}, ${account.id}, ${GTM_CREATOR}, ${parsed.url}, 'queued', 'research', 'naive',
            1, ${at}, ${at}
          where ${filmsInProgress(scope, now)} < ${MAX_FILMS_IN_PROGRESS}
            and ${realFilmCaps(runner.config, scope)}`,
      ),
      d1(
        runner.db,
        sql`insert into gtm_orders (film_id, idempotency_key, lead_ref, budget_micro_usd, created_at)
          select ${id}, ${input.idempotency_key}, ${input.lead_ref}, ${input.budget_micro_usd}, ${at}
          where exists (select 1 from films where id = ${id})`,
      ),
    ]);
    reserved = film?.meta.changes ?? 0;
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      const raced = await runner.db.query.gtmOrders.findFirst({
        where: eq(gtmOrders.idempotencyKey, input.idempotency_key),
      });
      if (raced) return { id: raced.filmId, created: false };
    }
    throw error;
  }
  if (reserved !== 1) {
    const refusal = await capRefusal(runner.db, runner.config, scope);
    if (refusal) throw refusal;
    throw new ApiError(
      429,
      'too_many_films',
      `The house account has ${MAX_FILMS_IN_PROGRESS} films in the works. Order another once one is finished.`,
    );
  }
  try {
    await ctx.pipelineFor('naive').start({
      filmId: id,
      url: parsed.url,
      mode: 'sample',
      costCapMicroUsd: input.budget_micro_usd,
    });
  } catch (error) {
    // A runner that cannot start leaves no film and no order behind; the same key may try again.
    await runner.db.delete(films).where(eq(films.id, id));
    throw error;
  }
  return { id, created: true };
}

const dialect = new SQLiteAsyncDialect();

/** A Drizzle `sql` template as a D1 statement, for `$client.batch`, which is one transaction. */
function d1(db: Db, query: SQL): D1PreparedStatement {
  const { sql: text, params } = dialect.sqlToQuery(query);
  return db.$client.prepare(text).bind(...params);
}

// ---------- Status ----------

/** The latest Quality Check verdict on the run's 16:9 cut: what `qc` reports. */
async function qcVerdict(db: Db, runId: string): Promise<'pending' | 'pass' | 'fail'> {
  const rows = await db
    .select({ data: runEvents.dataJson })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, 'qc')))
    .orderBy(desc(runEvents.sourceSeq))
    .limit(20);
  for (const row of rows) {
    let data: { format?: unknown; verdict?: unknown } = {};
    try {
      data = JSON.parse(row.data ?? '{}');
    } catch {
      continue;
    }
    if (data.format !== '16:9') continue;
    return data.verdict === 'pass' ? 'pass' : 'fail';
  }
  return 'pending';
}

/** The film's on-screen text and voiceover, one line each, for the executor's brand-safety screen. */
export function scriptText(json: string | null): string | null {
  const campaign = parseCampaign(json);
  if (!campaign) return null;
  const lines = campaign.scenes.flatMap((scene) => [
    ...scene.text.map((item) => item.value),
    ...(scene.voiceover ? [scene.voiceover.text] : []),
  ]);
  return lines.join('\n');
}

export async function sampleStatus(deps: GtmDeps, id: string): Promise<SampleStatus> {
  const ctx = houseContext(deps, await houseAccount(deps));
  const { order, film: stored } = await sampleOf(ctx, id);
  const film = order.withdrawnAt ? stored : await syncFilm(ctx, stored);
  const run = film.pipelineRunId ? await getRun(ctx.db, film.pipelineRunId) : null;
  const state: SampleStatus['state'] = order.withdrawnAt
    ? 'withdrawn'
    : film.status === 'done'
      ? 'ready'
      : film.status === 'failed'
        ? 'failed'
        : film.status === 'queued'
          ? 'queued'
          : 'working';
  const finished = run ? isTerminal(run.state) : false;
  return {
    orderId: film.id,
    state,
    stage: film.stage,
    qc: run ? await qcVerdict(ctx.db, run.id) : 'pending',
    simulated: film.pipeline === 'simulated' || film.standIn,
    // The whole cost, crew and computer, once nothing more can be spent.
    costMicroUsd: run && finished ? run.costCrewMicroUsd + run.costComputeMicroUsd : null,
    failure: state === 'failed' ? (run?.failureCode ?? 'failed') : null,
    script: state === 'ready' ? scriptText(film.campaignJson) : null,
  };
}

// ---------- Decisions ----------

/** What `GET /api/gtm/v1/films/{id}/decisions` answers: `FilmDecisions` in agents/src/film/order.ts. */
export interface SampleDecisions {
  orderId: string;
  simulated: boolean;
  decisions: {
    id: string;
    seq: number;
    at: string;
    agent: string;
    kind: string;
    stage: string;
    status: string;
    round: number;
    message: string;
    why: string;
  }[];
}

/**
 * The film's decisions feed, in the web app's words. The runner's feed carries no reason and no
 * round, so `why` is empty and `round` is 1.
 */
export async function sampleDecisions(deps: GtmDeps, id: string): Promise<SampleDecisions> {
  const ctx = houseContext(deps, await houseAccount(deps));
  const { order, film: stored } = await sampleOf(ctx, id);
  const film = order.withdrawnAt ? stored : await syncFilm(ctx, stored);
  const rows = await ctx.db
    .select()
    .from(filmEvents)
    .where(eq(filmEvents.filmId, film.id))
    .orderBy(asc(filmEvents.seq))
    .limit(500);
  return {
    orderId: film.id,
    simulated: film.pipeline === 'simulated' || film.standIn,
    decisions: rows.map((row) => ({
      id: `d-${row.seq}`,
      seq: row.seq,
      at: row.at.toISOString(),
      agent: row.agent,
      kind: row.kind,
      stage: row.stage,
      status: row.status,
      round: 1,
      message: row.message,
      why: '',
    })),
  };
}

// ---------- Sharing ----------

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % 32];
  return out;
}

/**
 * Publishes the delivered sample's film page, `/f/<share_id>`: unlisted, unindexed, and only for a
 * film with a stored 16:9 file. A second call answers the same page.
 */
export async function shareSample(
  deps: GtmDeps,
  id: string,
  origin: string,
): Promise<{ page_url: string; share_id: string }> {
  const ctx = houseContext(deps, await houseAccount(deps));
  const { order, film: stored } = await sampleOf(ctx, id);
  if (order.withdrawnAt) throw new ApiError(410, 'withdrawn', 'This sample was withdrawn.');
  const film = await syncFilm(ctx, stored);
  if (film.status !== 'done') {
    throw new ApiError(409, 'not_delivered', 'A sample is shared once it is delivered.');
  }
  if (!(await playable(ctx.db, film))) {
    throw new ApiError(409, 'no_file', 'This sample has no 16:9 file to show.');
  }
  let shareId = order.shareId;
  if (!shareId) {
    shareId = newShareId();
    const [updated] = await ctx.db
      .update(gtmOrders)
      .set({ shareId, sharedAt: deps.runner.now().getTime() })
      .where(and(eq(gtmOrders.filmId, id), sql`${gtmOrders.shareId} is null`))
      .returning();
    if (!updated) {
      const again = await ctx.db.query.gtmOrders.findFirst({ where: eq(gtmOrders.filmId, id) });
      shareId = again?.shareId ?? shareId;
    }
  }
  return { page_url: `${origin}/f/${shareId}`, share_id: shareId };
}

/** The film's 16:9 deliverable at its current version, with a stored file, or null. */
async function playable(db: Db, film: Film) {
  const [row] = await db
    .select()
    .from(deliverables)
    .where(
      and(
        eq(deliverables.filmId, film.id),
        eq(deliverables.scriptVersion, film.scriptVersion),
        eq(deliverables.format, '16:9'),
        isNotNull(deliverables.r2Key),
      ),
    )
    .orderBy(asc(deliverables.variantKey))
    .limit(1);
  return row ?? null;
}

/** A link to the 16:9 MP4 that works for 10 minutes, for the social provider to fetch. */
export async function sampleFile(deps: GtmDeps, id: string, origin: string): Promise<SampleFile> {
  const ctx = houseContext(deps, await houseAccount(deps));
  const { order, film } = await sampleOf(ctx, id);
  if (order.withdrawnAt) throw new ApiError(410, 'withdrawn', 'This sample was withdrawn.');
  if (film.status !== 'done') throw new ApiError(409, 'not_delivered', 'It is not delivered.');
  const file = await playable(ctx.db, film);
  if (!file?.r2Key) throw new ApiError(404, 'no_file', 'This sample has no 16:9 file.');
  const stored = await ctx.db.query.runFiles.findFirst({ where: eq(runFiles.r2Key, file.r2Key) });
  const nowSeconds = Math.floor(deps.runner.now().getTime() / 1000);
  const expires = nowSeconds + FILE_LINK_SECONDS;
  const sig = await signFileLink(deps.token, film.id, expires);
  return {
    url: `${origin}/api/gtm/v1/files/${film.id}?exp=${expires}&sig=${sig}`,
    expiresAt: new Date(expires * 1000).toISOString(),
    contentType: 'video/mp4',
    bytes: stored?.bytes ?? file.bytes ?? 0,
    durationSeconds: file.durationSeconds ?? 0,
    sha256: stored?.sha256 ?? '',
  };
}

// ---------- Withdrawing ----------

/**
 * Takes a sample down: the run stops if it is still at work (so it spends nothing more and stops
 * counting against the caps once the runner exits), the film page answers 410, and every file of
 * the film is deleted from R2. The order row stays as a tombstone. Safe to call twice.
 */
export async function withdrawSample(
  deps: GtmDeps,
  id: string,
  reason: string,
): Promise<{ withdrawn: true }> {
  const ctx = houseContext(deps, await houseAccount(deps));
  const { film, order } = await sampleOf(ctx, id);
  await takeDown(deps, film, order, reason);
  return { withdrawn: true };
}

async function takeDown(deps: GtmDeps, film: Film, order: GtmOrder, reason: string) {
  if (!order.withdrawnAt) {
    await deps.runner.db
      .update(gtmOrders)
      .set({ withdrawnAt: deps.runner.now().getTime(), withdrawReason: reason.slice(0, 32) })
      .where(and(eq(gtmOrders.filmId, film.id), sql`${gtmOrders.withdrawnAt} is null`));
  }
  await cleanUp(deps, film);
}

/**
 * What follows a withdrawal: the run stops if it is still at work, and every file of the film is
 * deleted from R2. Safe to run again, so a call that failed part way is finished by the next.
 */
async function cleanUp(deps: GtmDeps, film: Film) {
  const { runner } = deps;
  const run = film.pipelineRunId ? await getRun(runner.db, film.pipelineRunId) : null;
  if (run && !isTerminal(run.state)) await stopRun(runner, run, 'withdrawn');
  const keys = new Set<string>();
  const [uploads, cuts] = await Promise.all([
    runner.db.select({ key: runFiles.r2Key }).from(runFiles).where(eq(runFiles.filmId, film.id)),
    runner.db
      .select({ key: deliverables.r2Key })
      .from(deliverables)
      .where(and(eq(deliverables.filmId, film.id), isNotNull(deliverables.r2Key))),
  ]);
  for (const row of [...uploads, ...cuts]) if (row.key) keys.add(row.key);
  if (keys.size) await runner.films.delete([...keys]);
  await runner.db.update(deliverables).set({ r2Key: null }).where(eq(deliverables.filmId, film.id));
}

// ---------- The film page ----------

export interface SharedSample {
  film: Film;
  order: GtmOrder;
  host: string;
  /** The brand's name from the script, when there is one. */
  brand: string;
  withdrawn: boolean;
  simulated: boolean;
  file: { r2Key: string; contentType: string; fileName: string } | null;
}

/** The sample behind a film page, or null when there is none. Withdrawn ones come back marked. */
export async function sharedSample(db: Db, shareId: string): Promise<SharedSample | null> {
  if (!SHARE_ID.test(shareId)) return null;
  const [row] = await db
    .select({ film: films, order: gtmOrders })
    .from(gtmOrders)
    .innerJoin(films, eq(films.id, gtmOrders.filmId))
    .where(and(eq(gtmOrders.shareId, shareId), eq(films.sample, true)))
    .limit(1);
  if (!row) return null;
  const file = row.order.withdrawnAt ? null : await playable(db, row.film);
  const campaign = row.film.campaignJson
    ? campaignSchema.safeParse(safeJson(row.film.campaignJson))
    : null;
  const host = displayHost(row.film.url);
  return {
    film: row.film,
    order: row.order,
    host,
    brand: campaign?.success ? campaign.data.brand.name : host,
    withdrawn: row.order.withdrawnAt !== null,
    simulated: row.film.pipeline === 'simulated' || row.film.standIn,
    file: file?.r2Key
      ? { r2Key: file.r2Key, contentType: file.contentType, fileName: file.fileName }
      : null,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * "Remove this film" on the film page. Anyone may ask, with no sign-in: the film comes down at
 * once, and the request is queued for the executor, which suppresses the domain on every channel
 * and deletes any post of ours.
 *
 * The withdrawal and the request are one D1 batch, which is one transaction, and they go in before
 * anything that can fail part way (the run, R2). So a film page that is down always has its
 * request: a failure after the batch answers an error, and the visitor's next click finds the film
 * down, answers 410 and finishes the clean-up. One request per film page, however many clicks.
 */
export async function removeByPage(
  deps: GtmDeps,
  shareId: string,
): Promise<'removed' | 'already' | 'missing'> {
  const shared = await sharedSample(deps.runner.db, shareId);
  if (!shared) return 'missing';
  const { runner } = deps;
  const at = runner.now().getTime();
  const [withdrawn] = await runner.db.$client.batch([
    d1(
      runner.db,
      sql`update gtm_orders set withdrawn_at = ${at}, withdraw_reason = 'removal'
        where film_id = ${shared.film.id} and withdrawn_at is null`,
    ),
    d1(
      runner.db,
      sql`insert into gtm_requests (kind, channel, share_id, domain, at)
        select 'removal', 'film_page', ${shareId}, ${shared.host}, ${at}
        where not exists (select 1 from gtm_requests where share_id = ${shareId})`,
    ),
  ]);
  await cleanUp(deps, shared.film);
  return (withdrawn?.meta.changes ?? 0) === 1 ? 'removed' : 'already';
}

/** `GET /api/gtm/v1/requests?after=`: removals and opt-outs since the cursor, oldest first. */
export async function listRequests(deps: GtmDeps, after: string | null) {
  const from = after && /^\d{1,15}$/.test(after) ? Number(after) : 0;
  const rows = await deps.runner.db
    .select()
    .from(gtmRequests)
    .where(gt(gtmRequests.seq, from))
    .orderBy(asc(gtmRequests.seq))
    .limit(100);
  return {
    data: rows.map((row) => ({
      id: String(row.seq),
      kind: row.kind,
      channel: row.channel,
      token_hash: null,
      domain: row.domain,
      share_id: row.shareId,
      at: new Date(row.at).toISOString(),
    })),
    cursor: rows.length ? String(rows.at(-1)?.seq) : after,
  };
}
