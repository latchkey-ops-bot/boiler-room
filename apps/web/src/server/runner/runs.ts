import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { type FilmRun, filmRuns } from '../../db/schema.ts';
import type { CrewMember, EventKind } from '../../lib/film.ts';
import type { RunnerConfig } from './config.ts';
import type { NaiveApi } from './naive-api.ts';
import { isTerminal, type RunState, visibleStatus } from './states.ts';

/** What the runner code needs from the Worker. Tests pass a local D1 and R2 and a fake Naive. */
export interface RunnerDeps {
  db: Db;
  films: R2Bucket;
  /** Null when no Naive key is configured: nothing can be created, resumed or destroyed. */
  naive: NaiveApi | null;
  config: RunnerConfig;
  now: () => Date;
  /** Keeps work going after the response, like `ctx.waitUntil`. */
  waitUntil: (promise: Promise<unknown>) => void;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export const logLine = (deps: RunnerDeps, line: string) =>
  (deps.log ?? ((text: string) => console.log(text)))(line);

export async function getRun(db: Db, runId: string): Promise<FilmRun | null> {
  return (await db.query.filmRuns.findFirst({ where: eq(filmRuns.id, runId) })) ?? null;
}

/**
 * Moves a run on, but only from one of `from`, so two callers never make the same move. Answers the
 * updated run, or null when the run had already moved.
 */
export async function moveRun(
  deps: RunnerDeps,
  runId: string,
  from: readonly RunState[],
  set: Partial<typeof filmRuns.$inferInsert>,
): Promise<FilmRun | null> {
  const [row] = await deps.db
    .update(filmRuns)
    .set({ ...set, updatedAt: deps.now().getTime() })
    .where(and(eq(filmRuns.id, runId), inArray(filmRuns.state, [...from])))
    .returning();
  return row ?? null;
}

export async function patchRun(
  deps: RunnerDeps,
  runId: string,
  set: Partial<typeof filmRuns.$inferInsert>,
): Promise<FilmRun | null> {
  const [row] = await deps.db
    .update(filmRuns)
    .set({ ...set, updatedAt: deps.now().getTime() })
    .where(eq(filmRuns.id, runId))
    .returning();
  return row ?? null;
}

export interface FeedLine {
  agent: CrewMember;
  kind: EventKind;
  message: string;
  type?: string;
  data?: unknown;
}

/**
 * The website's own line on the decisions feed, such as the customer's approval or why a film
 * stopped. Its stage and status are the run's after the change, as `PipelineEvent` expects.
 */
export async function addWebEvent(deps: RunnerDeps, run: FilmRun, line: FeedLine): Promise<void> {
  const now = deps.now().getTime();
  const { stage, status } = visibleStatus(run);
  await deps.db.run(sql`
    insert into run_events (run_id, source, source_seq, feed_seq, film_id, at, type, agent, kind,
      stage, status, message, data_json, received_at)
    select ${run.id}, 'web',
      coalesce(max(case when source = 'web' then source_seq end), 0) + 1,
      coalesce(max(feed_seq), 0) + 1,
      ${run.filmId}, ${now}, ${line.type ?? 'web'}, ${line.agent}, ${line.kind}, ${stage}, ${status},
      ${line.message}, ${line.data === undefined ? null : JSON.stringify(line.data)}, ${now}
    from run_events where run_id = ${run.id}`);
}

/** What the founder reads when a film stops for each reason the website knows. */
export const FAILURE_MESSAGES: Record<string, string> = {
  computer_failed:
    "The crew's computer did not start, so this film stopped. Start a new video to try again.",
  computer_start_timeout:
    "The crew's computer did not start in time, so this film stopped. Start a new video to try again.",
  computer_expired:
    "The crew's computer expired while the script waited for you. Start a new video to try again.",
  computer_unavailable:
    "The crew's computer could not be brought back after you approved. Start a new video to try again.",
  runner_silent: "The crew's computer stopped answering, so this film stopped.",
  runner_exit: 'The crew stopped before the film was finished.',
  phase_timeout: 'This film went past its time limit, so it stopped.',
  cost_cap: 'This film reached its spending limit, so it stopped.',
  tripwire: 'Real films are paused while we check our spending, so this film stopped.',
  approval_expired: 'The script waited 3 days for you, so this film was closed.',
  invalid_campaign: "The Director's script did not pass its checks, so this film stopped.",
  stopped: 'This film was stopped.',
};

const LIVE: RunState[] = [
  'provisioning',
  'launching',
  'script_running',
  'script_ready',
  'awaiting_approval',
  'render_queued',
  'revise_queued',
  'render_running',
  'delivering',
  'stopping',
];

/**
 * Fails the film. The computer and checkpoint are cleaned up by `advance()`. `feed: false` when the
 * runner's own error line already says why.
 */
export async function failRun(
  deps: RunnerDeps,
  run: FilmRun,
  code: string,
  options: { message?: string; feed?: boolean } = {},
): Promise<FilmRun | null> {
  if (isTerminal(run.state)) return null;
  const failed = await moveRun(deps, run.id, LIVE, {
    state: 'failed',
    status: 'failed',
    failedStage: visibleStatus(run).stage,
    failureCode: code.slice(0, 64),
    failureMessage: (options.message ?? FAILURE_MESSAGES[code] ?? code).slice(0, 500),
  });
  if (!failed) return null;
  logLine(deps, `runner: film ${run.filmId} failed (${code})`);
  if (options.feed !== false) {
    await addWebEvent(deps, failed, {
      agent: 'coordinator',
      kind: 'failed',
      type: 'web.failed',
      message: FAILURE_MESSAGES[code] ?? 'This film stopped.',
    });
  }
  return failed;
}

/** States where a runner is at work and can be asked to stop. */
const STOPPABLE: RunState[] = ['launching', 'script_running', 'render_running', 'delivering'];

/**
 * Stops a film for `reason`. A runner at work is told through `control.stop` and given 90 seconds
 * to exit; a film with no runner at work fails at once.
 */
export async function stopRun(
  deps: RunnerDeps,
  run: FilmRun,
  reason: string,
): Promise<FilmRun | null> {
  if (run.state === 'stopping' || isTerminal(run.state)) return null;
  if ((STOPPABLE as string[]).includes(run.state)) {
    const stopping = await moveRun(deps, run.id, STOPPABLE, {
      state: 'stopping',
      stopRequestedAt: deps.now().getTime(),
      stopReason: reason,
    });
    if (stopping) logLine(deps, `runner: stopping film ${run.filmId} (${reason})`);
    return stopping;
  }
  return failRun(deps, run, reason);
}
