/**
 * `pnpm film <url>`: one URL in, one finished film out. The Researcher, then the Director with its
 * validate and repair loop, then the Art Director, then the render gate (`validateCampaign` and
 * `validateFilm`), the render on Naive computers, and Quality Check on the render's own frames.
 * A Quality Check failure the Director or the Art Director can fix goes back once to that owner
 * with its issues, the film is rendered again and checked again: at most 2 route-backs, under a
 * hard cap on everything the film spends (sessions, computers and generated media).
 *
 * This file holds the order of the work and its limits, and nothing that talks to Naive: the
 * stages are a `FilmCrew` (`crew.ts` is the live one, the tests pass fakes). Everything for one
 * film is written under `out/films/<host>/<run-id>/`, or the film runner's `--run-dir`.
 *
 * The film runner splits the same work in two (`command.ts`): `writeScript` is the Researcher and
 * the Director with its checks, up to the script the customer approves, and `renderApproved` is
 * the Art Director, the render, Quality Check and delivery of exactly the cut they approved, from
 * the same run dir. Both report as they go through `FilmEvents`.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { FilmAgent } from '@boiler-room/film-runner/contract';
import type { DirectorBrief } from '../director/output.ts';
import { OUTREACH_BRIEF } from '../director/output.ts';
import { scrub } from '../naive/client.ts';
import { type CloseClient, closeSession } from '../naive/session.ts';
import { LEDGER_FILE, type Step as LedgerStep, recordSpend, routable } from '../pipeline/ledger.ts';
import type { QcIssue, QcReport } from '../quality/output.ts';
import { siteHost } from '../researcher/text.ts';
import { type DecisionDraft, DecisionLog } from './decisions.ts';
import { type FilmEvents, NO_EVENTS } from './events.ts';
import {
  FILM_FORMATS,
  type FilmDecision,
  type FilmFormat,
  type FilmLength,
  type FilmStage,
  type OrderState,
} from './order.ts';

// ---------------------------------------------------------------------------------------------
// What a stage is, as the film sees it

export const STEPS = [
  'research',
  'director',
  'art-director',
  'gate',
  'render',
  'quality-check',
] as const;
export type FilmStep = (typeof STEPS)[number];

export interface StageCost {
  modelMicroUsd: number;
  computeMicroUsd: number;
  mediaMicroUsd: number;
}

export const NO_COST: StageCost = { modelMicroUsd: 0, computeMicroUsd: 0, mediaMicroUsd: 0 };
const total = (cost: StageCost) => cost.modelMicroUsd + cost.computeMicroUsd + cost.mediaMicroUsd;

export interface StageOutcome<T> {
  ok: boolean;
  value?: T;
  failure?: string;
  /** What the stage spent, whether or not it succeeded. */
  cost: StageCost;
  /** Every Naive session the stage started. The film closes each one afterwards. */
  sessionIds: string[];
  /** A session of the stage was paused on its budget. */
  budgetPaused?: boolean;
  /** Sessions the stage itself found parked on their budget and cancelled. */
  cancelled?: string[];
  /** The stage already retried smaller after a pause, so the film does not retry it again. */
  retriedSmaller?: boolean;
  /** The stage's ceiling stopped it. */
  capped?: boolean;
  /** What the stage's agents decided, in order. */
  decisions: DecisionDraft[];
  /** The stage's files, by role, as paths. */
  files?: Record<string, string>;
  /** Render computers, for the manifest. */
  computerIds?: string[];
  /** What the stage refused for its owner to fix, such as copy a scene could not set. */
  issues?: QcIssue[];
}

/** What every spending stage is given: what it may spend, and whether this is the smaller retry. */
export interface StageLimits {
  /** A hard ceiling on the stage's whole spend, in micro-USD. Never more than the film has left. */
  ceilingMicroUsd: number;
  /** True on the one retry after a budget pause: the stage does less. */
  smaller: boolean;
}

export interface GateIssue {
  code: string;
  path: string;
  message: string;
  severity: string;
  fix?: string;
}

export type GateOutcome =
  | { ok: true; warnings: string[] }
  | {
      ok: false;
      /** Which gate refused: `validateCampaign`, `validateFilm`, or the selected cut. */
      check: string;
      issues: GateIssue[];
    };

export interface RenderedFilm {
  renderDir: string;
  film: string;
  manifestFile: string;
  sha256: string;
  bytes: number;
  durationSeconds: number;
}

export interface Revision {
  /** The Director's own last campaign and handoff, which it revises. */
  campaignFile: string;
  handoffFile: string;
  issues: QcIssue[];
}

/** Which opening and which call to action a film is cut with. Null: the main one, none. */
export interface Cut {
  hookId: string | null;
  ctaId: string | null;
}

/** The production crew, one call per stage. */
export interface FilmCrew {
  research(
    input: { url: string; dir: string } & StageLimits,
  ): Promise<StageOutcome<{ researchFile: string }>>;
  direct(
    input: {
      researchFile: string;
      brief: DirectorBrief;
      dir: string;
      revise?: Revision;
    } & StageLimits,
  ): Promise<StageOutcome<{ campaignFile: string; handoffFile: string }>>;
  art(
    input: {
      campaignFile: string;
      researchFile: string;
      dir: string;
      issues: QcIssue[];
    } & StageLimits,
  ): Promise<StageOutcome<{ campaignFile: string }>>;
  /** `validateCampaign` and `validateFilm` on the cut, in this format. Spends nothing. */
  gate(input: { campaignFile: string; format: FilmFormat } & Partial<Cut>): Promise<GateOutcome>;
  /** Renders the cut. The research's files are where its pictures already are on disk. */
  render(
    input: {
      campaignFile: string;
      researchFile: string;
      format: FilmFormat;
      dir: string;
    } & Partial<Cut> &
      StageLimits,
  ): Promise<StageOutcome<RenderedFilm>>;
  qc(
    input: { renderDir: string; researchFile: string } & StageLimits,
  ): Promise<StageOutcome<{ report: QcReport; reportFile: string }>>;
}

// ---------------------------------------------------------------------------------------------
// Limits

/** The least a stage needs to start, in micro-USD. Sonnet and Opus sessions need $1. */
export const FLOORS: Record<FilmStep, number> = {
  research: 300_000,
  director: 1_000_000,
  // Under $1 the Art Director runs as code alone: the code's picks, nothing generated.
  'art-director': 0,
  gate: 0,
  render: 300_000,
  'quality-check': 1_000_000,
};

/** The most a stage is given, before the film's own cap. */
export const CEILINGS: Record<FilmStep, number> = {
  research: 1_500_000,
  // One session of up to $2.50, and the one smaller retry after a budget pause.
  director: 3_500_000,
  // $1 of review sessions, which run two at a time, and $0.10 of generated images.
  'art-director': 2_100_000,
  gate: 0,
  render: 2_000_000,
  'quality-check': 1_500_000,
};

/** What a stage leaves for the stages after it in the same round. */
export const RESERVES: Record<FilmStep, number> = {
  research: FLOORS.director + FLOORS.render + FLOORS['quality-check'],
  director: FLOORS.render + FLOORS['quality-check'],
  'art-director': FLOORS.render + FLOORS['quality-check'],
  gate: 0,
  render: FLOORS['quality-check'],
  'quality-check': 0,
};

export const DEFAULT_MAX_MICRO_USD = 5_000_000;
export const MAX_ROUTE_BACKS = 2;

const LEDGER_STEP: Record<FilmStep, LedgerStep | null> = {
  research: 'researcher',
  director: 'director',
  'art-director': 'art-director',
  gate: null,
  render: 'render',
  'quality-check': 'quality-check',
};

/** Each step's station on the web app's tracker. */
export const STAGE_OF: Record<FilmStep, FilmStage> = {
  research: 'research',
  director: 'script',
  'art-director': 'art_direction',
  gate: 'render',
  render: 'render',
  'quality-check': 'review',
};

// ---------------------------------------------------------------------------------------------
// The order

export interface FilmOptions {
  url: string;
  length: FilmLength;
  format: FilmFormat;
  /** An outreach sample: Short by rule 1, made unasked for a lead. */
  sample: boolean;
  /** The hard cap on the whole film, in micro-USD. */
  maxMicroUsd: number;
  /** `out/films`. The film goes in `<outRoot>/<host>/<runId>/`, unless `dir` names it. */
  outRoot: string;
  runId?: string;
  /** The film's own folder, absolute: the film runner's `--run-dir`, kept across phases. */
  dir?: string;
  /** The cuts the script is written for. Default: `format` alone. */
  formats?: readonly FilmFormat[];
  /** The least each step needs, where it differs: a render on this computer needs no computer. */
  floors?: Partial<Record<FilmStep, number>>;
  maxRouteBacks?: number;
  /** Kept in the manifest for `FilmOrder`. */
  order?: { orderId?: string; idempotencyKey?: string; leadRef?: string };
}

/** Why an order cannot be made, or null. */
export function orderProblem(
  options: Pick<FilmOptions, 'url' | 'length' | 'sample' | 'maxMicroUsd'>,
): string | null {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    return `${options.url} is not a URL`;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return `${options.url} is not http(s)`;
  if (options.sample && options.length !== 'short')
    return "An outreach sample is Short (rule 1 of the Director's §1), so --sample takes --length short.";
  const floor = FLOORS.research + RESERVES.research;
  if (!(options.maxMicroUsd >= floor))
    return `The cap must be at least $${(floor / 1e6).toFixed(2)}: research, a Director session, a render and a Quality Check review.`;
  return null;
}

/**
 * The Director's brief for the order. Rule 1 of §1 makes an outreach sample or a social cut Short;
 * a customer order that asks for 45 s is Standard, unless the research has fewer than 3 usable
 * claims (rule 2, Short). Extracted claims may be cited: approval comes after the Director.
 */
export function briefFor(
  options: Pick<FilmOptions, 'length' | 'format' | 'sample' | 'formats'>,
): DirectorBrief {
  const formats = options.formats?.length ? [...options.formats] : [options.format];
  const base: DirectorBrief = { ...OUTREACH_BRIEF, formats };
  if (options.sample) return base;
  if (options.length === 'short') return { ...base, kind: 'social-cut' };
  return { ...base, kind: 'customer-order', asksFor45s: true };
}

/** A run id that sorts by start time: `20261108-061502-a1b2`. */
export function newRunId(now: Date, random = Math.random().toString(16).slice(2, 6)): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${random}`;
}

/** The film's words, on screen and in voiceover, in order: for the brand-safety screen. */
export function filmScript(campaign: {
  scenes?: { text?: { value?: string }[]; voiceover?: { text?: string } }[];
}): string {
  return (campaign.scenes ?? [])
    .flatMap((scene) => [
      ...(scene.text ?? []).map((item) => item.value ?? ''),
      scene.voiceover?.text ?? '',
    ])
    .filter((line) => line.trim())
    .join('\n');
}

// ---------------------------------------------------------------------------------------------
// The manifest

export interface StageRecord {
  step: FilmStep;
  round: number;
  attempt: 'first' | 'smaller';
  startedAt: string;
  finishedAt: string;
  seconds: number;
  outcome: 'ok' | 'failed' | 'refused';
  failure: string | null;
  ceilingMicroUsd: number;
  cost: StageCost & { totalMicroUsd: number };
  sessionIds: string[];
  computerIds: string[];
  budgetPaused: boolean;
  /** Sessions parked on their budget and cancelled, by the stage itself or by the film after it. */
  cancelled: string[];
  files: Record<string, string>;
  /** What was decided in this stage, as in decisions.json. */
  decisions: { id: string; agent: string; message: string }[];
}

export interface FilmManifest {
  manifestVersion: 1;
  runId: string;
  url: string;
  host: string;
  /** The order as given: length, format, sample, cap. */
  options: {
    length: FilmLength;
    format: FilmFormat;
    sample: boolean;
    brief: DirectorBrief['kind'];
    maxMicroUsd: number;
    maxRouteBacks: number;
  };
  order: FilmOptions['order'] | null;
  state: OrderState;
  /** The web app's stage the film is at. */
  stage: FilmStage | null;
  step: FilmStep | null;
  qc: 'pending' | 'pass' | 'fail';
  round: number;
  routeBacks: number;
  failure: string | null;
  pid: number | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  spend: StageCost & { totalMicroUsd: number; capMicroUsd: number };
  stages: StageRecord[];
  /** The delivered film, relative to the film's folder. */
  film: {
    file: string;
    sha256: string;
    bytes: number;
    durationSeconds: number;
    format: FilmFormat;
    campaign: string;
    qcReport: string | null;
    round: number;
  } | null;
  /** Each format a film runner phase delivered, by format, relative to the film's folder. */
  films?: Partial<Record<FilmFormat, DeliveredFilm>>;
  script: string | null;
}

export interface DeliveredFilm {
  file: string;
  sha256: string;
  bytes: number;
  durationSeconds: number;
  format: FilmFormat;
  campaign: string;
  qcReport: string | null;
  /** Quality Check's verdict on it, or null when it did not review it. */
  qc: 'pass' | 'fail' | null;
  /** Quality Check's own folder for it, with its contact sheet and the frames it looked at. */
  qcDir: string | null;
  round: number;
}

export const MANIFEST_FILE = 'manifest.json';
export const DECISIONS_FILE = 'decisions.json';

export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, scrub(`${JSON.stringify(value, null, 2)}\n`));
  renameSync(temporary, file);
}

export function readManifest(dir: string): FilmManifest | undefined {
  const file = join(dir, MANIFEST_FILE);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as FilmManifest;
}

/**
 * A failure in one line: the first line of the message and the line that names the error, without
 * the progress lines and the stack a failed command prints. The whole text is in the stage's log.
 */
export function briefFailure(text: string, max = 600): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const first = lines[0] ?? 'failed';
  const cause = lines.slice(1).find((line) => /^[\w.]*(?:Error|Exception)\b[^:]*:/.test(line));
  const brief = cause ? `${first} ${cause}` : first;
  return brief.length > max ? `${brief.slice(0, max - 1)}…` : brief;
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const usd = (micro: number) => `$${(micro / 1e6).toFixed(2)}`;

export interface FilmDeps {
  crew: FilmCrew;
  /** Reads, interrupts and cancels sessions, so no stage leaves one running or parked. */
  sessions: CloseClient;
  clock?: () => Date;
  log?: (line: string) => void;
  signal?: AbortSignal;
  /** What the film runner is told as it happens (`--events`). Nothing, by default. */
  events?: FilmEvents;
}

/** Who works each step, in the website's words. */
export const STEP_AGENT: Record<FilmStep, FilmAgent> = {
  research: 'researcher',
  director: 'director',
  'art-director': 'art_director',
  gate: 'validator',
  render: 'render',
  'quality-check': 'quality_check',
};

/** What a step is doing, for the film page. */
function stepText(step: FilmStep, round: number, host: string, label?: string): string {
  switch (step) {
    case 'research':
      return `Reading ${host}: what it says about itself, its claims, colours, type and pages.`;
    case 'director':
      return round > 1
        ? "Revising the script with Quality Check's notes."
        : 'Writing the script, and checking it against the rules for claims, copy and timing.';
    case 'art-director':
      return round > 1
        ? "Choosing the pictures again with Quality Check's notes."
        : 'Choosing the pictures, colours and type for each scene.';
    case 'gate':
      return 'Checking the film can be drawn as written.';
    case 'render':
      return `Rendering the ${label ?? 'film'}${label ? ' film' : ''}.`;
    case 'quality-check':
      return `Watching the ${label ?? 'film'}${label ? ' film' : ''} frame by frame for problems.`;
  }
}

// ---------------------------------------------------------------------------------------------
// One film

class FilmRun {
  readonly dir: string;
  readonly manifest: FilmManifest;
  readonly log: DecisionLog;
  readonly events: FilmEvents;
  readonly floors: Record<FilmStep, number>;
  /** A step was refused or stopped by the cap. */
  capped = false;
  private readonly deps: FilmDeps;
  private readonly clock: () => Date;
  /** What an earlier phase of the film spent: this process's cap is on what it spends itself. */
  private readonly spentBefore: number;

  constructor(options: FilmOptions, deps: FilmDeps, resume?: FilmManifest) {
    this.deps = deps;
    this.clock = deps.clock ?? (() => new Date());
    this.events = deps.events ?? NO_EVENTS;
    this.floors = { ...FLOORS, ...options.floors };
    const now = this.clock();
    const host = siteHost(options.url);
    const runId = resume?.runId ?? options.runId ?? newRunId(now);
    this.dir = options.dir ?? join(options.outRoot, host, runId);
    const earlier = resume ? readDecisions(this.dir) : [];
    this.log = new DecisionLog(this.clock, earlier);
    this.spentBefore = resume?.spend.totalMicroUsd ?? 0;
    const brief = briefFor(options);
    const fresh: FilmManifest = {
      manifestVersion: 1,
      runId,
      url: options.url,
      host,
      options: {
        length: options.length,
        format: options.format,
        sample: options.sample,
        brief: brief.kind,
        maxMicroUsd: options.maxMicroUsd,
        maxRouteBacks: options.maxRouteBacks ?? MAX_ROUTE_BACKS,
      },
      order: options.order ?? null,
      state: 'working',
      stage: 'research',
      step: null,
      qc: 'pending',
      round: 1,
      routeBacks: 0,
      failure: null,
      pid: process.pid,
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      finishedAt: null,
      spend: { ...NO_COST, totalMicroUsd: 0, capMicroUsd: options.maxMicroUsd },
      stages: [],
      film: null,
      script: null,
    };
    this.manifest = resume
      ? {
          ...resume,
          state: 'working',
          failure: null,
          pid: process.pid,
          finishedAt: null,
          // The cap is on what this phase spends, beside what the film has spent before it.
          spend: { ...resume.spend, capMicroUsd: options.maxMicroUsd },
        }
      : fresh;
  }

  say(line: string) {
    this.deps.log?.(line);
  }

  get spent() {
    return this.manifest.spend.totalMicroUsd;
  }

  get room() {
    return this.manifest.spend.capMicroUsd - (this.spent - this.spentBefore);
  }

  rel(path: string) {
    return relative(this.dir, path) || '.';
  }

  write() {
    this.manifest.updatedAt = this.clock().toISOString();
    writeJson(join(this.dir, MANIFEST_FILE), this.manifest);
    writeJson(join(this.dir, DECISIONS_FILE), {
      orderId: this.manifest.order?.orderId ?? this.manifest.runId,
      runId: this.manifest.runId,
      url: this.manifest.url,
      simulated: false,
      decisions: this.log.entries,
    });
  }

  decide(draft: DecisionDraft): FilmDecision {
    const entry = this.log.add(draft, this.manifest.round);
    this.say(`${entry.agent}: ${entry.message}${entry.why ? ` (${entry.why})` : ''}`);
    this.events.decision(entry);
    return entry;
  }

  private spend(step: FilmStep, cost: StageCost, sessionId: string | null, note: string) {
    const spend = this.manifest.spend;
    spend.modelMicroUsd += cost.modelMicroUsd;
    spend.computeMicroUsd += cost.computeMicroUsd;
    spend.mediaMicroUsd += cost.mediaMicroUsd;
    spend.totalMicroUsd += total(cost);
    const ledgerStep = LEDGER_STEP[step];
    if (!ledgerStep) return;
    const file = join(this.dir, LEDGER_FILE);
    const at = this.clock().toISOString();
    const parts: [LedgerStep, number][] =
      step === 'art-director'
        ? [
            ['art-director', cost.modelMicroUsd + cost.computeMicroUsd],
            ['art-images', cost.mediaMicroUsd],
          ]
        : [[ledgerStep, total(cost)]];
    for (const [entryStep, microUsd] of parts) {
      if (microUsd > 0 || entryStep !== 'art-images') {
        recordSpend(file, this.manifest.runId, {
          step: entryStep,
          microUsd: Math.max(0, Math.round(microUsd)),
          session: sessionId,
          note,
          at,
        });
        this.events.cost(entryStep, microUsd, this.spent);
      }
    }
  }

  /** The ceiling a step gets now, or why it may not start. */
  ceiling(step: FilmStep, reserve = RESERVES[step]): { ceiling: number } | { refused: string } {
    const floor = this.floors[step];
    const ceiling = Math.min(CEILINGS[step], this.room - reserve);
    if (ceiling >= floor) return { ceiling: Math.max(0, ceiling) };
    return {
      refused: `${step} not started: ${usd(Math.max(0, this.room))} of the film's ${usd(this.manifest.spend.capMicroUsd)} cap is left, and it needs ${usd(floor + reserve)} (${usd(floor)} for itself and ${usd(reserve)} for the stages after it)`,
    };
  }

  private record(
    step: FilmStep,
    attempt: StageRecord['attempt'],
    startedAt: Date,
    ceiling: number,
    outcome: StageOutcome<unknown>,
    extra: { cancelled: string[]; budgetPaused: boolean; refused?: boolean },
    decisions: FilmDecision[],
  ) {
    const finished = this.clock();
    this.manifest.stages.push({
      step,
      round: this.manifest.round,
      attempt,
      startedAt: startedAt.toISOString(),
      finishedAt: finished.toISOString(),
      seconds: Number(((finished.getTime() - startedAt.getTime()) / 1000).toFixed(1)),
      outcome: extra.refused ? 'refused' : outcome.ok ? 'ok' : 'failed',
      failure: outcome.ok ? null : (outcome.failure ?? 'failed'),
      ceilingMicroUsd: ceiling,
      cost: { ...outcome.cost, totalMicroUsd: total(outcome.cost) },
      sessionIds: outcome.sessionIds,
      computerIds: outcome.computerIds ?? [],
      budgetPaused: extra.budgetPaused,
      cancelled: extra.cancelled,
      files: Object.fromEntries(
        Object.entries(outcome.files ?? {}).map(([role, path]) => [role, this.rel(path)]),
      ),
      decisions: decisions.map((entry) => ({
        id: entry.id,
        agent: entry.agent,
        message: entry.message,
      })),
    });
  }

  /**
   * Runs one spending step: checks the cap, gives the step its ceiling, closes every session it
   * started so none is left running or parked on its budget, records what it spent and decided,
   * and retries it once, smaller, if it failed on a budget pause it did not already retry.
   * `reserve` is what the step leaves for the steps after it; `label` names its format.
   */
  async step<T>(
    step: FilmStep,
    call: (limits: StageLimits) => Promise<StageOutcome<T>>,
    how: { reserve?: number; label?: string } = {},
  ): Promise<StageOutcome<T>> {
    let outcome = await this.attempt(step, 'first', call, how);
    if (!outcome.ok && outcome.budgetPaused && !outcome.retriedSmaller && !outcome.capped) {
      this.decide({
        agent: 'coordinator',
        kind: 'decision',
        stage: STAGE_OF[step],
        message: `Retrying ${step} once, smaller`,
        why: 'Its session was paused on its budget and has been cancelled. A smaller retry costs less than the first attempt, and the step is never split again.',
      });
      outcome = await this.attempt(step, 'smaller', call, how);
    }
    return outcome;
  }

  private async attempt<T>(
    step: FilmStep,
    attempt: StageRecord['attempt'],
    call: (limits: StageLimits) => Promise<StageOutcome<T>>,
    how: { reserve?: number; label?: string },
  ): Promise<StageOutcome<T>> {
    const started = this.clock();
    this.manifest.step = step;
    this.manifest.stage = STAGE_OF[step];
    const limit = this.ceiling(step, how.reserve);
    if ('refused' in limit) {
      this.capped = true;
      const refused: StageOutcome<T> = {
        ok: false,
        failure: limit.refused,
        capped: true,
        cost: NO_COST,
        sessionIds: [],
        decisions: [],
      };
      const entry = this.decide({
        agent: 'coordinator',
        kind: 'failed',
        stage: STAGE_OF[step],
        message: `Stopped before ${step}: the film's cap`,
        why: limit.refused,
        data: { spentMicroUsd: this.spent, capMicroUsd: this.manifest.spend.capMicroUsd },
      });
      this.record(
        step,
        attempt,
        started,
        0,
        refused,
        { cancelled: [], budgetPaused: false, refused: true },
        [entry],
      );
      this.write();
      return refused;
    }
    this.write();
    const stage = STAGE_OF[step];
    if (stage !== 'approval')
      this.events.stage(
        stage,
        STEP_AGENT[step],
        stepText(step, this.manifest.round, this.manifest.host, how.label),
      );
    this.say(
      `${step} (round ${this.manifest.round}, ${attempt}): ceiling ${usd(limit.ceiling)}, ${usd(this.room)} left of ${usd(this.manifest.spend.capMicroUsd)}`,
    );
    let outcome: StageOutcome<T>;
    try {
      outcome = await call({ ceilingMicroUsd: limit.ceiling, smaller: attempt === 'smaller' });
    } catch (cause) {
      outcome = {
        ok: false,
        failure: cause instanceof Error ? cause.message : String(cause),
        cost: NO_COST,
        sessionIds: [],
        decisions: [],
      };
    }
    if (outcome.capped) this.capped = true;
    if (!outcome.ok) outcome = { ...outcome, failure: briefFailure(outcome.failure ?? 'failed') };
    // Whatever the stage did, none of its sessions is left spending or waiting for a person.
    const cancelled: string[] = [];
    let budgetPaused = outcome.budgetPaused ?? false;
    for (const id of outcome.sessionIds) {
      this.events.session(STEP_AGENT[step], id, 'started');
      const closed = await closeSession(this.deps.sessions, id).catch(() => undefined);
      if (closed?.budgetPaused) budgetPaused = true;
      if (closed?.cancelled) cancelled.push(id);
      this.events.session(STEP_AGENT[step], id, 'ended', closed?.consumedMicroUsd);
    }
    // The stage's own cancellations are its decisions already; the film's are recorded below.
    const byStage = (outcome.cancelled ?? []).filter((id) => !cancelled.includes(id));
    this.spend(
      step,
      outcome.cost,
      outcome.sessionIds[0] ?? null,
      outcome.ok ? 'ok' : (outcome.failure ?? 'failed'),
    );
    const entries = outcome.decisions.map((draft) => this.decide(draft));
    for (const id of cancelled) {
      entries.push(
        this.decide({
          agent: 'coordinator',
          kind: 'decision',
          stage: STAGE_OF[step],
          message: `Cancelled session ${id}, parked on its budget`,
          why: 'A session parked on its budget shows as waiting for the founder. The film never leaves one: it cancels it and records it.',
          data: { sessionId: id },
        }),
      );
    }
    if (!outcome.ok) {
      entries.push(
        this.decide({
          agent: 'coordinator',
          kind: 'failed',
          stage: STAGE_OF[step],
          message: `${step} failed`,
          why: outcome.failure ?? 'no reason given',
          data: { budgetPaused },
        }),
      );
    }
    this.record(
      step,
      attempt,
      started,
      limit.ceiling,
      outcome,
      { cancelled: [...byStage, ...cancelled], budgetPaused },
      entries,
    );
    this.write();
    return { ...outcome, budgetPaused };
  }

  /** The render gate. It spends nothing, so it has no ceiling. */
  async gate(
    crew: FilmCrew,
    campaignFile: string,
    format: FilmFormat,
    cut: Cut = NO_CUT,
  ): Promise<GateOutcome> {
    const started = this.clock();
    this.manifest.step = 'gate';
    this.manifest.stage = STAGE_OF.gate;
    let gate: GateOutcome;
    try {
      gate = await crew.gate({ campaignFile, format, ...cutOf(cut) });
    } catch (cause) {
      gate = {
        ok: false,
        check: 'gate',
        issues: [
          {
            code: 'GATE_ERROR',
            path: '$',
            message: cause instanceof Error ? cause.message : String(cause),
            severity: 'error',
          },
        ],
      };
    }
    const errors = gate.ok ? [] : gate.issues.filter((issue) => issue.severity === 'error');
    const entry = gate.ok
      ? this.decide({
          agent: 'validator',
          kind: 'passed',
          stage: 'render',
          message: `validateCampaign and validateFilm passed the campaign for ${format}`,
          why: `The render starts only on a campaign both gates pass${gate.warnings.length ? `; ${gate.warnings.length} warning(s)` : ''}.`,
          ...(gate.warnings.length ? { data: { warnings: gate.warnings } } : {}),
        })
      : this.decide({
          agent: 'validator',
          kind: 'failed',
          stage: 'render',
          message: `${gate.check} refused the film: ${[...new Set(errors.map((issue) => issue.code))].join(', ') || 'no reason given'}`,
          why: `${errors.map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`).join(' ')} Nothing was rendered and no computer was started.`,
          data: { issues: gate.issues },
        });
    this.record(
      'gate',
      'first',
      started,
      0,
      {
        ok: gate.ok,
        ...(gate.ok ? {} : { failure: `${gate.check} refused the film` }),
        cost: NO_COST,
        sessionIds: [],
        decisions: [],
        files: { campaign: campaignFile },
      },
      { cancelled: [], budgetPaused: false },
      [entry],
    );
    this.write();
    return gate;
  }

  /** True once a film has been delivered, in any format. */
  get hasFilm(): boolean {
    return this.manifest.film !== null || Object.keys(this.manifest.films ?? {}).length > 0;
  }

  finish(state: OrderState, failure: string | null): FilmManifest {
    const done = this.manifest;
    done.state = state;
    done.failure = failure;
    done.step = null;
    done.stage = state === 'ready' ? 'delivery' : done.stage;
    done.finishedAt = this.clock().toISOString();
    done.pid = null;
    if (state === 'ready' && done.film) {
      this.decide({
        agent: 'coordinator',
        kind: done.qc === 'pass' ? 'delivered' : 'needs_you',
        stage: 'delivery',
        status: done.qc === 'pass' ? 'done' : 'needs_you',
        message:
          done.qc === 'pass'
            ? `Delivered the film after ${done.round} round(s), for ${usd(this.spent)}`
            : `The film is made but did not pass Quality Check, after ${done.round} round(s), for ${usd(this.spent)}`,
        why:
          failure ??
          (done.qc === 'pass' ? 'Quality Check passed it.' : 'See the Quality Check report.'),
        data: { file: done.film.file, spentMicroUsd: this.spent },
      });
    } else {
      this.decide({
        agent: 'coordinator',
        kind: 'failed',
        stage: done.stage ?? 'research',
        message: `No film: ${failure ?? 'stopped'}`,
        why: `Spent ${usd(this.spent)} of the ${usd(done.spend.capMicroUsd)} cap.`,
        data: { spentMicroUsd: this.spent },
      });
    }
    this.write();
    return done;
  }

  /**
   * Makes this round's film the delivered one: the MP4, its campaign and its QC report. `pnpm
   * film` keeps one film at the top of its folder; a film runner phase keeps one per format under
   * `delivered/`, so the script at the top of the run dir is never written over.
   */
  deliver(
    render: RenderedFilm,
    campaignFile: string,
    format: FilmFormat,
    qc: { report: QcReport; reportFile: string } | undefined,
    layout: 'top' | 'formats' = 'top',
  ) {
    const slug = format.replace(':', 'x');
    const names =
      layout === 'top'
        ? { film: 'film.mp4', campaign: 'campaign.json', qc: 'qc-report.json' }
        : {
            film: `delivered/film-${slug}.mp4`,
            campaign: 'delivered/campaign.json',
            qc: `delivered/qc-report-${slug}.json`,
          };
    mkdirSync(join(this.dir, dirname(names.film)), { recursive: true });
    copyFileSync(render.film, join(this.dir, names.film));
    copyFileSync(campaignFile, join(this.dir, names.campaign));
    if (qc) copyFileSync(qc.reportFile, join(this.dir, names.qc));
    const delivered: DeliveredFilm = {
      file: names.film,
      sha256: render.sha256,
      bytes: render.bytes,
      durationSeconds: render.durationSeconds,
      format,
      campaign: names.campaign,
      qcReport: qc ? names.qc : null,
      qc: qc ? (qc.report.verdict === 'pass' ? 'pass' : 'fail') : null,
      qcDir: qc ? this.rel(dirname(qc.reportFile)) : null,
      round: this.manifest.round,
    };
    if (layout === 'formats') {
      this.manifest.films = { ...this.manifest.films, [format]: delivered };
      const films = Object.values(this.manifest.films);
      this.manifest.qc = films.every((each) => each?.qc === 'pass') ? 'pass' : 'fail';
    } else {
      this.manifest.qc = delivered.qc ?? 'fail';
    }
    const first =
      layout === 'formats' ? (Object.values(this.manifest.films ?? {})[0] ?? delivered) : delivered;
    this.manifest.film = {
      file: first.file,
      sha256: first.sha256,
      bytes: first.bytes,
      durationSeconds: first.durationSeconds,
      format: first.format,
      campaign: first.campaign,
      qcReport: first.qcReport,
      round: first.round,
    };
    try {
      this.manifest.script = filmScript(JSON.parse(readFileSync(campaignFile, 'utf8')));
    } catch {
      this.manifest.script = null;
    }
    this.write();
  }
}

/** The main opening and no call-to-action label: `pnpm film` and a sample film. */
export const NO_CUT: Cut = { hookId: null, ctaId: null };

/** A cut as the render takes it: only the ids it names. */
const cutOf = (cut: Cut): Partial<Cut> => ({
  ...(cut.hookId ? { hookId: cut.hookId } : {}),
  ...(cut.ctaId ? { ctaId: cut.ctaId } : {}),
});

/** The decisions an earlier phase of the film wrote, which this one goes on from. */
function readDecisions(dir: string): FilmDecision[] {
  const file = join(dir, DECISIONS_FILE);
  if (!existsSync(file)) return [];
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as { decisions?: FilmDecision[] };
    return Array.isArray(value.decisions) ? value.decisions : [];
  } catch {
    return [];
  }
}

/** Where each round's work goes: `round-<n>/<part>/`. */
const roundDir = (dir: string, round: number, part: string) => join(dir, `round-${round}`, part);

function qcIssueToDecisionData(issues: QcIssue[]) {
  return issues.map((issue) => ({
    check: issue.check,
    severity: issue.severity,
    sceneId: issue.sceneId,
    frame: issue.frame,
  }));
}

// ---------------------------------------------------------------------------------------------
// The script: the Researcher, then the Director with its checks

interface Script {
  researchFile: string;
  director: { campaignFile: string; handoffFile: string };
}

async function scriptSteps(
  film: FilmRun,
  crew: FilmCrew,
  options: FilmOptions,
  brief: DirectorBrief,
  reserves: { research: number; director: number },
  onResearch?: (researchFile: string) => void,
  signal?: AbortSignal,
): Promise<Script | { failed: string }> {
  const research = await film.step(
    'research',
    (limits) => crew.research({ url: options.url, dir: join(film.dir, 'research'), ...limits }),
    { reserve: reserves.research },
  );
  if (!research.ok || !research.value) return { failed: research.failure ?? 'research failed' };
  const { researchFile } = research.value;
  onResearch?.(researchFile);
  if (signal?.aborted) return { failed: 'interrupted' };
  const first = await film.step(
    'director',
    (limits) =>
      crew.direct({ researchFile, brief, dir: roundDir(film.dir, 1, 'director'), ...limits }),
    { reserve: reserves.director },
  );
  if (!first.ok || !first.value)
    return { failed: first.failure ?? 'the Director wrote no campaign' };
  return { researchFile, director: first.value };
}

// ---------------------------------------------------------------------------------------------
// The film: art direction, the gate, the render and Quality Check, round by round

interface Production extends Script {
  brief: DirectorBrief;
  formats: readonly FilmFormat[];
  cut: Cut;
  /**
   * False once the customer has approved the script: the Director may then change nothing, so
   * issues it owns go to a person instead of back to it.
   */
  reviseScript: boolean;
  layout: 'top' | 'formats';
  signal?: AbortSignal;
}

/** Renders in a round go to `round-<n>/render/`, or `render-<format>/` when there are several. */
const renderDir = (dir: string, round: number, format: FilmFormat, formats: number) =>
  roundDir(dir, round, formats > 1 ? `render-${format.replace(':', 'x')}` : 'render');

/**
 * Art-directs, gates, renders and checks every format, and sends a failure the Director or the
 * Art Director can fix back to that owner, within the route-back limit and the cap. Never throws
 * for a stage that fails: the film is then delivered as it stands, or failed, with why.
 */
async function produce(film: FilmRun, crew: FilmCrew, input: Production): Promise<FilmManifest> {
  const { formats, researchFile, brief, cut } = input;
  const maxRouteBacks = film.manifest.options.maxRouteBacks;
  const perFormat = film.floors.render + film.floors['quality-check'];
  const aborted = () => input.signal?.aborted ?? false;
  const stop = (why: string) => film.finish(film.hasFilm ? 'ready' : 'failed', why);
  let director = input.director;
  let artIssues: QcIssue[] = [];
  /** The campaign the last render was asked to draw. */
  let triedSha: string | undefined;

  for (;;) {
    const round = film.manifest.round;
    if (aborted()) return stop('interrupted');
    const art = await film.step(
      'art-director',
      (limits) =>
        crew.art({
          campaignFile: director.campaignFile,
          researchFile,
          dir: roundDir(film.dir, round, 'art'),
          issues: artIssues,
          ...limits,
        }),
      { reserve: formats.length * perFormat },
    );
    if (!art.ok || !art.value) return stop(art.failure ?? 'the Art Director wrote no campaign');
    const { campaignFile } = art.value;
    const sha = sha256(campaignFile);
    if (triedSha === sha) {
      film.decide({
        agent: 'coordinator',
        kind: 'decision',
        stage: 'art_direction',
        message: 'Not rendered again: the campaign is the one already rendered',
        why: 'The route-back changed nothing in the campaign, so a new render would be the same film and fail the same way. The film goes to a person.',
      });
      return stop('the route-back changed nothing');
    }

    for (const format of formats) {
      const gate = await film.gate(crew, campaignFile, format, cut);
      if (!gate.ok) return stop(`${gate.check} refused the film, so it was not rendered`);
    }
    if (aborted()) return stop('interrupted');

    triedSha = sha;
    // What failed, and who can fix it: a scene motion refused to draw, or Quality Check's review.
    const failures: { by: string; issues: QcIssue[] }[] = [];
    let unreviewed: string | undefined;
    for (const [index, format] of formats.entries()) {
      const after = (formats.length - index - 1) * perFormat;
      const label = formats.length > 1 ? format : undefined;
      const render = await film.step(
        'render',
        (limits) =>
          crew.render({
            campaignFile,
            researchFile,
            format,
            dir: renderDir(film.dir, round, format, formats.length),
            ...cutOf(cut),
            ...limits,
          }),
        { reserve: film.floors['quality-check'] + after, label: format },
      );
      if (!render.ok || !render.value) {
        if (!render.issues?.length) return stop(render.failure ?? 'the render failed');
        // Copy a template refused to set is refused in every format: no other is drawn.
        failures.push({ by: 'motion refused to draw the film', issues: render.issues });
        break;
      }
      const rendered = render.value;
      const qc = await film.step(
        'quality-check',
        (limits) => crew.qc({ renderDir: rendered.renderDir, researchFile, ...limits }),
        { reserve: after, label: format },
      );
      if (!qc.ok || !qc.value) {
        film.deliver(rendered, campaignFile, format, undefined, input.layout);
        film.events.qc(format, null, qc.failure);
        unreviewed ??= `Quality Check did not review the ${label ? `${label} ` : ''}film: ${qc.failure ?? 'no report'}`;
        continue;
      }
      film.deliver(rendered, campaignFile, format, qc.value, input.layout);
      film.events.qc(format, qc.value.report);
      if (qc.value.report.verdict !== 'pass')
        failures.push({ by: 'Quality Check failed the film', issues: qc.value.report.issues });
    }
    if (failures.length === 0) return film.finish('ready', unreviewed ?? null);

    // Route the failure back to the agents that can fix it, within the limits.
    const failed = {
      by: [...new Set(failures.map((each) => each.by))].join(', and '),
      issues: failures.flatMap((each) => each.issues),
    };
    const owners = routable(failed);
    const toDirector = owners.get('director') ?? [];
    const toArt = owners.get('art-director') ?? [];
    const toMotion = owners.get('motion') ?? [];
    const routeBack = (why: string, message: string, data?: Record<string, unknown>) => {
      film.decide({
        agent: 'coordinator',
        kind: 'decision',
        stage: 'review',
        message,
        why,
        ...(data ? { data } : {}),
      });
      return stop(why);
    };
    if (toDirector.length === 0 && toArt.length === 0) {
      return routeBack(
        toMotion.length
          ? `${toMotion.length} issue(s) belong to motion, which no agent of the crew can change.`
          : 'Every issue is minor or an expected placeholder failure, which never sends a film back.',
        'Nothing to send back to the Director or the Art Director',
        { motion: qcIssueToDecisionData(toMotion) },
      );
    }
    if (toMotion.length) {
      return routeBack(
        `${toMotion.length} issue(s) belong to motion, and a new render would show them again whatever the Director and Art Director change.`,
        'Not sent back: motion issues no agent can fix',
        { motion: qcIssueToDecisionData(toMotion) },
      );
    }
    if (toDirector.length && !input.reviseScript) {
      return routeBack(
        `${toDirector.length} issue(s) belong to the Director, and the customer approved this version of the script, so the Director may not change it.`,
        'Not sent back: the script is approved',
        { director: qcIssueToDecisionData(toDirector) },
      );
    }
    if (film.manifest.routeBacks >= maxRouteBacks) {
      return routeBack(
        `The film has been sent back ${film.manifest.routeBacks} time(s), the limit.`,
        'Not sent back again: the route-back limit',
      );
    }
    const need = (toDirector.length ? film.floors.director : 0) + formats.length * perFormat;
    if (film.room < need) {
      return routeBack(
        `Another round needs at least ${usd(need)}, and ${usd(Math.max(0, film.room))} of the ${usd(film.manifest.spend.capMicroUsd)} cap is left.`,
        "Not sent back: the film's cap",
      );
    }

    film.manifest.routeBacks += 1;
    film.manifest.round += 1;
    // `qc` stays the delivered film's verdict until the next round's film is checked.
    const next = film.manifest.round;
    if (toDirector.length) {
      film.decide({
        agent: 'coordinator',
        kind: 'sent_back',
        stage: 'script',
        message: `Sent ${toDirector.length} issue(s) back to the Director: ${[...new Set(toDirector.map((issue) => issue.check))].join(', ')}`,
        why: `${failed.by}, and the Director owns these. Route-back ${film.manifest.routeBacks} of ${maxRouteBacks}.${toArt.length ? ' The Art Director gets its own issues after the Director has revised.' : ''}`,
        data: { issues: qcIssueToDecisionData(toDirector) },
      });
      const revised = await film.step(
        'director',
        (limits) =>
          crew.direct({
            researchFile,
            brief,
            dir: roundDir(film.dir, next, 'director'),
            revise: { ...director, issues: toDirector },
            ...limits,
          }),
        { reserve: formats.length * perFormat },
      );
      if (!revised.ok || !revised.value)
        return stop(`the Director could not revise: ${revised.failure ?? 'no campaign'}`);
      director = revised.value;
    }
    if (toArt.length) {
      film.decide({
        agent: 'coordinator',
        kind: 'sent_back',
        stage: 'art_direction',
        message: `Sent ${toArt.length} issue(s) back to the Art Director: ${[...new Set(toArt.map((issue) => issue.check))].join(', ')}`,
        why: `${failed.by}, and the Art Director owns these. Route-back ${film.manifest.routeBacks} of ${maxRouteBacks}.`,
        data: { issues: qcIssueToDecisionData(toArt) },
      });
    }
    artIssues = toArt;
  }
}

/**
 * Makes one film. Returns its manifest, which is also on disk with `decisions.json` beside it.
 * Never throws for a stage that fails: the film is then `failed`, with why.
 */
export async function makeFilm(options: FilmOptions, deps: FilmDeps): Promise<FilmManifest> {
  const problem = orderProblem(options);
  if (problem) throw new Error(problem);
  const film = new FilmRun(options, deps);
  const { format } = options;
  mkdirSync(film.dir, { recursive: true });
  const brief = briefFor(options);
  startedDecision(film, options, brief);
  film.write();
  const script = await scriptSteps(
    film,
    deps.crew,
    options,
    brief,
    { research: RESERVES.research, director: RESERVES.director },
    undefined,
    deps.signal,
  );
  if ('failed' in script) return film.finish('failed', script.failed);
  if (deps.signal?.aborted) return film.finish(film.hasFilm ? 'ready' : 'failed', 'interrupted');
  return produce(film, deps.crew, {
    ...script,
    brief,
    formats: [format],
    cut: NO_CUT,
    reviseScript: true,
    layout: 'top',
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
}

function startedDecision(film: FilmRun, options: FilmOptions, brief: DirectorBrief) {
  film.decide({
    agent: 'coordinator',
    kind: 'started',
    stage: 'research',
    message: `Started a ${brief.kind} of ${film.manifest.host}: ${options.length}, ${options.format}, under a ${usd(options.maxMicroUsd)} cap`,
    why:
      brief.kind === 'customer-order'
        ? 'A Standard film was asked for, so the brief asks for 45 s: Long cannot apply, and rule 2 still makes it Short if the research has fewer than 3 usable claims.'
        : "Rule 1 of the Director's §1: an outreach sample or a social cut is Short.",
    data: { brief },
  });
}

// ---------------------------------------------------------------------------------------------
// The film runner's two phases, in one run dir

/** What the script phase leaves in the run dir for the render phase. */
export const SCRIPT_FILE = 'script.json';
/** The script the website reads and the customer approves, at the top of the run dir. */
export const SCRIPT_CAMPAIGN = 'campaign.json';

export interface ScriptRecord {
  version: number;
  url: string;
  brief: DirectorBrief;
  length: FilmLength;
  sample: boolean;
  /** Relative to the run dir. */
  researchFile: string;
  director: { campaignFile: string; handoffFile: string };
  /** The claims the script cites that nobody has confirmed. */
  unconfirmedClaims: string[];
  writtenAt: string;
}

export function readScript(dir: string): ScriptRecord | undefined {
  const file = join(dir, SCRIPT_FILE);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as ScriptRecord;
}

interface CampaignClaims {
  claims?: { id?: unknown; status?: unknown }[];
  scenes?: unknown[];
  variants?: { hooks?: unknown[]; ctas?: unknown[] };
}

/** Every claim id the film cites, on screen or in voiceover, in any scene, hook or CTA. */
export function citedClaims(campaign: CampaignClaims): Set<string> {
  const cited = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key !== 'claimIds' || !Array.isArray(item)) {
        visit(item);
        continue;
      }
      for (const id of item) if (typeof id === 'string') cited.add(id);
    }
  };
  visit([campaign.scenes, campaign.variants?.hooks, campaign.variants?.ctas]);
  return cited;
}

/** The claims the film cites that nobody has approved: what the customer is asked to confirm. */
export function unconfirmedClaims(campaign: CampaignClaims): string[] {
  const cited = citedClaims(campaign);
  return (campaign.claims ?? []).flatMap((claim) =>
    typeof claim.id === 'string' && claim.status !== 'approved' && cited.has(claim.id)
      ? [claim.id]
      : [],
  );
}

export interface PhaseResult {
  manifest: FilmManifest;
  /** Why the phase did not finish, when it did not. */
  failure: string | null;
  /** The cap refused or stopped a step. */
  capped: boolean;
}

/**
 * The script phase: the Researcher, then the Director with its checks. Writes the script to the
 * top of the run dir as `campaign.json` (version 1), with `script.json` for the render phase, and
 * says `script_ready`. The cap is this phase's alone: the website checks it again at approval.
 */
export async function writeScript(
  options: FilmOptions & { dir: string },
  deps: FilmDeps,
  /**
   * What the Researcher and the Director each leave for the steps after them. A script alone
   * leaves the render to its own budget at approval; a sample film made in one go leaves it here.
   */
  reserves?: { research: number; director: number },
) {
  const film = new FilmRun(options, deps);
  mkdirSync(film.dir, { recursive: true });
  // A relaunch starts the script again from nothing: files of an earlier try are not this one's.
  for (const name of [SCRIPT_FILE, SCRIPT_CAMPAIGN, DECISIONS_FILE, MANIFEST_FILE])
    rmSync(join(film.dir, name), { force: true });
  const brief = briefFor(options);
  startedDecision(film, options, brief);
  film.write();
  const script = await scriptSteps(
    film,
    deps.crew,
    options,
    brief,
    reserves ?? { research: film.floors.director, director: 0 },
    (researchFile) => film.events.artifact('research', researchFile, 'application/json', 0),
    deps.signal,
  );
  if ('failed' in script) {
    film.finish('failed', script.failed);
    return { manifest: film.manifest, failure: script.failed, capped: film.capped, script: null };
  }
  const campaign = JSON.parse(readFileSync(script.director.campaignFile, 'utf8')) as CampaignClaims;
  const record: ScriptRecord = {
    version: 1,
    url: options.url,
    brief,
    length: options.length,
    sample: options.sample,
    researchFile: film.rel(script.researchFile),
    director: {
      campaignFile: film.rel(script.director.campaignFile),
      handoffFile: film.rel(script.director.handoffFile),
    },
    unconfirmedClaims: unconfirmedClaims(campaign),
    writtenAt: (deps.clock ?? (() => new Date()))().toISOString(),
  };
  const top = join(film.dir, SCRIPT_CAMPAIGN);
  copyFileSync(script.director.campaignFile, top);
  writeJson(join(film.dir, SCRIPT_FILE), record);
  film.manifest.step = null;
  film.manifest.stage = 'approval';
  film.manifest.script = filmScript(campaign as Parameters<typeof filmScript>[0]);
  film.decide({
    agent: 'director',
    kind: 'passed',
    stage: 'checks',
    message: `Version ${record.version} of the script is written and passed its checks`,
    why: record.unconfirmedClaims.length
      ? `It cites ${record.unconfirmedClaims.length} claim(s) the customer has not confirmed: ${record.unconfirmedClaims.join(', ')}.`
      : 'It cites no claim the customer still has to confirm.',
    data: { version: record.version, unconfirmedClaims: record.unconfirmedClaims },
  });
  film.write();
  film.events.scriptReady(record.version, top, record.unconfirmedClaims);
  return { manifest: film.manifest, failure: null, capped: false, script: record };
}

export interface Approval {
  version: number;
  hookId: string | null;
  ctaId: string | null;
  formats: FilmFormat[];
  confirmedClaimIds: string[];
}

/** Bad input from the website: an approval for another version, or a cut the script lacks. */
export class BadApproval extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BadApproval';
    this.code = code;
  }
}

/** Refuses an approval this run dir's script cannot be cut to, before anything is spent. */
export function checkApproval(script: ScriptRecord, campaign: unknown, approval: Approval) {
  if (approval.version !== script.version) {
    throw new BadApproval(
      'version_mismatch',
      `The approval is for version ${approval.version} of the script, and the run dir holds version ${script.version}.`,
    );
  }
  const variants = ((campaign as { variants?: Record<string, unknown> }).variants ?? {}) as {
    formats?: string[];
    hooks?: { id?: string }[];
    ctas?: { id?: string }[];
  };
  for (const format of approval.formats) {
    if (!(FILM_FORMATS as readonly string[]).includes(format))
      throw new BadApproval('bad_input', `${format} is not a format.`);
    if (Array.isArray(variants.formats) && !variants.formats.includes(format))
      throw new BadApproval('bad_input', `The script has no ${format} cut.`);
  }
  if (approval.formats.length === 0)
    throw new BadApproval('bad_input', 'The approval names no format.');
  if (
    approval.hookId !== null &&
    !(variants.hooks ?? []).some((hook) => hook.id === approval.hookId)
  )
    throw new BadApproval('bad_input', `The script has no opening "${approval.hookId}".`);
  if (approval.ctaId !== null && !(variants.ctas ?? []).some((cta) => cta.id === approval.ctaId))
    throw new BadApproval('bad_input', `The script has no call to action "${approval.ctaId}".`);
}

/**
 * The render phase: the cut the customer approved, in exactly the formats they approved, from the
 * run dir the script phase left. The claims they confirmed are marked approved in the campaign
 * before the gate. The Director changes nothing now; the Art Director may be sent back.
 */
export async function renderApproved(
  options: FilmOptions & { dir: string },
  approval: Approval,
  deps: FilmDeps,
  script: ScriptRecord,
  /** `sample`: a GTM sample film, which nobody approves, so the Director may still revise. */
  by: 'customer' | 'sample' = 'customer',
): Promise<PhaseResult> {
  const resume = readManifest(options.dir);
  const film = new FilmRun(options, deps, resume);
  const campaign = JSON.parse(readFileSync(join(film.dir, SCRIPT_CAMPAIGN), 'utf8')) as {
    claims?: { id: string; status: string }[];
  } & Record<string, unknown>;
  const known = new Set((campaign.claims ?? []).map((claim) => claim.id));
  const confirmed = approval.confirmedClaimIds.filter((id) => known.has(id));
  const approved = {
    ...campaign,
    claims: (campaign.claims ?? []).map((claim) =>
      confirmed.includes(claim.id) ? { ...claim, status: 'approved' } : claim,
    ),
  };
  const approvedFile = join(film.dir, 'approved', `campaign.v${approval.version}.json`);
  writeJson(approvedFile, approved);
  if (by === 'customer')
    film.decide({
      agent: 'customer',
      kind: 'decision',
      stage: 'approval',
      message: `Approved version ${approval.version} of the script, in ${approval.formats.join(', ')}`,
      why: `${confirmed.length ? `Confirmed ${confirmed.length} claim(s), now marked approved before the render gate: ${confirmed.join(', ')}.` : 'Confirmed no claim.'}${approval.confirmedClaimIds.length > confirmed.length ? ` ${approval.confirmedClaimIds.length - confirmed.length} confirmed id(s) are not claims of this script and were left out.` : ''} Opening ${approval.hookId ?? 'main'}, call to action ${approval.ctaId ?? 'as written'}.`,
      data: { version: approval.version, confirmed, formats: approval.formats },
    });
  film.write();
  const manifest = await produce(film, deps.crew, {
    researchFile: join(film.dir, script.researchFile),
    director: {
      campaignFile: approvedFile,
      handoffFile: join(film.dir, script.director.handoffFile),
    },
    brief: script.brief,
    formats: approval.formats,
    cut: { hookId: approval.hookId, ctaId: approval.ctaId },
    reviseScript: by === 'sample',
    layout: 'formats',
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  const missing = approval.formats.filter((format) => !manifest.films?.[format]);
  return {
    manifest,
    failure: missing.length ? (manifest.failure ?? `no ${missing.join(', ')} film was made`) : null,
    capped: film.capped,
  };
}
