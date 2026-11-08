import type { CapName, PhaseName } from './config.ts';
import type { RemovalRequest } from './removal.ts';

/**
 * The GTM store: suppression, contact history, leads, the action ledger, spend, phase state and
 * flags. One store for all days (the CLI keeps it in `out/gtm/store.json`, the hosted executor in
 * D1), so suppression and the 90-day contact history never reset. Per-day outputs live beside it
 * under `out/gtm/<date>/`. This module has no I/O: `store-file.ts` loads and saves the JSON.
 */

export type SuppressionKind = 'email' | 'domain' | 'x_handle';
export type SuppressionReason =
  | 'opt_out'
  | 'removal'
  | 'not_interested'
  | 'bounce'
  | 'complaint'
  | 'manual';

export interface SuppressionRow {
  kind: SuppressionKind;
  /** The registrable domain in clear; an email address or handle as the SHA-256 of its normal form. */
  value: string;
  reason: SuppressionReason;
  /** Where the request came from: `optout_link`, `remove_form`, `reply`, `board`, `bounce`, ... */
  source: string;
  created_at: string;
}

export type Channel = 'email' | 'x_post' | 'film';

export interface ContactRow {
  domain: string;
  channel: Channel;
  at: string;
  lead_id: string;
}

export type Source = 'hn' | 'ph' | 'x';
export type Jurisdiction = 'us' | 'uk_ltd' | 'eu' | 'de' | 'other' | 'unknown';

export interface LeadAddress {
  /** Dropped after 30 days if the lead was never contacted. */
  address: string | null;
  /** The page the address was found on, on the lead's own domain. */
  source_url: string;
  /** How the footer names that page: "contact page", "homepage", ... */
  page_label: string;
  provenance: 'site' | 'found';
}

export interface XLaunchPost {
  url: string;
  /** True when oEmbed confirmed it and its own link resolves to the lead's registrable domain. */
  verified: boolean;
  author_name: string | null;
  at: string | null;
}

export interface LeadRow {
  id: string;
  /** The Pacific date the lead was found. */
  date: string;
  domain: string;
  site_url: string;
  source: Source;
  source_url: string;
  /** When the source says it was posted or featured. */
  source_at: string;
  hn_points: number | null;
  x_post: XLaunchPost | null;
  /** The verified product name: found in p1's title, og:site_name or first h1. Null if none. */
  product_name: string | null;
  addresses: LeadAddress[];
  /** Why the email lane is closed for this lead, whatever the scout says. */
  email_closed: string | null;
  /** Code's own reading, before the scout. */
  jurisdiction_hint: Jurisdiction;
  /** Words from the brand-safety list found on the site. Any match closes the X lane. */
  brand_flags: string[];
  verdict: LeadVerdict | null;
  /** The lanes the GTM lead picked it for, after code's checks. */
  picked: ('x' | 'email')[];
  found_at: string;
}

export interface LeadVerdict {
  verdict: 'qualified' | 'rejected';
  reject_reason: string | null;
  category: string;
  fit: number;
  /** The scout's line, verified by `checkQuote`; null when it failed. */
  line: { page: string; url: string; quote: string } | null;
  email_option: number | null;
  jurisdiction: Jurisdiction;
  session_id: string | null;
}

export type ActionStatus = 'planned' | 'sent' | 'failed' | 'dry_run' | 'unknown' | 'skipped';
export type ActionKind =
  | 'film'
  | 'film-withdraw'
  | 'x-post'
  | 'x-delete'
  | 'email'
  | 'optout-token'
  | 'data-run'
  | 'session'
  | 'card'
  | 'comment';

export interface ActionRow {
  key: string;
  kind: ActionKind;
  lead_id: string | null;
  status: ActionStatus;
  provider_id: string | null;
  cost_micro_usd: number;
  detail: string;
  created_at: string;
  executed_at: string | null;
  /** Ticks this row has stayed `planned`. */
  planned_ticks: number;
}

export interface PhaseRow {
  date: string;
  phase: PhaseName;
  status: 'done' | 'skipped' | 'failed';
  detail: string;
  session_ids: string[];
  started_at: string;
  finished_at: string;
}

export type SpendCategory = 'agents' | 'data' | 'posts' | 'email' | 'films';

export interface SpendRow {
  date: string;
  category: SpendCategory;
  micro_usd: number;
  ref: string;
  /** A reservation (a film's whole budget until the app reports its cost), not a measured figure. */
  reserved: boolean;
}

export interface InboundRow {
  message_id: string;
  thread_id: string | null;
  received_at: string;
  stop_match: string | null;
  handled_at: string | null;
}

/** One film ordered for a lead, real or dry run, and where it got to. */
export interface FilmRow {
  key: string;
  date: string;
  lead_id: string;
  domain: string;
  order_id: string;
  kind: 'dry-run' | 'app';
  state: 'queued' | 'working' | 'ready' | 'failed' | 'withdrawn' | 'late';
  qc: 'pending' | 'pass' | 'fail';
  simulated: boolean;
  cost_micro_usd: number | null;
  page_url: string | null;
  share_id: string | null;
  duration_seconds: number | null;
}

/** Copy the executor used, for template rotation and the overlap check. */
export interface CopyRow {
  date: string;
  lane: 'x' | 'email';
  template_id: string | null;
  /** The variable part only: the product name and the verified quote. */
  variable: string;
  lead_id: string;
}

/**
 * A removal or opt-out that has not finished taking down everything of ours. It is queued before
 * the app cursor moves on or the board comment is marked received, and retried on every run until
 * every post is deleted and every film withdrawn.
 */
export interface PendingRemoval {
  key: string;
  request: RemovalRequest;
  received_at: string;
  attempts: number;
  /** What is still up, or why it could not come down, at the last attempt. */
  last_error: string | null;
}

/** One post in a day's pack: what the founder posts by hand on X. */
export interface PackEntry {
  lead_id: string;
  domain: string;
  film_page: string;
  /** The executor tried to post it and the provider refused. */
  refused: boolean;
}

/**
 * The day's pack: one `FOUNDER: gtm pack <date>` card holding every post the executor did not make
 * itself. It is `waiting` until the founder moves the card to done, and only then `posted`. The
 * next day's report counts a done card's posts as POSTED and every other as NOT POSTED.
 */
export interface PackRow {
  date: string;
  card_id: string;
  key: string;
  entries: PackEntry[];
  status: 'waiting' | 'posted';
  posted_at: string | null;
  /** When a later run last read the card. */
  checked_at: string | null;
}

export interface OptOutTokenRow {
  hash: string;
  lead_id: string;
  domain: string;
  created_at: string;
}

export type XLane = 'off' | 'dry_run' | 'standalone' | 'pack' | 'consent';
export type SimpleLane = 'off' | 'dry_run' | 'live';

export interface Flags {
  /** `halted` stops every lane but removals; `dry_run` is the default; `live` lets lanes go live. */
  mode: 'dry_run' | 'live' | 'halted';
  film_lane: SimpleLane;
  x_lane: XLane;
  email_lane: SimpleLane;
  reply_lane: SimpleLane;
  caps: Partial<Record<CapName, number>>;
  /** The footer's postal address. Emails stay in dry run until it is set. */
  postal_address: string | null;
  /** The founder's `usr_` id: the only author of person-only commands on the board. */
  founder_user_id: string | null;
  /** The public base of the app, once the web job deploys the GTM routes. */
  app_base: string | null;
  /** Founder rulings and one-time checks the activation checklist records. */
  rulings: {
    x_policy_accepted: boolean;
    x_bio_set: boolean;
    /** The hash of the caption templates the founder approved. */
    x_templates_approved: string | null;
    bundle_tier_known: boolean;
    x_canary_done: boolean;
    email_jurisdiction_accepted: boolean;
    email_canary_done: boolean;
    optout_routes_verified: boolean;
    /** The canary film reported a non-null cost. */
    film_canary_cost_reported: boolean;
  };
  email_paused: { at: string; reason: string } | null;
  /** The most suppression rows the store has held. Fewer means rows were lost: live lanes stop. */
  suppression_high_water: number;
  cursors: { requests: string | null; inbox: string | null; sender_events: string | null };
  /** When the executor key was minted, for the 30-day rotation. */
  executor_key_minted_at: string | null;
}

export interface FlagAuditRow {
  at: string;
  key: string;
  from: unknown;
  to: unknown;
  by: string;
}

export interface StoreData {
  version: 1;
  suppression: SuppressionRow[];
  contacts: ContactRow[];
  leads: LeadRow[];
  actions: ActionRow[];
  phases: PhaseRow[];
  spend: SpendRow[];
  inbound: InboundRow[];
  optout_tokens: OptOutTokenRow[];
  copy_history: CopyRow[];
  films: FilmRow[];
  flags: Flags;
  flag_audit: FlagAuditRow[];
  /** Removal requests for domains GTM never touched: counted, never put on the board. */
  unmatched_removals: Record<string, number>;
  pending_removals: PendingRemoval[];
  packs: PackRow[];
}

export const DEFAULT_FLAGS: Flags = {
  mode: 'dry_run',
  film_lane: 'dry_run',
  x_lane: 'dry_run',
  email_lane: 'dry_run',
  reply_lane: 'off',
  caps: {},
  postal_address: null,
  founder_user_id: null,
  app_base: null,
  rulings: {
    x_policy_accepted: false,
    x_bio_set: false,
    x_templates_approved: null,
    bundle_tier_known: false,
    x_canary_done: false,
    email_jurisdiction_accepted: false,
    email_canary_done: false,
    optout_routes_verified: false,
    film_canary_cost_reported: false,
  },
  email_paused: null,
  suppression_high_water: 0,
  cursors: { requests: null, inbox: null, sender_events: null },
  executor_key_minted_at: null,
};

export function emptyStore(): StoreData {
  return {
    version: 1,
    suppression: [],
    contacts: [],
    leads: [],
    actions: [],
    phases: [],
    spend: [],
    inbound: [],
    optout_tokens: [],
    copy_history: [],
    films: [],
    flags: structuredClone(DEFAULT_FLAGS),
    flag_audit: [],
    unmatched_removals: {},
    pending_removals: [],
    packs: [],
  };
}

/** Fills in fields a store written by an older build lacks, keeping every row it has. */
export function upgradeStore(data: Partial<StoreData>): StoreData {
  const empty = emptyStore();
  const flags = { ...empty.flags, ...(data.flags ?? {}) };
  flags.rulings = { ...empty.flags.rulings, ...(data.flags?.rulings ?? {}) };
  flags.cursors = { ...empty.flags.cursors, ...(data.flags?.cursors ?? {}) };
  return { ...empty, ...data, version: 1, flags };
}

/** Sets one flag and writes an audit row for the change. */
export function setFlag<K extends keyof Flags>(
  store: StoreData,
  key: K,
  value: Flags[K],
  by: string,
  at: string,
): void {
  const from = store.flags[key];
  if (JSON.stringify(from) === JSON.stringify(value)) return;
  store.flags[key] = value;
  store.flag_audit.push({ at, key, from, to: value, by });
}

/** One phase of one day, if it has run. */
export const phaseOf = (store: StoreData, date: string, phase: PhaseName) =>
  store.phases.find((row) => row.date === date && row.phase === phase);

/** Records a phase as finished. A phase is recorded once per day; a second record is ignored. */
export function recordPhase(store: StoreData, row: PhaseRow): void {
  if (phaseOf(store, row.date, row.phase)) return;
  store.phases.push(row);
}
