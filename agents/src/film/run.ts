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
 * film is written under `out/films/<host>/<run-id>/`.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { DirectorBrief } from '../director/output.ts';
import { OUTREACH_BRIEF } from '../director/output.ts';
import { scrub } from '../naive/client.ts';
import { type CloseClient, closeSession } from '../naive/session.ts';
import { LEDGER_FILE, type Step as LedgerStep, recordSpend, routable } from '../pipeline/ledger.ts';
import type { QcIssue, QcReport } from '../quality/output.ts';
import { siteHost } from '../researcher/text.ts';
import { type DecisionDraft, DecisionLog } from './decisions.ts';
import type { FilmDecision, FilmFormat, FilmLength, FilmStage, OrderState } from './order.ts';

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
  /** `validateCampaign` and `validateFilm` on the campaign, in this format. Spends nothing. */
  gate(input: { campaignFile: string; format: FilmFormat }): Promise<GateOutcome>;
  /** Renders the campaign. The research's files are where its pictures already are on disk. */
  render(
    input: {
      campaignFile: string;
      researchFile: string;
      format: FilmFormat;
      dir: string;
    } & StageLimits,
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
  /** `out/films`. The film goes in `<outRoot>/<host>/<runId>/`. */
  outRoot: string;
  runId?: string;
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
  options: Pick<FilmOptions, 'length' | 'format' | 'sample'>,
): DirectorBrief {
  const base: DirectorBrief = { ...OUTREACH_BRIEF, formats: [options.format] };
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
  /** Sessions the film found parked and cancelled after the stage. */
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
  script: string | null;
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
}

// ---------------------------------------------------------------------------------------------
// One film

class FilmRun {
  readonly dir: string;
  readonly manifest: FilmManifest;
  readonly log: DecisionLog;
  private readonly deps: FilmDeps;
  private readonly clock: () => Date;

  constructor(options: FilmOptions, deps: FilmDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? (() => new Date());
    const now = this.clock();
    const host = siteHost(options.url);
    const runId = options.runId ?? newRunId(now);
    this.dir = join(options.outRoot, host, runId);
    this.log = new DecisionLog(this.clock);
    const brief = briefFor(options);
    this.manifest = {
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
  }

  say(line: string) {
    this.deps.log?.(line);
  }

  get spent() {
    return this.manifest.spend.totalMicroUsd;
  }

  get room() {
    return this.manifest.spend.capMicroUsd - this.spent;
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
      if (microUsd > 0 || entryStep !== 'art-images')
        recordSpend(file, this.manifest.runId, {
          step: entryStep,
          microUsd: Math.max(0, Math.round(microUsd)),
          session: sessionId,
          note,
          at,
        });
    }
  }

  /** The ceiling a step gets now, or why it may not start. */
  ceiling(step: FilmStep): { ceiling: number } | { refused: string } {
    const ceiling = Math.min(CEILINGS[step], this.room - RESERVES[step]);
    if (ceiling >= FLOORS[step]) return { ceiling: Math.max(0, ceiling) };
    return {
      refused: `${step} not started: ${usd(Math.max(0, this.room))} of the film's ${usd(this.manifest.spend.capMicroUsd)} cap is left, and it needs ${usd(FLOORS[step] + RESERVES[step])} (${usd(FLOORS[step])} for itself and ${usd(RESERVES[step])} for the stages after it)`,
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
   */
  async step<T>(
    step: FilmStep,
    call: (limits: StageLimits) => Promise<StageOutcome<T>>,
  ): Promise<StageOutcome<T>> {
    let outcome = await this.attempt(step, 'first', call);
    if (!outcome.ok && outcome.budgetPaused && !outcome.retriedSmaller && !outcome.capped) {
      this.decide({
        agent: 'coordinator',
        kind: 'decision',
        stage: STAGE_OF[step],
        message: `Retrying ${step} once, smaller`,
        why: 'Its session was paused on its budget and has been cancelled. A smaller retry costs less than the first attempt, and the step is never split again.',
      });
      outcome = await this.attempt(step, 'smaller', call);
    }
    return outcome;
  }

  private async attempt<T>(
    step: FilmStep,
    attempt: StageRecord['attempt'],
    call: (limits: StageLimits) => Promise<StageOutcome<T>>,
  ): Promise<StageOutcome<T>> {
    const started = this.clock();
    this.manifest.step = step;
    this.manifest.stage = STAGE_OF[step];
    const limit = this.ceiling(step);
    if ('refused' in limit) {
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
    if (!outcome.ok) outcome = { ...outcome, failure: briefFailure(outcome.failure ?? 'failed') };
    // Whatever the stage did, none of its sessions is left spending or waiting for a person.
    const cancelled: string[] = [];
    let budgetPaused = outcome.budgetPaused ?? false;
    for (const id of outcome.sessionIds) {
      const closed = await closeSession(this.deps.sessions, id).catch(() => undefined);
      if (closed?.budgetPaused) budgetPaused = true;
      if (closed?.cancelled) cancelled.push(id);
    }
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
      { cancelled, budgetPaused },
      entries,
    );
    this.write();
    return { ...outcome, budgetPaused };
  }

  /** The render gate. It spends nothing, so it has no ceiling. */
  async gate(crew: FilmCrew, campaignFile: string, format: FilmFormat): Promise<GateOutcome> {
    const started = this.clock();
    this.manifest.step = 'gate';
    this.manifest.stage = STAGE_OF.gate;
    let gate: GateOutcome;
    try {
      gate = await crew.gate({ campaignFile, format });
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

  /** Makes this round's film the delivered one: the MP4, its campaign and its QC report. */
  deliver(
    render: RenderedFilm,
    campaignFile: string,
    format: FilmFormat,
    qc?: { report: QcReport; reportFile: string },
  ) {
    const film = join(this.dir, 'film.mp4');
    copyFileSync(render.film, film);
    copyFileSync(campaignFile, join(this.dir, 'campaign.json'));
    if (qc) copyFileSync(qc.reportFile, join(this.dir, 'qc-report.json'));
    this.manifest.film = {
      file: 'film.mp4',
      sha256: render.sha256,
      bytes: render.bytes,
      durationSeconds: render.durationSeconds,
      format,
      campaign: 'campaign.json',
      qcReport: qc ? 'qc-report.json' : null,
      round: this.manifest.round,
    };
    this.manifest.qc = qc ? (qc.report.verdict === 'pass' ? 'pass' : 'fail') : 'fail';
    try {
      this.manifest.script = filmScript(JSON.parse(readFileSync(campaignFile, 'utf8')));
    } catch {
      this.manifest.script = null;
    }
    this.write();
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

/**
 * Makes one film. Returns its manifest, which is also on disk with `decisions.json` beside it.
 * Never throws for a stage that fails: the film is then `failed`, with why.
 */
export async function makeFilm(options: FilmOptions, deps: FilmDeps): Promise<FilmManifest> {
  const problem = orderProblem(options);
  if (problem) throw new Error(problem);
  const film = new FilmRun(options, deps);
  const { crew } = deps;
  const { format } = options;
  const maxRouteBacks = options.maxRouteBacks ?? MAX_ROUTE_BACKS;
  mkdirSync(film.dir, { recursive: true });
  const brief = briefFor(options);
  film.decide({
    agent: 'coordinator',
    kind: 'started',
    stage: 'research',
    message: `Started a ${brief.kind} of ${film.manifest.host}: ${options.length}, ${format}, under a ${usd(options.maxMicroUsd)} cap`,
    why:
      brief.kind === 'customer-order'
        ? 'A Standard film was asked for, so the brief asks for 45 s: Long cannot apply, and rule 2 still makes it Short if the research has fewer than 3 usable claims.'
        : "Rule 1 of the Director's §1: an outreach sample or a social cut is Short.",
    data: { brief },
  });
  film.write();
  const aborted = () => deps.signal?.aborted ?? false;
  const stop = (why: string) => film.finish(film.manifest.film ? 'ready' : 'failed', why);

  const research = await film.step('research', (limits) =>
    crew.research({ url: options.url, dir: join(film.dir, 'research'), ...limits }),
  );
  if (!research.ok || !research.value)
    return film.finish('failed', research.failure ?? 'research failed');
  const { researchFile } = research.value;
  if (aborted()) return stop('interrupted');

  const first = await film.step('director', (limits) =>
    crew.direct({ researchFile, brief, dir: roundDir(film.dir, 1, 'director'), ...limits }),
  );
  if (!first.ok || !first.value)
    return film.finish('failed', first.failure ?? 'the Director wrote no campaign');
  let director = first.value;
  let artIssues: QcIssue[] = [];
  /** The campaign the last render was asked to draw. */
  let triedSha: string | undefined;

  for (;;) {
    const round = film.manifest.round;
    if (aborted()) return stop('interrupted');
    const art = await film.step('art-director', (limits) =>
      crew.art({
        campaignFile: director.campaignFile,
        researchFile,
        dir: roundDir(film.dir, round, 'art'),
        issues: artIssues,
        ...limits,
      }),
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

    const gate = await film.gate(crew, campaignFile, format);
    if (!gate.ok) return stop(`${gate.check} refused the film, so it was not rendered`);
    if (aborted()) return stop('interrupted');

    triedSha = sha;
    const render = await film.step('render', (limits) =>
      crew.render({
        campaignFile,
        researchFile,
        format,
        dir: roundDir(film.dir, round, 'render'),
        ...limits,
      }),
    );
    // What failed, and who can fix it: a scene motion refused to draw, or Quality Check's review.
    let failed: { by: string; issues: QcIssue[] };
    if (!render.ok || !render.value) {
      if (!render.issues?.length) return stop(render.failure ?? 'the render failed');
      failed = { by: 'motion refused to draw the film', issues: render.issues };
    } else {
      const rendered = render.value;
      const qc = await film.step('quality-check', (limits) =>
        crew.qc({ renderDir: rendered.renderDir, researchFile, ...limits }),
      );
      if (!qc.ok || !qc.value) {
        film.deliver(rendered, campaignFile, format);
        return film.finish(
          'ready',
          `Quality Check did not review the film: ${qc.failure ?? 'no report'}`,
        );
      }
      film.deliver(rendered, campaignFile, format, qc.value);
      const { report } = qc.value;
      if (report.verdict === 'pass') return film.finish('ready', null);
      failed = { by: 'Quality Check failed the film', issues: report.issues };
    }

    // Route the failure back to the agents that can fix it, within the limits.
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
    if (film.manifest.routeBacks >= maxRouteBacks) {
      return routeBack(
        `The film has been sent back ${film.manifest.routeBacks} time(s), the limit.`,
        'Not sent back again: the route-back limit',
      );
    }
    const need =
      (toDirector.length ? FLOORS.director : 0) + FLOORS.render + FLOORS['quality-check'];
    if (film.room < need) {
      return routeBack(
        `Another round needs at least ${usd(need)}, and ${usd(Math.max(0, film.room))} of the ${usd(options.maxMicroUsd)} cap is left.`,
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
      const revised = await film.step('director', (limits) =>
        crew.direct({
          researchFile,
          brief,
          dir: roundDir(film.dir, next, 'director'),
          revise: { ...director, issues: toDirector },
          ...limits,
        }),
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
