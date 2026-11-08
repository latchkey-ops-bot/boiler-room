/**
 * The words a film moves through. Shared by the database, the pipeline clients, the API and the
 * screens, so a stage or status means the same thing everywhere.
 */

/** The ten stations on the pipeline tracker, in order. */
export const STAGES = [
  'research',
  'script',
  'checks',
  'approval',
  'art_direction',
  'motion',
  'audio',
  'render',
  'review',
  'delivery',
] as const;
export type Stage = (typeof STAGES)[number];

/** The design system's five states. `needs_you` is the only pink one. */
export const FILM_STATUSES = ['queued', 'working', 'needs_you', 'done', 'failed'] as const;
export type FilmStatus = (typeof FILM_STATUSES)[number];

/** The crew, plus the coordinator that pauses the run and the customer who approves. */
export const CREW = [
  'coordinator',
  'researcher',
  'director',
  'validator',
  'art_director',
  'motion',
  'audio',
  'render',
  'quality_check',
  'account_manager',
  'customer',
] as const;
export type CrewMember = (typeof CREW)[number];

export const EVENT_KINDS = [
  'started',
  'decision',
  'sent_back',
  'passed',
  'needs_you',
  'delivered',
  'failed',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const PIPELINE_KINDS = ['simulated', 'naive'] as const;
export type PipelineKind = (typeof PIPELINE_KINDS)[number];

export const SCRIPT_DECISIONS = ['approved', 'changes_requested'] as const;
export type ScriptDecisionKind = (typeof SCRIPT_DECISIONS)[number];

/**
 * The film shapes in `campaign.json`. Kept here, not imported from `@boiler-room/schema`, so the
 * browser bundle does not pull in zod. `test/film.test.ts` checks the two lists match.
 */
export const FORMATS = ['16:9', '9:16', '1:1'] as const;
export type Format = (typeof FORMATS)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  research: 'Research',
  script: 'Script',
  checks: 'Checks',
  approval: 'You approve',
  art_direction: 'Art direction',
  motion: 'Motion',
  audio: 'Audio',
  render: 'Render',
  // Not "Review": that word is the founder's step, the script review.
  review: 'Quality check',
  delivery: 'Delivery',
};

/**
 * The four stops a founder sees, the same four as How it works on the landing page and What
 * happens next on the new-video page. The ten stages stay the pipeline's own; each maps to a stop.
 */
export const STOPS = ['research', 'script', 'approve', 'make'] as const;
export type Stop = (typeof STOPS)[number];

export const STOP_LABELS: Record<Stop, string> = {
  research: 'Research',
  script: 'Script',
  approve: 'You approve',
  make: 'Animate and deliver',
};

export const STOP_OF: Record<Stage, Stop> = {
  research: 'research',
  script: 'script',
  checks: 'script',
  approval: 'approve',
  art_direction: 'make',
  motion: 'make',
  audio: 'make',
  render: 'make',
  review: 'make',
  delivery: 'make',
};

/** Who works at each stop. The landing page lists the same cast, so the two always agree. */
export const STOP_CREW: Record<Stop, readonly CrewMember[]> = {
  research: ['researcher'],
  script: ['director', 'validator'],
  approve: ['customer'],
  make: ['art_director', 'motion', 'audio', 'render', 'quality_check', 'account_manager'],
};

export function stopIndex(stage: Stage): number {
  return STOPS.indexOf(STOP_OF[stage]);
}

/**
 * How long a simulated film takes, in seconds at demo pace: from the start to the script, and from
 * approval to delivery. The simulator's timeline uses these. A real film's times are not known yet.
 */
export const SIMULATED_SECONDS = { script: 30, delivery: 40 } as const;

export const STATUS_LABELS: Record<FilmStatus, string> = {
  queued: 'Queued',
  working: 'Working',
  needs_you: 'Needs you',
  done: 'Delivered',
  failed: 'Needs a fix',
};

/** What a working badge says at each station, such as "Rendering" in the dashboard sample. */
export const WORKING_LABELS: Record<Stage, string> = {
  research: 'Researching',
  script: 'Writing',
  checks: 'Checking',
  approval: 'Checking',
  art_direction: 'Designing',
  motion: 'Animating',
  audio: 'Adding sound',
  render: 'Rendering',
  review: 'Final check',
  delivery: 'Delivering',
};

export const CREW_LABELS: Record<CrewMember, string> = {
  coordinator: 'Coordinator',
  researcher: 'Researcher',
  director: 'Director',
  validator: 'Validator',
  art_director: 'Art Director',
  motion: 'Motion',
  audio: 'Audio',
  render: 'Render',
  quality_check: 'Quality Check',
  account_manager: 'Account Manager',
  customer: 'You',
};

/** Each crew member's icon, from DESIGN.md. */
export const CREW_ICONS = {
  coordinator: 'user',
  researcher: 'search',
  director: 'clapper',
  validator: 'shield',
  art_director: 'brush',
  motion: 'film',
  audio: 'note',
  render: 'gear',
  quality_check: 'eye',
  account_manager: 'mail',
  customer: 'user',
} as const satisfies Record<CrewMember, string>;

/** The icon on each pipeline station. */
export const STAGE_ICONS = {
  research: 'search',
  script: 'clapper',
  checks: 'shield',
  approval: 'user',
  art_direction: 'brush',
  motion: 'film',
  audio: 'note',
  render: 'gear',
  review: 'eye',
  delivery: 'mail',
} as const satisfies Record<Stage, string>;

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

/** The host a founder recognises, without `www.`. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
