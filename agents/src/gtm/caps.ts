import { CAPS, type CapName, type GtmAgentName, SESSION_BUDGETS } from './config.ts';
import type { SpendCategory, StoreData } from './store.ts';
import { monthOf, pacific } from './time.ts';

/** A cap as the flags set it, never past its hard maximum and never below zero. */
export function cap(store: StoreData, name: CapName): number {
  const { default: fallback, max } = CAPS[name];
  const wanted = store.flags.caps[name];
  const value = typeof wanted === 'number' && Number.isFinite(wanted) ? wanted : fallback;
  return Math.max(0, Math.min(value, max));
}

/** Spend recorded for a day, measured and reserved, optionally for one category. */
export function spentOn(store: StoreData, date: string, category?: SpendCategory): number {
  return store.spend
    .filter((row) => row.date === date && (!category || row.category === category))
    .reduce((sum, row) => sum + row.micro_usd, 0);
}

export function spentInMonth(store: StoreData, date: string): number {
  const month = monthOf(date);
  return store.spend
    .filter((row) => monthOf(row.date) === month)
    .reduce((sum, row) => sum + row.micro_usd, 0);
}

export interface SpendCheck {
  ok: boolean;
  reason: string | null;
}

/**
 * Before a priced action: `spent_today + worst_case <= cap`, for the day and the month. A film
 * order also keeps the reply reserve free, so replies and removals never starve behind films.
 */
export function canSpend(
  store: StoreData,
  date: string,
  worstCase: number,
  { keepReplyReserve = false }: { keepReplyReserve?: boolean } = {},
): SpendCheck {
  const reserve = keepReplyReserve ? cap(store, 'reply_reserve_micro') : 0;
  const day = spentOn(store, date) + worstCase + reserve;
  if (day > cap(store, 'spend_day_micro')) {
    return { ok: false, reason: 'day_cap' };
  }
  if (spentInMonth(store, date) + worstCase > cap(store, 'spend_month_micro')) {
    return { ok: false, reason: 'month_cap' };
  }
  return { ok: true, reason: null };
}

/** Data runs have their own count and spend caps, inside the day cap. `date` is a Pacific date. */
export function canRunData(store: StoreData, date: string, price: number): SpendCheck {
  const runs = store.actions.filter(
    (row) =>
      row.kind === 'data-run' &&
      row.status !== 'skipped' &&
      pacific(new Date(row.created_at)).date === date,
  ).length;
  if (runs + 1 > cap(store, 'data_runs_day')) return { ok: false, reason: 'data_runs_cap' };
  if (spentOn(store, date, 'data') + price > cap(store, 'data_spend_day_micro')) {
    return { ok: false, reason: 'data_spend_cap' };
  }
  return canSpend(store, date, price);
}

export function recordSpend(
  store: StoreData,
  row: {
    date: string;
    category: SpendCategory;
    micro_usd: number;
    ref: string;
    reserved?: boolean;
  },
): void {
  store.spend.push({ reserved: false, ...row });
}

/** Replaces a reservation with the measured figure, such as a film's reported cost. */
export function settleSpend(store: StoreData, ref: string, micro_usd: number): void {
  const row = store.spend.find((item) => item.ref === ref && item.reserved);
  if (!row) return;
  row.micro_usd = micro_usd;
  row.reserved = false;
}

export interface BudgetDecision {
  budget: number;
  /** Set when the quote is above the hard maximum: the lane stays in dry run. */
  refused: boolean;
}

/**
 * A session budget. Code may raise it to a pre-flight quote, but only up to the hard maximum; a
 * quote above that is refused and opens `FOUNDER: gtm budget-floor`.
 */
export function sessionBudget(agent: GtmAgentName, quote: number | null = null): BudgetDecision {
  const { default: fallback, max } = SESSION_BUDGETS[agent];
  if (quote === null || quote <= fallback) return { budget: fallback, refused: false };
  if (quote <= max) return { budget: quote, refused: false };
  return { budget: fallback, refused: true };
}
