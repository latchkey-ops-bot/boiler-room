import { type SQL, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { ApiError } from '../api/errors.ts';
import type { RunnerConfig } from './config.ts';

const DAY_MS = 24 * 3600_000;
/** A film row reserved for a real film whose run has not been inserted yet. It counts as live. */
const RESERVED_MS = 5 * 60_000;

export interface CapScope {
  accountId: string;
  userId: string;
  now: number;
}

/**
 * Real films at work for this founder, in any of their accounts, by the run's own state, which the
 * callbacks keep current whether or not a page is open. A film waiting for the founder's approval
 * is paused and does not count.
 */
const workingForAccount = ({ accountId, userId, now }: CapScope) => sql`(
  (select count(*) from film_runs r join films f on f.id = r.film_id
    where r.state not in ('script_ready', 'awaiting_approval', 'done', 'failed', 'ended')
      and (f.account_id = ${accountId} or f.created_by = ${userId}))
  + (select count(*) from films f where f.pipeline = 'naive' and f.pipeline_run_id is null
      and f.created_at > ${now - RESERVED_MS}
      and (f.account_id = ${accountId} or f.created_by = ${userId})))`;

/**
 * Real films holding the org's one Researcher, across the environment. A run waiting for approval
 * is paused and holds nothing.
 */
const holdingResearcher = ({ now }: CapScope) => sql`((select count(*) from film_runs r
  where r.state in ('provisioning', 'script_running', 'revise_queued')
     or (r.state = 'launching' and r.phase in ('script', 'all'))
     or (r.state = 'render_running' and r.phase = 'all'))
  + (select count(*) from films f where f.pipeline = 'naive' and f.pipeline_run_id is null
       and f.created_at > ${now - RESERVED_MS}))`;

/** A script waiting for the customer: its computer is paused and it spends nothing more. */
const WAITING = sql`('script_ready', 'awaiting_approval')`;

/**
 * What real films have cost in the last 24 hours, in micro-USD. A run at work counts at its full
 * cap, however long ago it started, so the daily caps hold even if every film at work spends all
 * it may. A script waiting for the customer counts at what it has spent: it can wait 3 days, and
 * would otherwise hold a whole film's cap all that time. Its approval reserves the rest
 * (`approvalCaps`).
 */
const daySpend = (config: RunnerConfig, { now }: CapScope, scope: SQL | null) => sql`(
  (select coalesce(sum(max(r.cost_crew_micro_usd + r.cost_compute_micro_usd,
      case when r.state in ('done', 'failed', 'ended') or r.state in ${WAITING} then 0
        else r.cost_cap_micro_usd end)), 0)
    from film_runs r join films f on f.id = r.film_id
    where (r.created_at > ${now - DAY_MS} or r.state not in ('done', 'failed', 'ended'))
      ${scope ? sql`and ${scope}` : sql``})
  + (select count(*) * ${config.filmCapMicroUsd} from films f
    where f.pipeline = 'naive' and f.pipeline_run_id is null and f.created_at > ${now - RESERVED_MS}
      ${scope ? sql`and ${scope}` : sql``}))`;

const accountScope = ({ accountId, userId }: CapScope) =>
  sql`(f.account_id = ${accountId} or f.created_by = ${userId})`;

const notHalted = sql`coalesce((select halted from runner_control where id = 'global'), 0) = 0`;

/**
 * The conditions a new real film must meet, for the reserving `insert … select … where` in
 * `createFilm`. All in one statement, so parallel requests cannot all pass.
 */
export function realFilmCaps(config: RunnerConfig, scope: CapScope): SQL {
  return sql`${workingForAccount(scope)} < ${config.maxRealPerAccount}
    and ${holdingResearcher(scope)} < ${config.maxRealGlobal}
    and ${daySpend(config, scope, accountScope(scope))} + ${config.filmCapMicroUsd} <= ${config.accountDailyCapMicroUsd}
    and ${daySpend(config, scope, null)} + ${config.filmCapMicroUsd} <= ${config.globalDailyCapMicroUsd}
    and ${notHalted}`;
}

/** After a refused reservation: which cap said no, as the error the founder sees. */
export async function capRefusal(
  db: Db,
  config: RunnerConfig,
  scope: CapScope,
): Promise<ApiError | null> {
  const [row] = await db.all<{
    working: number;
    holding: number;
    account: number;
    global: number;
    halted: number;
  }>(sql`select ${workingForAccount(scope)} as working, ${holdingResearcher(scope)} as holding,
      ${daySpend(config, scope, accountScope(scope))} as account, ${daySpend(config, scope, null)} as global,
      coalesce((select halted from runner_control where id = 'global'), 0) as halted`);
  if (!row) return null;
  if (row.halted) {
    return new ApiError(
      503,
      'crew_paused',
      'Real films are paused while we check our spending. Try again later.',
    );
  }
  if (row.working >= config.maxRealPerAccount) {
    return new ApiError(
      429,
      'too_many_films',
      'The crew is already making a film for you. Start another once it reaches your script or is delivered.',
    );
  }
  if (row.holding >= config.maxRealGlobal) {
    return new ApiError(
      429,
      'crew_busy',
      'The crew is busy with another film. Try again in about 20 minutes.',
    );
  }
  if (
    row.account + config.filmCapMicroUsd > config.accountDailyCapMicroUsd ||
    row.global + config.filmCapMicroUsd > config.globalDailyCapMicroUsd
  ) {
    return new ApiError(
      429,
      'daily_cap',
      'You have made as many real films as you can today. Try again tomorrow.',
    );
  }
  return null;
}

/** What is left of a waiting run's cap: what its approval reserves against the daily caps. */
const restOfCap = (runId: string) => sql`(select max(0, r.cost_cap_micro_usd
  - r.cost_crew_micro_usd - r.cost_compute_micro_usd) from film_runs r where r.id = ${runId})`;

/**
 * The conditions an approval must meet, for the conditional update in `approveScript`: the
 * founder has no other film at work (a waiting script does not count, so another could start
 * meanwhile), and the rest of this film's cap still fits both daily caps. One statement, so two
 * approvals at once cannot both pass.
 */
export function approvalCaps(config: RunnerConfig, scope: CapScope, runId: string): SQL {
  return sql`${workingForAccount(scope)} < ${config.maxRealPerAccount}
    and ${daySpend(config, scope, accountScope(scope))} + ${restOfCap(runId)} <= ${config.accountDailyCapMicroUsd}
    and ${daySpend(config, scope, null)} + ${restOfCap(runId)} <= ${config.globalDailyCapMicroUsd}
    and ${notHalted}`;
}

/** After a refused approval: which cap said no, as the error the founder sees. */
export async function approvalRefusal(
  db: Db,
  config: RunnerConfig,
  scope: CapScope,
  runId: string,
): Promise<ApiError | null> {
  const [row] = await db.all<{
    working: number;
    account: number;
    global: number;
    rest: number;
    halted: number;
  }>(sql`select ${workingForAccount(scope)} as working,
      ${daySpend(config, scope, accountScope(scope))} as account, ${daySpend(config, scope, null)} as global,
      ${restOfCap(runId)} as rest,
      coalesce((select halted from runner_control where id = 'global'), 0) as halted`);
  if (!row) return null;
  if (row.halted) {
    return new ApiError(
      503,
      'crew_paused',
      'Real films are paused while we check our spending. Your script will wait: approve it later.',
    );
  }
  if (row.working >= config.maxRealPerAccount) {
    return new ApiError(
      429,
      'too_many_films',
      'The crew is already making another film for you. Your script will wait: approve it once that one reaches its script or is delivered.',
    );
  }
  if (
    row.account + row.rest > config.accountDailyCapMicroUsd ||
    row.global + row.rest > config.globalDailyCapMicroUsd
  ) {
    return new ApiError(
      429,
      'daily_cap',
      'You have made as many real films as you can today. Your script will wait: approve it tomorrow.',
    );
  }
  return null;
}
