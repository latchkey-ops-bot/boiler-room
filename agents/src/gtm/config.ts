import { GTM_LEAD, INBOX_READER, SCOUT, SOCIAL_AGENT } from '../definitions/company/common.ts';

/**
 * The GTM executor's fixed numbers. Spec: docs/company/gtm-operations.md. Every cap has a default
 * and a hard maximum; a store flag may set a cap anywhere up to its maximum, never past it.
 */

/** The four GTM agents. The executor starts sessions for these and for no other agent. */
export const GTM_AGENT_NAMES = [GTM_LEAD, SCOUT, SOCIAL_AGENT, INBOX_READER] as const;
export type GtmAgentName = (typeof GTM_AGENT_NAMES)[number];

export const TIMEZONE = 'America/Los_Angeles';

export const CAPS = {
  x_posts_day: { default: 1, max: 1 },
  cold_emails_day: { default: 5, max: 5 },
  answers_day: { default: 20, max: 20 },
  /** The X pick included. The app's MAX_FILMS_IN_PROGRESS is 5. */
  films_day: { default: 5, max: 5 },
  /** While film_lane is live and both outreach lanes are dry run: the canary film only. */
  films_day_canary: { default: 1, max: 1 },
  film_budget_micro: { default: 1_000_000, max: 1_500_000 },
  candidates_day: { default: 40, max: 40 },
  qualified_day: { default: 15, max: 15 },
  data_runs_day: { default: 25, max: 40 },
  data_spend_day_micro: { default: 150_000, max: 250_000 },
  finder_runs_day: { default: 5, max: 5 },
  reader_sessions_day: { default: 60, max: 100 },
  spend_day_micro: { default: 7_000_000, max: 10_000_000 },
  spend_month_micro: { default: 150_000_000, max: 250_000_000 },
  /** Held back from the day cap for replies and removals before any film is ordered. */
  reply_reserve_micro: { default: 1_500_000, max: 1_500_000 },
} as const;
export type CapName = keyof typeof CAPS;

/** One session's budget, and the most code may raise it to when Naive quotes a higher floor. */
export const SESSION_BUDGETS: Readonly<Record<GtmAgentName, { default: number; max: number }>> = {
  [SCOUT]: { default: 150_000, max: 300_000 },
  // At most the lead's $1.00 task maximum (GTM_ACTIVE_BUDGETS): Naive refuses a session above it.
  [GTM_LEAD]: { default: 1_000_000, max: 1_000_000 },
  [SOCIAL_AGENT]: { default: 100_000, max: 200_000 },
  [INBOX_READER]: { default: 50_000, max: 100_000 },
};

/** Sessions per phase. */
export const SCOUT_SESSIONS = 4;
export const SCOUT_BATCH = 10;
export const MAX_EMAIL_PICKS = 5;

/** Fixed prices, in micro-USD. */
export const PRICES = {
  x_post: 32_500,
  x_post_with_link: 273_000,
  search_google: 150,
  search_web_pages: 4_000,
  find_domain_emails: 24_500,
} as const;

/**
 * Data tools the executor may run. Their ids are resolved at run time by exact catalogue name, the
 * catalogue domain and a listed price no higher than ours: the catalogue holds two tools named
 * `Search Google` (`search` at $0.00015 a call, `seo` at $0.008), so a name alone resolves nothing.
 * `queries` are the catalogue searches tried, best first; the search ranks, so a name can fall out
 * of one search's results and still be found by another.
 */
export const DATA_TOOLS = {
  google: {
    name: 'Search Google',
    domain: 'search',
    maxMicroUsd: PRICES.search_google,
    queries: ['Search Google', 'google search results'],
  },
  webPages: {
    name: 'Search Web Pages',
    domain: 'search',
    maxMicroUsd: PRICES.search_web_pages,
    queries: ['Search Web Pages', 'web pages by site and publish date'],
  },
  domainEmails: {
    name: 'Find Domain Emails',
    domain: 'people',
    maxMicroUsd: PRICES.find_domain_emails,
    queries: ['Find Domain Emails', 'email addresses for a domain'],
  },
} as const;
export type DataToolKey = keyof typeof DATA_TOOLS;

/** Discovery windows and floors. */
export const DISCOVERY = {
  window_hours: 72,
  hn_min_points_email: 5,
  hn_min_points_x: 20,
  ph_max_entries: 10,
  ph_tagline_overlap: 0.8,
  pages_per_site: 6,
  page_max_bytes: 300_000,
  page_timeout_ms: 8_000,
  max_redirects: 5,
  fence_chars: 2_000,
  product_name_max: 30,
} as const;

/** Contact rules. */
export const DEDUPE = {
  email_days: 90,
  film_days: 90,
  /** One X post per domain, ever. */
  x_post_days: Number.POSITIVE_INFINITY,
} as const;

/** Phase times, Pacific, in minutes after midnight. The hosted executor runs each when due. */
export const SCHEDULE = [
  { phase: 'open', at: 0 },
  { phase: 'discover', at: 5 * 60 },
  { phase: 'qualify', at: 5 * 60 + 20 },
  { phase: 'pick', at: 6 * 60 },
  { phase: 'order', at: 6 * 60 + 30 },
  { phase: 'films', at: 6 * 60 + 30 },
  { phase: 'compose', at: 9 * 60 + 45 },
  { phase: 'execute', at: 10 * 60 + 30 },
  { phase: 'report', at: 23 * 60 + 45 },
] as const;
export type PhaseName = (typeof SCHEDULE)[number]['phase'] | 'removals';

/**
 * The founder's ruling for the hackathon: no real email goes out, whatever the store's flags say.
 * While this is true the email lane is dry run on every run (`resolveLanes`), so `gtm:flags` cannot
 * lift it. Lifting it is a reviewed change to this line, as `GTM_ACTIVE` is.
 */
export const EMAIL_FORCED_DRY_RUN = true;

/**
 * The X account the founder posts the day's pack from, by hand. X refused programmatic posts from
 * it through Naive Social, so the pack (a `FOUNDER: gtm pack <date>` card) is how GTM reaches X.
 */
export const X_ACCOUNT = '@boilerroomstudi';

/** The minutes between compose and execute in which a person may comment HOLD. */
export const HOLD_WINDOW_MINUTES = 45;

/** `actions` rows of these kinds are never retried once planned: a retry could post or send twice. */
export const AT_MOST_ONCE = ['x-post', 'email'] as const;
/** Ticks a planned at-most-once row may wait for its provider id before it becomes `unknown`. */
export const UNKNOWN_AFTER_TICKS = 2;

/** The executor key is rotated on this day of its life; a FOUNDER card asks for it. */
export const KEY_ROTATION_DAY = 25;

/** The app's public base. Until the web job deploys the GTM routes, links are placeholders. */
export const APP_BASE_PLACEHOLDER = 'https://app.boiler-room.invalid';
export const BOT_USER_AGENT = (appBase: string) => `BoilerRoomBot/1.0 (+${appBase}/bot)`;

/** Card title prefixes the executor writes, and the only ones it may write. */
export const CARD_TITLE_PREFIXES = ['GTM: ', 'REMOVE: ', 'FOUNDER: gtm '] as const;
/** A card anyone may open to stop every lane. */
export const HOLD_CARD_PREFIX = 'GTM-HOLD: ';

/** The founder's needs the executor can raise, each one card `FOUNDER: gtm <need>`. */
export const FOUNDER_NEEDS = [
  'executor-key',
  'postal-address',
  'cold-sender',
  'connect-x',
  'x-volume',
  'email-paused',
  'budget-floor',
  'tampered',
  'unknown-send',
  'rotate-key',
  'ledger-mismatch',
  'lockdown',
  'reply',
  'removal',
  'pack',
  'hand-removal',
] as const;
export type FounderNeed = (typeof FOUNDER_NEEDS)[number];

/** Replies that may become a FOUNDER card: one per lead, at most this many a day. */
export const FOUNDER_REPLY_CARDS_DAY = 3;
