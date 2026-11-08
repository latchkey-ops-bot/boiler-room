import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GTM } from '../src/definitions/company/index.ts';
import { definitionDrift } from '../src/gtm/cards.ts';
import { EMAIL_FORCED_DRY_RUN } from '../src/gtm/config.ts';
import { buildCaption, templatesHash } from '../src/gtm/copy.ts';
import { runDay } from '../src/gtm/day.ts';
import { singleAddress, stableId } from '../src/gtm/domain.ts';
import { brandFlags, isRoleAddressOn, productName, usEvidence } from '../src/gtm/extract.ts';
import { GuardRefused, type NaiveLike, resolveDataTool } from '../src/gtm/guard.ts';
import { parseHtml } from '../src/gtm/html.ts';
import {
  type AppRequest,
  type DataRuns,
  DryRunFilmOrder,
  DryRunGtmApp,
  DryRunSocial,
  type EmailSender,
  type FilmOrder,
  type FilmOrderStatus,
  LocalBoard,
  PostRefused,
  type SenderEvent,
  type SocialPoster,
} from '../src/gtm/ports.ts';
import { postsWeMade } from '../src/gtm/removal.ts';
import { readSite } from '../src/gtm/site.ts';
import { productHunt } from '../src/gtm/sources.ts';
import { emptyStore, type LeadRow, type StoreData } from '../src/gtm/store.ts';
import type { Ports } from '../src/gtm/wiring.ts';
import { createPorts, SECRETS } from '../src/gtm/wiring.ts';
import type { Naive } from '../src/naive/client.ts';
import { agentConfig, HASH_KEY, syncAgents } from '../src/sync.ts';
import {
  DATE,
  fakeTransport,
  LINE,
  leadPicksEmail,
  NOW,
  QUILLBOX,
  QUILLBOX_LEAD,
  quillboxRoutes,
  ScriptedRunner,
  scoutQualifies,
} from './gtm-fixtures.ts';

/**
 * The red-team findings of 2026-11-07, one test each, against live-shaped fakes: ports whose `kind`
 * says live, that record every call and touch no network. Nothing here reads a secret.
 */

const NEXT = '2026-11-09';
const POSTAL = '548 Market St, San Francisco, CA 94104';

/** Every flag and ruling an activated GTM would have. Preconditions in code still decide. */
function liveStore(): StoreData {
  const store = emptyStore();
  Object.assign(store.flags, {
    mode: 'live',
    film_lane: 'live',
    x_lane: 'standalone',
    email_lane: 'live',
    postal_address: POSTAL,
    app_base: 'https://app.example',
    founder_user_id: 'usr_founder',
  });
  store.flags.rulings = {
    x_policy_accepted: true,
    x_bio_set: true,
    x_templates_approved: templatesHash(),
    bundle_tier_known: true,
    x_canary_done: true,
    email_jurisdiction_accepted: true,
    email_canary_done: true,
    optout_routes_verified: true,
    film_canary_cost_reported: true,
  };
  return store;
}

function liveFilm() {
  const orders: string[] = [];
  const withdrawn: string[] = [];
  const port: FilmOrder = {
    kind: 'app',
    async order(input) {
      orders.push(input.url);
      return { orderId: `fo_${orders.length}` };
    },
    async status(orderId): Promise<FilmOrderStatus> {
      return {
        orderId,
        state: 'ready',
        stage: 'delivered',
        qc: 'pass',
        simulated: false,
        costMicroUsd: 400_000,
        failure: null,
        script: 'A short film.',
      };
    },
    async share(orderId) {
      return { pageUrl: `https://app.example/f/sh${orderId}`, shareId: `sh${orderId}` };
    },
    async decisions(orderId) {
      return { orderId, simulated: false, decisions: [] };
    },
    async file(orderId) {
      return {
        url: `https://app.example/file/${orderId}.mp4`,
        expiresAt: '2026-11-08T14:00:00Z',
        contentType: 'video/mp4',
        bytes: 1000,
        durationSeconds: 25,
        sha256: 'x',
      };
    },
    async withdraw(orderId) {
      withdrawn.push(orderId);
    },
  };
  return { port, orders, withdrawn };
}

function liveSender(options: { events?: SenderEvent[][]; lostAnswer?: boolean } = {}) {
  const sent: { to: string; subject: string }[] = [];
  const queue = [...(options.events ?? [])];
  const port: EmailSender = {
    kind: 'mailbox',
    account: 'acct_1',
    from: 'Boiler Room <hello@send.example>',
    replyTo: 'outreach@send.example',
    capabilities: { bounceEvents: true, customHeaders: true },
    async send(input) {
      sent.push({ to: input.to, subject: input.subject });
      // The provider takes the email, and its answer never reaches us.
      if (options.lostAnswer) throw new Error('socket hang up after DATA');
      return { messageId: `msg_${sent.length}` };
    },
    async events(after) {
      const events = queue.shift() ?? [];
      return { events, cursor: events.length ? `ev_${events.length}` : after };
    },
  };
  return { port, sent };
}

function liveSocial(options: { failRemove?: number } = {}) {
  const posts: string[] = [];
  const removed: string[] = [];
  let failures = options.failRemove ?? 0;
  const port: SocialPoster = {
    kind: 'naive',
    async ready() {
      return { ok: true, reason: null };
    },
    async post(input) {
      posts.push(input.caption);
      return { postId: `post_${posts.length}` };
    },
    async find() {
      return null;
    },
    async remove(id) {
      if (failures > 0) {
        failures -= 1;
        throw new Error('bundle.social answered 503');
      }
      removed.push(id);
    },
  };
  return { port, posts, removed };
}

/** A board people can read: the company board, here an in-memory one of kind `naive`. */
function companyBoard(at: () => string): LocalBoard {
  return Object.assign(new LocalBoard(at), { kind: 'naive' }) as unknown as LocalBoard;
}

/** A Naive stand-in that passes the halt marker, the lockdown check and the tamper check. */
const passingNaive = () =>
  ({
    ceoHalted: async () => false,
    lockdownExposure: async () => [],
    storedAgent: async (name: string) =>
      GTM.find((definition) => definition.name === name) as unknown as Record<string, unknown>,
  }) as unknown as Ports['naive'];

interface Clock {
  t: number;
  now(): Date;
}
const clockAt = (iso: string): Clock => ({
  t: Date.parse(iso),
  now() {
    return new Date(this.t);
  },
});

function livePorts(clock: Clock, overrides: Partial<Ports> = {}) {
  const film = liveFilm();
  const sender = liveSender();
  const social = liveSocial();
  const ports: Ports = {
    naive: passingNaive(),
    agents: null,
    data: null,
    board: companyBoard(() => clock.now().toISOString()),
    film: film.port,
    social: social.port,
    sender: sender.port,
    app: new DryRunGtmApp(),
    replyInbox: { account: 'acct_1' },
    blockList: null,
    transport: fakeTransport(quillboxRoutes()),
    mx: async (domain) => domain !== '',
    appBase: 'https://app.example',
    ...overrides,
  };
  return { ports, film, sender, social };
}

async function day(
  store: StoreData,
  ports: Ports,
  clock: Clock,
  options: {
    date?: string;
    forcedDryRun?: boolean;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const files = new Map<string, string>();
  const logs: string[] = [];
  const slept: number[] = [];
  const result = await runDay({
    store,
    ports,
    clock,
    date: options.date ?? DATE,
    forcedDryRun: options.forcedDryRun ?? false,
    gtmActive: true,
    // These tests prove the email lane's own machinery, which EMAIL_FORCED_DRY_RUN keeps off on
    // every real run (gtm-pack.test.ts proves that).
    emailForcedDryRun: false,
    save: () => {},
    writeFile: (name, content) => files.set(name, content),
    log: (line) => logs.push(line),
    sleep:
      options.sleep ??
      (async (ms) => {
        slept.push(ms);
        clock.t += ms;
      }),
  });
  return { result, files, logs, slept, board: files.get('board.md') ?? '' };
}

/** A lead found yesterday, with a sent X post and a sent film: what an earlier live run left. */
function storeWithLiveAssets(): { store: StoreData; lead: string } {
  const store = liveStore();
  const lead = stableId('ld', `${QUILLBOX}|2026-11-07`);
  const row: LeadRow = {
    id: lead,
    date: '2026-11-07',
    domain: QUILLBOX,
    site_url: `https://${QUILLBOX}/`,
    source: 'hn',
    source_url: 'https://news.ycombinator.com/item?id=1',
    source_at: '2026-11-07T18:00:00Z',
    hn_points: 41,
    x_post: null,
    product_name: 'Quillbox',
    addresses: [],
    email_closed: null,
    jurisdiction_hint: 'unknown',
    brand_flags: [],
    verdict: null,
    picked: ['x'],
    found_at: '2026-11-07T13:00:00Z',
  };
  store.leads.push(row);
  const sent = (key: string, kind: 'x-post' | 'film', provider: string) =>
    store.actions.push({
      key,
      kind,
      lead_id: lead,
      status: 'sent',
      provider_id: provider,
      cost_micro_usd: 0,
      detail: `lead ${lead}`,
      created_at: '2026-11-07T18:30:00Z',
      executed_at: '2026-11-07T18:30:00Z',
      planned_ticks: 0,
    });
  sent('x-post:2026-11-07', 'x-post', 'post_abc123');
  sent(`film:${QUILLBOX}:2026-11-07`, 'film', 'fo_old');
  return { store, lead };
}

const removalRequest = (): AppRequest => ({
  id: 'req_1',
  kind: 'removal',
  channel: 'remove_form',
  token_hash: null,
  domain: QUILLBOX,
  share_id: null,
  at: NOW.toISOString(),
});

/** A fake Naive client as `GtmNaive.connect` sees it, recording every post it deletes. */
function naiveClient(options: { failDelete?: boolean } = {}) {
  const deleted: string[] = [];
  const agents = [
    ...GTM.map((definition, index) => ({ id: `agt_${index}`, name: definition.name })),
    { id: 'agt_ceo', name: 'br-ceo' },
  ];
  const client = {
    agents: {
      list: async () => ({ data: agents, has_more: false, next_cursor: null }),
      get: async (id: string) => ({ id, name: agents.find((a) => a.id === id)?.name ?? '?' }),
    },
    sessions: {},
    board: { cards: {} },
    data: { searchTools: async () => ({ data: [] }), run: async () => ({}) },
    social: {
      createPost: async () => ({ id: 'post_new', status: 'scheduled' }),
      deletePost: async (_identity: string, post: string) => {
        if (options.failDelete) throw new Error('bundle.social answered 503');
        deleted.push(post);
      },
      accounts: async () => ({ data: [{ platform: 'x', username: 'boilerroom' }] }),
      listPosts: async () => ({ data: [] }),
    },
    files: { import: async () => ({ id: 'fil_1' }) },
  };
  return { client: client as unknown as NaiveLike, deleted };
}

/** The live ports `gtm:day --live` builds, over the fake client, from the store as the CLI loads it. */
async function cliPorts(store: StoreData, client: NaiveLike) {
  const ports = await createPorts({
    dryRun: false,
    useBoard: false,
    gtmActive: true,
    secret: (name) =>
      name === SECRETS.executorKey ? 'test-key' : name === SECRETS.identity ? 'idn_gtm' : null,
    transport: fakeTransport({}),
    mx: async () => true,
    now: () => NOW.toISOString(),
    appBase: 'https://app.example',
    naiveClient: () => client,
    fetcher: vi.fn(),
    knownPosts: postsWeMade(store),
    log: () => {},
  });
  // No sessions or data runs in this test: the day is about removals.
  return { ...ports, agents: null, data: null, app: new DryRunGtmApp([removalRequest()]) };
}

describe('removals, after a restart and in dry run', () => {
  it('deletes a post an earlier process made, because the CLI hands the guard its known posts', async () => {
    const { store } = storeWithLiveAssets();
    const { client, deleted } = naiveClient();
    const ports = await cliPorts(store, client);
    expect(ports.social.kind).toBe('naive');
    const { board } = await day(store, ports, clockAt(NOW.toISOString()), { forcedDryRun: true });
    expect(deleted).toEqual(['post_abc123']);
    expect(store.actions.some((row) => row.key === 'x-delete:post_abc123')).toBe(true);
    // The film port is a dry run here (no app URL), so the film is still up and the request waits.
    expect(store.pending_removals.map((item) => item.key)).toEqual(['app:req_1']);
    expect(board).toMatch(/REMOVAL · rm-[a-z0-9]+ · pending/);
    expect(board).toContain('1 of 1 post(s) deleted, 0 of 1 film(s) withdrawn');
  });

  it('keeps a request whose delete fails, asks a person, and finishes it on the next run', async () => {
    const { store } = storeWithLiveAssets();
    store.actions = store.actions.filter((row) => row.kind !== 'film');
    const failing = naiveClient({ failDelete: true });
    const first = await day(
      store,
      await cliPorts(store, failing.client),
      clockAt(NOW.toISOString()),
      {
        forcedDryRun: true,
      },
    );
    expect(failing.deleted).toEqual([]);
    expect(first.result.needs).toContain('removal');
    expect(store.pending_removals).toHaveLength(1);
    expect(store.flags.cursors.requests).toBe('req_1');
    expect(first.board).toContain('0 of 1 post(s) deleted');
    expect(first.board).not.toMatch(/REMOVE: rm-/);

    const working = naiveClient();
    const second = await day(
      store,
      await cliPorts(store, working.client),
      clockAt(NOW.toISOString()),
      {
        forcedDryRun: true,
      },
    );
    expect(working.deleted).toEqual(['post_abc123']);
    expect(store.pending_removals).toEqual([]);
    expect(second.board).toMatch(/REMOVE: rm-[a-z0-9]+ \(todo\)/);
    expect(second.board).toMatch(/REMOVAL · rm-[a-z0-9]+ · done/);
  });

  it('does not use up a REMOVE command on a dry-run day: the next live run takes the post and film down', async () => {
    const { store, lead } = storeWithLiveAssets();
    const clock = clockAt(NOW.toISOString());
    const command = [
      {
        id: 'cmt_remove',
        author: 'usr_someone',
        body: `REMOVE ${lead}`,
        created_at: NOW.toISOString(),
      },
    ];
    const dry = new LocalBoard(() => clock.now().toISOString());
    vi.spyOn(dry, 'comments').mockResolvedValue(command);
    const dryPorts = livePorts(clock, {
      board: dry,
      social: new DryRunSocial(),
      film: new DryRunFilmOrder('https://app.example'),
    }).ports;
    const first = await day(store, dryPorts, clock, { forcedDryRun: true });
    expect(first.result.needs).toContain('removal');
    expect(store.pending_removals.map((item) => item.key)).toEqual(['removal:cmt_remove']);

    const live = livePorts(clock);
    vi.spyOn(live.ports.board, 'comments').mockResolvedValue(command);
    await day(store, live.ports, clock, { date: DATE, forcedDryRun: false });
    expect(live.social.removed).toEqual(['post_abc123']);
    expect(live.film.withdrawn).toEqual(['fo_old']);
    expect(store.pending_removals).toEqual([]);
  });
});

describe('the email lane after a complaint', () => {
  const lead = () =>
    new ScriptedRunner({ 'br-scout': [scoutQualifies()], 'br-gtm-lead': [leadPicksEmail()] });
  const resume = (at: string) => [
    { id: 'cmt_founder', author: 'usr_founder', body: 'RESUME email', created_at: at },
  ];

  it('stops again on a complaint that arrives after RESUME email', async () => {
    const store = liveStore();
    store.flags.email_paused = { at: '2026-11-07T20:00:00Z', reason: 'a complaint' };
    const clock = clockAt(NOW.toISOString());
    const sender = liveSender({
      events: [
        [],
        [
          {
            kind: 'complaint',
            to: 'hello@other.example',
            at: '2026-11-08T13:00:00Z',
            messageId: 'm1',
          },
        ],
      ],
    });
    const { ports } = livePorts(clock, { sender: sender.port, agents: lead() });
    vi.spyOn(ports.board, 'comments').mockResolvedValue(resume('2026-11-08T12:59:00Z'));
    const { result } = await day(store, ports, clock);
    expect(sender.sent).toEqual([]);
    expect(store.flags.email_paused?.reason).toBe('a complaint');
    expect(result.needs).toContain('email-paused');
  });

  it('is not resumed by a RESUME written before the first complaint', async () => {
    const store = liveStore();
    const clock = clockAt(NOW.toISOString());
    const sender = liveSender({
      events: [
        [],
        [
          {
            kind: 'complaint',
            to: 'hello@other.example',
            at: '2026-11-08T13:00:00Z',
            messageId: 'm2',
          },
        ],
      ],
    });
    const { ports } = livePorts(clock, { sender: sender.port, agents: lead() });
    vi.spyOn(ports.board, 'comments').mockResolvedValue(resume('2026-11-08T08:00:00Z'));
    await day(store, ports, clock);
    expect(sender.sent).toEqual([]);
  });

  it('moves a standing pause to the newest complaint, so an older RESUME cannot lift it', async () => {
    const store = liveStore();
    store.flags.email_paused = { at: '2026-11-07T20:00:00Z', reason: 'a complaint' };
    const clock = clockAt(NOW.toISOString());
    const sender = liveSender({
      events: [
        [
          {
            kind: 'complaint',
            to: 'hello@other.example',
            at: '2026-11-08T13:00:00Z',
            messageId: 'm3',
          },
        ],
        [],
      ],
    });
    const { ports } = livePorts(clock, { sender: sender.port, agents: lead() });
    // The first read of the day card fails, so the pause stands when the complaint comes in.
    vi.spyOn(ports.board, 'comments')
      .mockRejectedValueOnce(new Error('board unreadable'))
      .mockResolvedValue(resume('2026-11-08T12:59:00Z'));
    await day(store, ports, clock);
    expect(sender.sent).toEqual([]);
    expect(store.flags.email_paused?.at).toBe(NOW.toISOString());
  });

  it('resumes on a RESUME written after the pause, and stays resumed', async () => {
    const store = liveStore();
    store.flags.email_paused = { at: '2026-11-07T20:00:00Z', reason: 'a complaint' };
    const clock = clockAt(NOW.toISOString());
    const sender = liveSender({ events: [[], []] });
    const { ports } = livePorts(clock, { sender: sender.port, agents: lead() });
    vi.spyOn(ports.board, 'comments').mockResolvedValue(resume('2026-11-08T12:59:00Z'));
    await day(store, ports, clock);
    expect(sender.sent.map((item) => item.to)).toEqual(['hello@quillbox.example']);
    expect(store.flags.email_paused).toBeNull();
  });
});

/** A second fictional startup, Brightjar, on Show HN the same day as Quillbox. */
const BRIGHT = 'brightjar.example';
const BRIGHT_LINE = 'Recipes that scale themselves for any crowd.';
function twoSiteRoutes(options: { contact?: boolean } = {}) {
  const routes = quillboxRoutes([
    {
      url: `https://${BRIGHT}/`,
      title: 'Show HN: Brightjar – recipes that scale',
      points: 30,
      created_at: '2026-11-07T19:00:00Z',
      id: '50400002',
    },
  ]);
  routes[`https://${BRIGHT}/`] = {
    body: `<!doctype html><html><head><title>Brightjar – recipes</title><meta property="og:site_name" content="Brightjar"></head>
<body><h1>Brightjar</h1><main><p>${BRIGHT_LINE}</p><p>Cook for two or for twenty, and every amount changes at once on every phone in the kitchen.</p></main></body></html>`,
  };
  routes[`https://${BRIGHT}/contact`] = {
    body: `<html><head><title>Contact</title></head><body><h1>Contact</h1>${options.contact === false ? '<p>Use the form below and we will answer within a day or so.</p>' : `<p>Write to <a href="mailto:hello@${BRIGHT}">us</a>.</p>`}</body></html>`,
  };
  routes[`https://${BRIGHT}/terms`] = {
    body: '<html><head><title>Terms</title></head><body><h1>Terms</h1><p>These terms are between you and Brightjar, Inc., a Delaware corporation.</p></body></html>',
  };
  return routes;
}
const brightLead = (date: string) => stableId('ld', `${BRIGHT}|${date}`);
const brightQualifies = (candidate = 'c01') =>
  scoutQualifies({
    candidate_id: candidate,
    line: { page: 'p1', quote: BRIGHT_LINE },
    jurisdiction_quote: { page: 'p3', quote: 'Brightjar, Inc., a Delaware corporation' },
  });
const brightPicksEmail = (date: string) => ({
  x_pick: null,
  email_picks: [
    {
      lead_id: brightLead(date),
      why: 'Clear promise.',
      subject: 'A launch film for Brightjar',
      opener: `Your homepage line "${BRIGHT_LINE}" caught our eye.`,
    },
  ],
  passed_over: [],
});

describe('caps count the real day, not the --date label', () => {
  it('runs a second label on the same real day as a dry-run replay', async () => {
    const store = liveStore();
    const clock = clockAt(NOW.toISOString());
    const runner = new ScriptedRunner({
      'br-scout': [scoutQualifies(), brightQualifies()],
      'br-gtm-lead': [leadPicksEmail(), brightPicksEmail(NEXT)],
    });
    const { ports, sender, film } = livePorts(clock, {
      agents: runner,
      transport: fakeTransport(twoSiteRoutes()),
    });
    await day(store, ports, clock, { date: DATE });
    expect(sender.sent).toHaveLength(1);
    const ordered = film.orders.length;

    const second = await day(store, ports, clock, { date: NEXT });
    expect(second.result.lanes).toMatchObject({ film: 'dry_run', x: 'dry_run', email: 'dry_run' });
    expect(second.result.lanes.reasons.email).toContain(
      `the run is for ${NEXT}, not today: a replay is dry run`,
    );
    expect(
      store.leads.some((row) => row.id === brightLead(NEXT) && row.picked.includes('email')),
    ).toBe(true);
    expect(sender.sent).toHaveLength(1);
    expect(film.orders).toHaveLength(ordered);
    // Spend is booked on the real day whatever the label.
    expect(new Set(store.spend.map((row) => row.date))).toEqual(new Set([DATE]));
  });
});

describe('a live lane needs the company board and the hold window', () => {
  const runner = () =>
    new ScriptedRunner({ 'br-scout': [scoutQualifies()], 'br-gtm-lead': [leadPicksEmail()] });

  it('stays dry run with a local day card, which nobody can comment HOLD on', async () => {
    const store = liveStore();
    const clock = clockAt(NOW.toISOString());
    const { ports, sender } = livePorts(clock, {
      agents: runner(),
      board: new LocalBoard(() => clock.now().toISOString()),
    });
    const { result } = await day(store, ports, clock);
    expect(result.lanes.email).toBe('dry_run');
    expect(result.lanes.reasons.email.join('; ')).toMatch(/local file: nobody sees the drafts/);
    expect(sender.sent).toEqual([]);
  });

  it('waits the hold window after compose, and a HOLD written in it stops the send', async () => {
    const store = liveStore();
    const clock = clockAt(NOW.toISOString());
    const { ports, sender } = livePorts(clock, { agents: runner() });
    const board = ports.board as LocalBoard;
    const slept: number[] = [];
    const { board: text, result } = await day(store, ports, clock, {
      sleep: async (ms) => {
        slept.push(ms);
        clock.t += ms;
        const card = [...board.cards.values()].find((item) => item.title === `GTM: ${DATE}`);
        if (card) await board.comment(card.id, 'HOLD');
      },
    });
    expect(slept).toEqual([45 * 60_000]);
    expect(text).toContain('Goes out after 05:45 Pacific unless someone comments HOLD');
    expect(sender.sent).toEqual([]);
    expect(store.actions.find((row) => row.kind === 'email')?.status).not.toBe('sent');
    expect(result.lanes.reasons.email).toContain('a HOLD is open');
  });

  it('sends only after the window, when nobody holds', async () => {
    const store = liveStore();
    const clock = clockAt(NOW.toISOString());
    const { ports, sender } = livePorts(clock, { agents: runner() });
    await day(store, ports, clock);
    expect(sender.sent).toHaveLength(1);
    const composed = store.phases.find((row) => row.phase === 'compose');
    const email = store.actions.find((row) => row.kind === 'email');
    expect(
      Date.parse(email?.executed_at ?? '') - Date.parse(composed?.finished_at ?? ''),
    ).toBeGreaterThanOrEqual(45 * 60_000);
  });
});

describe('a send whose answer was lost', () => {
  it('counts as contacted at once, reads "unknown" on the board, and asks a person two runs later', async () => {
    const store = liveStore();
    const clock = clockAt(NOW.toISOString());
    const sender = liveSender({ lostAnswer: true });
    const { ports } = livePorts(clock, {
      sender: sender.port,
      agents: new ScriptedRunner({
        'br-scout': [scoutQualifies()],
        'br-gtm-lead': [leadPicksEmail()],
      }),
    });
    const first = await day(store, ports, clock);
    expect(first.board).toContain(`EMAIL · ${QUILLBOX_LEAD} · unknown`);
    expect(first.board).not.toMatch(/Not sent: \./);
    expect(store.contacts.filter((row) => row.channel === 'email')).toHaveLength(1);
    await day(store, ports, clock);
    const next = clockAt('2026-11-09T13:00:00Z');
    const third = await day(
      store,
      { ...ports, board: companyBoard(() => next.now().toISOString()) },
      next,
      {
        date: NEXT,
      },
    );
    expect(sender.sent).toHaveLength(1);
    expect(store.actions.find((row) => row.kind === 'email')?.status).toBe('unknown');
    expect(third.result.needs).toContain('unknown-send');
  });
});

describe('the claims screen on every lane', () => {
  const home = (title: string, siteName: string, h1: string) => {
    const parsed = parseHtml(
      `<html><head><title>${title}</title><meta property="og:site_name" content="${siteName}"></head><body><h1>${h1}</h1></body></html>`,
      'https://x.example/',
    );
    return { id: 'p1', parsed } as unknown as Parameters<typeof productName>[0];
  };

  it('accepts no product name that makes a superlative or a company claim', () => {
    expect(
      productName(home('Best Stripe Partner', 'Best Stripe Partner', 'Best Stripe Partner'), null),
    ).toBeNull();
    expect(productName(home('Quillbox – lists', 'Quillbox', 'Quillbox'), 'Quillbox')).toBe(
      'Quillbox',
    );
  });

  it('refuses an X caption whose quote claims backers or customers, as an email opener would', () => {
    const lead = {
      id: QUILLBOX_LEAD,
      product_name: 'Quillbox',
      source: 'hn' as const,
      source_at: '2026-11-07T18:00:00Z',
    };
    const quote = {
      ref: 'q1',
      page: 'p1',
      url: 'https://quillbox.example/',
      path: '/',
      quote: 'Backed by Y Combinator and trusted by teams at Stripe.',
    };
    const refused = buildCaption({ lead, template_id: 't1', quote, history: [], now: NOW });
    expect(refused).toMatchObject({
      ok: false,
      problems: expect.arrayContaining(['company_claim:backed', 'company_claim:y combinator']),
    });
    const own = { ...quote, quote: 'The fastest way to share a shopping list.' };
    expect(buildCaption({ lead, template_id: 't1', quote: own, history: [], now: NOW }).ok).toBe(
      true,
    );
    const named = { ...lead, product_name: 'Best Stripe Partner' };
    expect(
      buildCaption({ lead: named, template_id: 't2', quote: null, history: [], now: NOW }),
    ).toMatchObject({
      ok: false,
      problems: expect.arrayContaining(['superlative:best', 'company_claim:partner']),
    });
  });
});

describe('a mailto that is not one address', () => {
  const crafted = [
    'mailto:hello@victim.com%3F,hello@quillbox.example',
    'mailto:hello@victim.com%3Fx@quillbox.example',
    'mailto:hello@victim.com,hello@quillbox.example',
    'mailto:hello%ZZ@quillbox.example',
  ];

  it('is no address: parsing keeps each recipient, and only exactly one address on the domain counts', async () => {
    for (const href of crafted) {
      const parsed = parseHtml(`<a href="${href}">mail</a>`, 'https://quillbox.example/');
      const accepted = parsed.mailto.filter((value) => isRoleAddressOn(value, QUILLBOX));
      // Whatever survives is exactly the lead's own role address, never a string holding another.
      for (const value of accepted) expect(value).toBe('hello@quillbox.example');
      for (const value of parsed.mailto) {
        if (value.includes('victim.com'))
          expect(singleAddress(value)?.endsWith('@victim.com') ?? true).toBe(true);
      }
    }
    expect(singleAddress('hello@victim.com?,hello@quillbox.example')).toBeNull();
    expect(isRoleAddressOn('hello@victim.com?x@quillbox.example', QUILLBOX)).toBe(false);
    expect(singleAddress(' Hello@Quillbox.example ')).toBe('hello@quillbox.example');
  });

  it('is never sent to, even from a stored lead: execute checks the recipient again', async () => {
    const routes = quillboxRoutes();
    routes[`https://${QUILLBOX}/contact`] = {
      body: '<html><head><title>Contact</title></head><body><h1>Contact</h1><p>Write to <a href="mailto:hello@victim.com%3F,hello@quillbox.example">us</a>.</p></body></html>',
    };
    const site = await readSite(`https://${QUILLBOX}/`, fakeTransport(routes), 'test', NOW);
    const { publishedAddresses } = await import('../src/gtm/extract.ts');
    expect(publishedAddresses(site, QUILLBOX).map((item) => item.address)).toEqual([
      'hello@quillbox.example',
    ]);
    // A lead stored by an older build with the crafted value: compose and execute both refuse it.
    const store = liveStore();
    const clock = clockAt(NOW.toISOString());
    const runner = new ScriptedRunner({
      'br-scout': [scoutQualifies()],
      'br-gtm-lead': [leadPicksEmail()],
    });
    const start = runner.start.bind(runner);
    runner.start = async (input) => {
      for (const lead of store.leads)
        lead.addresses = [
          {
            address: 'hello@victim.com?,hello@quillbox.example',
            source_url: `https://${QUILLBOX}/contact`,
            page_label: 'contact page',
            provenance: 'site',
          },
        ];
      return start(input);
    };
    const mx = vi.fn(async () => true);
    const { ports, sender } = livePorts(clock, { agents: runner, mx });
    await day(store, ports, clock);
    expect(sender.sent).toEqual([]);
    expect(mx).not.toHaveBeenCalled();
    expect(store.actions.find((row) => row.kind === 'email')?.detail).toMatch(/bad_recipient/);
  });
});

describe('the data tools and their notes', () => {
  const catalogue = [
    { id: 'tool_seo', name: 'Search Google', domains: ['seo'], price: { micro_usd: 8_000 } },
    { id: 'tool_gs', name: 'Google Search', domains: ['search'], price: { micro_usd: 2_000 } },
    { id: 'tool_google', name: 'Search Google', domains: ['search'], price: { micro_usd: 150 } },
  ];

  it('resolves Search Google when the catalogue holds two tools of that name', async () => {
    const client = {
      data: {
        searchTools: vi.fn(async ({ query }: { query: string }) => ({
          data: query === 'Search Google' ? catalogue : [],
        })),
      },
    } as unknown as NaiveLike;
    await expect(resolveDataTool(client, 'google')).resolves.toEqual({
      id: 'tool_google',
      reason: 'resolved',
    });
    const onlySeo = {
      data: { searchTools: async () => ({ data: [catalogue[0]] }) },
    } as unknown as NaiveLike;
    await expect(resolveDataTool(onlySeo, 'google')).resolves.toMatchObject({
      id: null,
      reason: expect.stringMatching(/1 tool\(s\) named Search Google, 0 in search/),
    });
  });

  it('finds a tool one search ranks out, through the next query', async () => {
    const client = {
      data: {
        searchTools: vi.fn(async ({ query }: { query: string }) => ({
          data: query === 'google search results' ? catalogue : [catalogue[1]],
        })),
      },
    } as unknown as NaiveLike;
    await expect(resolveDataTool(client, 'google')).resolves.toMatchObject({ id: 'tool_google' });
  });

  it('notes a refused tool as refused, not as a cap', async () => {
    const feed = `<?xml version="1.0"?><feed><entry><title>Quillbox</title><published>2026-11-08T08:00:00Z</published><link rel="alternate" type="text/html" href="https://www.producthunt.com/products/quillbox"/><content type="html">&lt;p&gt;Shared lists that work offline&lt;/p&gt;</content></entry></feed>`;
    const transport = fakeTransport({
      'https://www.producthunt.com/feed': {
        body: feed,
        headers: { 'content-type': 'application/atom+xml' },
      },
    });
    const result = await productHunt(transport, 'test', NOW, async () => ({
      ok: false,
      reason: 'refused',
      detail:
        'refused: data tool Search Google is not resolved (no tool named Search Google found)',
    }));
    expect(result.report.note).toMatch(/^data run refused: refused: data tool Search Google/);
    expect(result.report.note).not.toMatch(/cap/);
  });

  it('says so in the day when the guard refuses a data run', async () => {
    const store = emptyStore();
    const clock = clockAt(NOW.toISOString());
    const data: DataRuns = {
      run: async () => {
        throw new GuardRefused('refused: data tool Search Google is not resolved (none found)');
      },
    };
    const routes = quillboxRoutes();
    routes['https://www.producthunt.com/feed'] = {
      body: `<feed><entry><title>Quillbox</title><published>2026-11-08T08:00:00Z</published><link rel="alternate" href="https://www.producthunt.com/p/q"/><content>Shared lists</content></entry></feed>`,
      headers: { 'content-type': 'application/atom+xml' },
    };
    const { ports } = livePorts(clock, { data, transport: fakeTransport(routes) });
    const { logs } = await day(store, ports, clock, { forcedDryRun: true });
    expect(logs.find((line) => line.startsWith('discover  ph:'))).toMatch(/data run refused/);
    expect(logs.join('\n')).not.toMatch(/data-run cap reached/);
  });
});

describe('the address finder runs after the scout', () => {
  it('spends a finder run only on a qualified lead with no published address', async () => {
    const routes = twoSiteRoutes({ contact: false });
    routes[`https://${QUILLBOX}/contact`] = {
      body: '<html><head><title>Contact</title></head><body><h1>Contact</h1><p>Use the form below and we will answer within a day or so.</p></body></html>',
    };
    const finder: string[] = [];
    const order: string[] = [];
    const data: DataRuns = {
      run: async (tool, input) => {
        if (tool !== 'domainEmails')
          return { data: { organic_results: [], results: [] }, costMicroUsd: 150 };
        const domain = String(input.body?.domain);
        finder.push(domain);
        order.push(`finder ${domain}`);
        return {
          data: {
            data: {
              emails: [
                {
                  value: `hello@${domain}`,
                  provenance: 'found',
                  source_type: 'found',
                  sources: [{ uri: `https://${domain}/about` }],
                },
              ],
            },
          },
          costMicroUsd: 24_500,
        };
      },
    };
    const rejectQuillbox = {
      verdicts: [
        {
          ...scoutQualifies().verdicts[0],
          candidate_id: 'c01',
          verdict: 'rejected',
          reject_reason: 'not_a_launch',
        },
        brightQualifies('c02').verdicts[0],
      ],
    };
    const runner = new ScriptedRunner({
      'br-scout': [rejectQuillbox],
      'br-gtm-lead': [brightPicksEmail(DATE)],
    });
    const start = runner.start.bind(runner);
    runner.start = async (input) => {
      order.push(input.agent);
      return start(input);
    };
    const store = emptyStore();
    const clock = clockAt(NOW.toISOString());
    const { ports } = livePorts(clock, { agents: runner, data, transport: fakeTransport(routes) });
    const { files } = await day(store, ports, clock, { forcedDryRun: true });
    expect(finder).toEqual([BRIGHT]);
    expect(order.indexOf('br-scout')).toBeLessThan(order.indexOf(`finder ${BRIGHT}`));
    expect(files.get('review.md')).toContain(`To: hello@${BRIGHT}`);
  });
});

describe('small rules', () => {
  it('reads "a Delaware company" as US evidence', () => {
    expect(usEvidence('BasedAI, Inc., a Delaware company')).toBe(true);
    expect(usEvidence('Quillbox, Inc., a Delaware corporation')).toBe(true);
    expect(usEvidence('Quillbox, Inc.')).toBe(false);
    expect(usEvidence('Delaware company search')).toBe(false);
  });

  it('records a lead with no verified product name as no_product_name, not site_unreadable', async () => {
    const routes = quillboxRoutes();
    routes[`https://${QUILLBOX}/`] = {
      body: `<!doctype html><html><head><title>quillbox.example</title><meta property="og:site_name" content="quillbox.example"></head><body><h1>quillbox.example</h1><main><p>${LINE}</p><p>Share one list with your household. Everyone sees each change at once, even with no signal in the tunnel.</p></main></body></html>`,
    };
    const store = emptyStore();
    const clock = clockAt(NOW.toISOString());
    const { ports } = livePorts(clock, {
      agents: new ScriptedRunner({ 'br-scout': [scoutQualifies()] }),
      transport: fakeTransport(routes),
    });
    await day(store, ports, clock, { forcedDryRun: true });
    expect(store.leads[0]?.verdict).toMatchObject({
      verdict: 'rejected',
      reject_reason: 'no_product_name',
    });
  });

  it('refuses a scout line from the terms page: copy quotes the homepage or the about page', async () => {
    const store = emptyStore();
    const clock = clockAt(NOW.toISOString());
    const { ports } = livePorts(clock, {
      agents: new ScriptedRunner({
        'br-scout': [
          scoutQualifies({ line: { page: 'p3', quote: 'We are not HIPAA compliant.' } }),
        ],
      }),
    });
    const { files } = await day(store, ports, clock, { forcedDryRun: true });
    expect(store.leads[0]?.verdict).toMatchObject({ verdict: 'qualified', line: null });
    expect(files.get('review.md')).toContain(
      'c01: line refused (not_homepage_or_about: terms page)',
    );
  });

  it('asks for the postal address and the cold sender only while email may go live', async () => {
    const store = emptyStore();
    const clock = clockAt(NOW.toISOString());
    const { ports } = livePorts(clock, {
      agents: new ScriptedRunner({ 'br-scout': [scoutQualifies()] }),
    });
    // This harness lifts EMAIL_FORCED_DRY_RUN; gtm-day.test.ts proves the cards stay away under it.
    const { result } = await day(store, ports, clock, { forcedDryRun: true });
    expect(result.needs).toContain('postal-address');
  });

  it("does not read Apple's AirDrop as a token airdrop", () => {
    expect(brandFlags('Send your drawings to a friend over AirDrop.')).toEqual([]);
    expect(brandFlags('Claim your airdrop before the snapshot.')).toEqual(['crypto_sale:airdrop']);
    expect(brandFlags('Join the AirDrop: free tokens for early users.')).toEqual([
      'crypto_sale:airdrop',
    ]);
  });
});

describe('the agents', () => {
  it('keeps the email picks when br-social cannot start', async () => {
    const runner = new ScriptedRunner({
      'br-scout': [scoutQualifies()],
      'br-gtm-lead': [
        { ...leadPicksEmail(), x_pick: { lead_id: QUILLBOX_LEAD, why: 'A launch post.' } },
      ],
    });
    const store = emptyStore();
    const start = runner.start.bind(runner);
    runner.start = async (input) => {
      if (input.agent === 'br-scout')
        for (const lead of store.leads)
          lead.x_post = {
            url: 'https://x.com/quillbox/status/1855',
            verified: true,
            author_name: null,
            at: null,
          };
      if (input.agent === 'br-social') throw new Error('budget is $0: session refused');
      return start(input);
    };
    const clock = clockAt(NOW.toISOString());
    const { ports } = livePorts(clock, { agents: runner });
    const { result, logs } = await day(store, ports, clock, { forcedDryRun: true });
    expect(result.phases.find((item) => item.phase === 'pick')).toMatchObject({
      status: 'done',
      detail: 'x none, email 1',
    });
    expect(logs.join('\n')).toMatch(/br-social could not start: budget is \$0/);
  });

  it('reports a scout that could not start as not judged, and says why', async () => {
    const runner = new ScriptedRunner({});
    runner.start = async () => {
      throw new Error("a session budget cannot exceed the agent's budget cap (0 micro-USD)");
    };
    const store = emptyStore();
    const clock = clockAt(NOW.toISOString());
    const { ports } = livePorts(clock, { agents: runner });
    const { result, files } = await day(store, ports, clock, { forcedDryRun: true });
    const qualify = result.phases.find((item) => item.phase === 'qualify');
    expect(qualify?.status).toBe('skipped');
    expect(qualify?.detail).toMatch(
      /^1 candidates not judged: br-scout could not start: .*company:sync has not run since GTM_ACTIVE/,
    );
    expect(files.get('review.md')).toContain(
      'The scout did not run, so no candidate was judged and none is qualified',
    );
    expect(files.get('report.txt')).toMatch(
      /Leads: 1 found, 0 judged by the scout, 0 qualified .*The scout did not run/,
    );
    expect(files.get('board.md')).toContain('LEADS · 2026-11-08 · not judged');
  });

  it('writes the quote pack a person needs to quote-post the launch post', async () => {
    const runner = new ScriptedRunner({
      'br-scout': [scoutQualifies()],
      'br-gtm-lead': [
        { ...leadPicksEmail(), x_pick: { lead_id: QUILLBOX_LEAD, why: 'A launch post.' } },
      ],
      'br-social': [{ lead_id: QUILLBOX_LEAD, template_id: 't2', quote_ref: null }],
    });
    const store = emptyStore();
    const start = runner.start.bind(runner);
    runner.start = async (input) => {
      if (input.agent === 'br-scout')
        for (const lead of store.leads)
          lead.x_post = {
            url: 'https://x.com/quillbox/status/1855',
            verified: true,
            author_name: null,
            at: null,
          };
      return start(input);
    };
    const clock = clockAt(NOW.toISOString());
    const { ports } = livePorts(clock, { agents: runner });
    const { files } = await day(store, ports, clock, { forcedDryRun: true });
    expect(files.get('review.md')).toMatch(
      /Quote pack, for a person posting by hand from the X app \(pack mode\): quote-post https:\/\/x\.com\/quillbox\/status\/1855/,
    );
  });
});

describe('sync and the tamper check', () => {
  const reader = GTM.find((definition) => definition.name === 'br-inbox-reader');
  if (!reader) throw new Error('br-inbox-reader');
  const agentmail = { name: 'agentmail', url: 'https://mcp.agentmail.to/mcp' };

  it('clears an MCP server a definition dropped, even when the hash matches', async () => {
    const versions = new Map(reader.skills.map((skill) => [skill.slug, 2]));
    const hash = agentConfig(reader, versions).metadata?.[HASH_KEY];
    const update = vi.fn(async (id: string) => ({ id, current_version: 10 }));
    const client = {
      skills: { push: vi.fn(async () => ({ id: 'skl_1', slug: 's', version: 2 })) },
      agents: {
        list: vi.fn(async () => ({
          data: [
            {
              id: 'agt_reader',
              name: reader.name,
              current_version: 9,
              metadata: { [HASH_KEY]: hash },
              mcp_servers: [agentmail],
            },
          ],
          has_more: false,
          next_cursor: null,
        })),
        create: vi.fn(),
        update,
      },
    };
    const [result] = await syncAgents(client as unknown as Naive, [reader]);
    expect(result).toMatchObject({ action: 'updated', version: 10 });
    expect(update).toHaveBeenCalledWith('agt_reader', expect.objectContaining({ mcp_servers: [] }));
  });

  it('counts a stored MCP server the definition does not name as drift', () => {
    const stored = { ...(reader as unknown as Record<string, unknown>), mcp_servers: [agentmail] };
    expect(definitionDrift(stored, reader)).toContain('mcp_servers');
    expect(definitionDrift({ ...stored, mcp_servers: [] }, reader)).not.toContain('mcp_servers');
  });
});

describe('the X pack: the founder posts by hand', () => {
  const NEXT_MORNING = '2026-11-09T13:00:00Z';
  const packRunner = () =>
    new ScriptedRunner({
      'br-scout': [scoutQualifies()],
      'br-gtm-lead': [
        { ...leadPicksEmail(), x_pick: { lead_id: QUILLBOX_LEAD, why: 'A clear promise.' } },
      ],
      'br-social': [{ lead_id: QUILLBOX_LEAD, template_id: 't1', quote_ref: 'q1' }],
    });

  /** A real day as `gtm:day --live --board` runs it: no test override of the email flag. */
  async function packDay(store: StoreData, ports: Ports, clock: Clock, date = DATE) {
    const files = new Map<string, string>();
    const result = await runDay({
      store,
      ports,
      clock,
      date,
      forcedDryRun: false,
      gtmActive: true,
      save: () => {},
      writeFile: (name, content) => files.set(name, content),
      log: () => {},
      sleep: async (ms) => {
        clock.t += ms;
      },
    });
    return { result, files };
  }
  const packCards = (ports: Ports) =>
    [...(ports.board as LocalBoard).cards.values()].filter((card) =>
      card.title.startsWith('FOUNDER: gtm pack'),
    );

  it('puts the day on ONE FOUNDER card, posts nothing, and never calls it posted', async () => {
    const store = liveStore();
    store.flags.x_lane = 'pack';
    const clock = clockAt(NOW.toISOString());
    const { ports, sender } = livePorts(clock, {
      agents: packRunner(),
      social: new DryRunSocial(),
    });
    const post = vi.spyOn(ports.social, 'post');
    const { result, files } = await packDay(store, ports, clock);
    // Pack mode needs no Naive social account: the founder posts.
    expect(result.lanes.x).toBe('pack');
    expect(post).not.toHaveBeenCalled();
    const cards = packCards(ports);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card).toMatchObject({ title: 'FOUNDER: gtm pack 2026-11-08', status: 'blocked' });
    expect(card?.body).toContain('Startup: Quillbox (quillbox.example)');
    expect(card?.body).toContain('Film page: https://app.example/f/shfo_1');
    expect(card?.body).toContain('X post to quote: none, post the film on its own');
    expect(card?.body).toContain(`Their website says: "${LINE}"`);
    expect(card?.body).toContain('@boilerroomstudi');
    expect(card?.body).toContain('move this card to done');
    // The caption quotes the site in words only: no number anywhere in it.
    const caption = card?.body.split('Caption:\n')[1] ?? '';
    expect(caption).not.toMatch(/\d/);
    expect(store.packs).toMatchObject([
      { date: DATE, status: 'waiting', entries: [{ lead_id: QUILLBOX_LEAD, domain: QUILLBOX }] },
    ]);
    expect(store.contacts.filter((row) => row.channel === 'x_post')).toEqual([]);
    expect(files.get('report.txt')).toContain(
      "X by hand: today's pack 1 post(s), NOT POSTED yet (the founder moves the card to done)",
    );
    // No email goes out: the code flag keeps the lane dry run whatever the store says.
    expect(result.lanes.email).toBe('dry_run');
    expect(result.lanes.reasons.email[0]).toMatch(/EMAIL_FORCED_DRY_RUN/);
    expect(sender.sent).toEqual([]);
  });

  it('writes the pack too when the X lane is dry run but the film is real', async () => {
    const store = liveStore();
    store.flags.x_lane = 'dry_run';
    const clock = clockAt(NOW.toISOString());
    const { ports } = livePorts(clock, { agents: packRunner() });
    const { result } = await packDay(store, ports, clock);
    expect(result.lanes.x).toBe('dry_run');
    expect(packCards(ports)).toHaveLength(1);
  });

  it('puts a post the network refused on the pack, and does not count it as posted', async () => {
    const store = liveStore();
    const clock = clockAt(NOW.toISOString());
    const refusing: SocialPoster = {
      kind: 'naive',
      ready: async () => ({ ok: true, reason: null }),
      post: async () => {
        throw new PostRefused('the post came back failed');
      },
      find: async () => null,
      remove: async () => {},
    };
    // A launch post to quote, as discovery would have verified it.
    const runner = packRunner();
    const start = runner.start.bind(runner);
    runner.start = async (input) => {
      if (input.agent === 'br-scout')
        for (const lead of store.leads)
          lead.x_post = {
            url: 'https://x.com/quillbox/status/1855',
            verified: true,
            author_name: null,
            at: null,
          };
      return start(input);
    };
    const { ports } = livePorts(clock, { agents: runner, social: refusing });
    const { result } = await packDay(store, ports, clock);
    expect(result.lanes.x).toBe('standalone');
    expect(store.actions.find((row) => row.kind === 'x-post')?.status).toBe('failed');
    expect(store.actions.filter((row) => row.status === 'unknown')).toEqual([]);
    expect(store.contacts.filter((row) => row.channel === 'x_post')).toEqual([]);
    const card = packCards(ports)[0];
    expect(card?.body).toContain('The executor tried to post this and the network refused it.');
    expect(card?.body).toContain('X post to quote: https://x.com/quillbox/status/1855');
  });

  it('counts the posts as POSTED the next day only once the founder moved the card to done', async () => {
    for (const moved of [true, false]) {
      const store = liveStore();
      store.flags.x_lane = 'pack';
      const clock = clockAt(NOW.toISOString());
      const { ports } = livePorts(clock, { agents: packRunner(), social: new DryRunSocial() });
      await packDay(store, ports, clock);
      const card = packCards(ports)[0];
      if (moved && card) await ports.board.move(card.id, 'done');
      clock.t = Date.parse(NEXT_MORNING);
      const { files } = await packDay(store, ports, clock, NEXT);
      expect(files.get('report.txt')).toContain(
        moved
          ? "Yesterday's pack: 1 POSTED, 0 NOT POSTED"
          : "Yesterday's pack: 0 POSTED, 1 NOT POSTED",
      );
      expect(store.packs[0]?.status).toBe(moved ? 'posted' : 'waiting');
      // A posted startup is never posted again: it counts as an X post for good.
      expect(store.contacts.filter((row) => row.channel === 'x_post').length).toBe(moved ? 1 : 0);
    }
  });

  it('writes no pack while someone holds the day', async () => {
    const store = liveStore();
    store.flags.x_lane = 'pack';
    const clock = clockAt(NOW.toISOString());
    const { ports } = livePorts(clock, { agents: packRunner(), social: new DryRunSocial() });
    vi.spyOn(ports.board, 'comments').mockResolvedValue([
      { id: 'cmt_hold', author: 'usr_anyone', body: 'HOLD', created_at: NOW.toISOString() },
    ]);
    await packDay(store, ports, clock);
    expect(packCards(ports)).toEqual([]);
  });
});

describe('email stays dry run for the hackathon', () => {
  it('is forced by a code flag that no store flag and no CLI option reaches', () => {
    expect(EMAIL_FORCED_DRY_RUN).toBe(true);
    const cli = readFileSync(new URL('../src/cli/gtm-day.ts', import.meta.url), 'utf8');
    expect(cli).not.toContain('emailForcedDryRun');
    const flags = readFileSync(new URL('../src/cli/gtm-flags.ts', import.meta.url), 'utf8');
    expect(flags).not.toContain('EMAIL_FORCED_DRY_RUN');
  });

  it('keeps every email a draft even when every flag and precondition says live', async () => {
    const store = liveStore();
    const clock = clockAt(NOW.toISOString());
    const sender = liveSender();
    const { ports } = livePorts(clock, {
      agents: new ScriptedRunner({
        'br-scout': [scoutQualifies()],
        'br-gtm-lead': [leadPicksEmail()],
      }),
      sender: sender.port,
    });
    const files = new Map<string, string>();
    const result = await runDay({
      store,
      ports,
      clock,
      date: DATE,
      forcedDryRun: false,
      gtmActive: true,
      save: () => {},
      writeFile: (name, content) => files.set(name, content),
      log: () => {},
      sleep: async (ms) => {
        clock.t += ms;
      },
    });
    expect(result.lanes.email).toBe('dry_run');
    expect(result.lanes.reasons.email).toEqual([
      "email is dry run in code for the hackathon (EMAIL_FORCED_DRY_RUN), whatever the store's flags say",
    ]);
    expect(sender.sent).toEqual([]);
    expect(store.actions.find((row) => row.kind === 'email')?.status).toBe('dry_run');
  });
});
