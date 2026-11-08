import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { type FilmRun, filmRuns } from '../../db/schema.ts';
import {
  BOOTSTRAP_PATH,
  type Bootstrap,
  deriveRunKey,
  LAUNCH_COMMAND,
  RUNNER_BASE_PATH,
  STOP_COMMAND,
} from './contract.ts';
import { isGone, type NaiveApi, NaiveApiError, type NaiveComputer } from './naive-api.ts';
import { failRun, getRun, logLine, moveRun, patchRun, type RunnerDeps } from './runs.ts';
import type { RunState } from './states.ts';

/** How long one caller holds a run while it steps it. */
export const LEASE_MS = 60_000;
/** A launch with no hello after this is tried again, at most `MAX_LAUNCHES` times in all. */
export const RELAUNCH_AFTER_MS = 3 * 60_000;
export const MAX_LAUNCHES = 3;
/** After `script_ready`, how long to wait for the runner's exit before pausing anyway. */
export const EXIT_GRACE_MS = 2 * 60_000;
/** A stopping runner gets this long to exit before the film is failed and the computer destroyed. */
export const STOP_GRACE_MS = 90_000;
/** A computer that does not come back within this long after approval fails the film. */
export const REQUEUE_LIMIT_MS = 60 * 60_000;

export interface AdvanceOptions {
  /** Wait up to this long for a new computer to be running, polling every 3 s. 0 in the cron. */
  waitMs?: number;
}

/**
 * Does the next step of a run that needs Naive: launch the runner, checkpoint and pause at the
 * approval gate, bring the computer back after approval, and clean up at the end. It takes a lease
 * first so two callers never do the same step, and every step can be repeated safely, so a step cut
 * short (a `waitUntil` that ran out) is finished by the next cron tick.
 */
export async function advance(
  deps: RunnerDeps,
  runId: string,
  options: AdvanceOptions = {},
): Promise<void> {
  const naive = deps.naive;
  if (!naive) return;
  const now = deps.now().getTime();
  const until = now + LEASE_MS;
  const [run] = await deps.db
    .update(filmRuns)
    .set({ leaseUntil: until })
    .where(
      and(eq(filmRuns.id, runId), or(isNull(filmRuns.leaseUntil), lt(filmRuns.leaseUntil, now))),
    )
    .returning();
  if (!run) return;
  try {
    await step(deps, naive, run, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logLine(deps, `advance: film ${run.filmId} (${run.state}): ${message}`);
    await patchRun(deps, runId, { lastError: message.slice(0, 300) });
  } finally {
    await deps.db
      .update(filmRuns)
      .set({ leaseUntil: null })
      .where(and(eq(filmRuns.id, runId), eq(filmRuns.leaseUntil, until)));
  }
}

async function step(
  deps: RunnerDeps,
  naive: NaiveApi,
  run: FilmRun,
  options: AdvanceOptions,
): Promise<void> {
  const now = deps.now().getTime();
  switch (run.state as RunState) {
    case 'provisioning':
      return bringUp(deps, naive, run, options);
    case 'launching':
      if (run.launchedAt !== null && now - run.launchedAt < RELAUNCH_AFTER_MS) return;
      if (run.launchAttempts >= MAX_LAUNCHES) {
        await failRun(deps, run, 'computer_start_timeout');
        return;
      }
      return launch(deps, naive, run);
    case 'script_ready':
      return pauseForApproval(deps, naive, run);
    case 'awaiting_approval':
      if (run.computerState === 'running') return pauseForApproval(deps, naive, run);
      return;
    case 'render_queued':
    case 'revise_queued':
      return bringUp(deps, naive, run, options);
    case 'stopping':
      if (run.stopRequestedAt !== null && now - run.stopRequestedAt > STOP_GRACE_MS) {
        await failRun(deps, run, run.stopReason ?? 'stopped');
      }
      return;
    case 'delivering':
      if (run.deliveredAt !== null && now - run.deliveredAt > EXIT_GRACE_MS) {
        await moveRun(deps, run.id, ['delivering'], { state: 'done', status: 'done' });
      }
      return;
    case 'done':
    case 'failed':
      return cleanUp(deps, naive, run);
    default:
      return;
  }
}

/**
 * Gets the film's computer running, then launches the runner. A new film's computer is already
 * being created. After approval, a paused computer is resumed, and one that Naive destroyed (12
 * hours after it was made) is forked again from the film's checkpoint.
 */
async function bringUp(
  deps: RunnerDeps,
  naive: NaiveApi,
  run: FilmRun,
  options: AdvanceOptions,
): Promise<void> {
  const now = deps.now().getTime();
  if (run.queuedAt !== null && now - run.queuedAt > REQUEUE_LIMIT_MS) {
    await failRun(deps, run, 'computer_unavailable');
    return;
  }
  // The runner of the last phase may still be flushing its last events. It exits by itself.
  if (
    run.computerState === 'running' &&
    run.exitedAt === null &&
    run.heartbeatAt !== null &&
    now - run.heartbeatAt < EXIT_GRACE_MS
  ) {
    return;
  }

  let computer = run.computerId ? await computerOrNull(naive, run.computerId) : null;
  if (computer?.status === 'paused') {
    try {
      computer = await naive.resume(computer.id);
    } catch (error) {
      if (!isGone(error)) {
        const code = error instanceof NaiveApiError ? error.code : 'error';
        await patchRun(deps, run.id, { lastError: `resume_refused: ${code}` });
        logLine(deps, `advance: film ${run.filmId}: resume_refused (${code})`);
        return;
      }
      computer = null;
    }
    await patchRun(deps, run.id, {
      computerState: 'running',
      runningSince: now,
      billedUntil: null,
    });
  }

  if (!computer || computer.status === 'destroyed') {
    if (run.state === 'provisioning' || !run.checkpointId) {
      await failRun(
        deps,
        run,
        run.state === 'provisioning' ? 'computer_failed' : 'computer_expired',
      );
      return;
    }
    computer = await naive.createComputer(
      {
        name: computerName(deps, run.filmId),
        vcpu: deps.config.size.vcpu,
        memory_mb: deps.config.size.memoryMb,
        disk_gb: deps.config.size.diskGb,
        snapshot_id: run.checkpointId,
      },
      `${run.id}:fork:${run.launchAttempts}`,
    );
    await patchRun(deps, run.id, {
      computerId: computer.id,
      computerState: 'creating',
      computerCreatedAt: Date.parse(computer.created_at) || now,
      runningSince: now,
      billedUntil: null,
    });
    logLine(deps, `advance: film ${run.filmId}: forked ${computer.id} from its checkpoint`);
  }

  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (options.waitMs ?? 0);
  while (computer.status === 'creating' && Date.now() < deadline) {
    await sleep(3000);
    computer = await naive.getComputer(computer.id);
  }
  if (computer.status === 'failed') {
    await failRun(deps, run, 'computer_failed');
    return;
  }
  if (computer.status !== 'running') return;

  const fresh = await getRun(deps.db, run.id);
  if (fresh) await launch(deps, naive, fresh);
}

/** Writes the bootstrap file and starts the runner. The runner's hello moves the run on. */
async function launch(deps: RunnerDeps, naive: NaiveApi, run: FilmRun): Promise<void> {
  const { config } = deps;
  if (!run.computerId || !config.signingSecret || !config.publicUrl) return;
  const now = deps.now().getTime();
  const home = await naive.home(run.computerId);
  const bootstrap: Bootstrap = {
    v: 1,
    filmId: run.filmId,
    runId: run.id,
    callbackBase: `${config.publicUrl}${RUNNER_BASE_PATH}`,
    key: await deriveRunKey(config.signingSecret, run.filmId, run.id),
    issuedAt: Math.floor(now / 1000),
  };
  await naive.writeFile(run.computerId, `${home}/${BOOTSTRAP_PATH}`, JSON.stringify(bootstrap));
  // `launching` is set before the exec, so a fast hello never finds the run still provisioning.
  const launching = await moveRun(
    deps,
    run.id,
    ['provisioning', 'launching', 'render_queued', 'revise_queued'],
    {
      state: 'launching',
      status: 'working',
      launchAttempts: run.launchAttempts + 1,
      launchedAt: now,
      exitedAt: null,
      heartbeatAt: null,
      computerState: 'running',
      runningSince: run.runningSince ?? now,
    },
  );
  if (!launching) return;
  const result = await naive.exec(run.computerId, LAUNCH_COMMAND, 30_000);
  if (result.exit_code !== 0 || result.timed_out) {
    // Left in `launching`: the next tick launches again, and `flock` keeps it to one runner.
    await patchRun(deps, run.id, { lastError: `launch exited ${result.exit_code}` });
  }
  logLine(
    deps,
    `advance: film ${run.filmId}: launched the ${run.phase} phase on ${run.computerId} (try ${launching.launchAttempts})`,
  );
}

/**
 * The approval gate. The script phase is over and the runner has exited: take a checkpoint of the
 * computer's disk, so a late approval can fork it, then pause the computer, which costs nothing.
 */
async function pauseForApproval(deps: RunnerDeps, naive: NaiveApi, run: FilmRun): Promise<void> {
  const now = deps.now().getTime();
  if (run.mode === 'sample') return;
  if (
    run.state === 'script_ready' &&
    run.exitedAt === null &&
    run.awaitingSince !== null &&
    now - run.awaitingSince < EXIT_GRACE_MS
  ) {
    return;
  }
  if (run.computerId && run.computerState === 'running') {
    let checkpointId = run.checkpointId;
    if (!checkpointId) {
      try {
        checkpointId = (await naive.snapshot(run.computerId)).snapshot_id;
        await patchRun(deps, run.id, { checkpointId });
      } catch (error) {
        // The film can still be approved within 12 hours of the computer's creation.
        const code = error instanceof NaiveApiError ? error.code : 'error';
        await patchRun(deps, run.id, { lastError: `checkpoint_failed: ${code}` });
        logLine(deps, `advance: film ${run.filmId}: checkpoint_failed (${code})`);
      }
    }
    let computerState: 'paused' | 'destroyed' = 'paused';
    try {
      await naive.pause(run.computerId);
    } catch (error) {
      if (!isGone(error)) throw error;
      computerState = 'destroyed';
    }
    await patchRun(deps, run.id, { computerState, runningSince: null, billedUntil: null });
  }
  await moveRun(deps, run.id, ['script_ready'], { state: 'awaiting_approval' });
}

/** Destroys the computer, then deletes the checkpoint, then the run has nothing left on Naive. */
async function cleanUp(deps: RunnerDeps, naive: NaiveApi, run: FilmRun): Promise<void> {
  if (run.computerId && run.computerState !== 'destroyed') {
    if (run.computerState === 'running' && run.exitedAt === null) {
      try {
        await naive.exec(run.computerId, STOP_COMMAND, 20_000);
      } catch {
        // Destroying the computer stops everything on it anyway.
      }
    }
    try {
      await naive.deleteComputer(run.computerId);
    } catch (error) {
      if (!isGone(error)) throw error;
    }
    const left = await computerOrNull(naive, run.computerId);
    if (left && left.status !== 'destroyed') return;
    await patchRun(deps, run.id, { computerState: 'destroyed', runningSince: null });
    logLine(deps, `advance: film ${run.filmId}: destroyed ${run.computerId}`);
  }
  if (run.checkpointId) {
    try {
      await naive.deleteSnapshot(run.checkpointId);
    } catch (error) {
      // 409 while a computer restored from it is still going away: the next tick tries again.
      if (!isGone(error)) throw error;
    }
    await patchRun(deps, run.id, { checkpointId: null });
  }
  await moveRun(deps, run.id, ['done', 'failed'], {
    state: 'ended',
    endedAt: deps.now().getTime(),
  });
}

async function computerOrNull(naive: NaiveApi, id: string): Promise<NaiveComputer | null> {
  try {
    return await naive.getComputer(id);
  } catch (error) {
    if (isGone(error)) return null;
    throw error;
  }
}

/** Every film computer is named for its film, so the watchdog can match a computer to a film. */
export function computerName(deps: Pick<RunnerDeps, 'config'>, filmId: string): string {
  return `${computerPrefix(deps)}${filmId}`;
}

export function computerPrefix(deps: Pick<RunnerDeps, 'config'>): string {
  return `br-film-${deps.config.appEnv}-`;
}
