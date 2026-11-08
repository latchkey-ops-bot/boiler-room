import { emailDomain } from './domain.ts';
import type { SenderEvent } from './ports.ts';
import { type StoreData, setFlag } from './store.ts';
import { suppress } from './suppression.ts';
import { daysSince } from './time.ts';

/**
 * The cold sender's bounces and complaints. A permanent bounce suppresses the address and its
 * domain at once. The lane pauses on its own only at 2 permanent bounces in the trailing 7 days, or
 * on any complaint, so brand-new startups' dead addresses do not need a person every day. Opt-outs
 * and `not_interested` replies stand in as the complaint signal at 5 emails a day. A new signal
 * pauses the lane again even if it is already paused, with a new `at`.
 */
export function applySenderEvents(
  store: StoreData,
  events: readonly SenderEvent[],
  now: Date,
): { suppressed: number; paused: string | null } {
  let suppressed = 0;
  for (const event of events) {
    if (event.kind === 'bounce_transient') continue;
    const reason = event.kind === 'complaint' ? 'complaint' : 'bounce';
    const before = store.suppression.length;
    suppress(store, {
      kind: 'email',
      raw: event.to,
      reason,
      source: 'sender_events',
      at: event.at,
    });
    const domain = emailDomain(event.to);
    if (domain)
      suppress(store, {
        kind: 'domain',
        raw: domain,
        reason,
        source: 'sender_events',
        at: event.at,
      });
    suppressed += store.suppression.length - before;
  }
  const recentBounces = store.suppression.filter(
    (row) => row.kind === 'email' && row.reason === 'bounce' && daysSince(row.created_at, now) < 7,
  ).length;
  const complaint = events.some((event) => event.kind === 'complaint');
  const newBounce = events.some((event) => event.kind === 'bounce_permanent');
  // Only a signal in this batch pauses, and every one does, even while a pause stands: its `at`
  // moves to now, so a RESUME written before it no longer lifts it.
  const paused = complaint
    ? 'a complaint'
    : newBounce && recentBounces >= 2
      ? `${recentBounces} permanent bounces in 7 days`
      : null;
  if (paused) {
    setFlag(
      store,
      'email_paused',
      { at: now.toISOString(), reason: paused },
      'sender_events',
      now.toISOString(),
    );
  }
  return { suppressed, paused };
}
