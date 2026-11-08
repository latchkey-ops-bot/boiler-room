import type { GtmAgentName } from './config.ts';
import type { GtmNaive } from './guard.ts';
import type {
  AgentRunner,
  AppRequest,
  Board,
  CardStatus,
  DataRuns,
  FilmDecisions,
  FilmFile,
  FilmOrder,
  FilmOrderStatus,
  GtmApp,
  SessionResult,
  SocialPoster,
} from './ports.ts';
import { PostRefused } from './ports.ts';
import type { BoardComment } from './removal.ts';

/**
 * The live ports. None of these is constructed in dry run (`createPorts` in `wiring.ts`), and none
 * reads a secret itself: each takes what it needs from the caller, so a test can prove that dry run
 * never reads the AgentMail key or a sender's credential.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// Naive

/**
 * Starts GTM sessions with `output_schema` and `structured_output_required`, and reads the output
 * from the events: `sessions.get` can still show the previous turn's output after a repair round,
 * so the latest accepted `submit_output`, or the `session.idle` event's output, is what counts.
 */
export class NaiveAgentRunner implements AgentRunner {
  private readonly naive: GtmNaive;
  private readonly cursors = new Map<string, number>();
  constructor(naive: GtmNaive) {
    this.naive = naive;
  }
  async start(input: {
    agent: GtmAgentName;
    message: string;
    outputSchema: Record<string, unknown>;
    budgetMicroUsd: number;
    metadata: Record<string, string>;
  }) {
    const id = await this.naive.startSession({
      agent_id: this.naive.agentId(input.agent),
      message: input.message,
      budget_micro_usd: input.budgetMicroUsd,
      output_schema: input.outputSchema,
      structured_output_required: true,
      metadata: { purpose: 'gtm-executor', ...input.metadata },
    });
    this.cursors.set(id, 0);
    return id;
  }
  async wait(sessionId: string, maxMs: number): Promise<SessionResult> {
    const deadline = Date.now() + maxMs;
    let after = this.cursors.get(sessionId) ?? 0;
    let latest: unknown = null;
    const pending = new Map<string, unknown>();
    for (;;) {
      const page = await this.naive.client.sessions.events(sessionId, {
        after_seq: after,
        limit: 100,
      });
      for (const event of page.data) {
        after = Math.max(after, event.seq);
        const data = event.data ?? {};
        if (event.type === 'tool.started' && data.name === 'submit_output')
          pending.set(String(data.tool_call_id), data.args);
        if (event.type === 'tool.completed' && data.name === 'submit_output' && !data.is_error) {
          latest = pending.get(String(data.tool_call_id)) ?? latest;
        }
        if (event.type === 'session.idle' && data.structured_output != null)
          latest = data.structured_output;
      }
      if (page.has_more) continue;
      const session = await this.naive.client.sessions.get(sessionId);
      if (!['running', 'queued'].includes(session.status) || Date.now() > deadline) {
        if (['running', 'queued'].includes(session.status)) {
          await this.naive.client.sessions.interrupt(sessionId).catch(() => undefined);
        }
        this.cursors.set(sessionId, after);
        return {
          sessionId,
          status: `${session.status}/${session.stop_reason ?? ''}`,
          output: latest,
          consumedMicroUsd: session.consumed_micro_usd ?? 0,
        };
      }
      await sleep(3000);
    }
  }
  async repair(sessionId: string, message: string) {
    await this.naive.sendToSession(sessionId, message);
  }
}

export class NaiveDataRuns implements DataRuns {
  private readonly naive: GtmNaive;
  constructor(naive: GtmNaive) {
    this.naive = naive;
  }
  async run(tool: Parameters<DataRuns['run']>[0], input: Parameters<DataRuns['run']>[1]) {
    const result = await this.naive.dataRun(tool, input);
    if (result.status !== 'succeeded')
      throw new Error(`data run failed: ${String(result.error).slice(0, 120)}`);
    return { data: result.data, costMicroUsd: result.cost_micro_usd };
  }
}

/** The company board, through the guard: unassigned GTM cards and comments only. */
export class NaiveBoard implements Board {
  readonly kind = 'naive' as const;
  private readonly naive: GtmNaive;
  constructor(naive: GtmNaive) {
    this.naive = naive;
  }
  async ensureCard(input: { title: string; body: string; status: CardStatus; key: string }) {
    const card = await this.naive.createCard(input);
    return { id: card.id };
  }
  async comment(cardId: string, body: string) {
    const comment = await this.naive.comment(cardId, body);
    return { id: comment.id };
  }
  async move(cardId: string, status: CardStatus, note?: string) {
    await this.naive.moveCard(cardId, { status, ...(note ? { note } : {}) });
  }
  async comments(cardId: string): Promise<BoardComment[]> {
    return this.naive.comments(cardId);
  }
  async holdCards() {
    const cards = await this.naive.listCards();
    return cards
      .filter((card) => card.title.startsWith('GTM-HOLD: ') && card.status !== 'done')
      .map((card) => card.title);
  }
  async cardStatus(cardId: string): Promise<CardStatus | null> {
    const card = (await this.naive.listCards()).find((item) => item.id === cardId);
    return card && ['todo', 'doing', 'blocked', 'done'].includes(card.status)
      ? (card.status as CardStatus)
      : null;
  }
}

/** Post statuses that mean the network would not take the post. */
const REFUSED = new Set(['failed', 'error', 'rejected', 'refused']);

/**
 * True when an error from creating a post means it did not go out: the provider answered 4xx (but
 * not a timeout). Anything else, a 5xx or a lost connection, may hide a post that went out.
 */
function refusedStatus(error: unknown): boolean {
  const status = Number((error as { status?: unknown } | null)?.status);
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408;
}

/**
 * Posts as the GTM identity through `POST /v1/identities/{id}/social/posts`. The film is imported to
 * Naive files first and posted by `file_ids`, because a 10-minute signed link can expire before
 * bundle.social fetches it; `media_urls` is the fallback.
 */
export class NaiveSocial implements SocialPoster {
  readonly kind = 'naive' as const;
  private readonly naive: GtmNaive;
  constructor(naive: GtmNaive) {
    this.naive = naive;
  }
  async ready() {
    const accounts = await this.naive.xAccounts().catch(() => []);
    return accounts.length
      ? { ok: true, reason: null }
      : { ok: false, reason: 'no X account connected' };
  }
  async post(input: { caption: string; filmFileUrl: string; idempotencyKey: string }) {
    let fileId: string | null = null;
    try {
      fileId = (
        await this.naive.importFile(
          input.filmFileUrl,
          `${input.idempotencyKey.replace(/[^a-z0-9-]/gi, '-')}.mp4`,
        )
      ).id;
    } catch {
      fileId = null;
    }
    let post: { id: string; status: string };
    try {
      post = await this.naive.post({
        content: input.caption,
        ...(fileId ? { file_ids: [fileId] } : { media_urls: [input.filmFileUrl] }),
      });
    } catch (error) {
      if (refusedStatus(error))
        throw new PostRefused(
          `the provider refused the post (${(error as { status: number }).status})`,
        );
      throw error;
    }
    // "The network refused it": the provider took the request and X would not post it.
    if (REFUSED.has(String(post.status).toLowerCase()))
      throw new PostRefused(`the post came back ${post.status}`);
    return { postId: post.id };
  }
  /**
   * Never matches. A post whose answer was lost stays `planned`, becomes `unknown` after two ticks
   * and goes to a person, which is safer than guessing which post is ours.
   */
  async find(): Promise<string | null> {
    return null;
  }
  async remove(postId: string) {
    await this.naive.deletePost(postId);
  }
}

// ---------------------------------------------------------------------------------------------
// The app's GTM routes (the web job builds them; see docs/company/gtm-operations.md section 8)

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

async function call(
  fetcher: FetchLike,
  base: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await fetcher(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status >= 400) throw new Error(`${method} ${path} answered ${response.status}`);
  return response.status === 204 ? null : response.json();
}

/** `FilmOrder` against `/api/gtm/v1/films`, with the GTM account's service token. */
export class AppFilmOrder implements FilmOrder {
  readonly kind = 'app' as const;
  private readonly base: string;
  private readonly token: string;
  private readonly fetcher: FetchLike;
  constructor(base: string, token: string, fetcher: FetchLike) {
    this.base = base.replace(/\/+$/, '');
    this.token = token;
    this.fetcher = fetcher;
  }
  async order(input: {
    url: string;
    idempotencyKey: string;
    budgetMicroUsd: number;
    leadRef: string;
  }) {
    const result = (await call(this.fetcher, this.base, this.token, 'POST', '/api/gtm/v1/films', {
      url: input.url,
      idempotency_key: input.idempotencyKey,
      budget_micro_usd: input.budgetMicroUsd,
      lead_ref: input.leadRef,
    })) as { id: string };
    return { orderId: result.id };
  }
  async status(orderId: string): Promise<FilmOrderStatus> {
    return (await call(
      this.fetcher,
      this.base,
      this.token,
      'GET',
      `/api/gtm/v1/films/${encodeURIComponent(orderId)}`,
    )) as FilmOrderStatus;
  }
  async share(orderId: string) {
    const result = (await call(
      this.fetcher,
      this.base,
      this.token,
      'POST',
      `/api/gtm/v1/films/${encodeURIComponent(orderId)}/share`,
    )) as {
      page_url: string;
      share_id: string;
    };
    return { pageUrl: result.page_url, shareId: result.share_id };
  }
  async file(orderId: string): Promise<FilmFile> {
    return (await call(
      this.fetcher,
      this.base,
      this.token,
      'GET',
      `/api/gtm/v1/films/${encodeURIComponent(orderId)}/file`,
    )) as FilmFile;
  }
  /** Who decided what on the film, from the run's `decisions.json`, as the app keeps it. */
  async decisions(orderId: string): Promise<FilmDecisions> {
    return (await call(
      this.fetcher,
      this.base,
      this.token,
      'GET',
      `/api/gtm/v1/films/${encodeURIComponent(orderId)}/decisions`,
    )) as FilmDecisions;
  }
  async withdraw(orderId: string, reason: string) {
    await call(
      this.fetcher,
      this.base,
      this.token,
      'POST',
      `/api/gtm/v1/films/${encodeURIComponent(orderId)}/withdraw`,
      { reason },
    );
  }
}

export class AppGtm implements GtmApp {
  readonly kind = 'app' as const;
  private readonly base: string;
  private readonly token: string;
  private readonly fetcher: FetchLike;
  constructor(base: string, token: string, fetcher: FetchLike) {
    this.base = base.replace(/\/+$/, '');
    this.token = token;
    this.fetcher = fetcher;
  }
  async registerOptOutToken(hash: string, ref: string) {
    await call(this.fetcher, this.base, this.token, 'POST', '/api/gtm/v1/optout-tokens', {
      token_hash: hash,
      ref,
    });
  }
  async requests(after: string | null) {
    const query = after ? `?after=${encodeURIComponent(after)}` : '';
    const result = (await call(
      this.fetcher,
      this.base,
      this.token,
      'GET',
      `/api/gtm/v1/requests${query}`,
    )) as {
      data: AppRequest[];
      cursor: string | null;
    };
    return { requests: result.data, cursor: result.cursor };
  }
}

// ---------------------------------------------------------------------------------------------
// AgentMail (replies and the provider's block list; never first-touch email)

/**
 * AgentMail's REST API, for the reply inbox only. AgentMail's terms forbid cold outreach, so this
 * class sends nothing but answers in a thread someone else started, and adds opt-outs to the
 * organisation's send block list as a second lock behind GTM's own suppression list.
 */
export class AgentMailClient {
  private readonly key: string;
  private readonly fetcher: FetchLike;
  static readonly BASE = 'https://api.agentmail.to/v0';
  constructor(key: string, fetcher: FetchLike) {
    this.key = key;
    this.fetcher = fetcher;
  }
  private request(method: string, path: string, body?: unknown, idempotencyKey?: string) {
    return this.fetcher(`${AgentMailClient.BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.key}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).then(async (response) => {
      if (response.status >= 400)
        throw new Error(`AgentMail ${method} ${path.split('/')[1]} answered ${response.status}`);
      return response.json();
    });
  }
  listMessages(inbox: string, query: { after?: string; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (query.after) params.set('after', query.after);
    params.set('limit', String(query.limit ?? 50));
    return this.request('GET', `/inboxes/${encodeURIComponent(inbox)}/messages?${params}`);
  }
  getMessage(inbox: string, messageId: string) {
    return this.request(
      'GET',
      `/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(messageId)}`,
    );
  }
  /** Answers in the message's own thread. The recipient is the provider's, never a model's. */
  reply(
    inbox: string,
    messageId: string,
    body: { text: string; headers?: Record<string, string> },
    idempotencyKey: string,
  ) {
    return this.request(
      'POST',
      `/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(messageId)}/reply`,
      body,
      idempotencyKey,
    );
  }
  /** Adds an address to the organisation's send block list: later sends to it fail with 403. */
  blockSend(entry: string, reason: string) {
    return this.request('POST', '/lists/send/block', { entry, reason });
  }
}
