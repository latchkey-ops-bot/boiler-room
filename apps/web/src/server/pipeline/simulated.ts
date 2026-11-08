import { type Campaign, campaignSchema } from '@boiler-room/schema';
import sample from '@boiler-room/schema/examples/nova.campaign.json';
import {
  type CrewMember,
  displayHost,
  type EventKind,
  type FilmStatus,
  type Format,
  type ScriptDecisionKind,
  SIMULATED_SECONDS,
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
 * crew would write, pauses for the customer's approval, rewrites on a note, "delivers" files that
 * do not exist, and goes round again on a revision. Every screen labels a simulated film as one.
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
  /** Claims nobody had confirmed, which the customer confirmed when approving. */
  confirmedClaimIds?: string[];
  at: Date;
}

/** The customer asked for changes to delivered version `version`. */
export interface ScriptRevision {
  version: number;
  note: string;
  at: Date;
}

export interface SimulatedRun {
  url: string;
  startedAt: Date;
  decisions: ScriptDecision[];
  /** Revisions asked for after delivery. None when left out. */
  revisions?: ScriptRevision[];
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
    // The files of the version that was delivered last, which is the one the run is on.
    const version = status.scriptVersion;
    const approved = run.decisions.find(
      (decision) => decision.decision === 'approved' && decision.version === version,
    );
    if (!approved) return [];
    const slug = displayHost(run.url).replace(/[^a-z0-9]+/g, '-');
    const opening = approved.hookId ?? 'main';
    const cut = version > 1 ? `-v${version}` : '';
    return approved.formats.map((format) => ({
      variantKey: `${format}.${opening}.${approved.ctaId ?? 'none'}`,
      format,
      hookId: approved.hookId,
      ctaId: approved.ctaId,
      fileName: `${slug}-${format.replace(':', 'x')}-${opening}${cut}.mp4`,
      contentType: 'video/mp4',
      r2Key: null,
      bytes: null,
      durationSeconds: SAMPLE_CAMPAIGN.durationSeconds,
      scriptVersion: version,
    }));
  }

  async requestRevision(runId: string, input: { version: number; note: string }): Promise<void> {
    // The app records the request in the ledger before it calls here, so that a request over the
    // cap never reaches a real pipeline. Judge the run as it stood without that request.
    const run = await this.requireRun(runId);
    const before = {
      ...run,
      revisions: (run.revisions ?? []).filter((item) => item.version !== input.version),
    };
    const now = this.clock().getTime();
    const last = timeline(runId, before, this.pace)
      .filter((event) => event.at.getTime() <= now)
      .at(-1);
    if (last?.status !== 'done') {
      throw new PipelineConflictError('The film is not delivered yet.');
    }
    if (last.scriptVersion !== input.version) {
      throw new PipelineConflictError(
        `Version ${input.version} is not the delivered film. Version ${last.scriptVersion} is.`,
      );
    }
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
  const lastAt = (fallback: number) => events[events.length - 1]?.at.getTime() ?? fallback;
  let readyAt = lastAt(run.startedAt.getTime());

  const byTime = <T extends { at: Date }>(items: T[]) =>
    [...items].sort((a, b) => a.at.getTime() - b.at.getTime());
  const decisions = byTime(run.decisions);
  const revisions = byTime(run.revisions ?? []);
  for (;;) {
    // A decision counts only on the version that was waiting, once it was waiting.
    const decision = decisions.find(
      (item) => item.version === version && item.at.getTime() >= readyAt,
    );
    if (!decision) break;
    const base = decision.at.getTime();
    if (decision.decision === 'changes_requested') {
      add(base, rewrite(version, decision.note ?? ''));
      version += 1;
      readyAt = lastAt(base);
      continue;
    }
    add(base, production(version, decision.formats, decision.confirmedClaimIds ?? []));
    // A revision counts only on the version that was delivered, once it was delivered.
    const deliveredAt = lastAt(base);
    const revision = revisions.find(
      (item) => item.version === version && item.at.getTime() >= deliveredAt,
    );
    if (!revision) break;
    add(revision.at.getTime(), revise(version, revision.note));
    version += 1;
    readyAt = lastAt(revision.at.getTime());
  }
  return events;
}

/** The site every simulated film's script comes from, whatever URL the founder typed. */
export const SAMPLE_HOST = displayHost(SAMPLE_CAMPAIGN.sourceUrl);

/** The Validator's pass, which says plainly when a number still needs the founder. */
function validatorPass(prefix: string): string {
  const open = SAMPLE_CAMPAIGN.claims.filter(
    (claim) =>
      claim.status !== 'approved' &&
      SAMPLE_CAMPAIGN.scenes.some((scene) =>
        [
          ...scene.text.flatMap((item) => item.claimIds),
          ...(scene.voiceover?.claimIds ?? []),
        ].includes(claim.id),
      ),
  );
  const backed = `${prefix}Every number is backed by a quote from ${SAMPLE_HOST}.`;
  if (open.length === 0) return backed;
  if (open.length === 1) return `${backed} "${open[0]?.text}" needs you to confirm it.`;
  return `${backed} ${open.length} of them need you to confirm them.`;
}

function firstScript(host: string): Planned[] {
  const v = 0;
  const brand = SAMPLE_CAMPAIGN.brand;
  const fonts = new Set([brand.fonts.display.family, brand.fonts.body.family]).size;
  const colours = Object.values(brand.colors).filter(Boolean).length;
  const extras = SAMPLE_CAMPAIGN.variants.hooks.length;
  return [
    step(
      0,
      'account_manager',
      'started',
      'research',
      'working',
      host === SAMPLE_HOST
        ? `Started a simulated film for ${host}. The Researcher is reading the site.`
        : `Started a simulated film for ${host}. The crew works from the sample site, ${SAMPLE_HOST}.`,
      v,
    ),
    step(4, 'researcher', 'decision', 'research', 'working', `Read 6 pages on ${SAMPLE_HOST}.`, v),
    step(
      9,
      'researcher',
      'decision',
      'research',
      'working',
      `Copied ${SAMPLE_CAMPAIGN.claims.length} claims word for word, each with the page it came from.`,
      v,
    ),
    step(
      12,
      'researcher',
      'decision',
      'script',
      'working',
      `Saved the brand: ${fonts} fonts, ${colours} colours and the logo.`,
      v,
    ),
    step(
      18,
      'director',
      'decision',
      'checks',
      'working',
      `Wrote ${SAMPLE_CAMPAIGN.scenes.length} scenes${extras > 0 ? ` and ${extras} alternate opening${extras === 1 ? '' : 's'}` : ''}, ${SAMPLE_CAMPAIGN.durationSeconds} seconds long.`,
      v,
    ),
    step(
      21,
      'validator',
      'sent_back',
      'script',
      'working',
      'Caught a number with no source ("73% faster") and sent the line back. It never reached your script.',
      v,
    ),
    step(
      26,
      'director',
      'decision',
      'checks',
      'working',
      "Fixed scene 2 with the site's own figure: 40% faster builds.",
      v,
    ),
    step(29, 'validator', 'passed', 'approval', 'working', validatorPass(''), v),
    step(
      SIMULATED_SECONDS.script,
      'account_manager',
      'needs_you',
      'approval',
      'needs_you',
      'Your script is ready. The crew paused until you approve it.',
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
      validatorPass(`Checked version ${next}. `),
      version,
    ),
    step(
      8,
      'account_manager',
      'needs_you',
      'approval',
      'needs_you',
      `Version ${next} is ready. The crew paused until you approve it.`,
      next,
    ),
  ];
}

function revise(version: number, note: string): Planned[] {
  const next = version + 1;
  return [
    step(
      0,
      'customer',
      'sent_back',
      'script',
      'working',
      `Asked for changes to version ${version}: "${shorten(note)}"`,
      version,
    ),
    step(
      2,
      'account_manager',
      'decision',
      'script',
      'working',
      `Took your note to the Director. The files of version ${version} stay ready to download.`,
      version,
    ),
    step(
      7,
      'director',
      'decision',
      'checks',
      'working',
      `Rewrote the script from your note. This is version ${next}.`,
      version,
    ),
    step(
      10,
      'validator',
      'passed',
      'approval',
      'working',
      validatorPass(`Checked version ${next}. `),
      version,
    ),
    step(
      11,
      'account_manager',
      'needs_you',
      'approval',
      'needs_you',
      `Version ${next} is ready. The crew paused until you approve it.`,
      next,
    ),
  ];
}

function shorten(note: string): string {
  return note.length > 80 ? `${note.slice(0, 79)}…` : note;
}

function production(version: number, formats: Format[], confirmed: string[]): Planned[] {
  const files = formats.length === 1 ? '1 file' : `${formats.length} files`;
  const shapes = formats.join(', ');
  const vouched = SAMPLE_CAMPAIGN.claims
    .filter((claim) => confirmed.includes(claim.id))
    .map((claim) => `"${claim.text}"`);
  return [
    step(
      0,
      'customer',
      'decision',
      'art_direction',
      'working',
      vouched.length > 0
        ? `Approved version ${version}, and confirmed ${vouched.join(' and ')}.`
        : `Approved version ${version}.`,
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
      SIMULATED_SECONDS.delivery,
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
