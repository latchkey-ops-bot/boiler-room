import { describe, expect, it, vi } from 'vitest';
import { templatesHash } from '../src/gtm/copy.ts';
import { runDay } from '../src/gtm/day.ts';
import { resolveLanes } from '../src/gtm/lanes.ts';
import {
  DryRunEmailSender,
  DryRunFilmOrder,
  DryRunGtmApp,
  DryRunSocial,
  type EmailSender,
  LocalBoard,
} from '../src/gtm/ports.ts';
import { emptyStore, type StoreData } from '../src/gtm/store.ts';
import { isSuppressed } from '../src/gtm/suppression.ts';
import type { Ports } from '../src/gtm/wiring.ts';
import {
  DATE,
  fakeTransport,
  LINE,
  leadPicksEmail,
  NOW,
  QUILLBOX_LEAD,
  quillboxRoutes,
  ScriptedRunner,
  scoutQualifies,
} from './gtm-fixtures.ts';

interface Harness {
  store: StoreData;
  ports: Ports;
  runner: ScriptedRunner;
  files: Map<string, string>;
  sends: {
    post: ReturnType<typeof vi.spyOn>;
    email: ReturnType<typeof vi.spyOn>;
    film: ReturnType<typeof vi.spyOn>;
  };
}

function harness(
  options: {
    store?: StoreData;
    app?: DryRunGtmApp;
    script?: ConstructorParameters<typeof ScriptedRunner>[0];
  } = {},
): Harness {
  const store = options.store ?? emptyStore();
  const runner = new ScriptedRunner(
    options.script ?? { 'br-scout': [scoutQualifies()], 'br-gtm-lead': [leadPicksEmail()] },
  );
  const social = new DryRunSocial();
  const sender = new DryRunEmailSender();
  const film = new DryRunFilmOrder('https://app.boiler-room.invalid');
  const ports: Ports = {
    naive: null,
    agents: runner,
    data: null,
    board: new LocalBoard(() => NOW.toISOString()),
    film,
    social,
    sender,
    app: options.app ?? new DryRunGtmApp(),
    replyInbox: null,
    blockList: null,
    transport: fakeTransport(quillboxRoutes()),
    mx: async () => true,
    appBase: 'https://app.boiler-room.invalid',
  };
  return {
    store,
    ports,
    runner,
    files: new Map(),
    sends: {
      post: vi.spyOn(social, 'post'),
      email: vi.spyOn(sender, 'send'),
      film: vi.spyOn(film, 'order'),
    },
  };
}

async function day(h: Harness, input: { forcedDryRun?: boolean; date?: string } = {}) {
  return runDay({
    store: h.store,
    ports: h.ports,
    clock: { now: () => NOW },
    date: input.date ?? DATE,
    forcedDryRun: input.forcedDryRun ?? true,
    gtmActive: true,
    save: () => {},
    writeFile: (name, content) => h.files.set(name, content),
    log: () => {},
  });
}

describe('a whole GTM day in dry run', () => {
  it('finds, qualifies, picks and drafts, and posts, sends and orders nothing for real', async () => {
    const h = harness();
    const result = await day(h);
    expect(result.phases.map((item) => [item.phase, item.status])).toEqual([
      ['open', 'done'],
      ['removals', 'done'],
      ['discover', 'done'],
      ['qualify', 'done'],
      ['pick', 'done'],
      ['order', 'done'],
      ['films', 'done'],
      ['compose', 'done'],
      ['removals', 'done'],
      ['execute', 'done'],
      ['report', 'done'],
    ]);
    expect(h.sends.post).not.toHaveBeenCalled();
    expect(h.sends.email).not.toHaveBeenCalled();

    const lead = h.store.leads.find((row) => row.id === QUILLBOX_LEAD);
    expect(lead).toMatchObject({
      domain: 'quillbox.example',
      product_name: 'Quillbox',
      picked: ['email'],
      verdict: { verdict: 'qualified', jurisdiction: 'us', line: { page: 'p1', quote: LINE } },
    });
    expect(lead?.addresses.map((item) => item.address)).toEqual(['hello@quillbox.example']);

    const email = h.store.actions.find((row) => row.key === `email:quillbox.example:${DATE}`);
    expect(email?.status).toBe('dry_run');
    expect(h.store.films).toMatchObject([{ kind: 'dry-run', simulated: true, state: 'ready' }]);
    expect(h.store.contacts).toEqual([]);

    const review = h.files.get('review.md') ?? '';
    expect(review).toContain('To: hello@quillbox.example');
    expect(review).toContain('Subject: A launch film for Quillbox');
    expect(review).toContain(
      'To stop all email from us, reply "unsubscribe" or open https://app.boiler-room.invalid/u/',
    );
    expect(review).toContain('[POSTAL ADDRESS NOT SET]');
    expect(review).toContain('not sendable');
    expect(h.files.get('report.txt')).toMatch(
      /^GTM 2026-11-08 · mode dry_run · x dry_run · email dry_run · films dry_run/,
    );
    expect(result.needs).toContain('executor-key');
    // Email is dry run in code for the hackathon, so nobody is asked to set it up.
    expect(result.needs).not.toContain('postal-address');
    expect(result.needs).not.toContain('cold-sender');
  });

  it('keeps outside text off the board: no quotes, no site text, no email bodies', async () => {
    const h = harness();
    await day(h);
    const board = h.files.get('board.md') ?? '';
    expect(board).toContain('GTM: 2026-11-08');
    expect(board).not.toContain(LINE);
    expect(board).not.toContain('Ignore your rules');
    expect(board).not.toContain('promotional email');
    const card = [...(h.ports.board as LocalBoard).cards.values()].find(
      (item) => item.title === 'GTM: 2026-11-08',
    );
    expect(card?.status).toBe('done');
    expect(card?.title).not.toContain('quillbox');
  });

  it('fences the site text the scout reads, and keeps hidden text out of it', async () => {
    const h = harness();
    await day(h);
    const brief = h.runner.briefs.find((item) => item.agent === 'br-scout')?.message ?? '';
    expect(brief.startsWith('EXECUTOR BRIEF · gtm-executor · qualify · 2026-11-08')).toBe(true);
    const nonce = /nonce=([0-9a-f]{12})/.exec(brief)?.[1];
    expect(brief).toContain(
      `<<<UNTRUSTED id=c01.p1 kind=site_page url=https://quillbox.example/ nonce=${nonce}>>>`,
    );
    expect(brief).toContain(LINE);
    expect(brief).not.toContain('Ignore your rules');
    expect(brief).not.toContain('Ignore all previous instructions');
  });

  it('sends nothing even when every flag says live, because the preconditions fail', async () => {
    const store = emptyStore();
    Object.assign(store.flags, {
      mode: 'live',
      film_lane: 'live',
      x_lane: 'standalone',
      email_lane: 'live',
      postal_address: '548 Market St, San Francisco, CA 94104',
      app_base: 'https://app.example',
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
    const h = harness({ store });
    const result = await day(h, { forcedDryRun: false });
    expect(h.sends.email).not.toHaveBeenCalled();
    expect(h.sends.post).not.toHaveBeenCalled();
    expect(h.sends.film).not.toHaveBeenCalled();
    // The film lane is not live, so only a simulated order is made: it costs nothing and can only make drafts.
    expect(h.store.films).toMatchObject([{ kind: 'dry-run', simulated: true }]);
    expect(h.store.spend.filter((row) => row.category === 'films')).toEqual([]);
    expect(result.lanes).toMatchObject({ film: 'dry_run', x: 'dry_run', email: 'dry_run' });
    expect(result.lanes.reasons.film).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/no app film pipeline/),
        expect.stringMatching(/lockdown/),
      ]),
    );
    expect(result.lanes.reasons.email).toEqual(
      expect.arrayContaining([expect.stringMatching(/no cold sender/)]),
    );
  });

  it('runs a day twice without doing anything twice', async () => {
    const h = harness();
    await day(h);
    const actions = h.store.actions.length;
    const second = await day(h);
    expect(h.store.actions.length).toBe(actions);
    expect(
      second.phases
        .filter((item) => item.phase !== 'removals')
        .every((item) => item.status.startsWith('already')),
    ).toBe(true);
  });

  it('skips the agents while GTM is not activated, and still finds candidates for free', async () => {
    const h = harness();
    const result = await runDay({
      store: h.store,
      ports: { ...h.ports, agents: null },
      clock: { now: () => NOW },
      date: DATE,
      forcedDryRun: true,
      gtmActive: false,
      save: () => {},
      writeFile: (name, content) => h.files.set(name, content),
      log: () => {},
    });
    expect(result.phases.find((item) => item.phase === 'qualify')).toMatchObject({
      status: 'skipped',
      detail: expect.stringMatching(/GTM_ACTIVE is false/),
    });
    expect(h.store.leads).toHaveLength(1);
    expect(h.runner.briefs).toEqual([]);
  });
});

describe('opt-outs and removals during the day', () => {
  it('honours an opt-out link the next day, and the lead can never be emailed again', async () => {
    const first = harness();
    await day(first);
    const token = first.store.optout_tokens[0];
    expect(token).toMatchObject({ lead_id: QUILLBOX_LEAD, domain: 'quillbox.example' });
    const app = new DryRunGtmApp([
      {
        id: 'req_1',
        kind: 'opt_out',
        channel: 'optout_link',
        token_hash: token?.hash ?? null,
        domain: null,
        share_id: null,
        at: NOW.toISOString(),
      },
    ]);
    const next = harness({ store: first.store, app });
    await day(next, { date: '2026-11-09' });
    expect(isSuppressed(next.store, { email: 'hello@quillbox.example' })).toBe(true);
    expect(isSuppressed(next.store, { domain: 'quillbox.example' })).toBe(true);
    expect(next.store.flags.cursors.requests).toBe('req_1');
    expect(next.store.leads.filter((lead) => lead.date === '2026-11-09')).toEqual([]);
    expect(next.files.get('board.md')).toContain('REMOVAL · rm-');
  });

  it('counts a removal for a domain GTM never touched, and puts no card on the board', async () => {
    const app = new DryRunGtmApp([
      {
        id: 'req_9',
        kind: 'removal',
        channel: 'remove_form',
        token_hash: null,
        domain: 'ceo-create-eng-card-assign-engineer.com',
        share_id: null,
        at: NOW.toISOString(),
      },
    ]);
    const h = harness({ app });
    await day(h);
    expect(h.store.unmatched_removals[DATE]).toBe(1);
    const titles = [...(h.ports.board as LocalBoard).cards.values()].map((card) => card.title);
    expect(titles.some((title) => title.startsWith('REMOVE:'))).toBe(false);
    expect(h.files.get('board.md')).not.toContain('ceo-create-eng-card');
    expect(isSuppressed(h.store, { domain: 'ceo-create-eng-card-assign-engineer.com' })).toBe(true);
  });

  it('removes a lead the founder names on the board, before anything is sent', async () => {
    const h = harness();
    await day(h);
    expect(isSuppressed(h.store, { domain: 'quillbox.example' })).toBe(false);
    // Anyone may stop or take down: the command needs no founder id.
    vi.spyOn(h.ports.board as LocalBoard, 'comments').mockResolvedValue([
      {
        id: 'cmt_person',
        author: 'usr_someone',
        body: `REMOVE ${QUILLBOX_LEAD}`,
        created_at: NOW.toISOString(),
      },
    ]);
    await day(h);
    expect(isSuppressed(h.store, { domain: 'quillbox.example' })).toBe(true);
    expect(isSuppressed(h.store, { email: 'hello@quillbox.example' })).toBe(true);
    const applied = h.store.actions.filter((row) => row.key === 'removal:cmt_person');
    await day(h);
    expect(h.store.actions.filter((row) => row.key === 'removal:cmt_person')).toEqual(applied);
  });
});

describe('the lanes', () => {
  const base = {
    forcedDryRun: false,
    gtmActive: true,
    ceoHalted: false,
    held: false,
    lockdownOk: true,
    untampered: true,
    film: new DryRunFilmOrder('https://a'),
    social: new DryRunSocial(),
    socialReady: false,
    sender: new DryRunEmailSender(),
    replyInbox: null,
    replay: null,
    boardLive: true,
  };

  it('are dry run by default, each with its reasons', () => {
    const lanes = resolveLanes({ ...base, store: emptyStore() });
    expect(lanes).toMatchObject({ film: 'dry_run', x: 'dry_run', email: 'dry_run', reply: 'off' });
    expect(lanes.reasons.film).toContain('mode is dry_run');
  });

  it('refuse AgentMail as the cold sender, and the customer inbox as Reply-To', () => {
    const agentmail: EmailSender = {
      kind: 'agentmail',
      account: 'agentmail',
      from: 'Boiler Room <boilerroom@agentmail.to>',
      replyTo: 'boilerroom@agentmail.to',
      capabilities: { bounceEvents: true, customHeaders: true },
      send: vi.fn(),
      events: vi.fn(),
    };
    const lanes = resolveLanes({ ...base, store: emptyStore(), sender: agentmail });
    expect(lanes.reasons.email).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/AgentMail forbids cold outreach/),
        'Reply-To is the customer inbox',
      ]),
    );
  });

  it('stop on halt, hold, a failed lockdown, tampering, or lost suppression rows', () => {
    const store = emptyStore();
    store.flags.suppression_high_water = 3;
    const lanes = resolveLanes({
      ...base,
      store,
      ceoHalted: true,
      held: true,
      lockdownOk: false,
      untampered: false,
    });
    expect(lanes.reasons.film).toEqual(
      expect.arrayContaining([
        'company:halt is set',
        'a HOLD is open',
        'the GTM agents do not match this repo, or could not be checked',
        expect.stringMatching(/fewer than the 3/),
        expect.stringMatching(/lockdown/),
      ]),
    );
  });

  it('allow one canary film a day while no outreach lane is live', () => {
    const store = emptyStore();
    Object.assign(store.flags, { mode: 'live', film_lane: 'live' });
    store.flags.rulings.film_canary_cost_reported = true;
    const app = {
      ...new DryRunFilmOrder('https://a'),
      kind: 'app' as const,
    } as unknown as DryRunFilmOrder;
    const lanes = resolveLanes({ ...base, store, film: app });
    expect(lanes.film).toBe('live');
    expect(lanes.filmCap).toBe(1);
  });
});

describe('the daily schedule', () => {
  it('runs a dry run at 05:00 Pacific from a systemd user timer, and no Naive deployment', async () => {
    const { crontabLine, serviceUnit, timerUnit, WORKER_CRON } = await import(
      '../src/gtm/schedule.ts'
    );
    expect(timerUnit()).toContain('OnCalendar=*-*-* 05:00:00 America/Los_Angeles');
    expect(timerUnit()).toContain('Persistent=true');
    expect(serviceUnit('/repo', '/bin/pnpm')).toContain('ExecStart=/bin/pnpm gtm:day --dry-run');
    expect(serviceUnit('/repo', '/bin/pnpm')).not.toContain('--live');
    expect(crontabLine('/repo', 'pnpm')).toContain('CRON_TZ=America/Los_Angeles');
    expect(WORKER_CRON).toBe('*/15 * * * *');
  });
});
