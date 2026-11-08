import { eq } from 'drizzle-orm';
import { type Db, getDb } from '../../db/client.ts';
import { type Account, accounts } from '../../db/schema.ts';
import type { PipelineKind } from '../../lib/film.ts';
import { newId } from '../ids.ts';
import { createPipeline, type PipelineClient, pipelineKindFrom } from '../pipeline/index.ts';
import {
  type RunnerBindings,
  type RunnerConfig,
  realFilmsFor,
  runnerConfig,
} from '../runner/config.ts';
import { HttpNaiveApi, type NaiveApi } from '../runner/naive-api.ts';
import type { RunnerDeps } from '../runner/runs.ts';

/** Who is asking, from Clerk. `orgId` is the active organisation, if any. */
export interface Principal {
  userId: string;
  orgId: string | null;
}

/** The Worker bindings and vars the API uses. See wrangler.jsonc. */
export interface Bindings extends RunnerBindings {
  DB: D1Database;
  FILMS: R2Bucket;
  PIPELINE?: string;
  APP_ENV?: string;
  /** Boiler Room's own account: its film leads the showcase. Empty until the founder sets it. */
  BR_HOUSE_ACCOUNT_ID?: string;
}

/** What the request runs in, beyond the bindings. Tests pass a fake Naive and collect `waitUntil`. */
export interface Runtime {
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Overrides the Naive client built from `NAIVE_WEB_KEY`. */
  naive?: NaiveApi | null;
  log?: (line: string) => void;
}

export interface ApiContext {
  db: Db;
  principal: Principal;
  /** The account every query is scoped to. */
  account: Account;
  /** The pipeline this caller's new films use: real for the founders in `REAL_FILM_USERS`. */
  pipelineKind: PipelineKind;
  /** Real films' settings and caps. */
  runnerConfig: RunnerConfig;
  /** The pipeline that makes an existing film, by the kind recorded on the film. */
  pipelineFor(kind: PipelineKind): PipelineClient;
  films: R2Bucket;
  now(): Date;
}

export async function createContext(
  principal: Principal,
  bindings: Bindings,
  clock: () => Date = () => new Date(),
  runtime: Runtime = {},
): Promise<ApiContext> {
  const db = getDb(bindings.DB);
  const account = await resolveAccount(db, principal, clock());
  const pipelines = new Map<PipelineKind, PipelineClient>();
  const runner = runnerDeps(bindings, db, clock, runtime);
  return {
    db,
    principal,
    account,
    pipelineKind: pipelineKindFor(bindings, principal),
    runnerConfig: runner.config,
    pipelineFor(kind) {
      let client = pipelines.get(kind);
      if (!client) {
        client = createPipeline(kind, db, clock, runner);
        pipelines.set(kind, client);
      }
      return client;
    },
    films: bindings.FILMS,
    now: clock,
  };
}

/**
 * The pipeline this caller's new films use. A founder named in `REAL_FILM_USERS` gets real films
 * once everything they need is configured; everyone else gets the environment's `PIPELINE`.
 */
export function pipelineKindFor(bindings: Bindings, principal: Principal): PipelineKind {
  return realFilmsFor(runnerConfig(bindings), principal.userId)
    ? 'naive'
    : pipelineKindFrom(bindings.PIPELINE);
}

/** The runner's deps from the bindings: the Naive client is built only when the key is set. */
export function runnerDeps(
  bindings: Bindings,
  db: Db,
  clock: () => Date,
  runtime: Runtime = {},
): RunnerDeps {
  const config = runnerConfig(bindings);
  const naive =
    runtime.naive !== undefined
      ? runtime.naive
      : config.naiveKey
        ? new HttpNaiveApi({ key: config.naiveKey, baseUrl: config.naiveApiUrl })
        : null;
  return {
    db,
    films: bindings.FILMS,
    naive,
    config,
    now: clock,
    waitUntil:
      runtime.waitUntil ??
      ((promise) => {
        promise.catch((error: unknown) => console.error('Background step failed', error));
      }),
    log: runtime.log,
  };
}

/**
 * Finds or creates the account that owns this principal's films: the organisation's when one is
 * active, otherwise the user's own. Safe to race: the unique index keeps one row.
 */
export async function resolveAccount(db: Db, principal: Principal, now: Date): Promise<Account> {
  const where = principal.orgId
    ? eq(accounts.clerkOrgId, principal.orgId)
    : eq(accounts.clerkUserId, principal.userId);
  const existing = await db.query.accounts.findFirst({ where });
  if (existing) return existing;

  await db
    .insert(accounts)
    .values(
      principal.orgId
        ? { id: newId('acc'), kind: 'org', clerkOrgId: principal.orgId, createdAt: now }
        : { id: newId('acc'), kind: 'user', clerkUserId: principal.userId, createdAt: now },
    )
    .onConflictDoNothing();
  const created = await db.query.accounts.findFirst({ where });
  if (!created) throw new Error('The account could not be created.');
  return created;
}
