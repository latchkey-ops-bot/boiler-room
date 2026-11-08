import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
