import type { DataToolKey, GtmAgentName } from './config.ts';
import { stableId } from './domain.ts';
import type { BoardComment } from './removal.ts';

/**
 * What the executor talks to. Each port has a dry-run implementation that needs no network and no
 * secret, and a live one in `live.ts`. In dry run the live classes are never constructed.
 */

// ---------------------------------------------------------------------------------------------
// Films

/** What GTM needs from the film pipeline. Implemented by DryRunFilmOrder and AppFilmOrder. */
export interface FilmOrder {
  readonly kind: 'dry-run' | 'app';
  /** Orders a Short (25 s), 16:9 outreach sample of `url`. The same key returns the same order. */
  order(input: {
    url: string;
    idempotencyKey: string;
    budgetMicroUsd: number;
    leadRef: string;
  }): Promise<{ orderId: string }>;
  status(orderId: string): Promise<FilmOrderStatus>;
  /** Publishes the film's unlisted page and returns its address. Only for a ready film. */
  share(orderId: string): Promise<{ pageUrl: string; shareId: string }>;
  /** A short-lived link to the 16:9 MP4, for the X post. */
  file(orderId: string): Promise<FilmFile>;
  /** Takes the page down (410 from then on) and deletes the files. Safe to call twice. */
  withdraw(orderId: string, reason: 'removal' | 'opt_out' | 'failed' | 'manual'): Promise<void>;
}

export interface FilmOrderStatus {
  orderId: string;
  state: 'queued' | 'working' | 'ready' | 'failed' | 'withdrawn';
  /** The app's Stage, such as 'render'. */
  stage: string | null;
  qc: 'pending' | 'pass' | 'fail';
  /** True for DryRunFilmOrder and the app's SimulatedPipeline. */
  simulated: boolean;
  /** What the pipeline spent, media and repair rounds included. Null until the app knows it. */
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

/**
 * Needs no network. An order moves from `queued` to `ready` over three status reads, is always
 * `simulated`, has a page address marked as not real, and has no file. A simulated film can only
 * ever produce drafts.
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
      stage: state === 'ready' ? 'delivered' : state === 'working' ? 'render' : null,
      qc: state === 'ready' ? 'pass' : 'pending',
      simulated: true,
      costMicroUsd: 0,
      failure: null,
      script: state === 'ready' ? '' : null,
    };
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

// ---------------------------------------------------------------------------------------------
// X

export interface SocialPoster {
  readonly kind: 'dry-run' | 'naive';
  /** Whether an X account is connected and posting can work. */
  ready(): Promise<{ ok: boolean; reason: string | null }>;
  /** Posts the caption with the film. The idempotency key is the action key. */
  post(input: {
    caption: string;
    filmFileUrl: string;
    idempotencyKey: string;
  }): Promise<{ postId: string }>;
  /** Finds a post made under this key, to settle a planned row after a lost answer. */
  find(idempotencyKey: string): Promise<string | null>;
  remove(postId: string): Promise<void>;
}

/** Posts nothing. Calling `post` is a bug: the ledger records a dry run instead. */
export class DryRunSocial implements SocialPoster {
  readonly kind = 'dry-run' as const;
  async ready() {
    return { ok: false, reason: 'dry run' };
  }
  async post(): Promise<{ postId: string }> {
    throw new Error('DryRunSocial never posts');
  }
  async find() {
    return null;
  }
  async remove() {}
}

// ---------------------------------------------------------------------------------------------
// Email

export interface SenderEvent {
  kind: 'bounce_permanent' | 'bounce_transient' | 'complaint';
  to: string;
  at: string;
  messageId: string;
}

/** A sender of first-touch email. Replies and answers go through AgentMail, not this. */
export interface EmailSender {
  readonly kind: string;
  /** The account the sender lives on; the reply opt-out mailbox must be on the same one. */
  readonly account: string;
  readonly from: string;
  /** Where replies land: the sender's own mailbox, never the customer inbox. */
  readonly replyTo: string;
  readonly capabilities: { bounceEvents: boolean; customHeaders: boolean };
  send(input: {
    from: string;
    replyTo: string;
    to: string;
    subject: string;
    text: string;
    headers: Record<string, string>;
    idempotencyKey: string;
  }): Promise<{ messageId: string }>;
  /** Bounces since the cursor, from provider events or DSN messages in the sending mailbox. */
  events(after: string | null): Promise<{ events: SenderEvent[]; cursor: string | null }>;
}

/** Sends nothing. */
export class DryRunEmailSender implements EmailSender {
  readonly kind = 'dry-run';
  readonly account = 'dry-run';
  readonly from = 'Boiler Room <hello@sending-domain.invalid>';
  readonly replyTo = 'hello@sending-domain.invalid';
  readonly capabilities = { bounceEvents: false, customHeaders: true };
  async send(): Promise<{ messageId: string }> {
    throw new Error('DryRunEmailSender never sends');
  }
  async events() {
    return { events: [], cursor: null };
  }
}

// ---------------------------------------------------------------------------------------------
// The app's other GTM routes

export interface AppRequest {
  id: string;
  kind: 'opt_out' | 'removal';
  /** `optout_link` or `remove_form`. */
  channel: string;
  /** For an opt-out: the token's lead. For a removal: the domain or film page given. */
  token_hash: string | null;
  domain: string | null;
  share_id: string | null;
  at: string;
}

export interface GtmApp {
  readonly kind: 'dry-run' | 'app';
  registerOptOutToken(hash: string, ref: string): Promise<void>;
  /** Opt-outs and removals since the cursor. */
  requests(after: string | null): Promise<{ requests: AppRequest[]; cursor: string | null }>;
}

/** Registers nothing and receives nothing until the web job's routes exist. */
export class DryRunGtmApp implements GtmApp {
  readonly kind = 'dry-run' as const;
  readonly registered: string[] = [];
  private readonly pending: AppRequest[];
  constructor(pending: AppRequest[] = []) {
    this.pending = pending;
  }
  async registerOptOutToken(hash: string) {
    this.registered.push(hash);
  }
  async requests(after: string | null) {
    const start = after ? this.pending.findIndex((item) => item.id === after) + 1 : 0;
    const requests = this.pending.slice(start);
    return { requests, cursor: requests.at(-1)?.id ?? after };
  }
}

// ---------------------------------------------------------------------------------------------
// The board

export type CardStatus = 'todo' | 'doing' | 'blocked' | 'done';

export interface Board {
  readonly kind: 'local' | 'naive';
  /** Creates a card, or answers the one made with the same key. Never assigned. */
  ensureCard(input: {
    title: string;
    body: string;
    status: CardStatus;
    key: string;
  }): Promise<{ id: string }>;
  comment(cardId: string, body: string): Promise<{ id: string }>;
  move(cardId: string, status: CardStatus, note?: string): Promise<void>;
  comments(cardId: string): Promise<BoardComment[]>;
  /** Open `GTM-HOLD:` cards, by title. */
  holdCards(): Promise<string[]>;
}

/** The `--no-board` board: an in-memory log the CLI writes to the day's folder. */
export class LocalBoard implements Board {
  readonly kind = 'local' as const;
  readonly cards = new Map<
    string,
    { id: string; title: string; body: string; status: CardStatus; note: string | null }
  >();
  readonly log: string[] = [];
  private readonly byKey = new Map<string, string>();
  private readonly notes = new Map<string, BoardComment[]>();
  private count = 0;
  private readonly at: () => string;
  constructor(at: () => string) {
    this.at = at;
  }
  async ensureCard(input: { title: string; body: string; status: CardStatus; key: string }) {
    const existing = this.byKey.get(input.key);
    if (existing) return { id: existing };
    this.count += 1;
    const id = `local-crd-${this.count}`;
    this.byKey.set(input.key, id);
    this.cards.set(id, {
      id,
      title: input.title,
      body: input.body,
      status: input.status,
      note: null,
    });
    this.log.push(`## ${input.title} (${input.status})\n\n${input.body}\n`);
    return { id };
  }
  async comment(cardId: string, body: string) {
    this.count += 1;
    const id = `local-cmt-${this.count}`;
    const list = this.notes.get(cardId) ?? [];
    list.push({ id, author: 'gtm-executor', body, created_at: this.at() });
    this.notes.set(cardId, list);
    this.log.push(`> ${body.split('\n').join('\n> ')}\n`);
    return { id };
  }
  async move(cardId: string, status: CardStatus, note?: string) {
    const card = this.cards.get(cardId);
    if (!card) return;
    card.status = status;
    if (note) card.note = note;
    this.log.push(`(${card.title} moved to ${status})${note ? `\n\n${note}\n` : ''}`);
  }
  async comments(cardId: string) {
    return [...(this.notes.get(cardId) ?? [])];
  }
  async holdCards() {
    return [];
  }
  markdown(): string {
    return `${this.log.join('\n')}\n`;
  }
}

// ---------------------------------------------------------------------------------------------
// Agents and data

export interface SessionResult {
  sessionId: string;
  status: string;
  /** The latest accepted `submit_output`, read from the events, or null. */
  output: unknown;
  consumedMicroUsd: number;
}

/** Starts the four GTM agents and reads their typed output. */
export interface AgentRunner {
  start(input: {
    agent: GtmAgentName;
    message: string;
    outputSchema: Record<string, unknown>;
    budgetMicroUsd: number;
    metadata: Record<string, string>;
  }): Promise<string>;
  /** Waits for the turn to end and returns the newest output since the last call. */
  wait(sessionId: string, maxMs: number): Promise<SessionResult>;
  /** Sends one repair message into the same session. */
  repair(sessionId: string, message: string): Promise<void>;
}

export interface DataRuns {
  run(
    tool: DataToolKey,
    input: { query?: Record<string, unknown>; body?: Record<string, unknown> },
  ): Promise<{
    data: unknown;
    costMicroUsd: number;
  }>;
}
