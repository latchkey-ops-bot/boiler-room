import { type BoardExposure, boardExposure } from '../company/seats.ts';
import { CEO } from '../definitions/company/common.ts';
import { HASH_KEY } from '../sync.ts';
import {
  CARD_TITLE_PREFIXES,
  DATA_TOOLS,
  type DataToolKey,
  GTM_AGENT_NAMES,
  type GtmAgentName,
} from './config.ts';

/**
 * The executor's only door into Naive. Its key can start any agent (`sessions:write`) and create
 * assigned cards (`agents:write`), so this wrapper narrows it in code:
 *
 * - `startSession` refuses every agent but the four GTM agents, resolved by name at connect time.
 * - `sendToSession` reaches only sessions this process started.
 * - card writes force `assignee: null`, never touch `assignee` on a move, and take only titles that
 *   start `GTM: `, `REMOVE: ` or `FOUNDER: gtm `; comments go only on such cards.
 * - data runs reach only the three tools GTM uses.
 * - posts go only to the GTM identity, and only posts this executor made can be deleted.
 */

export interface NaiveLike {
  agents: {
    list(query: { limit: number; after?: string }): Promise<{
      data: { id: string; name: string }[];
      has_more: boolean;
      next_cursor?: string | null;
    }>;
    get(id: string): Promise<Record<string, unknown> & { id: string; name: string }>;
  };
  sessions: {
    create(body: Record<string, unknown>): Promise<{ id: string }>;
    get(id: string): Promise<{
      id: string;
      status: string;
      stop_reason?: string | null;
      structured_output?: unknown;
      consumed_micro_usd?: number | null;
    }>;
    events(
      id: string,
      query: { after_seq?: number; limit?: number },
    ): Promise<{
      data: { seq: number; type: string; data: Record<string, unknown> }[];
      has_more: boolean;
    }>;
    send(id: string, body: { message: string }): Promise<unknown>;
    interrupt(id: string): Promise<unknown>;
  };
  board: {
    cards: {
      list(
        board: string,
        query?: { limit?: number; after?: string },
      ): Promise<{
        data: { id: string; title: string; status: string }[];
        has_more: boolean;
        next_cursor: string | null;
      }>;
      create(board: string, body: Record<string, unknown>): Promise<{ id: string; title: string }>;
      update(board: string, id: string, body: Record<string, unknown>): Promise<unknown>;
      comment(board: string, id: string, body: { body: string }): Promise<{ id: string }>;
      comments(
        board: string,
        id: string,
        query?: { limit?: number; after?: string },
      ): Promise<{
        data: { id: string; author: string; body: string; created_at: string }[];
        has_more: boolean;
        next_cursor: string | null;
      }>;
    };
  };
  data: {
    searchTools(query: { query: string }): Promise<{ data: { id: string; name: string }[] }>;
    run(body: {
      tool_id: string;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }): Promise<{
      status: string;
      data: unknown;
      error: string | null;
      cost_micro_usd: number;
    }>;
  };
  social: {
    createPost(
      identity: string,
      body: Record<string, unknown>,
    ): Promise<{ id: string; status: string }>;
    deletePost(identity: string, post: string): Promise<unknown>;
    accounts(identity: string): Promise<{ data: { platform: string; username: string | null }[] }>;
    listPosts(
      query: Record<string, unknown>,
    ): Promise<{ data: { id: string; content: string | null; status: string }[] }>;
  };
  files: {
    import(body: { url: string; name?: string; tags?: string[] }): Promise<{ id: string }>;
  };
}

export class GuardRefused extends Error {}

const allowedTitle = (title: string) =>
  CARD_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix));

async function everyAgent(client: NaiveLike) {
  const out: { id: string; name: string }[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await client.agents.list({ limit: 100, ...(after ? { after } : {}) });
    out.push(...result.data);
    if (!result.has_more || !result.next_cursor) break;
    after = result.next_cursor;
  }
  return out;
}

export class GtmNaive {
  readonly client: NaiveLike;
  /** The four GTM agents' ids, by id. Nothing else can be started. */
  readonly agents: ReadonlyMap<string, GtmAgentName>;
  /** br-ceo's id: the company board is addressed by it. */
  readonly boardRef: string;
  private readonly tools: ReadonlyMap<DataToolKey, string>;
  private readonly identity: string | null;
  private readonly sessions = new Set<string>();
  private readonly cards = new Set<string>();
  private readonly posts = new Set<string>();

  constructor(input: {
    client: NaiveLike;
    agents: ReadonlyMap<string, GtmAgentName>;
    boardRef: string;
    tools: ReadonlyMap<DataToolKey, string>;
    identity: string | null;
    knownPosts?: Iterable<string>;
  }) {
    this.client = input.client;
    this.agents = input.agents;
    this.boardRef = input.boardRef;
    this.tools = input.tools;
    this.identity = input.identity;
    for (const post of input.knownPosts ?? []) this.posts.add(post);
  }

  /** Resolves the GTM agents, br-ceo and the data tools by exact name. Two agents with one name fail. */
  static async connect(
    client: NaiveLike,
    options: { identity: string | null; knownPosts?: Iterable<string> },
  ) {
    const all = await everyAgent(client);
    const agents = new Map<string, GtmAgentName>();
    for (const name of GTM_AGENT_NAMES) {
      const matches = all.filter((agent) => agent.name === name);
      if (matches.length !== 1)
        throw new Error(
          `${matches.length} agents are named ${name}; the executor needs exactly one.`,
        );
      agents.set((matches[0] as { id: string }).id, name);
    }
    const ceo = all.filter((agent) => agent.name === CEO);
    if (ceo.length !== 1)
      throw new Error(`${ceo.length} agents are named ${CEO}; the executor needs exactly one.`);
    const tools = new Map<DataToolKey, string>();
    for (const [key, name] of Object.entries(DATA_TOOLS) as [DataToolKey, string][]) {
      const found = (await client.data.searchTools({ query: name })).data.filter(
        (tool) => tool.name === name,
      );
      if (found.length === 1) tools.set(key, (found[0] as { id: string }).id);
    }
    return new GtmNaive({
      client,
      agents,
      boardRef: (ceo[0] as { id: string }).id,
      tools,
      identity: options.identity,
      knownPosts: options.knownPosts,
    });
  }

  /** Whether `company:halt` stopped br-ceo: its stored definition hash reads `halted`. */
  async ceoHalted(): Promise<boolean> {
    const ceo = await this.client.agents.get(this.boardRef);
    const metadata = (ceo.metadata ?? {}) as Record<string, unknown>;
    return metadata[HASH_KEY] === 'halted';
  }

  /** One GTM agent as Naive stores it, for the daily tamper check. */
  async storedAgent(name: GtmAgentName) {
    return this.client.agents.get(this.agentId(name));
  }

  /**
   * The lockdown check `company:verify --lockdown` runs: every agent the company board offers a
   * board tool its definition does not give it. Read-only. Until it is empty, films stay dry run.
   */
  async lockdownExposure(): Promise<BoardExposure[]> {
    const stored = [];
    for (const agent of await everyAgent(this.client)) {
      stored.push(
        (await this.client.agents.get(agent.id)) as unknown as Parameters<
          typeof boardExposure
        >[0][number],
      );
    }
    return boardExposure(stored);
  }

  agentId(name: GtmAgentName): string {
    for (const [id, agent] of this.agents) if (agent === name) return id;
    throw new GuardRefused(`${name} is not resolved`);
  }

  async startSession(body: { agent_id: string } & Record<string, unknown>): Promise<string> {
    if (!this.agents.has(body.agent_id)) {
      throw new GuardRefused(`refused: ${body.agent_id} is not a GTM agent`);
    }
    const session = await this.client.sessions.create(body);
    this.sessions.add(session.id);
    return session.id;
  }

  async sendToSession(id: string, message: string): Promise<void> {
    if (!this.sessions.has(id))
      throw new GuardRefused(`refused: session ${id} was not started by the executor`);
    await this.client.sessions.send(id, { message });
  }

  async createCard(
    input: { title: string; body: string; status: string; key: string } & Record<string, unknown>,
  ) {
    if (!allowedTitle(input.title))
      throw new GuardRefused(`refused: card title "${input.title.slice(0, 40)}" has no GTM prefix`);
    const card = await this.client.board.cards.create(this.boardRef, {
      title: input.title,
      body: input.body,
      status: input.status,
      key: input.key,
      assignee: null,
    });
    this.cards.add(card.id);
    return card;
  }

  /** Moves a GTM card. `assignee` is never written: writing it resets the board's wake. */
  async moveCard(id: string, body: { status: string; note?: string }) {
    if (!this.cards.has(id)) throw new GuardRefused(`refused: card ${id} is not a GTM card`);
    await this.client.board.cards.update(this.boardRef, id, {
      status: body.status,
      ...(body.note ? { note: body.note } : {}),
    });
  }

  async comment(id: string, body: string) {
    if (!this.cards.has(id)) throw new GuardRefused(`refused: card ${id} is not a GTM card`);
    return this.client.board.cards.comment(this.boardRef, id, { body });
  }

  /** Lists the company board's cards. A GTM card it lists may then be written. */
  async listCards() {
    const out: { id: string; title: string; status: string }[] = [];
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await this.client.board.cards.list(this.boardRef, {
        limit: 100,
        ...(after ? { after } : {}),
      });
      out.push(...result.data);
      if (!result.has_more || !result.next_cursor) break;
      after = result.next_cursor;
    }
    for (const card of out) if (allowedTitle(card.title)) this.cards.add(card.id);
    return out;
  }

  async comments(id: string) {
    if (!this.cards.has(id)) throw new GuardRefused(`refused: card ${id} is not a GTM card`);
    const result = await this.client.board.cards.comments(this.boardRef, id, { limit: 100 });
    return result.data;
  }

  async dataRun(
    tool: DataToolKey,
    input: { query?: Record<string, unknown>; body?: Record<string, unknown> },
  ) {
    const id = this.tools.get(tool);
    if (!id) throw new GuardRefused(`refused: data tool ${DATA_TOOLS[tool]} is not resolved`);
    return this.client.data.run({ tool_id: id, ...input });
  }

  async post(body: { content: string; file_ids?: string[]; media_urls?: string[] }) {
    if (!this.identity) throw new GuardRefused('refused: no GTM identity is configured');
    const post = await this.client.social.createPost(this.identity, {
      content: body.content,
      platforms: ['x'],
      ai_generated: true,
      ...(body.file_ids ? { file_ids: body.file_ids } : {}),
      ...(body.media_urls ? { media_urls: body.media_urls } : {}),
    });
    this.posts.add(post.id);
    return post;
  }

  async deletePost(id: string) {
    if (!this.identity) throw new GuardRefused('refused: no GTM identity is configured');
    if (!this.posts.has(id))
      throw new GuardRefused(`refused: post ${id} was not made by the executor`);
    await this.client.social.deletePost(this.identity, id);
  }

  async xAccounts() {
    if (!this.identity) return [];
    return (await this.client.social.accounts(this.identity)).data.filter(
      (account) => account.platform === 'x',
    );
  }

  async importFile(url: string, name: string) {
    return this.client.files.import({ url, name, tags: ['gtm'] });
  }
}
