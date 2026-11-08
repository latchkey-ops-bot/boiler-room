/**
 * The live production crew for `pnpm film`: each stage calls the same function its own command
 * does (`research`, `direct`, `artDirect`, `renderCampaign`, `qualityCheckRender`), with a Naive
 * client that holds the stage to the ceiling the film gives it, and reads what the stage spent,
 * which sessions it ran and what it decided from the reports it wrote.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FilmRejected, layoutRefusals } from '@boiler-room/motion';
import { CostLimitExceeded, chargesOf, gateCampaign, renderCampaign } from '@boiler-room/render';
import { DEFAULT_CAP, DEFAULT_IMAGE_MODEL } from '../art/generate.ts';
import type { ArtIssue } from '../art/prompt.ts';
import { artDirect } from '../art/run.ts';
import type { DirectorIssue } from '../director/checks.ts';
import { direct } from '../director/run.ts';
import { naiveClient } from '../naive/client.ts';
import { closeSession } from '../naive/session.ts';
import type { QcIssue, QcReport } from '../quality/output.ts';
import { qualityCheckRender } from '../quality/run.ts';
import { research } from '../researcher/run.ts';
import type { AgentSync } from '../sync.ts';
import { localizeCampaign } from './assets.ts';
import { type Capped, capNaive, MIN_SESSION_MICRO_USD } from './cap.ts';
import { artDecisions, directorDecisions, qcDecisions, researchDecisions } from './decisions.ts';
import type {
  FilmCrew,
  GateOutcome,
  RenderedFilm,
  StageCost,
  StageLimits,
  StageOutcome,
} from './run.ts';

type Json = Record<string, unknown>;

function readJson(file: string): Json | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Json;
  } catch {
    return undefined;
  }
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
/** The sessions a stage's report says paused on their budget, which the stage cancelled. */
const pausedIds = (sessions: Json[]): string[] =>
  sessions.flatMap((each) =>
    each.budget_paused === true && typeof each.session_id === 'string' ? [each.session_id] : [],
  );
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const cost = (model: number, compute = 0, media = 0): StageCost => ({
  modelMicroUsd: Math.max(0, Math.round(model)),
  computeMicroUsd: Math.max(0, Math.round(compute)),
  mediaMicroUsd: Math.max(0, Math.round(media)),
});

/** A Quality Check issue as the Director's repair loop words one. */
export function directorIssueOf(issue: QcIssue, campaign: Json | undefined): DirectorIssue {
  const variants = (campaign?.variants as Json | undefined) ?? {};
  const scenes = Array.isArray(campaign?.scenes) ? (campaign.scenes as Json[]) : [];
  const hooks = Array.isArray(variants.hooks) ? (variants.hooks as Json[]) : [];
  const sceneIndex = scenes.findIndex((scene) => scene.id === issue.sceneId);
  const hookIndex = hooks.findIndex((scene) => scene.id === issue.sceneId);
  const path =
    sceneIndex >= 0
      ? `campaign.scenes[${sceneIndex}]`
      : hookIndex >= 0
        ? `campaign.variants.hooks[${hookIndex}]`
        : 'campaign';
  const where = [
    issue.sceneId ? `in scene ${issue.sceneId}` : 'in the film',
    issue.frame !== null
      ? `at frame ${issue.frame}${issue.timecode ? ` (${issue.timecode})` : ''}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    code: `QC_${issue.check.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
    severity: 'error',
    path,
    message: `Quality Check (${issue.source}, ${issue.severity}) ${where}: ${issue.what}`,
    fix: issue.fix,
    owner: 'director',
  };
}

export const artIssueOf = (issue: QcIssue): ArtIssue => ({
  check: issue.check,
  severity: issue.severity,
  sceneId: issue.sceneId,
  frame: issue.frame,
  what: issue.what,
  fix: issue.fix,
});

/**
 * The copy a scene template refused to set, as Quality Check issues the Director owns. motion
 * never shrinks type to make copy fit, and neither the campaign validator nor `validateFilm`
 * measures type, so a type card or a stat-counter whose words do not fit their line at their cap
 * height stops the render with `TYPE_CARD_LAYOUT` or `LAYOUT_UNFIT`: when the film is selected,
 * before any computer exists, for every scene at once, or, for one that gets past that, while its
 * chunk is drawn. The fix is shorter copy. The same refusal comes back from every computer and tab
 * that drew the scene; it is one issue.
 */
export function renderLayoutIssues(text: string): QcIssue[] {
  const found = new Map<string, QcIssue>();
  const add = (check: string, sceneId: string | null, what: string, fix: string) => {
    const key = `${check} ${sceneId} ${what}`;
    if (!found.has(key))
      found.set(key, {
        severity: 'blocker',
        check,
        sceneId,
        frame: null,
        timecode: null,
        what,
        fix,
        owner: 'director',
        source: 'code',
      });
  };
  for (const refusal of layoutRefusals(text)) {
    const card = /^TYPE_CARD_LAYOUT at (?:scene "([^"]+)", )?text "([^"]+)": (.+)$/.exec(refusal);
    if (card) {
      const [, sceneId, textId, rest] = card;
      add(
        'type-card-layout',
        sceneId ?? null,
        `Text "${textId}": ${(rest ?? '').trim()}`,
        `Shorten text "${textId}" until it sets on its lines at its cap height. motion never sets type smaller to make copy fit.`,
      );
      continue;
    }
    const rest = refusal.replace(/^LAYOUT_UNFIT: /, '').trim();
    add(
      'stat-counter-layout',
      /Scene "([^"]+)"/.exec(rest)?.[1] ?? null,
      rest,
      'Shorten the number or its label until both set at their cap heights. motion never sets type smaller to make copy fit.',
    );
  }
  return [...found.values()];
}

/** Which gate a `FilmRejected` names: "This campaign cannot be rendered: <check> found ...". */
export function rejectedBy(error: FilmRejected): string {
  return /cannot be rendered: (.+?) found/.exec(error.message)?.[1] ?? 'the render gate';
}

/** The render gate, as `renderCampaign` runs it, on its own so a refusal costs nothing. */
export async function gateFilm(input: {
  campaignFile: string;
  format: '16:9' | '9:16' | '1:1';
  hookId?: string | null;
  ctaId?: string | null;
}): Promise<GateOutcome> {
  let campaign: unknown;
  try {
    campaign = JSON.parse(readFileSync(input.campaignFile, 'utf8'));
  } catch (cause) {
    return {
      ok: false,
      check: 'validateCampaign',
      issues: [{ code: 'NOT_JSON', path: '$', message: message(cause), severity: 'error' }],
    };
  }
  try {
    const gated = await gateCampaign(campaign, {
      format: input.format,
      ...(input.hookId ? { hookId: input.hookId } : {}),
      ...(input.ctaId ? { ctaId: input.ctaId } : {}),
    });
    return {
      ok: true,
      warnings: gated.warnings.map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`),
    };
  } catch (cause) {
    if (!(cause instanceof FilmRejected)) throw cause;
    return {
      ok: false,
      check: rejectedBy(cause),
      issues: cause.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
        severity: issue.severity,
        ...('fix' in issue && typeof issue.fix === 'string' ? { fix: issue.fix } : {}),
      })),
    };
  }
}

export interface NaiveCrewOptions {
  /** The repo's `out/`, for the stages that read their defaults from it. */
  outRoot: string;
  signal?: AbortSignal;
  log?: (line: string) => void;
  /** `naive` renders on Naive computers; `local` on this computer, as the film computer does. */
  renderRunner?: 'naive' | 'local';
  /** `verify` never creates or changes an agent or pushes a skill (`--no-sync`). */
  agentSync?: AgentSync;
}

export class NaiveCrew implements FilmCrew {
  /** Every session any stage started through this crew, so an interrupted film can close them. */
  readonly started = new Set<string>();
  private readonly options: NaiveCrewOptions;
  private readonly capped: Capped<ReturnType<typeof naiveClient>>[] = [];
  /** Clean-ups a stage handed over, such as the Researcher pausing its computer. */
  private readonly stoppers = new Set<() => Promise<void>>();
  private readonly sync: { agentSync?: AgentSync };

  constructor(options: NaiveCrewOptions) {
    this.options = options;
    this.sync = options.agentSync ? { agentSync: options.agentSync } : {};
  }

  private cap(limits: StageLimits) {
    const capped = capNaive(naiveClient(), { ceilingMicroUsd: limits.ceilingMicroUsd });
    this.capped.push(capped);
    return capped;
  }

  private sessionsOf(capped: Capped<unknown>): string[] {
    for (const id of capped.sessions) this.started.add(id);
    return [...capped.sessions];
  }

  /** Interrupts or cancels every session the crew started, and runs each stage's clean-up. */
  async stop(): Promise<void> {
    const client = naiveClient();
    for (const capped of this.capped) for (const id of capped.sessions) this.started.add(id);
    await Promise.all([
      ...[...this.started].map((id) => closeSession(client, id).catch(() => undefined)),
      ...[...this.stoppers].map((stop) => stop().catch(() => undefined)),
    ]);
  }

  async research(input: { url: string; dir: string } & StageLimits) {
    const code = await research({
      url: input.url,
      material: [],
      budgetUsd: Math.min(1.5, input.ceilingMicroUsd / 1e6),
      // The smaller retry after a budget pause sends no repair rounds back.
      maxRepairs: input.smaller ? 0 : 2,
      keepComputer: false,
      drillRepair: false,
      outRoot: this.options.outRoot,
      outDir: input.dir,
      ...this.sync,
      // The film owns SIGINT and SIGTERM; it calls the research's clean-up through stop().
      ownSignals: false,
      onStop: (stop) => this.stoppers.add(stop),
    });
    const report = readJson(join(input.dir, 'report.json')) ?? {};
    const researchFile = join(input.dir, 'research.json');
    const accepted = code === 0 ? readJson(researchFile) : undefined;
    const session = num(report.session_micro_usd);
    // The agent's own spend this run includes its computer; it can book a few minutes late.
    const agent = num(report.agent_spend_this_run_micro_usd);
    const sessionId = typeof report.session_id === 'string' ? report.session_id : undefined;
    if (sessionId) this.started.add(sessionId);
    return {
      ok: Boolean(accepted),
      ...(accepted ? { value: { researchFile } } : {}),
      failure: accepted
        ? undefined
        : typeof report.error === 'string'
          ? report.error
          : 'no research passed the gate',
      cost: cost(session, Math.max(0, agent - session)),
      sessionIds: sessionId ? [sessionId] : [],
      budgetPaused: report.stop_reason === 'budget_paused',
      decisions: researchDecisions(report, accepted),
      files: {
        research: researchFile,
        pages: join(input.dir, 'pages.json'),
        report: join(input.dir, 'report.json'),
      },
    } satisfies StageOutcome<{ researchFile: string }>;
  }

  async direct(input: Parameters<FilmCrew['direct']>[0]) {
    const capped = this.cap(input);
    let revise: { submission: unknown; issues: DirectorIssue[] } | undefined;
    if (input.revise) {
      const campaign = readJson(input.revise.campaignFile);
      const { leftToOthers: _left, ...handoff } = readJson(input.revise.handoffFile) ?? {};
      revise = {
        submission: { campaign, handoff },
        issues: input.revise.issues.map((issue) => directorIssueOf(issue, campaign)),
      };
    }
    let code = 1;
    let failure: string | undefined;
    try {
      code = await direct({
        researchPath: input.researchFile,
        brief: input.brief,
        budgetUsd: Math.min(2.5, input.ceilingMicroUsd / 1e6),
        maxRepairs: 3,
        outDir: input.dir,
        client: capped.client,
        ...this.sync,
        ...(revise ? { revise } : {}),
      });
    } catch (cause) {
      failure = message(cause);
    }
    const report = readJson(join(input.dir, 'director-report.json')) ?? {};
    const campaignFile = join(input.dir, 'campaign.json');
    const handoffFile = join(input.dir, 'handoff.json');
    const ok = code === 0 && existsSync(campaignFile) && existsSync(handoffFile);
    const sessions = Array.isArray(report.sessions) ? (report.sessions as Json[]) : [];
    return {
      ok,
      ...(ok ? { value: { campaignFile, handoffFile } } : {}),
      failure: ok
        ? undefined
        : (failure ??
          (typeof report.failed === 'string' ? report.failed : undefined) ??
          (typeof report.error === 'string' ? report.error : 'no campaign written')),
      cost: cost(
        report.session_micro_usd === undefined
          ? await capped.committedMicroUsd()
          : num(report.session_micro_usd),
      ),
      sessionIds: this.sessionsOf(capped),
      budgetPaused: sessions.some((each) => each.budget_paused === true),
      cancelled: pausedIds(sessions),
      // `direct` retries a budget pause itself, once, from its last submission.
      retriedSmaller: true,
      decisions: directorDecisions(report, ok ? readJson(handoffFile) : undefined),
      files: {
        campaign: campaignFile,
        handoff: handoffFile,
        report: join(input.dir, 'director-report.json'),
      },
    } satisfies StageOutcome<{ campaignFile: string; handoffFile: string }>;
  }

  async art(input: Parameters<FilmCrew['art']>[0]) {
    const capped = this.cap(input);
    const outPath = join(input.dir, 'campaign.art.json');
    const reportPath = join(input.dir, 'campaign.art.report.json');
    const imageCap = Math.min(
      DEFAULT_CAP.maxMicroUsd,
      Math.max(0, input.ceilingMicroUsd - MIN_SESSION_MICRO_USD),
    );
    // Under $1 there is no room for a review session: the code's picks stand, nothing generated.
    const agent = input.ceilingMicroUsd >= MIN_SESSION_MICRO_USD;
    let code = 1;
    let failure: string | undefined;
    try {
      code = await artDirect({
        campaignPath: input.campaignFile,
        researchPath: input.researchFile,
        outPath,
        outRoot: this.options.outRoot,
        budgetUsd: Math.max(0.05, Math.min(1, (input.ceilingMicroUsd - imageCap) / 1e6)),
        concurrency: 2,
        cap: { ...DEFAULT_CAP, maxMicroUsd: imageCap },
        imageModel: DEFAULT_IMAGE_MODEL,
        agent,
        issues: input.issues.map(artIssueOf),
        client: capped.client,
        ...this.sync,
      });
    } catch (cause) {
      failure = message(cause);
    }
    const report = readJson(reportPath) ?? {};
    const spent = (report.cost as Json | undefined) ?? {};
    // Exit 3 is a campaign written with a tile-wall sent back to the Director: it still renders.
    const ok = (code === 0 || code === 3) && existsSync(outPath);
    const reviews = Array.isArray((report.agent as Json | undefined)?.reviews)
      ? ((report.agent as Json).reviews as Json[])
      : [];
    const decisions = report.family ? artDecisions(report) : [];
    if (!agent) {
      decisions.unshift({
        agent: 'coordinator',
        kind: 'decision',
        stage: 'art_direction',
        message: "The Art Director ran as code alone: the code's picks, nothing generated",
        why: `The film's cap left $${(input.ceilingMicroUsd / 1e6).toFixed(2)} for art direction, and a review session needs $1.`,
      });
    }
    return {
      ok,
      ...(ok ? { value: { campaignFile: outPath } } : {}),
      failure: ok ? undefined : (failure ?? 'the art-directed campaign failed validateCampaign'),
      cost: report.cost
        ? cost(num(spent.session_micro_usd), 0, num(spent.images_micro_usd))
        : cost(await capped.committedMicroUsd()),
      sessionIds: this.sessionsOf(capped),
      budgetPaused: reviews.some((each) => each.budget_paused === true),
      cancelled: pausedIds(reviews),
      // The review retries a paused batch itself, as smaller batches.
      retriedSmaller: true,
      decisions,
      files: { campaign: outPath, report: reportPath },
    } satisfies StageOutcome<{ campaignFile: string }>;
  }

  gate(input: Parameters<FilmCrew['gate']>[0]) {
    return gateFilm(input);
  }

  async render(input: Parameters<FilmCrew['render']>[0]): Promise<StageOutcome<RenderedFilm>> {
    const output = join(input.dir, 'film.mp4');
    try {
      // The render service reads pictures from beside the campaign, not from Naive files.
      const local = await localizeCampaign({
        campaignFile: input.campaignFile,
        outDir: input.dir,
        searchDirs: [
          join(dirname(input.researchFile), 'files'),
          join(dirname(input.campaignFile), 'assets', 'generated'),
        ],
        download: (fileId) => naiveClient().files.downloadBytes(fileId),
      });
      if (local.downloaded.length)
        this.options.log?.(`render: downloaded ${local.downloaded.join(', ')} from Naive files`);
      const result = await renderCampaign({
        campaignFile: local.campaignFile,
        format: input.format,
        ...(input.hookId ? { hookId: input.hookId } : {}),
        ...(input.ctaId ? { ctaId: input.ctaId } : {}),
        output,
        maxCostUsd: input.ceilingMicroUsd / 1e6,
        // `local` draws on this computer and starts none, so it costs the crew nothing.
        runner: this.options.renderRunner ?? 'naive',
        ...(this.options.signal ? { signal: this.options.signal } : {}),
        log: (line) => this.options.log?.(`render: ${line}`),
      });
      const { manifest } = result;
      const usdSpent = Math.max(manifest.cost.computedUsd, manifest.cost.ledgerUsd ?? 0);
      return {
        ok: true,
        value: {
          renderDir: input.dir,
          film: result.output,
          manifestFile: result.manifestFile,
          sha256: manifest.output.sha256,
          bytes: manifest.output.bytes,
          durationSeconds: manifest.settings.durationInFrames / manifest.settings.fps,
        },
        cost: cost(0, usdSpent * 1e6),
        sessionIds: [],
        computerIds: manifest.computers.map((computer) => computer.id),
        decisions: [
          {
            agent: 'render',
            kind: 'decision',
            stage: 'render',
            message: `Rendered ${manifest.settings.durationInFrames} frames in ${manifest.settings.chunks} chunk(s) on ${manifest.computers.length} computer(s)`,
            why: `Estimated at most $${(manifest.cost.estimate?.maxUsd ?? 0).toFixed(4)} against a limit of $${manifest.cost.limitUsd.toFixed(2)}; spent $${usdSpent.toFixed(4)}.`,
            data: { runId: manifest.runId },
          },
        ],
        files: { film: result.output, manifest: result.manifestFile, campaign: local.campaignFile },
      };
    } catch (cause) {
      // A run that created computers says what they cost. Nothing is spent before the estimate
      // is accepted; any other failure is counted at the limit the pool stops before.
      const charges = chargesOf(cause);
      const before =
        cause instanceof FilmRejected ||
        (cause instanceof CostLimitExceeded && cause.message.startsWith('The estimate'));
      const issues = renderLayoutIssues(message(cause));
      return {
        ok: false,
        failure: message(cause),
        capped: cause instanceof CostLimitExceeded,
        cost: cost(0, charges ? charges.chargedUsd * 1e6 : before ? 0 : input.ceilingMicroUsd),
        sessionIds: [],
        computerIds: charges?.computerIds ?? [],
        ...(issues.length ? { issues } : {}),
        decisions: issues.map((issue) => ({
          agent: 'motion' as const,
          kind: 'failed' as const,
          stage: 'render' as const,
          message: `Refused to draw ${issue.sceneId ?? 'a scene'}: ${issue.check}`,
          why: issue.what,
        })),
      };
    }
  }

  async qc(input: Parameters<FilmCrew['qc']>[0]) {
    const capped = this.cap(input);
    try {
      const report: QcReport = await qualityCheckRender({
        renderDir: input.renderDir,
        researchFile: input.researchFile,
        model: true,
        budgetUsd: Math.min(1.5, Math.max(1, input.ceilingMicroUsd / 1e6)),
        client: capped.client,
        ...this.sync,
        say: (line) => this.options.log?.(`qc: ${line}`),
      });
      const reportFile = join(input.renderDir, `${report.campaignId}.qc`, 'qc-report.json');
      return {
        ok: true,
        value: { report, reportFile },
        cost: cost(report.review?.costMicroUsd ?? (await capped.committedMicroUsd())),
        sessionIds: this.sessionsOf(capped),
        budgetPaused: report.review?.sessions?.some((each) => each.budget_paused) ?? false,
        cancelled: pausedIds((report.review?.sessions ?? []) as unknown as Json[]),
        // A paused review is retried by the review itself, as two half sessions.
        retriedSmaller: true,
        decisions: qcDecisions(report as unknown as Json),
        files: { report: reportFile },
      } satisfies StageOutcome<{ report: QcReport; reportFile: string }>;
    } catch (cause) {
      return {
        ok: false,
        failure: message(cause),
        cost: cost(await capped.committedMicroUsd()),
        sessionIds: this.sessionsOf(capped),
        retriedSmaller: true,
        decisions: [],
      };
    }
  }
}
