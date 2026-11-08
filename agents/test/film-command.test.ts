import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FilmEvent, filmCommandArgs, parseFilmEvent } from '@boiler-room/film-runner/contract';
import { describe, expect, it, vi } from 'vitest';
import {
  type CommandDeps,
  type ContractArgs,
  parseContractArgs,
  runFilmCommand,
} from '../src/film/command.ts';
import { plain } from '../src/film/events.ts';
import type { FilmCrew, GateOutcome, StageOutcome } from '../src/film/run.ts';
import { NO_COST } from '../src/film/run.ts';
import type { QcIssue, QcReport } from '../src/quality/output.ts';

const NOVA = fileURLToPath(
  new URL('../../packages/schema/examples/nova.campaign.json', import.meta.url),
);
const STOP_FIXTURE = fileURLToPath(new URL('./fixtures/film-stop.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

const usd = (dollars: number) => Math.round(dollars * 1e6);
const write = (file: string, content: string | Buffer) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
  return file;
};

/** A Nova campaign, as the Director writes one: its pricing claim is cited and unconfirmed. */
const novaCampaign = () => readFileSync(NOVA, 'utf8');

const report = (verdict: 'pass' | 'fail', issues: QcIssue[] = []): QcReport =>
  ({
    verdict,
    blocked: null,
    renderDir: '',
    campaignId: 'nova-launch',
    render: {
      file: '',
      sha256: '',
      width: 1920,
      height: 1080,
      fps: 30,
      frames: 750,
      format: '16:9',
    },
    campaignFile: '',
    researchFile: null,
    checks: [],
    issues,
    review: null,
    createdAt: '2026-11-08T00:00:00.000Z',
  }) satisfies QcReport;

interface Plan {
  qc?: QcReport;
  /** Called at the start of research, to hold it open. */
  research?: () => Promise<void>;
}

/** A crew whose stages write the files the real one would, and say what a stage really says. */
function fakeCrew(plan: Plan = {}) {
  const done = <T>(value: T, dollars: number, sessionIds: string[] = []): StageOutcome<T> => ({
    ok: true,
    value,
    cost: { ...NO_COST, modelMicroUsd: usd(dollars) },
    sessionIds,
    decisions: [],
  });
  const crew = {
    research: vi.fn<FilmCrew['research']>(async ({ dir }) => {
      await plan.research?.();
      const outcome = done(
        { researchFile: write(join(dir, 'research.json'), '{"claims":[]}') },
        0.05,
        ['ses_researchresearch01'],
      );
      // What a stage report says, keys, links, paths and ids included: the events must not.
      outcome.decisions = [
        {
          agent: 'researcher',
          kind: 'decision',
          stage: 'research',
          message: 'Kept 4 claims from https://www.nova.example/pricing?sig=abc',
          why: `Read in ses_researchresearch01; report at ${join(dir, 'report.json')}, file fil_7rvk836fprsa75e42t5evrtzxv.`,
        },
      ];
      return outcome;
    }),
    direct: vi.fn<FilmCrew['direct']>(async ({ dir }) =>
      done(
        {
          campaignFile: write(join(dir, 'campaign.json'), novaCampaign()),
          handoffFile: write(join(dir, 'handoff.json'), '{"template":"Short"}'),
        },
        0.5,
        ['ses_directordirector01'],
      ),
    ),
    art: vi.fn<FilmCrew['art']>(async ({ dir, campaignFile }) =>
      done(
        { campaignFile: write(join(dir, 'campaign.art.json'), readFileSync(campaignFile)) },
        0.1,
        ['ses_artdirectorartdir1'],
      ),
    ),
    gate: vi.fn<FilmCrew['gate']>(async (): Promise<GateOutcome> => ({ ok: true, warnings: [] })),
    render: vi.fn<FilmCrew['render']>(async ({ dir }) => {
      const film = write(join(dir, 'film.mp4'), 'an mp4');
      return done(
        {
          renderDir: dir,
          film,
          manifestFile: write(join(dir, 'film.manifest.json'), '{}'),
          sha256: createHash('sha256').update('an mp4').digest('hex'),
          bytes: 6,
          durationSeconds: 25,
        },
        0,
      );
    }),
    qc: vi.fn<FilmCrew['qc']>(async ({ renderDir }) => {
      const work = join(renderDir, 'nova-launch.qc');
      write(join(work, 'contact-sheet.png'), 'png');
      for (const frame of ['00060', '00150', '00244'])
        write(join(work, `rest-${frame}.png`), 'png');
      const qc = plan.qc ?? report('pass');
      const reportFile = write(join(work, 'qc-report.json'), JSON.stringify(qc));
      return done({ report: qc, reportFile }, 0.3, ['ses_qualitycheckqc01']);
    }),
    stop: vi.fn(async () => {}),
  };
  return crew;
}

const sessions = {
  sessions: {
    get: vi.fn(async () => ({ status: 'idle', stop_reason: 'end_turn', consumed_micro_usd: 1000 })),
    interrupt: vi.fn(async () => ({})),
    cancel: vi.fn(async () => ({})),
  },
} as unknown as CommandDeps['sessions'];

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'br-film-command-'));
  const runDir = join(root, 'br-run', 'film');
  return { root, runDir, eventsFile: (phase: string) => join(runDir, `events-${phase}-1.jsonl`) };
}

/** The arguments exactly as the runner builds them (`filmCommandArgs`), parsed by the command. */
function argsFor(
  runDir: string,
  eventsFile: string,
  phase: 'script' | 'render' | 'all',
  extra: { approvalFile?: string; maxUsd?: number } = {},
): ContractArgs {
  const argv = filmCommandArgs({
    url: 'https://www.nova.example/',
    phase,
    runDir,
    eventsFile,
    maxUsd: extra.maxUsd ?? 3,
    ...(extra.approvalFile ? { approvalFile: extra.approvalFile } : {}),
  });
  const parsed = parseContractArgs(argv);
  if ('problem' in parsed) throw new Error(parsed.problem);
  return parsed;
}

const deps = (crew: ReturnType<typeof fakeCrew>, extra: Partial<CommandDeps> = {}) => ({
  crew,
  sessions,
  checkAgents: vi.fn(async () => []),
  ...extra,
});

/** Every line of an events file, each checked by the contract's own parser. */
function readEvents(file: string): FilmEvent[] {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return lines.map((line) => {
    const parsed = parseFilmEvent(line);
    if (!parsed.ok) throw new Error(`the contract refuses ${line}: ${parsed.reason}`);
    return parsed.event;
  });
}

/** What the website shows: every message and issue a founder reads. */
const shown = (events: FilmEvent[]) =>
  events.flatMap((event) => [
    ...('message' in event ? [event.message] : []),
    ...(event.type === 'qc' ? event.issues.map((issue) => issue.message) : []),
  ]);

function expectWellFormed(events: FilmEvent[]) {
  expect(events.length).toBeGreaterThan(0);
  expect(events.map((event) => event.seq)).toEqual(events.map((_event, index) => index + 1));
  for (const event of events) {
    if (event.type === 'stage') expect(event.stage).not.toBe('approval');
  }
  for (const text of shown(events)) {
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/(?:^|\s)\/[\w.-]+\//);
    expect(text).not.toMatch(/\b(?:ses|fil|agt|cmp)_[a-z0-9]{8,}/);
    expect(text).not.toMatch(/NAIVE_API_KEY|REDACTED/);
  }
}

const approve = (runDir: string, approval: Record<string, unknown>) =>
  write(join(runDir, '..', 'approval.json'), JSON.stringify(approval));

describe('the film command, as the film runner calls it', () => {
  it('writes the script, says script_ready and exits 0, in events the contract accepts', async () => {
    const { runDir, eventsFile } = setup();
    const crew = fakeCrew();
    const code = await runFilmCommand(argsFor(runDir, eventsFile('script'), 'script'), deps(crew));
    expect(code).toBe(0);
    const events = readEvents(eventsFile('script'));
    expectWellFormed(events);
    expect(new Set(events.map((event) => event.type))).toEqual(
      new Set(['stage', 'decision', 'session', 'cost', 'artifact', 'script_ready']),
    );
    expect(events.filter((event) => event.type === 'stage').map((event) => event.stage)).toEqual([
      'research',
      'script',
    ]);
    // Only what the website takes before approval: the research, then the script.
    expect(events.filter((event) => event.type === 'artifact')).toEqual([
      expect.objectContaining({ kind: 'research', path: 'research/research.json', version: 0 }),
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'script_ready',
      version: 1,
      campaignPath: 'campaign.json',
      unconfirmedClaims: ['pricing'],
    });
    expect(events.find((event) => event.type === 'decision')?.message).toBe(
      'Started a customer-order of nova.example: standard, 16:9, under a $3.00 cap. A Standard film was asked for, so the brief asks for 45 s: Long cannot apply, and rule 2 still makes it Short if the research has fewer than 3 usable claims.',
    );
    const researched = events.find(
      (event) => event.type === 'decision' && event.message.startsWith('Kept 4 claims'),
    );
    expect(researched).toMatchObject({
      message:
        'Kept 4 claims from nova.example. Read in a session; report at report.json, file a file.',
    });
    expect(events.filter((event) => event.type === 'cost').at(-1)).toMatchObject({
      step: 'director',
      totalMicroUsd: usd(0.55),
    });
    // The same decisions are in decisions.json, and the script is at the top of the run dir.
    const decisions = JSON.parse(readFileSync(join(runDir, 'decisions.json'), 'utf8'));
    expect(decisions.decisions.length).toBe(events.filter((e) => e.type === 'decision').length);
    expect(readFileSync(join(runDir, 'campaign.json'), 'utf8')).toBe(novaCampaign());
    expect(JSON.parse(readFileSync(join(runDir, 'script.json'), 'utf8'))).toMatchObject({
      version: 1,
      researchFile: 'research/research.json',
      unconfirmedClaims: ['pricing'],
    });
    expect(crew.art).not.toHaveBeenCalled();
  });

  it('renders exactly the approved cut, marks the confirmed claims approved and delivers', async () => {
    const { runDir, eventsFile } = setup();
    const crew = fakeCrew();
    await runFilmCommand(argsFor(runDir, eventsFile('script'), 'script'), deps(crew));
    const approvalFile = approve(runDir, {
      version: 1,
      hookId: 'open-question',
      ctaId: 'book-demo',
      formats: ['16:9', '1:1'],
      confirmedClaimIds: ['pricing'],
    });
    const code = await runFilmCommand(
      argsFor(runDir, eventsFile('render'), 'render', { approvalFile, maxUsd: 2.5 }),
      deps(crew),
    );
    expect(code).toBe(0);
    const events = readEvents(eventsFile('render'));
    expectWellFormed(events);
    expect(events.filter((event) => event.type === 'stage').map((event) => event.stage)).toEqual([
      'art_direction',
      'render',
      'review',
      'render',
      'review',
    ]);
    // The approved cut, and the claim the customer confirmed approved, before the gate.
    expect(crew.gate.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ format: '16:9', hookId: 'open-question', ctaId: 'book-demo' }),
      expect.objectContaining({ format: '1:1', hookId: 'open-question', ctaId: 'book-demo' }),
    ]);
    const gated = JSON.parse(readFileSync(crew.gate.mock.calls[0]?.[0].campaignFile ?? '', 'utf8'));
    expect(gated.claims.find((claim: { id: string }) => claim.id === 'pricing').status).toBe(
      'approved',
    );
    expect(crew.direct).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === 'qc')).toEqual([
      expect.objectContaining({ format: '16:9', verdict: 'pass', routable: 0 }),
      expect.objectContaining({ format: '1:1', verdict: 'pass', routable: 0 }),
    ]);
    const artifacts = events.filter((event) => event.type === 'artifact');
    expect(artifacts.map((event) => [event.kind, event.path, event.variantKey])).toEqual([
      ['mp4', 'delivered/film-16x9.mp4', '16:9.open-question.book-demo'],
      ['still', 'delivered/poster-16x9.png', undefined],
      ['quality', 'delivered/contact-sheet-16x9.png', undefined],
      ['quality', 'delivered/qc-report-16x9.json', undefined],
      ['mp4', 'delivered/film-1x1.mp4', '1:1.open-question.book-demo'],
      ['still', 'delivered/poster-1x1.png', undefined],
      ['quality', 'delivered/contact-sheet-1x1.png', undefined],
      ['quality', 'delivered/qc-report-1x1.json', undefined],
      ['decisions', 'decisions.json', undefined],
      ['manifest', 'manifest.json', undefined],
    ]);
    expect(artifacts.every((event) => event.version === 1)).toBe(true);
    for (const event of artifacts) expect(existsSync(join(runDir, event.path))).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'delivered',
      version: 1,
      variants: ['16:9.open-question.book-demo', '1:1.open-question.book-demo'],
    });
    // decisions.json goes on from the script phase.
    const decisions = JSON.parse(readFileSync(join(runDir, 'decisions.json'), 'utf8')).decisions;
    expect(decisions[0].message).toMatch(/^Started a customer-order/);
    expect(decisions.map((entry: { id: string }) => entry.id)).toEqual(
      decisions.map((_entry: unknown, index: number) => `d-${index}`),
    );
    expect(
      decisions.some((entry: { message: string }) =>
        entry.message.startsWith('Approved version 1'),
      ),
    ).toBe(true);
  });

  it('never sends an approved script back to the Director, and still delivers what it made', async () => {
    const { runDir, eventsFile } = setup();
    const copy: QcIssue = {
      severity: 'major',
      check: 'copy-fit',
      sceneId: 'hook',
      frame: 12,
      timecode: '0:00.12',
      what: 'The headline runs past /home/moss/out/films/x 65% of the width',
      fix: 'Shorten it',
      owner: 'director',
      source: 'model',
    };
    const crew = fakeCrew({ qc: report('fail', [copy]) });
    await runFilmCommand(argsFor(runDir, eventsFile('script'), 'script'), deps(crew));
    const approvalFile = approve(runDir, {
      version: 1,
      hookId: null,
      ctaId: null,
      formats: ['16:9'],
      confirmedClaimIds: [],
    });
    const code = await runFilmCommand(
      argsFor(runDir, eventsFile('render'), 'render', { approvalFile }),
      deps(crew),
    );
    expect(code).toBe(0);
    expect(crew.direct).toHaveBeenCalledTimes(1);
    const events = readEvents(eventsFile('render'));
    expectWellFormed(events);
    expect(events.find((event) => event.type === 'qc')).toMatchObject({
      verdict: 'fail',
      routable: 1,
      issues: [
        {
          check: 'copy-fit',
          owner: 'director',
          scene: 'hook',
          frame: 12,
          message: 'The headline runs past x 65% of the width Fix: Shorten it',
        },
      ],
    });
    expect(
      events.some(
        (event) => event.type === 'decision' && /the script is approved/.test(event.message),
      ),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'delivered', variants: ['16:9.main.none'] });
  });

  it('exits 2 for an approval of another version, before anything is spent', async () => {
    const { runDir, eventsFile } = setup();
    const crew = fakeCrew();
    await runFilmCommand(argsFor(runDir, eventsFile('script'), 'script'), deps(crew));
    const approvalFile = approve(runDir, {
      version: 2,
      hookId: null,
      ctaId: null,
      formats: ['16:9'],
      confirmedClaimIds: [],
    });
    const code = await runFilmCommand(
      argsFor(runDir, eventsFile('render'), 'render', { approvalFile }),
      deps(crew),
    );
    expect(code).toBe(2);
    expect(crew.art).not.toHaveBeenCalled();
    const events = readEvents(eventsFile('render'));
    expect(events).toEqual([
      expect.objectContaining({
        type: 'error',
        code: 'version_mismatch',
        message: 'The approval is for version 2 of the script, and the run dir holds version 1.',
        retryable: false,
      }),
    ]);
  });

  it('with --no-sync, stops with agent_drift when a deployed agent is not this checkout', async () => {
    const { runDir, eventsFile } = setup();
    const crew = fakeCrew();
    const checkAgents = vi.fn(async (_definitions: readonly { name: string }[]) => [
      {
        name: 'br-director',
        problem: 'its definition hash is 3fd453cfdcce, and this checkout’s is 1a2b3c4d5e6f',
      },
    ]);
    const args = argsFor(runDir, eventsFile('script'), 'script');
    expect(args.sync).toBe(false);
    const code = await runFilmCommand(args, deps(crew, { checkAgents }));
    expect(code).toBe(1);
    expect(checkAgents.mock.calls[0]?.[0].map((agent) => agent.name)).toEqual([
      'br-researcher',
      'br-director',
    ]);
    expect(crew.research).not.toHaveBeenCalled();
    expect(readEvents(eventsFile('script'))).toEqual([
      expect.objectContaining({ type: 'error', code: 'agent_drift', stage: null }),
    ]);
  });

  it('exits 4 when the crew budget cannot pay for the phase', async () => {
    const { runDir, eventsFile } = setup();
    const crew = fakeCrew();
    const code = await runFilmCommand(
      argsFor(runDir, eventsFile('script'), 'script', { maxUsd: 0.5 }),
      deps(crew),
    );
    expect(code).toBe(4);
    expect(crew.research).not.toHaveBeenCalled();
    expect(readEvents(eventsFile('script'))).toEqual([
      expect.objectContaining({ type: 'error', code: 'cost_cap' }),
    ]);
  });

  it('makes a whole sample film with --phase all: script_ready before any film, then delivered', async () => {
    const { runDir, eventsFile } = setup();
    const crew = fakeCrew();
    const code = await runFilmCommand(
      argsFor(runDir, eventsFile('all'), 'all', { maxUsd: 3 }),
      deps(crew),
    );
    expect(code).toBe(0);
    const events = readEvents(eventsFile('all'));
    expectWellFormed(events);
    const ready = events.findIndex((event) => event.type === 'script_ready');
    const mp4 = events.findIndex((event) => event.type === 'artifact' && event.kind === 'mp4');
    expect(ready).toBeGreaterThan(-1);
    expect(mp4).toBeGreaterThan(ready);
    expect(events.at(-1)).toMatchObject({
      type: 'delivered',
      version: 1,
      variants: ['16:9.main.none'],
    });
    expect(crew.direct.mock.calls[0]?.[0].brief.kind).toBe('outreach-sample');
  });

  it('refuses a send-back it cannot write yet, as bad input', async () => {
    const { runDir, eventsFile } = setup();
    const argv = [
      ...filmCommandArgs({
        url: 'https://www.nova.example/',
        phase: 'script',
        runDir,
        eventsFile: eventsFile('script'),
        maxUsd: 3,
        reviseFile: join(runDir, '..', 'revise.json'),
      }),
    ];
    const parsed = parseContractArgs(argv);
    if ('problem' in parsed) throw new Error(parsed.problem);
    expect(await runFilmCommand(parsed, deps(fakeCrew()))).toBe(2);
    expect(readEvents(eventsFile('script'))[0]).toMatchObject({ type: 'error', code: 'bad_input' });
  });

  it('stops every live session on a stop, says error stopped, and exits 143', async () => {
    const { runDir, eventsFile } = setup();
    const controller = new AbortController();
    let release: () => void = () => {};
    const crew = fakeCrew({
      research: () =>
        new Promise<void>((resolve) => {
          release = resolve;
          setTimeout(() => controller.abort(), 20);
        }),
    });
    const code = await runFilmCommand(
      argsFor(runDir, eventsFile('script'), 'script'),
      deps(crew, { signal: controller.signal, stopGraceMs: 1000 }),
    );
    release();
    expect(code).toBe(143);
    expect(crew.stop).toHaveBeenCalledTimes(1);
    const events = readEvents(eventsFile('script'));
    expectWellFormed(events);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'stopped', stage: 'research' });
    // Nothing is written after the last word, even when the crew carries on for a moment.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(readEvents(eventsFile('script')).at(-1)).toMatchObject({ code: 'stopped' });
  });

  it('exits 143 within 60 s of SIGTERM, as a process', async () => {
    const { runDir, eventsFile } = setup();
    const file = eventsFile('script');
    const child = spawn(TSX, [STOP_FIXTURE, runDir, file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    // Wait until the film is under way, then stop it.
    for (let tries = 0; tries < 200 && !output.includes('research started'); tries += 1)
      await new Promise((resolve) => setTimeout(resolve, 50));
    const sent = Date.now();
    child.kill('SIGTERM');
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code, output).toBe(143);
    expect(Date.now() - sent).toBeLessThan(60_000);
    expect(readEvents(file).at(-1)).toMatchObject({ type: 'error', code: 'stopped' });
  }, 90_000);
});

describe('what the founder reads', () => {
  it('keeps the sentence and drops keys, links, paths and ids', () => {
    expect(
      plain(
        'Uploaded /home/moss/br-run/film/delivered/film-16x9.mp4 to https://api.vetta.sh/v1/files/fil_wnpzpjk73kb4sffw4jmbgsfp0w/x.png?sig=abc for ses_5jgeehma9d6za9jr9g0fphgwmr.',
      ),
    ).toBe('Uploaded film-16x9.mp4 to api.vetta.sh for a session.');
    expect(plain(`a ${'very '.repeat(200)}long line`).length).toBeLessThanOrEqual(500);
  });
});
