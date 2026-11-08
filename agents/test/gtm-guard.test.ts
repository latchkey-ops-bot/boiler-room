import { describe, expect, it, vi } from 'vitest';
import { GtmNaive, GuardRefused, type NaiveLike } from '../src/gtm/guard.ts';
import { createPorts, SECRETS, SEND_SECRETS } from '../src/gtm/wiring.ts';
import { fakeTransport } from './gtm-fixtures.ts';

/** A fake Naive with the four GTM agents, br-ceo, a builder, and the three data tools. */
function fakeNaive() {
  const agents = [
    { id: 'agt_lead', name: 'br-gtm-lead' },
    { id: 'agt_scout', name: 'br-scout' },
    { id: 'agt_social', name: 'br-social' },
    { id: 'agt_reader', name: 'br-inbox-reader' },
    { id: 'agt_ceo', name: 'br-ceo' },
    { id: 'agt_eng', name: 'br-engineer-1' },
  ];
  const tools = [
    { id: 'tool_google', name: 'Search Google', domains: ['search'], price: { micro_usd: 150 } },
    {
      id: 'tool_pages',
      name: 'Search Web Pages',
      domains: ['search'],
      price: { micro_usd: 4_000 },
    },
    {
      id: 'tool_emails',
      name: 'Find Domain Emails',
      domains: ['people'],
      price: { micro_usd: 24_500 },
    },
    { id: 'tool_enrich', name: 'Enrich Person', domains: ['people'], price: { micro_usd: 1_000 } },
  ];
  const client = {
    agents: {
      list: vi.fn(async () => ({ data: agents, has_more: false, next_cursor: null })),
      get: vi.fn(async (id: string) => ({
        ...(agents.find((agent) => agent.id === id) ?? { id, name: '?' }),
        metadata: {},
      })),
    },
    sessions: {
      create: vi.fn(async () => ({ id: 'ses_1' })),
      get: vi.fn(),
      events: vi.fn(),
      send: vi.fn(async () => ({})),
      interrupt: vi.fn(),
    },
    board: {
      cards: {
        list: vi.fn(async () => ({
          data: [
            { id: 'crd_eng', title: 'ENG: thing 1/2 task', status: 'todo' },
            { id: 'crd_gtm', title: 'GTM: 2026-11-08', status: 'todo' },
          ],
          has_more: false,
          next_cursor: null,
        })),
        create: vi.fn(async (_board: string, body: Record<string, unknown>) => ({
          id: 'crd_new',
          title: String(body.title),
        })),
        update: vi.fn(async () => ({})),
        comment: vi.fn(async () => ({ id: 'cmt_1' })),
        comments: vi.fn(async () => ({ data: [], has_more: false, next_cursor: null })),
      },
    },
    data: {
      searchTools: vi.fn(async ({ query }: { query: string }) => ({
        data: tools.filter((tool) => tool.name === query),
      })),
      run: vi.fn(async () => ({ status: 'succeeded', data: {}, error: null, cost_micro_usd: 150 })),
    },
    social: {
      createPost: vi.fn(async () => ({ id: 'spo_1', status: 'posted' })),
      deletePost: vi.fn(async () => ({})),
      accounts: vi.fn(async () => ({ data: [] })),
      listPosts: vi.fn(async () => ({ data: [] })),
    },
    files: { import: vi.fn(async () => ({ id: 'fil_1' })) },
  };
  return { client, naive: client as unknown as NaiveLike };
}

describe('the guarded Naive client', () => {
  it('starts sessions for the four GTM agents only', async () => {
    const { client, naive } = fakeNaive();
    const guard = await GtmNaive.connect(naive, { identity: null });
    await expect(
      guard.startSession({ agent_id: 'agt_eng', message: 'push to main' }),
    ).rejects.toBeInstanceOf(GuardRefused);
    await expect(guard.startSession({ agent_id: 'agt_ceo', message: 'hi' })).rejects.toBeInstanceOf(
      GuardRefused,
    );
    expect(client.sessions.create).not.toHaveBeenCalled();
    await expect(
      guard.startSession({ agent_id: 'agt_scout', message: 'EXECUTOR BRIEF' }),
    ).resolves.toBe('ses_1');
    await expect(guard.sendToSession('ses_other', 'x')).rejects.toBeInstanceOf(GuardRefused);
    await guard.sendToSession('ses_1', 'repair');
    expect(client.sessions.send).toHaveBeenCalledWith('ses_1', { message: 'repair' });
  });

  it('writes only unassigned cards with a GTM prefix, and never writes assignee on a move', async () => {
    const { client, naive } = fakeNaive();
    const guard = await GtmNaive.connect(naive, { identity: null });
    await expect(
      guard.createCard({ title: 'ENG: push code 1/1 x', body: '', status: 'todo', key: 'k' }),
    ).rejects.toBeInstanceOf(GuardRefused);
    await expect(
      guard.createCard({ title: 'GTM-HOLD: x', body: '', status: 'todo', key: 'k' }),
    ).rejects.toBeInstanceOf(GuardRefused);
    await guard.createCard({
      title: 'GTM: 2026-11-08',
      body: 'b',
      status: 'todo',
      key: 'gtm-day:2026-11-08',
      assignee: 'br-engineer-1',
    });
    expect(client.board.cards.create).toHaveBeenCalledWith('agt_ceo', {
      title: 'GTM: 2026-11-08',
      body: 'b',
      status: 'todo',
      key: 'gtm-day:2026-11-08',
      assignee: null,
    });
    await guard.moveCard('crd_new', { status: 'done', note: 'report' });
    expect(client.board.cards.update).toHaveBeenCalledWith('agt_ceo', 'crd_new', {
      status: 'done',
      note: 'report',
    });
    await expect(guard.moveCard('crd_eng', { status: 'done' })).rejects.toBeInstanceOf(
      GuardRefused,
    );
    await expect(guard.comment('crd_eng', 'hello')).rejects.toBeInstanceOf(GuardRefused);
    await guard.listCards();
    await expect(guard.comment('crd_gtm', 'LEADS · x · y')).resolves.toEqual({ id: 'cmt_1' });
    await expect(guard.comment('crd_eng', 'hello')).rejects.toBeInstanceOf(GuardRefused);
  });

  it('runs only the three data tools GTM uses, and deletes only posts it made', async () => {
    const { client, naive } = fakeNaive();
    const guard = await GtmNaive.connect(naive, { identity: 'idn_gtm', knownPosts: ['spo_old'] });
    await guard.dataRun('google', { query: { q: 'x' } });
    expect(client.data.run).toHaveBeenCalledWith({ tool_id: 'tool_google', query: { q: 'x' } });
    await expect(guard.deletePost('spo_someone_else')).rejects.toBeInstanceOf(GuardRefused);
    await guard.deletePost('spo_old');
    const post = await guard.post({ content: 'caption', file_ids: ['fil_1'] });
    expect(client.social.createPost).toHaveBeenCalledWith('idn_gtm', {
      content: 'caption',
      platforms: ['x'],
      ai_generated: true,
      file_ids: ['fil_1'],
    });
    await guard.deletePost(post.id);
    expect(client.social.deletePost).toHaveBeenCalledTimes(2);
  });

  it('refuses to connect when two agents share a GTM name', async () => {
    const { client, naive } = fakeNaive();
    const listed = await client.agents.list();
    client.agents.list.mockResolvedValueOnce({
      ...listed,
      data: [...listed.data, { id: 'agt_b', name: 'br-scout' }],
    });
    await expect(GtmNaive.connect(naive, { identity: null })).rejects.toThrow(
      /2 agents are named br-scout/,
    );
  });
});

describe('wiring in dry run', () => {
  it('constructs no live port and never reads the AgentMail key or a sender credential', async () => {
    const { naive } = fakeNaive();
    const read: string[] = [];
    const onLive = vi.fn();
    const ports = await createPorts({
      dryRun: true,
      useBoard: false,
      gtmActive: true,
      secret: (name) => {
        read.push(name);
        return name === SECRETS.executorKey
          ? 'test-key'
          : name === SECRETS.appUrl
            ? 'https://app.example'
            : 'x';
      },
      transport: fakeTransport({}),
      mx: async () => true,
      now: () => '2026-11-08T13:00:00Z',
      appBase: null,
      naiveClient: () => naive,
      fetcher: vi.fn(),
      log: () => {},
      onLive,
    });
    expect(onLive).not.toHaveBeenCalled();
    for (const name of SEND_SECRETS) expect(read).not.toContain(name);
    expect(read).not.toContain(SECRETS.serviceToken);
    expect([
      ports.film.kind,
      ports.social.kind,
      ports.sender.kind,
      ports.app.kind,
      ports.board.kind,
    ]).toEqual(['dry-run', 'dry-run', 'dry-run', 'dry-run', 'local']);
    expect(ports.agents).not.toBeNull();
    expect(ports.blockList).toBeNull();
  });

  it('has no cold sender to build even with --live: the founder has not chosen one', async () => {
    const { naive } = fakeNaive();
    const read: string[] = [];
    const ports = await createPorts({
      dryRun: false,
      useBoard: false,
      gtmActive: true,
      secret: (name) => {
        read.push(name);
        return name === SECRETS.executorKey ? 'test-key' : null;
      },
      transport: fakeTransport({}),
      mx: async () => true,
      now: () => '2026-11-08T13:00:00Z',
      appBase: null,
      naiveClient: () => naive,
      fetcher: vi.fn(),
      log: () => {},
    });
    expect(ports.sender.kind).toBe('dry-run');
    // Outside dry run the AgentMail key is read for the send block list only, never as a sender.
    expect(read).toContain(SECRETS.agentMail);
    expect(ports.blockList).toBeNull();
  });

  it('starts no agent session while GTM is not activated', async () => {
    const { naive } = fakeNaive();
    const ports = await createPorts({
      dryRun: true,
      useBoard: false,
      gtmActive: false,
      secret: (name) => (name === SECRETS.executorKey ? 'test-key' : null),
      transport: fakeTransport({}),
      mx: async () => true,
      now: () => '2026-11-08T13:00:00Z',
      appBase: null,
      naiveClient: () => naive,
      fetcher: vi.fn(),
      log: () => {},
    });
    expect(ports.agents).toBeNull();
    expect(ports.data).not.toBeNull();
  });
});
