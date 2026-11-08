/**
 * `FilmOrder`: how the GTM team and the web app order a film of a URL, poll it, and read its file
 * and the crew's decisions. The pipeline behind it is `pnpm film` (`LocalFilmOrder` in
 * `local-order.ts`); `DryRunFilmOrder` needs no network and makes nothing.
 *
 * This file imports nothing, not even `node:*`, so a Cloudflare Worker or a browser bundle can
 * import it (`@boiler-room/agents/film-order`) without pulling in the pipeline. The shapes match
 * GTM's `agents/src/gtm/ports.ts`, with `decisions` added. The words of a decision (`agent`, `kind`,
 * `stage`, `status`) are the web app's, from `apps/web/src/lib/film.ts`, so a decision maps onto
 * its `PipelineEvent` one to one.
 */

export const FILM_ORDER_KINDS = ['dry-run', 'app', 'local'] as const;
export type FilmOrderKind = (typeof FILM_ORDER_KINDS)[number];

export const FILM_LENGTHS = ['short', 'standard'] as const;
export type FilmLength = (typeof FILM_LENGTHS)[number];

/** The formats `campaign.json` knows. One is rendered per order. */
export const FILM_FORMATS = ['16:9', '9:16', '1:1'] as const;
export type FilmFormat = (typeof FILM_FORMATS)[number];

export const WITHDRAW_REASONS = ['removal', 'opt_out', 'failed', 'manual'] as const;
export type WithdrawReason = (typeof WITHDRAW_REASONS)[number];

export interface FilmOrderInput {
  url: string;
  /** The same key returns the same order. */
  idempotencyKey: string;
  /**
   * A hard cap on everything the film may spend: agent sessions, render computers and generated
   * media, route-back rounds included. The pipeline stops at it.
   */
  budgetMicroUsd: number;
  /** The caller's reference, such as GTM's lead id. Kept with the order, never shown. */
  leadRef: string;
  /** True (the default) for an outreach sample, which is Short by rule 1 of the Director's §1. */
  sample?: boolean;
  /** Default `short`. `standard` needs `sample: false`. */
  length?: FilmLength;
  /** Default `16:9`. */
  format?: FilmFormat;
}

/** What GTM and the app need from the film pipeline. */
export interface FilmOrder {
  readonly kind: FilmOrderKind;
  /** Orders a film of `url`. The same idempotency key returns the same order. */
  order(input: FilmOrderInput): Promise<{ orderId: string }>;
  status(orderId: string): Promise<FilmOrderStatus>;
  /** A link to the MP4. Only for a ready film. */
  file(orderId: string): Promise<FilmFile>;
  /** Who decided what on this film, and why, in order. Grows while the film is made. */
  decisions(orderId: string): Promise<FilmDecisions>;
  /** Publishes the film's unlisted page and returns its address. Only the app has pages. */
  share(orderId: string): Promise<{ pageUrl: string; shareId: string }>;
  /** Stops the film if it is still being made, and deletes its file. Safe to call twice. */
  withdraw(orderId: string, reason: WithdrawReason): Promise<void>;
}

export const ORDER_STATES = ['queued', 'working', 'ready', 'failed', 'withdrawn'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export interface FilmOrderStatus {
  orderId: string;
  /** `ready` once a film was rendered and reviewed; `qc` says whether it passed. */
  state: OrderState;
  /** The app's Stage, such as `render`. */
  stage: FilmStage | null;
  qc: 'pending' | 'pass' | 'fail';
  /** True for DryRunFilmOrder and the app's SimulatedPipeline. */
  simulated: boolean;
  /** Everything spent so far: sessions, computers and media, route-backs included. */
  costMicroUsd: number | null;
  failure: string | null;
  /** The film's on-screen and voiceover text, for the brand-safety screen. Null until ready. */
  script: string | null;
}

export interface FilmFile {
  url: string;
  expiresAt: string;
  contentType: 'video/mp4';
  bytes: number;
  durationSeconds: number;
  sha256: string;
}

// ---------------------------------------------------------------------------------------------
// Decisions, in the web app's words

/** The ten stations of the web app's pipeline tracker. */
export const FILM_STAGES = [
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
export type FilmStage = (typeof FILM_STAGES)[number];

export const FILM_STATUSES = ['queued', 'working', 'needs_you', 'done', 'failed'] as const;
export type FilmStatus = (typeof FILM_STATUSES)[number];

/** The crew, plus the coordinator (the film command itself) and the customer. */
export const CREW_MEMBERS = [
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
export type CrewMember = (typeof CREW_MEMBERS)[number];

export const DECISION_KINDS = [
  'started',
  'decision',
  'sent_back',
  'passed',
  'needs_you',
  'delivered',
  'failed',
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

/** One thing a member of the crew decided, and why. */
export interface FilmDecision {
  /** Unique within the film: `d-<seq>`. */
  id: string;
  /** Position in the film, from 0. */
  seq: number;
  at: string;
  agent: CrewMember;
  kind: DecisionKind;
  /** The stage the film is in once this has happened. */
  stage: FilmStage;
  /** The film's status once this has happened. */
  status: FilmStatus;
  /** 1 for the first pass, 2 and 3 for the rounds after a route-back. */
  round: number;
  /** What was decided, in one line. */
  message: string;
  /** Why. */
  why: string;
  /** The facts behind it, such as issue codes, scene ids or a session id. */
  data?: Record<string, unknown>;
}

export interface FilmDecisions {
  orderId: string;
  simulated: boolean;
  decisions: FilmDecision[];
}

// ---------------------------------------------------------------------------------------------
// The dry run

/** A short id from `input`, the same every time. FNV-1a, so it needs no crypto module. */
export function stableId(prefix: string, input: string, length = 6): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  let id = '';
  for (let round = 0; id.length < length; round += 1) {
    let hash = 0x811c9dc5 ^ round;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    for (let left = 0; left < 4 && id.length < length; left += 1) {
      id += alphabet[(hash >>> (left * 8)) % alphabet.length];
    }
  }
  return `${prefix}-${id}`;
}

/**
 * Needs no network. An order moves from `queued` to `ready` over three status reads, is always
 * `simulated`, has a page address marked as not real, no file and no decisions. A simulated film
 * can only ever produce drafts.
 */
export class DryRunFilmOrder implements FilmOrder {
  readonly kind = 'dry-run' as const;
  private readonly reads = new Map<string, number>();
  readonly withdrawn: string[] = [];
  private readonly appBase: string;
  constructor(appBase: string) {
    this.appBase = appBase;
  }
  async order(input: { idempotencyKey: string }) {
    const orderId = stableId('fo-dry', input.idempotencyKey);
    if (!this.reads.has(orderId)) this.reads.set(orderId, 0);
    return { orderId };
  }
  async status(orderId: string): Promise<FilmOrderStatus> {
    const reads = (this.reads.get(orderId) ?? 0) + 1;
    this.reads.set(orderId, reads);
    const state = this.withdrawn.includes(orderId)
      ? 'withdrawn'
      : reads >= 3
        ? 'ready'
        : reads === 2
          ? 'working'
          : 'queued';
    return {
      orderId,
      state,
      stage: state === 'ready' ? 'delivery' : state === 'working' ? 'render' : null,
      qc: state === 'ready' ? 'pass' : 'pending',
      simulated: true,
      costMicroUsd: 0,
      failure: null,
      script: state === 'ready' ? '' : null,
    };
  }
  async decisions(orderId: string): Promise<FilmDecisions> {
    return { orderId, simulated: true, decisions: [] };
  }
  async share(orderId: string) {
    const shareId = `dry-run-${orderId.slice(-6)}`;
    return { pageUrl: `${this.appBase}/f/${shareId}`, shareId };
  }
  async file(): Promise<FilmFile> {
    throw new Error('a dry-run film has no file');
  }
  async withdraw(orderId: string) {
    if (!this.withdrawn.includes(orderId)) this.withdrawn.push(orderId);
  }
}
