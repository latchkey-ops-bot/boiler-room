import { AT_MOST_ONCE, UNKNOWN_AFTER_TICKS } from './config.ts';
import type { ActionKind, ActionRow, StoreData } from './store.ts';

/**
 * The action ledger. Every external action is a row with a unique key, such as
 * `x-post:2026-11-08` or `email:quillbox.example:2026-11-08`. The row is written `planned` and
 * saved before the call, then `sent`, `failed` or `dry_run` after it. A call is never made for a key
 * whose row is past `planned`.
 *
 * X posts and emails go out at most once. A `planned` row of either kind is never retried: a tick
 * that finds one tries to match it to a provider id, and after two ticks without one it becomes
 * `unknown` and a person is asked. Only film orders and data runs, which the provider dedupes by
 * the same key, may retry.
 */

export type ActionOutcome =
  | { state: 'done'; row: ActionRow }
  | { state: 'dry_run'; row: ActionRow }
  | { state: 'failed'; row: ActionRow; error: string }
  /** Planned earlier and not settled: nothing was called this time. */
  | { state: 'pending'; row: ActionRow }
  /** Became `unknown` this tick: open `FOUNDER: gtm unknown-send`. */
  | { state: 'unknown'; row: ActionRow };

export const findAction = (store: StoreData, key: string) =>
  store.actions.find((row) => row.key === key);

const atMostOnce = (kind: ActionKind) => (AT_MOST_ONCE as readonly string[]).includes(kind);

export interface ActionRequest {
  key: string;
  kind: ActionKind;
  lead_id: string | null;
  detail: string;
  /** Records a dry run instead of calling. */
  dryRun: boolean;
  /** Called once, after the planned row is saved. */
  call: () => Promise<{ provider_id: string | null; cost_micro_usd?: number; detail?: string }>;
  /**
   * For a planned at-most-once row from an earlier tick: looks the action up at the provider by its
   * key. A provider id settles the row as sent; null leaves it planned for another tick.
   */
  reconcile?: () => Promise<string | null>;
}

/**
 * Runs one action through the ledger. `save` persists the store; it is called after the planned
 * row is written and before the call, so a crash between the two leaves a row to reconcile.
 */
export async function runAction(
  store: StoreData,
  request: ActionRequest,
  save: () => void | Promise<void>,
  now: () => string,
): Promise<ActionOutcome> {
  const existing = findAction(store, request.key);
  if (existing && existing.status !== 'planned') {
    if (existing.status === 'dry_run') return { state: 'dry_run', row: existing };
    if (existing.status === 'failed')
      return { state: 'failed', row: existing, error: existing.detail };
    if (existing.status === 'unknown') return { state: 'pending', row: existing };
    return { state: 'done', row: existing };
  }

  if (existing) {
    if (atMostOnce(existing.kind)) {
      const providerId = request.reconcile ? await request.reconcile().catch(() => null) : null;
      if (providerId) {
        existing.status = 'sent';
        existing.provider_id = providerId;
        existing.executed_at = now();
        await save();
        return { state: 'done', row: existing };
      }
      existing.planned_ticks += 1;
      if (existing.planned_ticks >= UNKNOWN_AFTER_TICKS) {
        existing.status = 'unknown';
        existing.detail = `${existing.detail}; no provider id after ${existing.planned_ticks} ticks, never retried`;
        await save();
        return { state: 'unknown', row: existing };
      }
      await save();
      return { state: 'pending', row: existing };
    }
    // Film orders and data runs are deduplicated by the provider on the same key, so they retry.
  }

  const row: ActionRow = existing ?? {
    key: request.key,
    kind: request.kind,
    lead_id: request.lead_id,
    status: 'planned',
    provider_id: null,
    cost_micro_usd: 0,
    detail: request.detail,
    created_at: now(),
    executed_at: null,
    planned_ticks: 0,
  };
  if (!existing) store.actions.push(row);

  if (request.dryRun) {
    row.status = 'dry_run';
    row.executed_at = now();
    await save();
    return { state: 'dry_run', row };
  }

  await save();
  try {
    const result = await request.call();
    row.status = 'sent';
    row.provider_id = result.provider_id;
    row.cost_micro_usd = result.cost_micro_usd ?? 0;
    if (result.detail) row.detail = result.detail;
    row.executed_at = now();
    await save();
    return { state: 'done', row };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (atMostOnce(row.kind)) {
      // The provider may have acted before the error reached us, so this is not a clean failure.
      row.planned_ticks = 0;
      row.detail = `${row.detail}; call errored: ${message.slice(0, 200)}`;
      await save();
      return { state: 'pending', row };
    }
    row.status = 'failed';
    row.detail = message.slice(0, 300);
    row.executed_at = now();
    await save();
    return { state: 'failed', row, error: message };
  }
}

/** Records a decision not to act, with its reason, so the report counts it. */
export function skipAction(
  store: StoreData,
  input: { key: string; kind: ActionKind; lead_id: string | null; reason: string; at: string },
): ActionRow {
  const existing = findAction(store, input.key);
  if (existing) return existing;
  const row: ActionRow = {
    key: input.key,
    kind: input.kind,
    lead_id: input.lead_id,
    status: 'skipped',
    provider_id: null,
    cost_micro_usd: 0,
    detail: input.reason,
    created_at: input.at,
    executed_at: input.at,
    planned_ticks: 0,
  };
  store.actions.push(row);
  return row;
}
