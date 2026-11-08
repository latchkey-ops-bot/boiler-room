import { eq } from 'drizzle-orm';
import { type Db, getDb } from '../../db/client.ts';
import { type Account, accounts } from '../../db/schema.ts';
import type { PipelineKind } from '../../lib/film.ts';
import { newId } from '../ids.ts';
import { createPipeline, type PipelineClient, pipelineKindFrom } from '../pipeline/index.ts';

/** Who is asking, from Clerk. `orgId` is the active organisation, if any. */
export interface Principal {
  userId: string;
  orgId: string | null;
}

/** The Worker bindings and vars the API uses. See wrangler.jsonc. */
export interface Bindings {
  DB: D1Database;
  FILMS: R2Bucket;
  PIPELINE?: string;
  APP_ENV?: string;
  /** Boiler Room's own account: its film leads the showcase. Empty until the founder sets it. */
  BR_HOUSE_ACCOUNT_ID?: string;
}

export interface ApiContext {
  db: Db;
  principal: Principal;
  /** The account every query is scoped to. */
  account: Account;
  /** The pipeline new films use here. */
  pipelineKind: PipelineKind;
  /** The pipeline that makes an existing film, by the kind recorded on the film. */
  pipelineFor(kind: PipelineKind): PipelineClient;
  films: R2Bucket;
  now(): Date;
}

export async function createContext(
  principal: Principal,
  bindings: Bindings,
  clock: () => Date = () => new Date(),
): Promise<ApiContext> {
  const db = getDb(bindings.DB);
  const account = await resolveAccount(db, principal, clock());
  const pipelines = new Map<PipelineKind, PipelineClient>();
  return {
    db,
    principal,
    account,
    pipelineKind: pipelineKindFrom(bindings.PIPELINE),
    pipelineFor(kind) {
      let client = pipelines.get(kind);
      if (!client) {
        client = createPipeline(kind, db, clock);
        pipelines.set(kind, client);
      }
      return client;
    },
    films: bindings.FILMS,
    now: clock,
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
