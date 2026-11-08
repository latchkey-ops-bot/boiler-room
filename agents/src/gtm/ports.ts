import type { DataToolKey, GtmAgentName } from './config.ts';
import type { BoardComment } from './removal.ts';

/**
 * What the executor talks to. Each port has a dry-run implementation that needs no network and no
 * secret, and a live one in `live.ts`. In dry run the live classes are never constructed.
 */

// ---------------------------------------------------------------------------------------------
// Films

/**
 * What GTM needs from the film pipeline: `FilmOrder`, shared with the web app and the film command
 * in `../film/order.ts`. Implemented by DryRunFilmOrder (there), AppFilmOrder (`live.ts`) and
 * LocalFilmOrder (`../film/local-order.ts`, which runs `pnpm film`). Only an `app` order is live
 * here: GTM shares a film through the app's page.
 */
export type { FilmDecisions, FilmFile, FilmOrder, FilmOrderStatus } from '../film/order.ts';
export { DryRunFilmOrder } from '../film/order.ts';

// ---------------------------------------------------------------------------------------------
// X

/**
 * The provider answered that it would not post: the post did not go out. Unlike any other error
 * from a post, which may hide a post that went out, this one is safe to treat as not sent, so the
 * day puts the post in the founder's pack instead of marking it unknown.
 */
export class PostRefused extends Error {
  readonly notSent = true;
  constructor(message: string) {
    super(message);
    this.name = 'PostRefused';
  }
}

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
  /** A GTM card's status now, such as a pack card the founder moved to done. Null when unknown. */
  cardStatus(cardId: string): Promise<CardStatus | null>;
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
  async cardStatus(cardId: string) {
    return this.cards.get(cardId)?.status ?? null;
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
