import { eq, lt, ne, sql } from 'drizzle-orm';
import { type FilmRun, filmRuns, runnerControl, runnerNonces } from '../../db/schema.ts';
import { advance, computerPrefix, MAX_LAUNCHES, RELAUNCH_AFTER_MS } from './advance.ts';
import { BLOCK_MS, blockMicroUsd } from './config.ts';
import { isGone } from './naive-api.ts';
import { failRun, logLine, patchRun, type RunnerDeps, stopRun } from './runs.ts';
import type { RunState } from './states.ts';

export const SILENT_AFTER_MS = 5 * 60_000;
export const NEVER_STARTED_AFTER_MS = 10 * 60_000;
/**
 * A launch is tried again `RELAUNCH_AFTER_MS` after the last try, on the next tick, and the run
 * fails after `MAX_LAUNCHES` tries. A run still `launching` this long after its last try is
 * stuck, since no new try could even begin, and fails too.
 */
export const LAUNCH_STUCK_AFTER_MS = RELAUNCH_AFTER_MS + 3 * 60_000;
/** The longest a healthy start can stay `launching`: every try, and the stuck margin. */
export const LAUNCHING_MAX_MS = RELAUNCH_AFTER_MS * (MAX_LAUNCHES - 1) + LAUNCH_STUCK_AFTER_MS;
export const NEAR_EXPIRY_MS = 11 * 3600_000;
export const ORPHAN_MAX_AGE_MS = 11.5 * 3600_000;
export const ORPHAN_MIN_AGE_MS = 10 * 60_000;
export const APPROVAL_EXPIRES_MS = 72 * 3600_000;
export const NONCE_TTL_MS = 15 * 60_000;
export const BASELINE_MS = 24 * 3600_000;

export interface TickReport {
  runs: number;
  actions: string[];
}

/**
 * One cron tick, every minute on staging. Each rule can run again safely. No computer outlives
 * its film: a silent runner, a missed deadline, a spent cap, an expired approval or a stray
 * computer all end with the computer destroyed.
 */
export async function watchdogTick(deps: RunnerDeps): Promise<TickReport> {
  const actions: string[] = [];
  const note = (line: string) => {
    actions.push(line);
    logLine(deps, `watchdog: ${line}`);
  };
  const now = deps.now().getTime();

  await deps.db.delete(runnerNonces).where(lt(runnerNonces.seenAt, now - NONCE_TTL_MS));
  if (deps.naive) await tripwire(deps, note);

  const live = await deps.db.select().from(filmRuns).where(ne(filmRuns.state, 'ended'));
  const block = blockMicroUsd(deps.config.size);
  for (const start of live) {
    let run: FilmRun = start;
    try {
      run = (await chargeCompute(deps, run, block, now)) ?? run;
      const state = run.state as RunState;
      const spent = run.costCrewMicroUsd + run.costComputeMicroUsd;
      if (spent >= run.costCapMicroUsd && !['stopping', 'done', 'failed'].includes(state)) {
        if (await stopRun(deps, run, 'cost_cap')) note(`stopping film ${run.filmId} (cost_cap)`);
      } else if (state === 'provisioning' && now - run.createdAt > NEVER_STARTED_AFTER_MS) {
        if (await failRun(deps, run, 'computer_start_timeout')) {
          note(`failed film ${run.filmId} (computer_start_timeout)`);
        }
      } else if (
        state === 'launching' &&
        now - (run.launchedAt ?? run.updatedAt) > LAUNCH_STUCK_AFTER_MS
      ) {
        if (await failRun(deps, run, 'computer_start_timeout')) {
          note(`failed film ${run.filmId} (computer_start_timeout, stuck launching)`);
        }
      } else if (
        (state === 'script_running' || state === 'render_running' || state === 'delivering') &&
        (run.heartbeatAt ?? 0) < now - SILENT_AFTER_MS
      ) {
        if (await failRun(deps, run, 'runner_silent'))
          note(`failed film ${run.filmId} (runner_silent)`);
      } else if (
        (state === 'script_running' || state === 'render_running') &&
        run.phaseDeadlineAt !== null &&
        now > run.phaseDeadlineAt
      ) {
        if (await stopRun(deps, run, 'phase_timeout'))
          note(`stopping film ${run.filmId} (phase_timeout)`);
      } else if (
        (state === 'awaiting_approval' || state === 'script_ready') &&
        run.awaitingSince !== null &&
        now - run.awaitingSince > APPROVAL_EXPIRES_MS
      ) {
        if (await failRun(deps, run, 'approval_expired'))
          note(`failed film ${run.filmId} (approval_expired)`);
      } else if (
        state === 'awaiting_approval' &&
        run.computerState === 'paused' &&
        run.checkpointId &&
        run.computerId &&
        run.computerCreatedAt !== null &&
        now - run.computerCreatedAt > NEAR_EXPIRY_MS &&
        deps.naive
      ) {
        // Naive destroys every computer 12 hours after it was made. Destroy it first, on purpose;
        // the checkpoint brings the film back if the customer approves later.
        try {
          await deps.naive.deleteComputer(run.computerId);
        } catch (error) {
          if (!isGone(error)) throw error;
        }
        await patchRun(deps, run.id, { computerState: 'destroyed', runningSince: null });
        note(
          `destroyed ${run.computerId} before its 12 hours, film ${run.filmId} keeps its checkpoint`,
        );
      }
    } catch (error) {
      note(`film ${run.filmId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Everything that needs Naive goes through advance(), which skips a run another caller holds.
  const needsStep = await deps.db
    .select({ id: filmRuns.id, state: filmRuns.state })
    .from(filmRuns)
    .where(
      sql`${filmRuns.state} in ('provisioning', 'launching', 'script_ready', 'awaiting_approval',
        'render_queued', 'revise_queued', 'stopping', 'delivering', 'done', 'failed')`,
    );
  for (const { id } of needsStep) await advance(deps, id);

  await sweepOrphans(deps, note);
  return { runs: live.length, actions };
}

/**
 * Compute is billed ahead, one 10-minute clock block at a time, from the moment a computer is
 * created or resumed. Counts each block the computer has entered since the last tick.
 */
async function chargeCompute(
  deps: RunnerDeps,
  run: FilmRun,
  block: number,
  now: number,
): Promise<FilmRun | null> {
  if (run.runningSince === null || !['creating', 'running'].includes(run.computerState))
    return null;
  let until = run.billedUntil ?? Math.floor(run.runningSince / BLOCK_MS) * BLOCK_MS;
  let added = 0;
  while (until <= now) {
    added += block;
    until += BLOCK_MS;
  }
  if (added === 0) return null;
  return patchRun(deps, run.id, {
    costComputeMicroUsd: run.costComputeMicroUsd + added,
    billedUntil: until,
  });
}

/**
 * If the Naive balance has fallen by more than the daily cap since the day's baseline, from any
 * source, stop every real film and refuse new ones until a person clears `runner_control`.
 */
async function tripwire(deps: RunnerDeps, note: (line: string) => void): Promise<void> {
  const naive = deps.naive;
  if (!naive) return;
  const now = deps.now().getTime();
  let balance: number;
  try {
    balance = await naive.balanceMicroUsd();
  } catch (error) {
    logLine(
      deps,
      `watchdog: could not read the balance (${error instanceof Error ? error.message : error})`,
    );
    return;
  }
  await deps.db
    .insert(runnerControl)
    .values({ id: 'global', halted: false, updatedAt: now })
    .onConflictDoNothing();
  const control = await deps.db.query.runnerControl.findFirst({
    where: eq(runnerControl.id, 'global'),
  });
  if (!control) return;
  if (
    control.balanceBaselineMicroUsd === null ||
    control.baselineAt === null ||
    now - control.baselineAt > BASELINE_MS ||
    balance > control.balanceBaselineMicroUsd
  ) {
    await deps.db
      .update(runnerControl)
      .set({ balanceBaselineMicroUsd: balance, baselineAt: now, updatedAt: now })
      .where(eq(runnerControl.id, 'global'));
    return;
  }
  const fallen = control.balanceBaselineMicroUsd - balance;
  if (control.halted || fallen <= deps.config.globalDailyCapMicroUsd) return;
  await deps.db
    .update(runnerControl)
    .set({
      halted: true,
      haltedReason: `The balance fell by ${(fallen / 1_000_000).toFixed(2)} USD in a day.`,
      updatedAt: now,
    })
    .where(eq(runnerControl.id, 'global'));
  note(`tripwire: the balance fell by ${(fallen / 1_000_000).toFixed(2)} USD, real films halted`);
  const live = await deps.db.select().from(filmRuns).where(ne(filmRuns.state, 'ended'));
  for (const run of live) await stopRun(deps, run, 'tripwire');
}

/**
 * A film computer no live run owns, or one near Naive's 12-hour limit, is destroyed. Computers
 * are matched by name, so one leaked by a create that answered after its film was dropped is
 * found too.
 */
async function sweepOrphans(deps: RunnerDeps, note: (line: string) => void): Promise<void> {
  const naive = deps.naive;
  if (!naive) return;
  const now = deps.now().getTime();
  const prefix = computerPrefix(deps);
  const live = await deps.db
    .select({
      id: filmRuns.id,
      computerId: filmRuns.computerId,
      computerState: filmRuns.computerState,
    })
    .from(filmRuns)
    .where(ne(filmRuns.state, 'ended'));
  const owned = new Set(live.map((row) => row.computerId));
  const listedIds = new Set<string>();
  let complete = false;
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const listed = await naive.listComputers({ limit: 100, ...(after ? { after } : {}) });
    for (const computer of listed.data) {
      if (computer.status !== 'destroyed' && computer.status !== 'failed') {
        listedIds.add(computer.id);
      }
    }
    for (const computer of listed.data) {
      if (!computer.name.startsWith(prefix) || computer.status === 'destroyed') continue;
      const age = now - Date.parse(computer.created_at);
      if (!(age > ORPHAN_MIN_AGE_MS)) continue;
      if (owned.has(computer.id) && age < ORPHAN_MAX_AGE_MS) continue;
      try {
        await naive.deleteComputer(computer.id);
        note(`destroyed ${computer.id} (${computer.name}), which no live film owns`);
      } catch (error) {
        if (!isGone(error))
          note(
            `could not destroy ${computer.id}: ${error instanceof Error ? error.message : error}`,
          );
      }
    }
    if (!listed.has_more || !listed.next_cursor) {
      complete = true;
      break;
    }
    after = listed.next_cursor;
  }
  // A computer D1 thinks is up but Naive no longer lists is gone: Naive's 12-hour limit, a host
  // failure, a destroy that answered late. Stop counting compute for it, and let the film's next
  // step find out (a run waiting for its computer then fails, or forks its checkpoint).
  if (!complete) return;
  for (const row of live) {
    if (!row.computerId || !['creating', 'running', 'paused'].includes(row.computerState)) continue;
    if (listedIds.has(row.computerId)) continue;
    const computer = await naive.getComputer(row.computerId).catch((error: unknown) => {
      if (isGone(error)) return null;
      throw error;
    });
    if (computer && computer.status !== 'destroyed' && computer.status !== 'failed') continue;
    await patchRun(deps, row.id, { computerState: 'destroyed', runningSince: null });
    note(`${row.computerId} is gone from Naive; its film no longer counts compute for it`);
    const run = await deps.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, row.id) });
    if (run && ['launching', 'script_running', 'render_running'].includes(run.state)) {
      if (await failRun(deps, run, 'computer_failed'))
        note(`failed film ${run.filmId} (computer_failed)`);
    }
  }
}
