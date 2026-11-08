import { type Campaign, campaignSchema } from '@boiler-room/schema';
import sample from '@boiler-room/schema/examples/nova.campaign.json';
import {
  type CrewMember,
  displayHost,
  type EventKind,
  type FilmStatus,
  type Format,
  type ScriptDecisionKind,
  type Stage,
} from '../../lib/film.ts';
import {
  type PipelineClient,
  PipelineConflictError,
  type PipelineDeliverable,
  type PipelineEvent,
  type PipelineStatus,
  type ScriptApproval,
} from './types.ts';

/**
 * A pipeline that makes no film. It walks a run through all ten stages with the events a real
 * crew would write, pauses for the customer's approval, rewrites on a note, and "delivers" files
 * that do not exist. Every screen labels a simulated film as one.
 *
 * It keeps no state of its own, because a Worker keeps nothing between requests. The run is a pure
 * function of when it started, what the customer decided and when, and the clock. The app supplies
 * the first two from D1 through `SimulationLedger`.
 */

export interface ScriptDecision {
  version: number;
  decision: ScriptDecisionKind;
  note: string | null;
  hookId: string | null;
  ctaId: string | null;
  formats: Format[];
  at: Date;
}

export interface SimulatedRun {
  url: string;
  startedAt: Date;
  decisions: ScriptDecision[];
}

export interface SimulationLedger {
  run(runId: string): Promise<SimulatedRun | null>;
}

export interface SimulatedPipelineOptions {
  clock?: () => Date;
  /** 1 is demo speed: about 30 seconds to the script, 40 more to delivery. */
  pace?: number;
}

/** The sample script every simulated film gets. Sample figures on sample content need no label. */
export const SAMPLE_CAMPAIGN: Campaign = campaignSchema.parse(sample);

interface Planned {
  offset: number;
  agent: CrewMember;
  kind: EventKind;
  stage: Stage;
  status: FilmStatus;
  message: string;
  scriptVersion: number;
}

interface TimedEvent extends PipelineEvent {
  scriptVersion: number;
}

export class SimulatedPipeline implements PipelineClient {
  readonly kind = 'simulated' as const;
  private readonly ledger: SimulationLedger;
  private readonly clock: () => Date;
  private readonly pace: number;

  constructor(ledger: SimulationLedger, options: SimulatedPipelineOptions = {}) {
    this.ledger = ledger;
    this.clock = options.clock ?? (() => new Date());
    this.pace = options.pace ?? 1;
  }

  async start(input: { filmId: string; url: string }): Promise<{ runId: string }> {
    return { runId: `sim_${input.filmId}` };
  }

  async status(runId: string): Promise<PipelineStatus> {
    const happened = await this.happened(runId);
    const last = happened[happened.length - 1];
    if (!last) {
      return { runId, stage: 'research', status: 'queued', scriptVersion: 0, campaign: null };
    }
    const scriptWritten = happened.some((event) => event.agent === 'director');
    return {
      runId,
      stage: last.stage,
      status: last.status,
      scriptVersion: last.scriptVersion,
      campaign: scriptWritten ? SAMPLE_CAMPAIGN : null,
    };
  }

  async events(runId: string, options: { after?: string } = {}): Promise<PipelineEvent[]> {
    const happened = await this.happened(runId);
    const from = options.after ? happened.findIndex((event) => event.id === options.after) + 1 : 0;
    return happened.slice(from).map(({ scriptVersion: _version, ...event }) => event);
  }

  async approveScript(runId: string, input: ScriptApproval): Promise<void> {
    await this.assertAwaiting(runId, input.version);
  }

  async sendBackScript(runId: string, input: { version: number; note: string }): Promise<void> {
    await this.assertAwaiting(runId, input.version);
  }

  async deliverables(runId: string): Promise<PipelineDeliverable[]> {
    const run = await this.requireRun(runId);
    const status = await this.status(runId);
    if (status.status !== 'done') return [];
    const approved = run.decisions.find((decision) => decision.decision === 'approved');
    if (!approved) return [];
    const slug = displayHost(run.url).replace(/[^a-z0-9]+/g, '-');
    const opening = approved.hookId ?? 'main';
    return approved.formats.map((format) => ({
      variantKey: `${format}.${opening}.${approved.ctaId ?? 'none'}`,
      format,
      hookId: approved.hookId,
      ctaId: approved.ctaId,
      fileName: `${slug}-${format.replace(':', 'x')}-${opening}.mp4`,
      contentType: 'video/mp4',
      r2Key: null,
      bytes: null,
      durationSeconds: SAMPLE_CAMPAIGN.durationSeconds,
    }));
  }

  private async assertAwaiting(runId: string, version: number): Promise<void> {
    const status = await this.status(runId);
    if (status.status !== 'needs_you' || status.stage !== 'approval') {
      throw new PipelineConflictError('The script is not waiting for your approval.');
    }
    if (status.scriptVersion !== version) {
      throw new PipelineConflictError(
        `Version ${version} is not the latest script. Version ${status.scriptVersion} is.`,
      );
    }
  }

  private async requireRun(runId: string): Promise<SimulatedRun> {
    const run = await this.ledger.run(runId);
    if (!run) throw new PipelineConflictError(`There is no simulated run ${runId}.`);
    return run;
  }

  /** The run's events up to now. */
  private async happened(runId: string): Promise<TimedEvent[]> {
    const run = await this.requireRun(runId);
    const now = this.clock().getTime();
    return timeline(runId, run, this.pace).filter((event) => event.at.getTime() <= now);
  }
}

/** Every event the run will have, given the decisions so far, including ones still to come. */
export function timeline(runId: string, run: SimulatedRun, pace = 1): TimedEvent[] {
  const host = displayHost(run.url);
  const events: TimedEvent[] = [];
  const add = (base: number, steps: Planned[]) => {
    for (const step of steps) {
      events.push({
        id: `${runId}:${events.length}`,
        seq: events.length,
        at: new Date(base + (step.offset * 1000) / pace),
        agent: step.agent,
        kind: step.kind,
        stage: step.stage,
        status: step.status,
        message: step.message,
        scriptVersion: step.scriptVersion,
      });
    }
  };

  add(run.startedAt.getTime(), firstScript(host));
  let version = 1;
  let readyAt = events[events.length - 1]?.at.getTime() ?? run.startedAt.getTime();

  const decisions = [...run.decisions].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const decision of decisions) {
    // A decision counts only on the version that was waiting, once it was waiting.
    if (decision.version !== version || decision.at.getTime() < readyAt) continue;
    const base = decision.at.getTime();
    if (decision.decision === 'changes_requested') {
      add(base, rewrite(version, decision.note ?? ''));
      version += 1;
      readyAt = events[events.length - 1]?.at.getTime() ?? base;
      continue;
    }
    add(base, production(version, decision.formats));
    break;
  }
  return events;
}

function firstScript(host: string): Planned[] {
  const v = 0;
  return [
    step(
      0,
      'coordinator',
      'started',
      'research',
      'working',
      `Started a film for ${host}. The Researcher is reading the site.`,
      v,
    ),
    step(4, 'researcher', 'decision', 'research', 'working', `Read 6 pages on ${host}.`, v),
    step(
      9,
      'researcher',
      'decision',
      'research',
      'working',
      'Copied 4 claims word for word, each with the page it came from.',
      v,
    ),
    step(
      12,
      'researcher',
      'decision',
      'script',
      'working',
      'Saved the brand: 2 fonts, 5 colours and the logo.',
      v,
    ),
    step(
      18,
      'director',
      'decision',
      'checks',
      'working',
      'Wrote 4 scenes and 1 alternate opening, 20 seconds long.',
      v,
    ),
    step(
      21,
      'validator',
      'sent_back',
      'script',
      'working',
      '"Builds 73% faster" has no source. Cite a claim that states it, or remove it.',
      v,
    ),
    step(
      26,
      'director',
      'decision',
      'checks',
      'working',
      'Rewrote scene 2 from the build-times quote: 40% faster builds.',
      v,
    ),
    step(
      29,
      'validator',
      'passed',
      'approval',
      'working',
      'No issues. Every number is backed by a quote.',
      v,
    ),
    step(
      30,
      'coordinator',
      'needs_you',
      'approval',
      'needs_you',
      'Paused the run until you approve the script.',
      1,
    ),
  ];
}

function rewrite(version: number, note: string): Planned[] {
  const next = version + 1;
  const quoted = note.length > 80 ? `${note.slice(0, 79)}…` : note;
  return [
    step(
      0,
      'customer',
      'sent_back',
      'script',
      'working',
      `Sent version ${version} back: "${quoted}"`,
      version,
    ),
    step(
      4,
      'director',
      'decision',
      'checks',
      'working',
      `Rewrote the script from your note. This is version ${next}.`,
      version,
    ),
    step(
      7,
      'validator',
      'passed',
      'approval',
      'working',
      `Checked version ${next}. Every number is backed by a quote.`,
      version,
    ),
    step(
      8,
      'coordinator',
      'needs_you',
      'approval',
      'needs_you',
      `Version ${next} is ready. Paused until you approve it.`,
      next,
    ),
  ];
}

function production(version: number, formats: Format[]): Planned[] {
  const files = formats.length === 1 ? '1 file' : `${formats.length} files`;
  const shapes = formats.join(', ');
  return [
    step(
      0,
      'customer',
      'decision',
      'art_direction',
      'working',
      `Approved version ${version}.`,
      version,
    ),
    step(
      6,
      'art_director',
      'decision',
      'motion',
      'working',
      'Picked a motion template for each of the 4 scenes.',
      version,
    ),
    step(
      14,
      'motion',
      'decision',
      'audio',
      'working',
      'Animated 4 scenes at 30 frames a second.',
      version,
    ),
    step(
      20,
      'audio',
      'decision',
      'render',
      'working',
      'Laid the voiceover, a music bed and 1 sound effect.',
      version,
    ),
    step(28, 'render', 'decision', 'review', 'working', `Rendered ${files}: ${shapes}.`, version),
    step(
      36,
      'quality_check',
      'passed',
      'delivery',
      'working',
      'Watched every transition and read every line at phone size. Passed.',
      version,
    ),
    step(
      40,
      'account_manager',
      'delivered',
      'delivery',
      'done',
      `Delivered ${files}. They are ready to download.`,
      version,
    ),
  ];
}

function step(
  offset: number,
  agent: CrewMember,
  kind: EventKind,
  stage: Stage,
  status: FilmStatus,
  message: string,
  scriptVersion: number,
): Planned {
  return { offset, agent, kind, stage, status, message, scriptVersion };
}
