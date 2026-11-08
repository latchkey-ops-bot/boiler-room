import { validateCampaign } from '@boiler-room/schema';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type FilmRun, runFiles } from '../../db/schema.ts';
import { CREW, type CrewMember, type EventKind, STAGES, type Stage } from '../../lib/film.ts';
import { ApiError } from '../api/errors.ts';
import { advance } from './advance.ts';
import type { ApprovalInput, EventsAnswer } from './contract.ts';
import { SAMPLE_FORMATS, variantKey } from './contract.ts';
import { failRun, getRun, moveRun, patchRun, type RunnerDeps, stopRun } from './runs.ts';
import { asStage, PHASE_DEADLINE_MS, visibleStatus } from './states.ts';

// ---------- Shapes. Extra fields are allowed, so a newer runner still talks to this website. ----------

const name = z.string().min(1).max(64);
const message = z.string().max(4000);
const base = {
  seq: z.int().positive().max(1_000_000_000),
  at: z.string().max(40),
  phase: z.enum(['script', 'render', 'all']),
};

export const helloEvent = z.object({
  ...base,
  type: z.literal('runner.hello'),
  commit: z.string().max(64),
  filmCommit: z.string().max(64),
  node: z.string().max(32),
  freeDiskGb: z.number().nonnegative().max(100_000),
  swapMb: z.number().nonnegative().max(1_000_000),
});

const microUsd = z.int().nonnegative().max(1_000_000_000_000);

export const runnerEvent = z.discriminatedUnion('type', [
  helloEvent,
  z.object({ ...base, type: z.literal('runner.heartbeat') }),
  z.object({
    ...base,
    type: z.literal('stage'),
    stage: name,
    status: name.optional(),
    agent: name,
    message,
  }),
  z.object({
    ...base,
    type: z.literal('decision'),
    agent: name,
    stage: name.optional(),
    kind: z.enum(['decision', 'passed', 'sent_back']),
    message,
    detail: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('session'),
    agent: name,
    sessionId: z.string().max(80),
    state: z.enum(['started', 'ended']),
    microUsd: microUsd.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('cost'),
    step: name,
    microUsd,
    totalMicroUsd: microUsd,
  }),
  z.object({
    ...base,
    type: z.literal('artifact'),
    kind: name,
    fileId: z.string().max(40),
    version: z.int().nonnegative(),
    variantKey: z.string().max(120).optional(),
    bytes: z.int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({
    ...base,
    type: z.literal('script_ready'),
    version: z.int().positive(),
    campaignFileId: z.string().max(40),
    unconfirmedClaims: z.int().nonnegative().max(1000),
  }),
  z.object({
    ...base,
    type: z.literal('qc'),
    format: z.string().max(8),
    verdict: z.enum(['pass', 'fail', 'blocked']),
    routable: z.int().nonnegative().max(10_000),
    issues: z
      .array(
        z.object({
          severity: name,
          check: name,
          owner: name,
          scene: z.string().max(64).optional(),
          frame: z.int().nonnegative().optional(),
          message,
        }),
      )
      .max(100),
  }),
  z.object({
    ...base,
    type: z.literal('delivered'),
    version: z.int().positive(),
    variants: z.array(z.string().max(120)).max(30),
  }),
  z.object({
    ...base,
    type: z.literal('error'),
    code: name,
    message,
    stage: name.optional(),
    agent: name.optional(),
    retryable: z.boolean(),
  }),
  z.object({
    ...base,
    type: z.literal('runner.exit'),
    exitCode: z.int().nullable(),
    signal: z.string().max(16).nullable(),
    durationMs: z.int().nonnegative(),
  }),
]);
export type RunnerEventInput = z.infer<typeof runnerEvent>;

export const eventsBody = z.object({
  runId: z.string().max(40),
  events: z.array(runnerEvent).min(1).max(100),
});

// ---------- Names: the film command uses the website's words; anything else is mapped or dropped ----------

export function crewOf(value: string | undefined): CrewMember {
  const normal = (value ?? '').toLowerCase().replace(/[-\s]+/g, '_');
  return CREW.includes(normal as CrewMember) && normal !== 'customer'
    ? (normal as CrewMember)
    : 'coordinator';
}

/** A stage the runner may move a film to. Only the website moves a film into or out of approval. */
export function stageOf(value: string | undefined): Stage | null {
  const normal = (value ?? '').toLowerCase().replace(/[-\s]+/g, '_');
  const stage = normal === 'quality_check' ? 'review' : normal;
  return STAGES.includes(stage as Stage) && stage !== 'approval' ? (stage as Stage) : null;
}

/** Control characters, which a feed line never carries. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are the characters removed
const CONTROL = /[\u0000-\u001f\u007f]+/g;

/** A feed line as the founder reads it: one plain sentence or a few, no control characters. */
export function feedText(text: string, secrets: string[] = []): string {
  let clean = text;
  for (const secret of secrets) if (secret) clean = clean.split(secret).join('[redacted]');
  clean = clean.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > 500 ? `${clean.slice(0, 499)}…` : clean;
}

// ---------- Applying a batch ----------

interface Feed {
  agent: CrewMember;
  kind: EventKind;
  message: string;
}

/**
 * Applies a batch in order. Each event is stored once, by its runner seq, so a batch sent again
 * after a lost answer changes nothing. A `delivered` that comes before its files is refused with
 * 409, and the events before it in the batch stay applied.
 */
export async function applyEvents(
  deps: RunnerDeps,
  start: FilmRun,
  events: RunnerEventInput[],
  secrets: string[],
): Promise<EventsAnswer> {
  let run = start;
  let lastSeq = 0;
  const now = deps.now().getTime();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    lastSeq = Math.max(lastSeq, event.seq);
    if (event.type === 'runner.heartbeat' || event.type === 'runner.hello') continue;
    if (event.type === 'delivered') await assertDelivered(deps, run, event);

    const stored = await deps.db.run(sql`
      insert or ignore into run_events (run_id, source, source_seq, film_id, at, type, data_json,
        received_at)
      values (${run.id}, 'runner', ${event.seq}, ${run.filmId}, ${eventTime(event.at, now)},
        ${event.type}, ${JSON.stringify(dataOf(event)).slice(0, 8192)}, ${now})`);
    if (stored.meta.changes !== 1) continue;

    const feed = await applyOne(deps, run, event, secrets);
    run = (await getRun(deps.db, run.id)) ?? run;
    if (feed) {
      const { stage, status } = visibleStatus(run);
      await deps.db.run(sql`
        update run_events set
          feed_seq = (select coalesce(max(feed_seq), 0) + 1 from run_events where run_id = ${run.id}),
          agent = ${feed.agent}, kind = ${feed.kind}, stage = ${stage}, status = ${status},
          message = ${feed.message}
        where run_id = ${run.id} and source = 'runner' and source_seq = ${event.seq}`);
    }
  }
  run = (await patchRun(deps, run.id, { heartbeatAt: now })) ?? run;
  // The cleanup `advance()` starts at once, so a failed run may already read `ended` here.
  const stop =
    run.state === 'stopping' ||
    run.state === 'failed' ||
    (run.state === 'ended' && run.deliveredAt === null);
  return {
    ok: true,
    lastSeq,
    control: stop
      ? { stop: true, reason: run.stopReason ?? run.failureCode ?? 'stopped' }
      : { stop: false },
    serverTime: Math.floor(now / 1000),
  };
}

async function applyOne(
  deps: RunnerDeps,
  run: FilmRun,
  event: RunnerEventInput,
  secrets: string[],
): Promise<Feed | null> {
  const running = run.state === 'script_running' || run.state === 'render_running';
  switch (event.type) {
    case 'stage': {
      const stage = stageOf(event.stage);
      if (stage && running) await patchRun(deps, run.id, { stage });
      return {
        agent: crewOf(event.agent),
        kind: 'started',
        message: feedText(event.message, secrets),
      };
    }
    case 'decision':
      return {
        agent: crewOf(event.agent),
        kind: event.kind,
        message: feedText(event.message, secrets),
      };
    case 'cost': {
      const crew = Math.max(run.costCrewMicroUsd, event.totalMicroUsd);
      const updated = await patchRun(deps, run.id, { costCrewMicroUsd: crew });
      if (updated && crew + updated.costComputeMicroUsd >= updated.costCapMicroUsd) {
        await stopRun(deps, updated, 'cost_cap');
      }
      return null;
    }
    case 'session':
      return null;
    case 'artifact': {
      const file = await deps.db.query.runFiles.findFirst({
        where: and(eq(runFiles.id, event.fileId), eq(runFiles.runId, run.id)),
      });
      if (!file) deps.log?.(`runner: film ${run.filmId} named a file it never uploaded`);
      return null;
    }
    case 'script_ready':
      return scriptReady(deps, run, event);
    case 'qc':
      return {
        agent: 'quality_check',
        kind: event.verdict === 'pass' ? 'passed' : 'sent_back',
        message:
          event.verdict === 'pass'
            ? `The ${event.format} cut passed the final check.`
            : event.verdict === 'blocked'
              ? `The final check could not look at the ${event.format} cut.`
              : `The ${event.format} cut failed the final check, with ${event.routable} ${event.routable === 1 ? 'issue' : 'issues'} to fix.`,
      };
    case 'delivered': {
      const moved = await moveRun(deps, run.id, ['render_running'], {
        state: 'delivering',
        stage: 'delivery',
        deliveredAt: deps.now().getTime(),
      });
      if (!moved) return null;
      const count = event.variants.length;
      return {
        agent: 'account_manager',
        kind: 'delivered',
        message: `Your film is ready: ${count} ${count === 1 ? 'file' : 'files'} to download.`,
      };
    }
    case 'error': {
      const code = run.state === 'stopping' ? (run.stopReason ?? event.code) : event.code;
      const text = feedText(event.message, secrets) || 'The crew stopped with an error.';
      await failRun(deps, run, code, { message: text, feed: false });
      deps.waitUntil(advance(deps, run.id));
      return { agent: crewOf(event.agent), kind: 'failed', message: text };
    }
    case 'runner.exit':
      await runnerExited(deps, run, event.exitCode);
      return null;
    default:
      return null;
  }
}

async function scriptReady(
  deps: RunnerDeps,
  run: FilmRun,
  event: Extract<RunnerEventInput, { type: 'script_ready' }>,
): Promise<Feed | null> {
  if (event.version !== run.scriptVersion + 1) {
    deps.log?.(
      `runner: film ${run.filmId} sent script v${event.version} after v${run.scriptVersion}`,
    );
    return null;
  }
  const file = await deps.db.query.runFiles.findFirst({
    where: and(
      eq(runFiles.id, event.campaignFileId),
      eq(runFiles.runId, run.id),
      eq(runFiles.kind, 'campaign'),
      eq(runFiles.scriptVersion, event.version),
    ),
  });
  const object = file ? await deps.films.get(file.r2Key) : null;
  let checked: Awaited<ReturnType<typeof validateCampaign>> | null = null;
  if (object) {
    try {
      checked = await validateCampaign(JSON.parse(await object.text()));
    } catch {
      checked = null;
    }
  }
  if (!checked?.ok || !checked.campaign) {
    await failRun(deps, run, 'invalid_campaign');
    deps.waitUntil(advance(deps, run.id));
    return null;
  }
  const campaignJson = JSON.stringify(checked.campaign);
  if (run.mode === 'sample') {
    await patchRun(deps, run.id, { campaignJson, scriptVersion: event.version });
    return {
      agent: 'director',
      kind: 'passed',
      message: `Version ${event.version} of the script passed its checks. A sample film goes straight on to animation.`,
    };
  }
  const ready = await moveRun(deps, run.id, ['script_running'], {
    state: 'script_ready',
    stage: 'approval',
    campaignJson,
    scriptVersion: event.version,
    awaitingSince: deps.now().getTime(),
  });
  if (!ready) return null;
  const open = event.unconfirmedClaims;
  return {
    agent: 'coordinator',
    kind: 'needs_you',
    message:
      `Version ${event.version} of the script is ready for you.` +
      (open > 0
        ? ` ${open} ${open === 1 ? 'claim needs' : 'claims need'} you to confirm ${open === 1 ? 'it' : 'them'}.`
        : ''),
  };
}

async function runnerExited(deps: RunnerDeps, run: FilmRun, exitCode: number | null) {
  const exited = (await patchRun(deps, run.id, { exitedAt: deps.now().getTime() })) ?? run;
  switch (exited.state) {
    case 'script_ready':
      break;
    case 'delivering':
      await moveRun(deps, run.id, ['delivering'], { state: 'done', status: 'done' });
      break;
    case 'stopping':
      await failRun(deps, exited, exited.stopReason ?? 'stopped');
      break;
    case 'script_running':
    case 'render_running':
      deps.log?.(`runner: film ${run.filmId} exited ${exitCode} before its phase finished`);
      await failRun(deps, exited, 'runner_exit');
      break;
    default:
      break;
  }
  deps.waitUntil(advance(deps, run.id));
}

/** Every file a `delivered` names must be in R2 first. */
async function assertDelivered(
  deps: RunnerDeps,
  run: FilmRun,
  event: Extract<RunnerEventInput, { type: 'delivered' }>,
): Promise<void> {
  if (event.version !== run.scriptVersion) {
    throw new ApiError(409, 'wrong_version', `The run is on version ${run.scriptVersion}.`);
  }
  const expected = expectedVariants(run, event.variants);
  if (expected.length === 0) {
    throw new ApiError(409, 'missing_files', 'A delivery needs at least one film.');
  }
  const rows = await deps.db
    .select({ variantKey: runFiles.variantKey })
    .from(runFiles)
    .where(
      and(
        eq(runFiles.runId, run.id),
        eq(runFiles.kind, 'mp4'),
        eq(runFiles.scriptVersion, run.scriptVersion),
      ),
    );
  const have = new Set(rows.map((row) => row.variantKey));
  const missing = expected.filter((key) => !have.has(key));
  if (missing.length > 0) {
    throw new ApiError(409, 'missing_files', `Upload these films first: ${missing.join(', ')}.`);
  }
}

/** The cuts a run must deliver: exactly the approved ones, or what a sample film made. */
export function expectedVariants(run: FilmRun, named: string[]): string[] {
  if (run.mode === 'sample') {
    return named.filter((key) =>
      (SAMPLE_FORMATS as readonly string[]).includes(key.split('.')[0] ?? ''),
    );
  }
  const approval = parseApproval(run.approvalJson);
  if (!approval) return [];
  return approval.formats.map((format) => variantKey(format, approval.hookId, approval.ctaId));
}

export function parseApproval(json: string | null): ApprovalInput | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ApprovalInput;
  } catch {
    return null;
  }
}

/** What a stored event row keeps of the event, for the audit trail. */
function dataOf(event: RunnerEventInput): Record<string, unknown> {
  const { seq: _seq, at: _at, type: _type, ...rest } = event as Record<string, unknown>;
  if (event.type === 'qc') return { ...rest, issues: event.issues.slice(0, 20) };
  return rest;
}

function eventTime(at: string, fallback: number): number {
  const parsed = Date.parse(at);
  // A runner's clock is not trusted to order the feed, only to say roughly when.
  return Number.isFinite(parsed) && Math.abs(parsed - fallback) < 24 * 3600_000 ? parsed : fallback;
}

/** What a hello does: the runner is up, the phase starts and its deadline is set. */
export async function applyHello(
  deps: RunnerDeps,
  run: FilmRun,
  event: z.infer<typeof helloEvent>,
): Promise<FilmRun> {
  const now = deps.now().getTime();
  if (event.phase !== run.phase) {
    throw new ApiError(409, 'wrong_phase', `This run is in its ${run.phase} phase.`);
  }
  if (run.state !== 'launching') {
    return (await patchRun(deps, run.id, { heartbeatAt: now })) ?? run;
  }
  const config = deps.config;
  if (
    (config.runnerCommit && !config.runnerCommit.startsWith(event.commit.slice(0, 12))) ||
    (config.filmCommit && !config.filmCommit.startsWith(event.filmCommit.slice(0, 12)))
  ) {
    deps.log?.(`runner: film ${run.filmId} runs commits that differ from the configured ones`);
  }
  const stage: Stage =
    run.phase === 'render' ? 'art_direction' : run.reviseJson ? 'script' : asStage(run.stage);
  const moved = await moveRun(deps, run.id, ['launching'], {
    state: run.phase === 'script' ? 'script_running' : 'render_running',
    stage,
    status: 'working',
    heartbeatAt: now,
    phaseStartedAt: now,
    phaseDeadlineAt: now + PHASE_DEADLINE_MS[run.phase],
    runnerCommit: event.commit.slice(0, 64),
  });
  if (!moved) return (await patchRun(deps, run.id, { heartbeatAt: now })) ?? run;
  const stored = await deps.db.run(sql`
    insert or ignore into run_events (run_id, source, source_seq, feed_seq, film_id, at, type, agent,
      kind, stage, status, message, data_json, received_at)
    select ${run.id}, 'runner', ${event.seq}, coalesce(max(feed_seq), 0) + 1, ${run.filmId}, ${now},
      'runner.hello', 'coordinator', 'started', ${moved.stage}, 'working',
      ${run.phase === 'render' ? "The crew's computer is back. Animation starts now." : "The crew's computer is ready."},
      ${JSON.stringify({ commit: event.commit, filmCommit: event.filmCommit, node: event.node, freeDiskGb: event.freeDiskGb, swapMb: event.swapMb })},
      ${now}
    from run_events where run_id = ${run.id}`);
  if (stored.meta.changes !== 1) deps.log?.(`runner: film ${run.filmId} said hello twice`);
  return moved;
}
