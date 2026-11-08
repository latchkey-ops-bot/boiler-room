import { DEDUPE } from './config.ts';
import { emailDomain, normalise, registrableDomain, sha256 } from './domain.ts';
import type {
  Channel,
  StoreData,
  SuppressionKind,
  SuppressionReason,
  SuppressionRow,
} from './store.ts';
import { daysSince } from './time.ts';

/**
 * Suppression and dedupe. Suppression is kept forever and never sold or shared. It is checked
 * against the address, the domain and the handle, at pick, at compose and again at execute.
 */

/** The stored value of a suppression row: a domain in clear, anything else hashed. */
export function suppressionValue(kind: SuppressionKind, raw: string): string | null {
  if (kind === 'domain') return registrableDomain(raw);
  const value = normalise(raw).replace(/^@/, '');
  return value ? sha256(value) : null;
}

/** Adds a suppression row unless the same kind and value is already suppressed. */
export function suppress(
  store: StoreData,
  input: {
    kind: SuppressionKind;
    raw: string;
    reason: SuppressionReason;
    source: string;
    at: string;
  },
): SuppressionRow | null {
  const value = suppressionValue(input.kind, input.raw);
  if (!value) return null;
  const existing = store.suppression.find((row) => row.kind === input.kind && row.value === value);
  if (existing) return existing;
  const row: SuppressionRow = {
    kind: input.kind,
    value,
    reason: input.reason,
    source: input.source,
    created_at: input.at,
  };
  store.suppression.push(row);
  return row;
}

export interface SuppressionQuery {
  email?: string | null;
  domain?: string | null;
  handle?: string | null;
}

/** The first suppression row that matches the address, its domain, the domain or the handle. */
export function suppressedBy(store: StoreData, query: SuppressionQuery): SuppressionRow | null {
  const wanted: { kind: SuppressionKind; value: string | null }[] = [];
  if (query.email) {
    wanted.push({ kind: 'email', value: suppressionValue('email', query.email) });
    wanted.push({ kind: 'domain', value: emailDomain(query.email) });
  }
  if (query.domain) wanted.push({ kind: 'domain', value: registrableDomain(query.domain) });
  if (query.handle)
    wanted.push({ kind: 'x_handle', value: suppressionValue('x_handle', query.handle) });
  for (const { kind, value } of wanted) {
    if (!value) continue;
    const row = store.suppression.find((item) => item.kind === kind && item.value === value);
    if (row) return row;
  }
  return null;
}

export const isSuppressed = (store: StoreData, query: SuppressionQuery) =>
  suppressedBy(store, query) !== null;

const WINDOW_DAYS: Record<Channel, number> = {
  email: DEDUPE.email_days,
  x_post: DEDUPE.x_post_days,
  film: DEDUPE.film_days,
};

/**
 * Whether a domain was already contacted on a channel inside its window: one cold email per domain
 * in any 90 days, one film per domain in any 90 days, one X post per domain ever.
 */
export function contactedWithin(
  store: StoreData,
  domain: string,
  channel: Channel,
  now: Date,
): boolean {
  const registrable = registrableDomain(domain);
  if (!registrable) return true;
  return store.contacts.some(
    (row) =>
      row.domain === registrable &&
      row.channel === channel &&
      daysSince(row.at, now) < WINDOW_DAYS[channel],
  );
}

export function recordContact(
  store: StoreData,
  input: { domain: string; channel: Channel; at: string; lead_id: string },
): void {
  const domain = registrableDomain(input.domain);
  if (!domain) return;
  store.contacts.push({ ...input, domain });
}

/**
 * Why a domain cannot become a lead today, or null: suppressed for any reason, emailed in 90 days,
 * filmed in 90 days, or already a lead today.
 */
export function dropReason(
  store: StoreData,
  domain: string,
  date: string,
  now: Date,
): 'suppressed' | 'emailed_90d' | 'filmed' | 'lead_today' | null {
  if (isSuppressed(store, { domain })) return 'suppressed';
  if (contactedWithin(store, domain, 'email', now)) return 'emailed_90d';
  if (contactedWithin(store, domain, 'film', now)) return 'filmed';
  if (store.leads.some((lead) => lead.domain === registrableDomain(domain) && lead.date === date)) {
    return 'lead_today';
  }
  return null;
}

/** Leads never contacted lose their address after 30 days; only the domain row stays. */
export function pruneLeads(store: StoreData, now: Date): number {
  let pruned = 0;
  for (const lead of store.leads) {
    if (daysSince(lead.found_at, now) < 30) continue;
    const contacted = store.contacts.some((row) => row.lead_id === lead.id);
    if (contacted) continue;
    for (const address of lead.addresses) {
      if (address.address !== null) {
        address.address = null;
        pruned += 1;
      }
    }
  }
  return pruned;
}
