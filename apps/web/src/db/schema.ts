import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import {
  CREW,
  EVENT_KINDS,
  FILM_STATUSES,
  FORMATS,
  PIPELINE_KINDS,
  SCRIPT_DECISIONS,
  STAGES,
} from '../lib/film.ts';

/**
 * The D1 schema. Change it here, then run `pnpm web:db:generate` to write the next migration in
 * `drizzle/`. Every migration must work with the code that is already deployed: see
 * skills/engineering-deploy/SKILL.md, "D1 migrations".
 *
 * Times are integer milliseconds since the epoch. JSON columns hold text that the app validates.
 */

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

/**
 * Who owns films. A Clerk user working on their own has a `user` account. When they work inside a
 * Clerk organisation, the films belong to the organisation's `org` account, so its members share
 * them. Exactly one of the two Clerk ids is set.
 */
export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['user', 'org'] }).notNull(),
    clerkUserId: text('clerk_user_id'),
    clerkOrgId: text('clerk_org_id'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('accounts_clerk_user_id_unique').on(t.clerkUserId),
    uniqueIndex('accounts_clerk_org_id_unique').on(t.clerkOrgId),
    check(
      'accounts_one_owner',
      sql`(${t.kind} = 'user' and ${t.clerkUserId} is not null and ${t.clerkOrgId} is null) or (${t.kind} = 'org' and ${t.clerkOrgId} is not null and ${t.clerkUserId} is null)`,
    ),
  ],
);

export const films = sqliteTable(
  'films',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    /** The Clerk user who started the film. */
    createdBy: text('created_by').notNull(),
    url: text('url').notNull(),
    status: text('status', { enum: FILM_STATUSES }).notNull(),
    stage: text('stage', { enum: STAGES }).notNull(),
    /** Which pipeline makes this film. A simulated film is always labelled as one. */
    pipeline: text('pipeline', { enum: PIPELINE_KINDS }).notNull(),
    pipelineRunId: text('pipeline_run_id'),
    /** The script version the customer is looking at. Starts at 1 when the first script is ready. */
    scriptVersion: integer('script_version').notNull().default(0),
    /** The campaign.json the crew wrote, as text. Null until the Director has written it. */
    campaignJson: text('campaign_json'),
    /** The opening the customer chose: a hook scene id, or null for the main opening. */
    chosenHook: text('chosen_hook'),
    /** The call to action the customer chose: a CTA id from the campaign. */
    chosenCta: text('chosen_cta'),
    /** The shapes the customer chose, as a JSON array of formats such as ["16:9","9:16"]. */
    formatsJson: text('formats_json').notNull().default('[]'),
    /** The customer agreed to show this film on the public showcase once it is delivered. */
    showcaseOptIn: integer('showcase_opt_in', { mode: 'boolean' }).notNull().default(false),
    /** The day the founder launches, as `YYYY-MM-DD` with no time zone. Null until they say. */
    launchDate: text('launch_date'),
    /** Where the founder will post the film, as a JSON array of channels such as ["x","reels"]. */
    launchChannelsJson: text('launch_channels_json').notNull().default('[]'),
    /**
     * A real film's computer ran the stand-in film command, which calls no agent and makes a
     * labelled test film. Such a film is labelled simulated everywhere and never shown publicly.
     */
    standIn: integer('stand_in', { mode: 'boolean' }).notNull().default(false),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('films_account_created_idx').on(t.accountId, t.createdAt),
    index('films_showcase_idx').on(t.showcaseOptIn, t.status),
  ],
);

/** The crew's decisions feed. One row per pipeline event, in the order it happened. */
export const filmEvents = sqliteTable(
  'film_events',
  {
    id: text('id').primaryKey(),
    filmId: text('film_id')
      .notNull()
      .references(() => films.id, { onDelete: 'cascade' }),
    /** The pipeline's own id for the event, so syncing the same event twice stores it once. */
    pipelineEventId: text('pipeline_event_id').notNull(),
    seq: integer('seq').notNull(),
    at: timestamp('at').notNull(),
    agent: text('agent', { enum: CREW }).notNull(),
    kind: text('kind', { enum: EVENT_KINDS }).notNull(),
    stage: text('stage', { enum: STAGES }).notNull(),
    status: text('status', { enum: FILM_STATUSES }).notNull(),
    message: text('message').notNull(),
  },
  (t) => [
    uniqueIndex('film_events_pipeline_event_unique').on(t.filmId, t.pipelineEventId),
    index('film_events_film_seq_idx').on(t.filmId, t.seq),
  ],
);

/** Every approve or send-back the customer made on a script version. */
export const approvals = sqliteTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    filmId: text('film_id')
      .notNull()
      .references(() => films.id, { onDelete: 'cascade' }),
    scriptVersion: integer('script_version').notNull(),
    decision: text('decision', { enum: SCRIPT_DECISIONS }).notNull(),
    note: text('note'),
    chosenHook: text('chosen_hook'),
    chosenCta: text('chosen_cta'),
    formatsJson: text('formats_json'),
    /**
     * Claims the crew found but nobody had confirmed, which the customer confirmed as right when
     * they approved, as a JSON array of claim ids. Null on a send-back and on older rows.
     */
    confirmedClaimsJson: text('confirmed_claims_json'),
    /** The Clerk user who decided. */
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at').notNull(),
  },
  (t) => [uniqueIndex('approvals_film_version_unique').on(t.filmId, t.scriptVersion)],
);

/** The finished files. `r2Key` is null for a simulated film, which has no files. */
export const deliverables = sqliteTable(
  'deliverables',
  {
    id: text('id').primaryKey(),
    filmId: text('film_id')
      .notNull()
      .references(() => films.id, { onDelete: 'cascade' }),
    /** format, hook and CTA, such as `16:9.main.start-free`. One file per variant. */
    variantKey: text('variant_key').notNull(),
    format: text('format', { enum: FORMATS }).notNull(),
    hookId: text('hook_id'),
    ctaId: text('cta_id'),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    r2Key: text('r2_key'),
    bytes: integer('bytes'),
    durationSeconds: integer('duration_seconds'),
    createdAt: timestamp('created_at').notNull(),
    /**
     * The script version the file was cut from. A revision delivers a new set, and the earlier
     * files stay. 0 on files delivered before versions were recorded.
     */
    scriptVersion: integer('script_version').notNull().default(0),
  },
  (t) => [
    uniqueIndex('deliverables_film_version_variant_unique').on(
      t.filmId,
      t.scriptVersion,
      t.variantKey,
    ),
  ],
);

/**
 * The customer asked for changes to a delivered film. One per delivered version: the Account
 * Manager takes the note to the crew, and the next version comes back for approval.
 */
export const revisions = sqliteTable(
  'revisions',
  {
    id: text('id').primaryKey(),
    filmId: text('film_id')
      .notNull()
      .references(() => films.id, { onDelete: 'cascade' }),
    /** The delivered version the customer wants changed. */
    scriptVersion: integer('script_version').notNull(),
    note: text('note').notNull(),
    /** The Clerk user who asked. */
    requestedBy: text('requested_by').notNull(),
    requestedAt: timestamp('requested_at').notNull(),
  },
  (t) => [uniqueIndex('revisions_film_version_unique').on(t.filmId, t.scriptVersion)],
);

export type Account = typeof accounts.$inferSelect;
export type Film = typeof films.$inferSelect;
export type FilmEvent = typeof filmEvents.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Deliverable = typeof deliverables.$inferSelect;
export type Revision = typeof revisions.$inferSelect;

// ---------- Real films: one Naive computer per film ----------
//
// A real film's run lives here. The runner on the film's computer fills these tables through the
// signed callbacks in `/api/runner/v1/`; `NaivePipeline` reads them. No page poll calls Naive.

/** One run per film: its state, its computer, its costs. `id` is `films.pipeline_run_id`. */
export const filmRuns = sqliteTable(
  'film_runs',
  {
    id: text('id').primaryKey(),
    filmId: text('film_id')
      .notNull()
      .references(() => films.id, { onDelete: 'cascade' }),
    /** `customer` pauses for the script approval. `sample` (a GTM film) runs straight through. */
    mode: text('mode', { enum: ['customer', 'sample'] }).notNull(),
    /** See `RUN_STATES` in src/server/runner/states.ts. */
    state: text('state').notNull(),
    /** The phase the next or current launch runs: `script`, `render`, or `all` for a sample. */
    phase: text('phase', { enum: ['script', 'render', 'all'] }).notNull(),
    stage: text('stage', { enum: STAGES }).notNull().default('research'),
    status: text('status', { enum: FILM_STATUSES }).notNull().default('queued'),
    scriptVersion: integer('script_version').notNull().default(0),
    /** The campaign the runner uploaded, after it passed `validateCampaign`. */
    campaignJson: text('campaign_json'),
    /** The customer's approval of `script_version`, as the runner's instructions carry it. */
    approvalJson: text('approval_json'),
    reviseJson: text('revise_json'),
    computerId: text('computer_id'),
    /** `none`, `creating`, `running`, `paused` or `destroyed`. */
    computerState: text('computer_state').notNull().default('none'),
    computerCreatedAt: integer('computer_created_at'),
    /** When the current running stretch began, for the compute cost. Null while not running. */
    runningSince: integer('running_since'),
    /** The 10-minute block the compute cost has been counted up to, as an epoch ms. */
    billedUntil: integer('billed_until'),
    baseSnapshotId: text('base_snapshot_id').notNull(),
    /** A snapshot of the film's computer, taken at the approval gate. */
    checkpointId: text('checkpoint_id'),
    runnerCommit: text('runner_commit'),
    /** What the runner's hello said it runs: `film`, the crew, or `standin`. Null before a hello. */
    adapter: text('adapter'),
    heartbeatAt: integer('heartbeat_at'),
    launchedAt: integer('launched_at'),
    phaseStartedAt: integer('phase_started_at'),
    phaseDeadlineAt: integer('phase_deadline_at'),
    /** When the script was ready for the customer. */
    awaitingSince: integer('awaiting_since'),
    /** When the customer's decision queued the next phase. */
    queuedAt: integer('queued_at'),
    launchAttempts: integer('launch_attempts').notNull().default(0),
    /** The runner reported its exit for the current launch. */
    exitedAt: integer('exited_at'),
    /** Held by the one caller running `advance()` for this run. */
    leaseUntil: integer('lease_until'),
    costCrewMicroUsd: integer('cost_crew_micro_usd').notNull().default(0),
    costComputeMicroUsd: integer('cost_compute_micro_usd').notNull().default(0),
    costCapMicroUsd: integer('cost_cap_micro_usd').notNull(),
    stopRequestedAt: integer('stop_requested_at'),
    stopReason: text('stop_reason'),
    /** The last stage the film was in before it failed, for the tracker. */
    failedStage: text('failed_stage', { enum: STAGES }),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    /** Last thing `advance()` could not do, such as `resume_refused`. For the logs and ops. */
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    /** Set once the computer and the checkpoint are gone. */
    endedAt: integer('ended_at'),
    deliveredAt: integer('delivered_at'),
  },
  (t) => [
    uniqueIndex('film_runs_film_unique').on(t.filmId),
    index('film_runs_state_idx').on(t.state, t.updatedAt),
  ],
);

/**
 * What the runner reported, and what the website wrote about the run. A row with `feed_seq` is on
 * the film's decisions feed, in that order. `(run_id, source, source_seq)` makes a resent batch a
 * no-op.
 */
export const runEvents = sqliteTable(
  'run_events',
  {
    runId: text('run_id')
      .notNull()
      .references(() => filmRuns.id, { onDelete: 'cascade' }),
    /** `runner` or `web`. */
    source: text('source', { enum: ['runner', 'web'] }).notNull(),
    sourceSeq: integer('source_seq').notNull(),
    feedSeq: integer('feed_seq'),
    filmId: text('film_id').notNull(),
    at: integer('at').notNull(),
    type: text('type').notNull(),
    agent: text('agent', { enum: CREW }),
    kind: text('kind', { enum: EVENT_KINDS }),
    stage: text('stage', { enum: STAGES }),
    status: text('status', { enum: FILM_STATUSES }),
    message: text('message'),
    dataJson: text('data_json'),
    receivedAt: integer('received_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.source, t.sourceSeq] }),
    index('run_events_feed_idx').on(t.runId, t.feedSeq),
  ],
);

/** Every file the runner uploaded. The website picks each R2 key; the runner never names one. */
export const runFiles = sqliteTable(
  'run_files',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => filmRuns.id, { onDelete: 'cascade' }),
    filmId: text('film_id').notNull(),
    kind: text('kind').notNull(),
    scriptVersion: integer('script_version').notNull(),
    variantKey: text('variant_key'),
    format: text('format', { enum: FORMATS }),
    name: text('name').notNull(),
    r2Key: text('r2_key').notNull(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('run_files_r2_key_unique').on(t.r2Key),
    index('run_files_run_idx').on(t.runId, t.kind),
  ],
);

/** Every runner request's nonce, kept 15 minutes, so a captured request cannot be sent again. */
export const runnerNonces = sqliteTable(
  'runner_nonces',
  {
    nonce: text('nonce').primaryKey(),
    filmId: text('film_id').notNull(),
    seenAt: integer('seen_at').notNull(),
  },
  (t) => [index('runner_nonces_seen_idx').on(t.seenAt)],
);

/** One row, `global`: the kill switch the balance tripwire throws. No row reads as not halted. */
export const runnerControl = sqliteTable('runner_control', {
  id: text('id').primaryKey(),
  halted: integer('halted', { mode: 'boolean' }).notNull().default(false),
  haltedReason: text('halted_reason'),
  balanceBaselineMicroUsd: integer('balance_baseline_micro_usd'),
  baselineAt: integer('baseline_at'),
  updatedAt: integer('updated_at').notNull(),
});

export type FilmRun = typeof filmRuns.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type RunFile = typeof runFiles.$inferSelect;
