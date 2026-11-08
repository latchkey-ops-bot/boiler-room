import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { expectedTemplate, type ResearchFacts } from '../src/director/checks.ts';
import { localizeCampaign } from '../src/film/assets.ts';
import { type CappableClient, CapReached, capClient } from '../src/film/cap.ts';
import { directorIssueOf, gateFilm, renderLayoutIssues } from '../src/film/crew.ts';
import { artDecisions, directorDecisions, qcDecisions } from '../src/film/decisions.ts';
import { LocalFilmOrder } from '../src/film/local-order.ts';
import {
  CREW_MEMBERS,
  DECISION_KINDS,
  DryRunFilmOrder,
  FILM_STAGES,
  FILM_STATUSES,
  stableId,
} from '../src/film/order.ts';
import {
  briefFailure,
  briefFor,
  type FilmCrew,
  type FilmOptions,
  type GateOutcome,
  makeFilm,
  NO_COST,
  orderProblem,
  type StageCost,
  type StageOutcome,
} from '../src/film/run.ts';
import { stableId as gtmStableId } from '../src/gtm/domain.ts';
import { DryRunFilmOrder as GtmDryRun } from '../src/gtm/ports.ts';
import type { QcIssue, QcReport } from '../src/quality/output.ts';

// ---------------------------------------------------------------------------------------------
// Fakes

const usd = (dollars: number) => Math.round(dollars * 1e6);
const model = (dollars: number): StageCost => ({ ...NO_COST, modelMicroUsd: usd(dollars) });

const issue = (
  check: string,
  owner: QcIssue['owner'],
  severity: QcIssue['severity'] = 'major',
): QcIssue => ({
  severity,
  check,
  sceneId: 'hook',
  frame: 12,
  timecode: '0:00.12',
  what: `${check} is wrong`,
  fix: `fix ${check}`,
  owner,
  source: 'model',
});

const qcReport = (verdict: 'pass' | 'fail', issues: QcIssue[] = []): QcReport =>
  ({
    verdict,
    blocked: null,
    renderDir: '',
    campaignId: 'film',
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

const write = (file: string, content: string) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
  return file;
};

interface Plan {
  /** Quality Check's verdict on each render, in order. The last repeats. */
  qc?: QcReport[];
  costs?: Partial<Record<'research' | 'direct' | 'art' | 'render' | 'qc', number>>;
  /** What the Art Director writes on each call. Default: a new campaign every time. */
  art?: (call: number) => string;
  gate?: () => Promise<GateOutcome>;
}

/** A crew whose every stage writes the files the real one would and answers what the plan says. */
function fakeCrew(plan: Plan = {}) {
  const costs = plan.costs ?? {};
  const reports = plan.qc ?? [qcReport('pass')];
  let calls = { art: 0, qc: 0, render: 0 };
  const done = <T>(value: T, cost: number, sessionIds: string[] = []): StageOutcome<T> => ({
    ok: true,
    value,
    cost: model(cost),
    sessionIds,
    decisions: [],
  });
  const crew = {
    research: vi.fn<FilmCrew['research']>(async ({ dir }) =>
      done(
        { researchFile: write(join(dir, 'research.json'), '{"claims":[]}') },
        costs.research ?? 0.05,
        ['ses_research'],
      ),
    ),
    direct: vi.fn<FilmCrew['direct']>(async ({ dir }) =>
      done(
        {
          campaignFile: write(join(dir, 'campaign.json'), `{"director":"${dir}"}`),
          handoffFile: write(join(dir, 'handoff.json'), '{"template":"Short"}'),
        },
        costs.direct ?? 0.5,
        ['ses_director'],
      ),
    ),
    art: vi.fn<FilmCrew['art']>(async ({ dir }) => {
      calls.art += 1;
      const content = plan.art
        ? plan.art(calls.art)
        : `{"art":${calls.art},"scenes":[{"text":[{"value":"Ship faster"}]}]}`;
      return done(
        { campaignFile: write(join(dir, 'campaign.art.json'), content) },
        costs.art ?? 0.1,
        [`ses_art_${calls.art}`],
      );
    }),
    gate: vi.fn<FilmCrew['gate']>(plan.gate ?? (async () => ({ ok: true, warnings: [] }))),
    render: vi.fn<FilmCrew['render']>(async ({ dir }) => {
      calls.render += 1;
      const film = write(join(dir, 'film.mp4'), `mp4 ${calls.render}`);
      return {
        ...done(
          {
            renderDir: dir,
            film,
            manifestFile: write(join(dir, 'film.manifest.json'), '{}'),
            sha256: createHash('sha256').update(readFileSync(film)).digest('hex'),
            bytes: readFileSync(film).byteLength,
            durationSeconds: 25,
          },
          0,
        ),
        cost: { ...NO_COST, computeMicroUsd: usd(costs.render ?? 0.2) },
        computerIds: [`cmp_${calls.render}`],
      };
    }),
    qc: vi.fn<FilmCrew['qc']>(async ({ renderDir }) => {
      const report = reports[Math.min(calls.qc, reports.length - 1)] as QcReport;
      calls.qc += 1;
      const reportFile = write(
        join(renderDir, 'film.qc', 'qc-report.json'),
        JSON.stringify(report),
      );
      return done({ report, reportFile }, costs.qc ?? 0.17, [`ses_qc_${calls.qc}`]);
    }),
  };
  return { crew, reset: () => (calls = { art: 0, qc: 0, render: 0 }) };
}

/** Naive's sessions, as closeSession reads them. `parked` sessions sit on their budget. */
function fakeSessions(parked: string[] = []) {
  const cancelled = new Set<string>();
  return {
    sessions: {
      get: vi.fn(async (id: string) =>
        parked.includes(id) && !cancelled.has(id)
          ? { status: 'idle', stop_reason: 'budget_paused', consumed_micro_usd: 1_500_000 }
          : cancelled.has(id)
            ? { status: 'cancelled', stop_reason: 'budget_paused', consumed_micro_usd: 1_500_000 }
            : { status: 'idle', stop_reason: 'end_turn', consumed_micro_usd: 100_000 },
      ),
      interrupt: vi.fn(async () => ({})),
      cancel: vi.fn(async (id: string) => {
        cancelled.add(id);
        return { status: 'cancelled' };
      }),
    },
  } as unknown as Parameters<typeof makeFilm>[1]['sessions'] & {
    sessions: { cancel: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  };
}

const outRoot = () => mkdtempSync(join(tmpdir(), 'br-film-'));

const order = (root: string, extra: Partial<FilmOptions> = {}): FilmOptions => ({
  url: 'https://www.example.com/',
  length: 'short',
  format: '16:9',
  sample: true,
  maxMicroUsd: usd(5),
  outRoot: root,
  runId: 'run-1',
  ...extra,
});

const clock = () => {
  let at = Date.parse('2026-11-08T06:00:00.000Z');
  return () => {
    at += 1000;
    return new Date(at);
  };
};

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

/** What a render stopped by a type card's layout check said, as it came back from Naive. */
const LAYOUT_ERROR =
  'SymbolicateableError [TypeCardLayoutError]: TYPE_CARD_LAYOUT at scene "name", text "name-descriptor": "Product development system" does not fit on one line of 1248 px at a cap height of 78 px. Shorten the copy: a type card never sets type below its cap height.';
const LAYOUT_FAILURE = [
  'Chunk 4 failed on 2 computers: A command on cmp_1 exited with 1:',
  '{"type":"progress","renderedFrames":9,"encodedFrames":0,"progress":0.03}',
  '',
  'node:internal/modules/run_main:107',
  '    triggerUncaughtException(',
  '    ^',
  '',
  LAYOUT_ERROR,
  '    at measure (http://localhost:3000/bundle.js:6115:13)',
  '    at TypeCard (http://localhost:3000/bundle.js:6233:18)',
  '',
  'A command on cmp_2 exited with 1:',
  LAYOUT_ERROR,
].join('\n');

// ---------------------------------------------------------------------------------------------

describe('makeFilm', () => {
  it('runs every stage in order and writes the film, its manifest and its decisions', async () => {
    const root = outRoot();
    const { crew } = fakeCrew();
    const manifest = await makeFilm(order(root), {
      crew,
      sessions: fakeSessions(),
      clock: clock(),
    });
    const dir = join(root, 'example.com', 'run-1');

    expect(manifest.state).toBe('ready');
    expect(manifest.qc).toBe('pass');
    expect(manifest.stages.map((stage) => stage.step)).toEqual([
      'research',
      'director',
      'art-director',
      'gate',
      'render',
      'quality-check',
    ]);
    for (const name of [
      'film.mp4',
      'campaign.json',
      'qc-report.json',
      'manifest.json',
      'decisions.json',
      'film-ledger.json',
    ])
      expect(existsSync(join(dir, name)), name).toBe(true);
    expect(readFileSync(join(dir, 'film.mp4'), 'utf8')).toBe('mp4 1');
    expect(json(join(dir, 'manifest.json'))).toEqual(manifest);
    expect(manifest.film).toMatchObject({
      file: 'film.mp4',
      durationSeconds: 25,
      format: '16:9',
      round: 1,
    });
    expect(manifest.script).toBe('Ship faster');
    // Each stage's time, cost and sessions are recorded, and the totals add up.
    const research = manifest.stages[0];
    expect(research).toMatchObject({ sessionIds: ['ses_research'], outcome: 'ok' });
    expect(research?.seconds).toBeGreaterThan(0);
    expect(manifest.spend.totalMicroUsd).toBe(usd(0.05 + 0.5 + 0.1 + 0.2 + 0.17));
    expect(manifest.spend.computeMicroUsd).toBe(usd(0.2));
    // The work of each round has its own folder.
    expect(crew.direct.mock.calls[0]?.[0].dir).toBe(join(dir, 'round-1', 'director'));
    expect(crew.render.mock.calls[0]?.[0].dir).toBe(join(dir, 'round-1', 'render'));
    const decisions = json(join(dir, 'decisions.json'));
    expect(decisions.decisions[0]).toMatchObject({ agent: 'coordinator', kind: 'started', seq: 0 });
    expect(decisions.decisions.at(-1)).toMatchObject({
      agent: 'coordinator',
      kind: 'delivered',
      status: 'done',
    });
    expect(
      json(join(dir, 'film-ledger.json')).entries.map((entry: { step: string }) => entry.step),
    ).toEqual(['researcher', 'director', 'art-director', 'render', 'quality-check']);
  });

  it('routes a Quality Check failure the Director owns back to it, renders again and checks again', async () => {
    const root = outRoot();
    const toDirector = issue('copy-fit', 'director');
    const { crew } = fakeCrew({ qc: [qcReport('fail', [toDirector]), qcReport('pass')] });
    const manifest = await makeFilm(order(root), {
      crew,
      sessions: fakeSessions(),
      clock: clock(),
    });
    const dir = join(root, 'example.com', 'run-1');

    expect(manifest).toMatchObject({ state: 'ready', qc: 'pass', routeBacks: 1, round: 2 });
    expect(crew.direct).toHaveBeenCalledTimes(2);
    const revise = crew.direct.mock.calls[1]?.[0].revise;
    expect(revise).toEqual({
      campaignFile: join(dir, 'round-1', 'director', 'campaign.json'),
      handoffFile: join(dir, 'round-1', 'director', 'handoff.json'),
      issues: [toDirector],
    });
    // The revised campaign is art-directed again, rendered again and checked again.
    expect(crew.art).toHaveBeenCalledTimes(2);
    expect(crew.art.mock.calls[1]?.[0]).toMatchObject({
      campaignFile: join(dir, 'round-2', 'director', 'campaign.json'),
      issues: [],
    });
    expect(crew.render).toHaveBeenCalledTimes(2);
    expect(crew.qc).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(dir, 'film.mp4'), 'utf8')).toBe('mp4 2');
    expect(manifest.film?.round).toBe(2);
    const sent = json(join(dir, 'decisions.json')).decisions.find(
      (entry: { kind: string }) => entry.kind === 'sent_back',
    );
    expect(sent).toMatchObject({ agent: 'coordinator', stage: 'script', round: 2 });
    expect(sent.message).toContain('back to the Director');
  });

  it('sends Art Director issues to the Art Director alone', async () => {
    const root = outRoot();
    const toArt = issue('asset-fit', 'art-director');
    const { crew } = fakeCrew({ qc: [qcReport('fail', [toArt]), qcReport('pass')] });
    const manifest = await makeFilm(order(root), {
      crew,
      sessions: fakeSessions(),
      clock: clock(),
    });
    expect(manifest).toMatchObject({ state: 'ready', qc: 'pass', routeBacks: 1 });
    expect(crew.direct).toHaveBeenCalledTimes(1);
    expect(crew.art.mock.calls[1]?.[0].issues).toEqual([toArt]);
    // The Art Director revises the Director's same campaign.
    expect(crew.art.mock.calls[1]?.[0].campaignFile).toBe(crew.art.mock.calls[0]?.[0].campaignFile);
  });

  it('stops after 2 route-backs, keeping the last film', async () => {
    const root = outRoot();
    const { crew } = fakeCrew({ qc: [qcReport('fail', [issue('copy-fit', 'director')])] });
    const manifest = await makeFilm(order(root, { maxMicroUsd: usd(12) }), {
      crew,
      sessions: fakeSessions(),
      clock: clock(),
    });
    expect(manifest).toMatchObject({ state: 'ready', qc: 'fail', routeBacks: 2, round: 3 });
    expect(crew.qc).toHaveBeenCalledTimes(3);
    expect(manifest.failure).toMatch(/sent back 2 time\(s\), the limit/);
    expect(readFileSync(join(root, 'example.com', 'run-1', 'film.mp4'), 'utf8')).toBe('mp4 3');
  });

  it('does not send back a film motion must fix, or one with only minor and placeholder issues', async () => {
    for (const issues of [
      [issue('copy-fit', 'director'), issue('inside-frame', 'motion')],
      [issue('accent-ration', 'art-director', 'minor'), issue('frame-0', 'director', 'blocker')],
    ]) {
      const root = outRoot();
      const { crew } = fakeCrew({ qc: [qcReport('fail', issues)] });
      const manifest = await makeFilm(order(root), {
        crew,
        sessions: fakeSessions(),
        clock: clock(),
      });
      expect(manifest).toMatchObject({ state: 'ready', qc: 'fail', routeBacks: 0 });
      expect(crew.direct).toHaveBeenCalledTimes(1);
      expect(crew.render).toHaveBeenCalledTimes(1);
    }
  });

  it('does not render again a campaign the route-back left unchanged', async () => {
    const root = outRoot();
    const { crew } = fakeCrew({
      qc: [qcReport('fail', [issue('asset-fit', 'art-director')])],
      art: () => '{"same":true}',
    });
    const manifest = await makeFilm(order(root), {
      crew,
      sessions: fakeSessions(),
      clock: clock(),
    });
    expect(crew.art).toHaveBeenCalledTimes(2);
    expect(crew.render).toHaveBeenCalledTimes(1);
    expect(manifest).toMatchObject({
      state: 'ready',
      qc: 'fail',
      failure: 'the route-back changed nothing',
    });
  });

  it('cancels a session parked on its budget, records it, and retries the stage once, smaller', async () => {
    const root = outRoot();
    const { crew } = fakeCrew();
    crew.research.mockImplementationOnce(async () => ({
      ok: false,
      failure: 'the session stopped (idle/budget_paused) without a new result',
      cost: model(1.5),
      sessionIds: ['ses_paused'],
      decisions: [],
    }));
    const sessions = fakeSessions(['ses_paused']);
    const manifest = await makeFilm(order(root), { crew, sessions, clock: clock() });

    expect(sessions.sessions.cancel).toHaveBeenCalledWith('ses_paused');
    expect(crew.research).toHaveBeenCalledTimes(2);
    expect(crew.research.mock.calls[0]?.[0].smaller).toBe(false);
    expect(crew.research.mock.calls[1]?.[0].smaller).toBe(true);
    const [first, retry] = manifest.stages;
    expect(first).toMatchObject({
      step: 'research',
      attempt: 'first',
      budgetPaused: true,
      cancelled: ['ses_paused'],
      outcome: 'failed',
    });
    expect(retry).toMatchObject({ step: 'research', attempt: 'smaller', outcome: 'ok' });
    // The paused attempt's spend counts against the cap.
    expect(manifest.spend.totalMicroUsd).toBeGreaterThan(usd(1.5));
    const messages = json(join(root, 'example.com', 'run-1', 'decisions.json')).decisions.map(
      (entry: { message: string }) => entry.message,
    );
    expect(messages).toContain('Cancelled session ses_paused, parked on its budget');
    expect(messages).toContain('Retrying research once, smaller');
    expect(manifest.state).toBe('ready');
  });

  it('cancels a parked session a successful stage left behind, without a retry', async () => {
    const root = outRoot();
    const { crew } = fakeCrew();
    const sessions = fakeSessions(['ses_director']);
    const manifest = await makeFilm(order(root), { crew, sessions, clock: clock() });
    expect(sessions.sessions.cancel).toHaveBeenCalledWith('ses_director');
    expect(crew.direct).toHaveBeenCalledTimes(1);
    expect(manifest.stages[1]).toMatchObject({
      step: 'director',
      budgetPaused: true,
      cancelled: ['ses_director'],
    });
  });

  it('never retries a stage that already retried smaller itself', async () => {
    const root = outRoot();
    const { crew } = fakeCrew();
    crew.direct.mockImplementationOnce(async () => ({
      ok: false,
      failure: 'the session was paused on its budget of $2.50 and has been cancelled',
      cost: model(2.5),
      sessionIds: ['ses_d1', 'ses_d2'],
      budgetPaused: true,
      retriedSmaller: true,
      decisions: [],
    }));
    const manifest = await makeFilm(order(root), {
      crew,
      sessions: fakeSessions(),
      clock: clock(),
    });
    expect(crew.direct).toHaveBeenCalledTimes(1);
    expect(crew.art).not.toHaveBeenCalled();
    expect(manifest).toMatchObject({ state: 'failed', film: null });
  });

  it('gives no stage more than the film has left, and stops a route-back the cap cannot pay for', async () => {
    const root = outRoot();
    const { crew } = fakeCrew({
      qc: [qcReport('fail', [issue('copy-fit', 'director')])],
      costs: { research: 0.2, direct: 0.9, art: 0.3, render: 0.2, qc: 0.2 },
    });
    const manifest = await makeFilm(order(root, { maxMicroUsd: usd(3) }), {
      crew,
      sessions: fakeSessions(),
      clock: clock(),
    });
    // Each ceiling leaves room for the stages after it in the round.
    expect(crew.research.mock.calls[0]?.[0].ceilingMicroUsd).toBe(usd(3 - 2.3));
    expect(crew.direct.mock.calls[0]?.[0].ceilingMicroUsd).toBe(usd(2.8 - 1.3));
    expect(crew.art.mock.calls[0]?.[0].ceilingMicroUsd).toBe(usd(1.9 - 1.3));
    expect(crew.render.mock.calls[0]?.[0].ceilingMicroUsd).toBe(usd(1.6 - 1.0));
    expect(crew.qc.mock.calls[0]?.[0].ceilingMicroUsd).toBe(usd(1.4));
    // $1.20 is left, and a Director round needs $2.30: nothing more starts.
    expect(manifest).toMatchObject({ state: 'ready', qc: 'fail', routeBacks: 0 });
    expect(manifest.failure).toMatch(
      /Another round needs at least \$2\.30, and \$1\.20 .* is left/,
    );
    expect(crew.direct).toHaveBeenCalledTimes(1);
    expect(manifest.spend.totalMicroUsd).toBeLessThanOrEqual(manifest.spend.capMicroUsd);
  });

  it('refuses a stage before it starts when the film cannot pay for it', async () => {
    const root = outRoot();
    const { crew } = fakeCrew({ costs: { research: 1.2 } });
    const manifest = await makeFilm(order(root, { maxMicroUsd: usd(3) }), {
      crew,
      sessions: fakeSessions(),
      clock: clock(),
    });
    expect(crew.direct).not.toHaveBeenCalled();
    expect(manifest.state).toBe('failed');
    expect(manifest.stages.at(-1)).toMatchObject({ step: 'director', outcome: 'refused' });
    expect(manifest.failure).toMatch(
      /director not started: \$1\.80 of the film's \$3\.00 cap is left/,
    );
  });

  it('sends copy a scene refused to set while drawing back to the Director, and renders again', async () => {
    const root = outRoot();
    const { crew } = fakeCrew();
    const refused = renderLayoutIssues(LAYOUT_FAILURE);
    crew.render.mockImplementationOnce(async () => ({
      ok: false,
      failure: LAYOUT_FAILURE,
      cost: { ...NO_COST, computeMicroUsd: usd(0.04) },
      sessionIds: [],
      issues: refused,
      decisions: [],
    }));
    const manifest = await makeFilm(order(root), {
      crew,
      sessions: fakeSessions(),
      clock: clock(),
    });

    expect(manifest).toMatchObject({ state: 'ready', qc: 'pass', routeBacks: 1, round: 2 });
    expect(crew.direct.mock.calls[1]?.[0].revise?.issues).toEqual(refused);
    expect(crew.render).toHaveBeenCalledTimes(2);
    expect(crew.qc).toHaveBeenCalledTimes(1);
    // The failure is kept in a line, without the progress output and the stack.
    const failed = manifest.stages.find((stage) => stage.step === 'render');
    expect(failed?.failure).toBe(briefFailure(LAYOUT_FAILURE));
    expect(failed?.cost.computeMicroUsd).toBe(usd(0.04));
    const sent = json(join(root, 'example.com', 'run-1', 'decisions.json')).decisions.find(
      (entry: { kind: string }) => entry.kind === 'sent_back',
    );
    expect(sent.why).toMatch(/^motion refused to draw the film, and the Director owns these/);
  });

  it('fails the film when a refused render cannot be sent back', async () => {
    const root = outRoot();
    const { crew } = fakeCrew();
    crew.render.mockImplementation(async () => ({
      ok: false,
      failure: LAYOUT_FAILURE,
      cost: NO_COST,
      sessionIds: [],
      issues: renderLayoutIssues(LAYOUT_FAILURE),
      decisions: [],
    }));
    const manifest = await makeFilm(order(root, { maxRouteBacks: 0 }), {
      crew,
      sessions: fakeSessions(),
      clock: clock(),
    });
    expect(manifest).toMatchObject({ state: 'failed', film: null, routeBacks: 0 });
    expect(crew.qc).not.toHaveBeenCalled();
  });

  it('never renders a campaign validateFilm refuses', async () => {
    const root = outRoot();
    const nova = json(
      join(import.meta.dirname, '../../packages/schema/examples/nova.campaign.json'),
    );
    nova.scenes[1].props = { demo: 'video' };
    const broken = JSON.stringify(nova);
    const { crew } = fakeCrew({ art: () => broken, gate: undefined });
    crew.gate.mockImplementation(gateFilm);
    const manifest = await makeFilm(order(root), {
      crew,
      sessions: fakeSessions(),
      clock: clock(),
    });

    expect(crew.gate).toHaveBeenCalledTimes(1);
    expect(crew.render).not.toHaveBeenCalled();
    expect(crew.qc).not.toHaveBeenCalled();
    expect(manifest).toMatchObject({ state: 'failed', film: null });
    expect(manifest.failure).toBe('validateFilm refused the film, so it was not rendered');
    const refusal = json(join(root, 'example.com', 'run-1', 'decisions.json')).decisions.find(
      (entry: { agent: string }) => entry.agent === 'validator',
    );
    expect(refusal).toMatchObject({ kind: 'failed', stage: 'render' });
    expect(refusal.message).toBe('validateFilm refused the film: PROPS_INVALID');
    expect(refusal.data.issues[0]).toMatchObject({
      code: 'PROPS_INVALID',
      path: 'scenes[1].props.demo',
    });
  });

  it('refuses an order it could never finish', () => {
    expect(
      orderProblem({ url: 'https://a.com', length: 'standard', sample: true, maxMicroUsd: usd(5) }),
    ).toMatch(/outreach sample is Short/);
    expect(
      orderProblem({ url: 'https://a.com', length: 'short', sample: true, maxMicroUsd: usd(2) }),
    ).toMatch(/at least \$2\.60/);
    expect(
      orderProblem({ url: 'ftp://a.com', length: 'short', sample: true, maxMicroUsd: usd(5) }),
    ).toMatch(/http/);
  });
});

describe('a render that motion refused', () => {
  it('reads the copy a template could not set, once, as an issue for the Director', () => {
    expect(renderLayoutIssues(LAYOUT_FAILURE)).toEqual([
      {
        severity: 'blocker',
        check: 'type-card-layout',
        sceneId: 'name',
        frame: null,
        timecode: null,
        what: 'Text "name-descriptor": "Product development system" does not fit on one line of 1248 px at a cap height of 78 px. Shorten the copy: a type card never sets type below its cap height.',
        fix: 'Shorten text "name-descriptor" until it sets on its lines at its cap height. motion never sets type smaller to make copy fit.',
        owner: 'director',
        source: 'code',
      },
    ]);
    const unfit = renderLayoutIssues(
      'Error: LAYOUT_UNFIT: Scene "proof": the number "50,000+" does not fit at its cap height.',
    );
    expect(unfit).toMatchObject([
      { check: 'stat-counter-layout', sceneId: 'proof', owner: 'director' },
    ]);
    expect(renderLayoutIssues('Chunk 2 failed: ECONNRESET')).toEqual([]);
  });

  it('reads every scene of a refusal made before any computer, in either way it is printed', () => {
    const card = (scene: string, text: string, value: string) =>
      `TYPE_CARD_LAYOUT at scene "${scene}", text "${text}": "${value}" does not fit on one line of 1248 px at a cap height of 78 px. Shorten the copy: a type card never sets type below its cap height.`;
    const value = card('value', 'value-line', 'Analytics, errors and replays');
    const name = card('name', 'name-descriptor', "Your product's context layer");
    // posthog.com, 8 November: both scenes, which two renders on computers found one at a time.
    const listed = [
      'FilmRejected: This campaign cannot be rendered: laying out the copy found 2 error(s).',
      `- TYPE_CARD_LAYOUT at scenes[3].text[0].value: ${value} Shorten scenes[3].text[0].value.`,
      `- TYPE_CARD_LAYOUT at scenes[16].text[1].value: ${name} Shorten scenes[16].text[1].value.`,
    ].join('\n');
    const oneLine = `This campaign cannot be rendered: laying out the copy found 2 error(s). (1) TYPE_CARD_LAYOUT at scenes[3].text[0].value: ${value} Shorten scenes[3].text[0].value. (2) TYPE_CARD_LAYOUT at scenes[16].text[1].value: ${name} Shorten scenes[16].text[1].value.`;
    const fromChunks = `motion refused to draw the film (2 refusal(s)):\n${value}\n${name}`;
    for (const text of [listed, oneLine, fromChunks]) {
      expect(renderLayoutIssues(text).map((issue) => [issue.sceneId, issue.check])).toEqual([
        ['value', 'type-card-layout'],
        ['name', 'type-card-layout'],
      ]);
    }
  });

  it('keeps a failure to its first line and the line that names the error', () => {
    expect(briefFailure(LAYOUT_FAILURE)).toBe(
      'Chunk 4 failed on 2 computers: A command on cmp_1 exited with 1: SymbolicateableError [TypeCardLayoutError]: TYPE_CARD_LAYOUT at scene "name", text "name-descriptor": "Product development system" does not fit on one line of 1248 px at a cap height of 78 px. Shorten the copy: a type card never sets type below its cap height.',
    );
    expect(briefFailure('no campaign written')).toBe('no campaign written');
  });
});

describe('the gate', () => {
  it('passes an example campaign that validateFilm accepts', async () => {
    const gate = await gateFilm({
      campaignFile: join(import.meta.dirname, '../../packages/schema/examples/nova.campaign.json'),
      format: '16:9',
    });
    expect(gate.ok).toBe(true);
  });
});

describe('the render campaign', () => {
  it('puts every Naive file beside a copy of the campaign, from disk first', async () => {
    const root = outRoot();
    const campaignFile = write(
      join(root, 'art', 'campaign.art.json'),
      JSON.stringify({
        id: 'film',
        assets: {
          home: { kind: 'image', src: 'naive://files/fil_home' },
          field: { kind: 'image', src: 'naive://files/fil_field' },
          logo: { kind: 'svg', src: 'naive://files/fil_logo' },
          font: { kind: 'font', src: 'https://fonts.gstatic.com/s/inter.woff2' },
        },
      }),
    );
    write(join(root, 'research', 'files', 'home.png'), 'home bytes');
    write(join(root, 'art', 'assets', 'generated', 'field.webp'), 'field bytes');
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const download = vi.fn(async () => png);
    const local = await localizeCampaign({
      campaignFile,
      outDir: join(root, 'render'),
      searchDirs: [join(root, 'research', 'files'), join(root, 'art', 'assets', 'generated')],
      download,
    });
    const campaign = json(local.campaignFile);
    expect(local.campaignFile).toBe(join(root, 'render', 'campaign.json'));
    expect(campaign.assets.home.src).toBe('assets/home.png');
    expect(campaign.assets.field.src).toBe('assets/field.webp');
    expect(campaign.assets.logo.src).toBe('assets/logo.png');
    expect(campaign.assets.font.src).toBe('https://fonts.gstatic.com/s/inter.woff2');
    expect(download).toHaveBeenCalledExactlyOnceWith('fil_logo');
    expect(readFileSync(join(root, 'render', 'assets', 'home.png'), 'utf8')).toBe('home bytes');
    expect(local.downloaded).toEqual(['logo']);
  });
});

describe('the brief for an order', () => {
  const facts = (claims: number): ResearchFacts =>
    ({
      host: 'example.com',
      claims,
      approvedClaimIds: [],
      numericClaimIds: [],
      surfaces: ['a', 'b'],
      capturedTiles: 2,
    }) as unknown as ResearchFacts;

  it('asks for the length the order names, by the rules of §1', () => {
    expect(
      expectedTemplate(briefFor({ sample: true, length: 'short', format: '16:9' }), facts(9), 9)
        .label,
    ).toBe('Short');
    const social = briefFor({ sample: false, length: 'short', format: '9:16' });
    expect(social).toMatchObject({ kind: 'social-cut', formats: ['9:16'] });
    expect(expectedTemplate(social, facts(9), 9).label).toBe('Short');
    const standard = briefFor({ sample: false, length: 'standard', format: '16:9' });
    expect(standard).toMatchObject({ kind: 'customer-order', asksFor45s: true });
    expect(expectedTemplate(standard, facts(9), 9).label).toBe('Standard');
    // Rule 2 still makes it Short when the research has too few usable claims.
    expect(expectedTemplate(standard, facts(2), 2).label).toBe('Short');
  });
});

// ---------------------------------------------------------------------------------------------

/** Sessions that run until `stop` is called, then stop at what they used. */
function capBase() {
  const states = new Map<string, { status: string; consumed_micro_usd: number }>();
  let count = 0;
  const base = {
    sessions: {
      create: vi.fn(async (body: { budget_micro_usd: number }) => {
        count += 1;
        const id = `ses_${count}`;
        states.set(id, { status: 'running', consumed_micro_usd: 0 });
        return { id, budget: body.budget_micro_usd };
      }),
      send: vi.fn(async () => ({ accepted_seq: 1 })),
      get: vi.fn(async (id: string) => states.get(id) ?? { status: 'idle', consumed_micro_usd: 0 }),
    },
    media: { images: { generate: vi.fn(async () => ({ cost_micro_usd: 15_000, files: [] })) } },
  };
  const stop = (id: string, used: number): void => {
    states.set(id, { status: 'idle', consumed_micro_usd: used });
  };
  return { base, stop };
}

describe('the cap inside a stage', () => {
  it('clamps a session to the room left, holding running sessions at their whole budget', async () => {
    const { base, stop } = capBase();
    const capped = capClient(base as unknown as CappableClient, { ceilingMicroUsd: usd(2.5) });
    const first = (await capped.client.sessions.create({
      budget_micro_usd: usd(2.5),
    } as never)) as unknown as { budget: number };
    expect(first.budget).toBe(usd(2.5));
    stop('ses_1', usd(0.4));
    const second = (await capped.client.sessions.create({
      budget_micro_usd: usd(2.5),
    } as never)) as unknown as { budget: number };
    expect(second.budget).toBe(usd(2.1));
    expect(await capped.committedMicroUsd()).toBe(usd(2.5));
  });

  it('refuses a session the room cannot hold, once nothing is running', async () => {
    const { base, stop } = capBase();
    const capped = capClient(base as unknown as CappableClient, {
      ceilingMicroUsd: usd(1.5),
      sleep: async () => stop('ses_1', usd(0.9)),
    });
    await capped.client.sessions.create({ budget_micro_usd: usd(1) } as never);
    // The second waits for the first to stop, and then $0.60 is left: under the $1 a session needs.
    await expect(
      capped.client.sessions.create({ budget_micro_usd: usd(1) } as never),
    ).rejects.toThrow(CapReached);
    expect(base.sessions.create).toHaveBeenCalledTimes(1);
  });

  it('waits for a running session to stop when that makes room', async () => {
    const { base, stop } = capBase();
    const capped = capClient(base as unknown as CappableClient, {
      ceilingMicroUsd: usd(1.5),
      sleep: async () => stop('ses_1', usd(0.05)),
    });
    await capped.client.sessions.create({ budget_micro_usd: usd(1) } as never);
    const second = (await capped.client.sessions.create({
      budget_micro_usd: usd(1),
    } as never)) as unknown as {
      budget: number;
    };
    expect(second.budget).toBe(usd(1));
  });

  it('wakes a session only while its whole budget still fits', async () => {
    const { base, stop } = capBase();
    const capped = capClient(base as unknown as CappableClient, { ceilingMicroUsd: usd(3) });
    await capped.client.sessions.create({ budget_micro_usd: usd(2) } as never);
    stop('ses_1', usd(0.5));
    await capped.client.sessions.create({ budget_micro_usd: usd(2) } as never);
    // ses_2 holds $2 while it runs, so ses_1's $2 no longer fits under $3.
    await expect(capped.client.sessions.send('ses_1', {} as never)).rejects.toThrow(CapReached);
    stop('ses_2', usd(0.3));
    await capped.client.sessions.send('ses_1', {} as never);
    expect(base.sessions.send).toHaveBeenCalledTimes(1);
  });

  it('counts generated images and refuses one the room cannot hold', async () => {
    const { base } = capBase();
    const capped = capClient(base as unknown as CappableClient, { ceilingMicroUsd: 60_000 });
    await capped.client.media?.images.generate({} as never);
    expect(capped.mediaMicroUsd()).toBe(15_000);
    await expect(capped.client.media?.images.generate({} as never)).rejects.toThrow(CapReached);
  });
});

// ---------------------------------------------------------------------------------------------

describe('decisions', () => {
  it('use the web app words, so its film page shows them as they are', () => {
    const web = readFileSync(join(import.meta.dirname, '../../apps/web/src/lib/film.ts'), 'utf8');
    const words = (name: string) => {
      const body =
        new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`).exec(web)?.[1] ?? '';
      return [...body.matchAll(/'([a-z_:0-9]+)'/g)].map((match) => match[1]);
    };
    expect(FILM_STAGES).toEqual(words('STAGES'));
    expect(CREW_MEMBERS).toEqual(words('CREW'));
    expect(DECISION_KINDS).toEqual(words('EVENT_KINDS'));
    expect(FILM_STATUSES).toEqual(words('FILM_STATUSES'));
  });

  it('say who decided what, and why, from the stage reports', () => {
    const director = directorDecisions(
      {
        rounds: [
          {
            blocking: [{ code: 'TEXT_TOO_LONG', message: 'type-card headline is 41 characters' }],
            other: [],
          },
          { blocking: [], other: [] },
        ],
        sessions: [],
      },
      {
        template: 'Short',
        reason: 'rule 1: an outreach sample is Short',
        substitutions: [{ row: 7, from: 'proof-bars', to: 'stat-counter' }],
        tier4SceneIds: [],
        issuesLeft: [],
        notes: '',
      },
    );
    expect(director.map(({ agent, kind }) => `${agent} ${kind}`)).toEqual([
      'validator sent_back',
      'validator passed',
      'director decision',
      'director decision',
    ]);
    expect(director[2]).toMatchObject({
      message: 'Chose the Short template',
      why: 'rule 1: an outreach sample is Short',
    });

    const art = artDecisions({
      family: { name: 'Neutral Cut', background: '#ffffff', background_l: 1, ground: '#ffffff' },
      colour_changes: [],
      assets_per_scene: [
        {
          scene_id: 'hero',
          asset_ids: ['home'],
          source: 'agent',
          reason: 'the clearest product screen',
        },
      ],
      generated: [],
      sent_back: [],
    });
    expect(art[1]).toMatchObject({
      agent: 'art_director',
      message: 'Picked home for hero',
      why: 'the clearest product screen',
    });

    const qc = qcDecisions(
      qcReport('fail', [
        issue('copy-fit', 'director'),
        issue('taste', 'art-director', 'minor'),
      ]) as never,
    );
    expect(qc[0]).toMatchObject({
      agent: 'quality_check',
      kind: 'sent_back',
      message: 'Failed the film with 1 blocker or major issue',
    });
    expect(qc).toHaveLength(2);
  });

  it('word a Quality Check issue for the Director with the path of its scene', () => {
    const mapped = directorIssueOf(issue('copy-fit', 'director'), {
      scenes: [{ id: 'intro' }, { id: 'hook' }],
    });
    expect(mapped).toMatchObject({
      code: 'QC_COPY_FIT',
      path: 'campaign.scenes[1]',
      severity: 'error',
      owner: 'director',
      fix: 'fix copy-fit',
    });
    expect(mapped.message).toBe(
      'Quality Check (model, major) in scene hook at frame 12 (0:00.12): copy-fit is wrong',
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe('FilmOrder', () => {
  it('is the one GTM uses, with the same dry-run ids', async () => {
    expect(GtmDryRun).toBe(DryRunFilmOrder);
    for (const key of ['lead-1', 'acme.dev:2026-11-08'])
      expect(await stableId('fo-dry', key)).toBe(gtmStableId('fo-dry', key));
  });

  it('keeps the dry run: three reads to ready, simulated, no file', async () => {
    const dry = new DryRunFilmOrder('https://app.example');
    const { orderId } = await dry.order({ idempotencyKey: 'lead-1' });
    expect((await dry.order({ idempotencyKey: 'lead-1' })).orderId).toBe(orderId);
    expect(orderId).toMatch(/^fo-dry-[2-9a-z]{6}$/);
    expect((await dry.status(orderId)).state).toBe('queued');
    expect((await dry.status(orderId)).state).toBe('working');
    expect(await dry.status(orderId)).toMatchObject({
      state: 'ready',
      qc: 'pass',
      simulated: true,
    });
    expect(await dry.decisions(orderId)).toEqual({ orderId, simulated: true, decisions: [] });
    await expect(dry.file()).rejects.toThrow('no file');
  });

  it('orders a film through the film command, polls it, and reads its file and decisions', async () => {
    const root = outRoot();
    const launched: string[][] = [];
    const alive = new Set<number>();
    const killed: number[] = [];
    const local = new LocalFilmOrder({
      root,
      launch: (args) => {
        launched.push(args);
        alive.add(4000 + launched.length);
        return { pid: 4000 + launched.length };
      },
      alive: (pid) => alive.has(pid),
      kill: (pid) => killed.push(pid),
      clock: () => new Date('2026-11-08T06:00:00.000Z'),
    });
    const input = {
      url: 'https://www.example.com/',
      idempotencyKey: 'lead-1',
      budgetMicroUsd: usd(4),
      leadRef: 'lead-1',
    };
    const { orderId } = await local.order(input);
    expect((await local.order(input)).orderId).toBe(orderId);
    expect(launched).toHaveLength(1);
    const args = launched[0] as string[];
    expect(args.slice(0, 7)).toEqual([
      'https://www.example.com/',
      '--length',
      'short',
      '--format',
      '16:9',
      '--sample',
      '--max-usd',
    ]);
    expect(args[7]).toBe('4');
    const runId = args[args.indexOf('--run-id') + 1] as string;
    expect(await local.status(orderId)).toMatchObject({
      state: 'working',
      stage: 'research',
      simulated: false,
    });

    // A second film waits while the first is made: they share the Researcher's computer.
    const second = await local.order({
      ...input,
      idempotencyKey: 'lead-2',
      url: 'https://other.example/',
    });
    expect(launched).toHaveLength(1);
    expect((await local.status(second.orderId)).state).toBe('queued');

    // The film command writes the run folder; the order reads it.
    const { crew } = fakeCrew();
    await makeFilm(order(root, { runId, maxMicroUsd: usd(4), order: { orderId } }), {
      crew,
      sessions: fakeSessions(),
      clock: clock(),
    });
    const status = await local.status(orderId);
    expect(status).toMatchObject({
      state: 'ready',
      qc: 'pass',
      stage: 'delivery',
      script: 'Ship faster',
    });
    expect(status.costMicroUsd).toBe(usd(1.02));
    // The first is finished, so the status read started the second.
    expect(launched).toHaveLength(2);
    const file = await local.file(orderId);
    expect(file).toMatchObject({ contentType: 'video/mp4', durationSeconds: 25, bytes: 5 });
    expect(file.url).toMatch(/^file:\/\/.*\/example\.com\/.*\/film\.mp4$/);
    const decisions = await local.decisions(orderId);
    expect(decisions.decisions[0]).toMatchObject({ agent: 'coordinator', kind: 'started' });
    expect(decisions.decisions.at(-1)).toMatchObject({ kind: 'delivered' });
    await expect(local.share()).rejects.toThrow('the web app publishes film pages');

    // Withdrawing stops a film still being made and deletes the file. Twice is safe.
    await local.withdraw(second.orderId, 'opt_out');
    expect(killed).toEqual([4002]);
    await local.withdraw(orderId, 'removal');
    await local.withdraw(orderId, 'removal');
    expect(existsSync(join(root, 'example.com', runId, 'film.mp4'))).toBe(false);
    expect(await local.status(orderId)).toMatchObject({
      state: 'withdrawn',
      failure: 'withdrawn: removal',
    });
    await expect(local.file(orderId)).rejects.toThrow('withdrawn');
  });

  it('says a film failed when its command stopped without finishing', async () => {
    const root = outRoot();
    const local = new LocalFilmOrder({ root, launch: () => ({ pid: 1 }), alive: () => false });
    const { orderId } = await local.order({
      url: 'https://example.com/',
      idempotencyKey: 'k',
      budgetMicroUsd: usd(5),
      leadRef: 'r',
    });
    expect(await local.status(orderId)).toMatchObject({
      state: 'failed',
      failure: expect.stringMatching(/stopped before it wrote a manifest/),
    });
  });
});
