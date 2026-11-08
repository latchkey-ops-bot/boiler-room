import { spentOn } from './caps.ts';
import type { FounderNeed } from './config.ts';
import type { LaneState } from './lanes.ts';
import type { Source, StoreData } from './store.ts';

/**
 * The day's metrics, computed from the store alone with no model, so the report the CEO's digest
 * reads carries no text from outside the company.
 */

export interface DayMetrics {
  date: string;
  leads: { found: number; qualified: number; bySource: Record<Source, number> };
  picks: { x: number; email: number };
  films: { ordered: number; dryRun: number; ready: number; failed: number; late: number };
  x: { posted: number; drafts: number; skipped: number };
  /**
   * The founder's hand posts, from `FOUNDER: gtm pack <date>` cards. A post counts as POSTED only
   * once its card is done; every other is NOT POSTED.
   */
  pack: {
    today: { posts: number; status: 'none' | 'waiting' | 'posted' };
    yesterday: { date: string; posted: number; notPosted: number } | null;
  };
  email: { sent: number; drafts: number; skipped: Record<string, number> };
  replies: { in: number; answered: number; toPerson: number };
  optOuts: number;
  removals: number;
  unmatchedRemovals: number;
  bounces: number;
  complaints: number;
  spend: {
    total: number;
    agents: number;
    data: number;
    posts: number;
    email: number;
    films: number;
  };
  costPerQualified: number | null;
  week: { qualified: number; spend: number; costPerQualified: number | null };
  unknownSends: number;
}

const actionsOn = (store: StoreData, date: string, kind: string) =>
  store.actions.filter((row) => row.kind === kind && row.key.endsWith(`:${date}`));

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

export function dayMetrics(store: StoreData, date: string): DayMetrics {
  const leads = store.leads.filter((lead) => lead.date === date);
  const qualified = leads.filter((lead) => lead.verdict?.verdict === 'qualified');
  const bySource: Record<Source, number> = { hn: 0, ph: 0, x: 0 };
  for (const lead of qualified) bySource[lead.source] += 1;
  const films = store.films.filter((row) => row.date === date);
  const packToday = (store.packs ?? []).find((row) => row.date === date);
  const yesterday = addDays(date, -1);
  const packYesterday = (store.packs ?? []).find((row) => row.date === yesterday);
  const posts = actionsOn(store, date, 'x-post');
  const emails = actionsOn(store, date, 'email');
  const skipped: Record<string, number> = {};
  for (const row of emails.filter((item) => item.status === 'skipped')) {
    const reason = row.detail.split(/[;:]/)[0]?.trim() || 'other';
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  }
  const suppressedToday = store.suppression.filter((row) => row.created_at.startsWith(date));
  const spend = {
    total: spentOn(store, date),
    agents: spentOn(store, date, 'agents'),
    data: spentOn(store, date, 'data'),
    posts: spentOn(store, date, 'posts'),
    email: spentOn(store, date, 'email'),
    films: spentOn(store, date, 'films'),
  };
  let weekQualified = 0;
  let weekSpend = 0;
  for (let back = 0; back < 7; back++) {
    const day = addDays(date, -back);
    weekQualified += store.leads.filter(
      (lead) => lead.date === day && lead.verdict?.verdict === 'qualified',
    ).length;
    weekSpend += spentOn(store, day);
  }
  return {
    date,
    leads: { found: leads.length, qualified: qualified.length, bySource },
    picks: {
      x: leads.filter((lead) => lead.picked.includes('x')).length,
      email: leads.filter((lead) => lead.picked.includes('email')).length,
    },
    films: {
      ordered: films.filter((row) => row.kind === 'app').length,
      dryRun: films.filter((row) => row.kind === 'dry-run').length,
      ready: films.filter((row) => row.state === 'ready' && row.qc === 'pass').length,
      failed: films.filter((row) => row.state === 'failed' || row.qc === 'fail').length,
      late: films.filter((row) => row.state === 'late').length,
    },
    x: {
      posted: posts.filter((row) => row.status === 'sent').length,
      drafts: posts.filter((row) => row.status === 'dry_run').length,
      skipped: posts.filter((row) => row.status === 'skipped').length,
    },
    pack: {
      today: {
        posts: packToday?.entries.length ?? 0,
        status: packToday ? (packToday.status === 'posted' ? 'posted' : 'waiting') : 'none',
      },
      yesterday: packYesterday
        ? {
            date: yesterday,
            posted: packYesterday.status === 'posted' ? packYesterday.entries.length : 0,
            notPosted: packYesterday.status === 'posted' ? 0 : packYesterday.entries.length,
          }
        : null,
    },
    email: {
      sent: emails.filter((row) => row.status === 'sent').length,
      drafts: emails.filter((row) => row.status === 'dry_run').length,
      skipped,
    },
    replies: { in: 0, answered: 0, toPerson: 0 },
    optOuts: suppressedToday.filter(
      (row) => row.reason === 'opt_out' || row.reason === 'not_interested',
    ).length,
    removals: suppressedToday.filter((row) => row.reason === 'removal' && row.kind === 'domain')
      .length,
    unmatchedRemovals: store.unmatched_removals[date] ?? 0,
    bounces: suppressedToday.filter((row) => row.reason === 'bounce').length,
    complaints: suppressedToday.filter((row) => row.reason === 'complaint').length,
    spend,
    costPerQualified: qualified.length ? spend.total / qualified.length : null,
    week: {
      qualified: weekQualified,
      spend: weekSpend,
      costPerQualified: weekQualified ? weekSpend / weekQualified : null,
    },
    unknownSends: store.actions.filter((row) => row.status === 'unknown').length,
  };
}

const usd = (micro: number) => `$${(micro / 1e6).toFixed(3)}`;
const list = (record: Record<string, number>) =>
  Object.entries(record)
    .map(([key, value]) => `${key} ${value}`)
    .join(', ') || 'none';

/** The day card's note. The first three lines are what the CEO copies into its sweep report. */
export function reportText(
  metrics: DayMetrics,
  input: {
    mode: string;
    lanes: LaneState;
    holds: string[];
    needs: readonly FounderNeed[];
    review: string | null;
  },
): string {
  const { lanes } = input;
  const m = metrics;
  return [
    `GTM ${m.date} · mode ${input.mode} · x ${lanes.x} · email ${lanes.email} · films ${lanes.film} · replies ${lanes.reply}`,
    `Leads: ${m.leads.found} found, ${m.leads.qualified} qualified (hn ${m.leads.bySource.hn}, ph ${m.leads.bySource.ph}, x ${m.leads.bySource.x})`,
    `Spend: ${usd(m.spend.total)} (agents ${usd(m.spend.agents)}, data ${usd(m.spend.data)}, posts ${usd(m.spend.posts)}, email ${usd(m.spend.email)}, films ${usd(m.spend.films)})`,
    `Picks: x ${m.picks.x}, email ${m.picks.email}`,
    `Films: ${m.films.ordered} ordered, ${m.films.dryRun} dry run, ${m.films.ready} ready, ${m.films.failed} failed, ${m.films.late} late`,
    `X: ${m.x.posted} posted, ${m.x.drafts} draft, ${m.x.skipped} skipped`,
    `X by hand: today's pack ${m.pack.today.status === 'none' ? 'none' : `${m.pack.today.posts} post(s), ${m.pack.today.status === 'posted' ? 'POSTED' : 'NOT POSTED yet (the founder moves the card to done)'}`}. Yesterday's pack: ${m.pack.yesterday ? `${m.pack.yesterday.posted} POSTED, ${m.pack.yesterday.notPosted} NOT POSTED` : 'none'}`,
    `Email: ${m.email.sent} sent, ${m.email.drafts} drafts, skipped: ${list(m.email.skipped)}`,
    `Replies: ${m.replies.in} in, ${m.replies.answered} answered, ${m.replies.toPerson} to a person. Opt-outs ${m.optOuts}. Removals ${m.removals} (${m.unmatchedRemovals} for domains we never touched). Bounces ${m.bounces}. Complaints ${m.complaints}.`,
    `Cost per qualified lead: ${m.costPerQualified === null ? 'n/a' : usd(m.costPerQualified)}. Last 7 days: ${m.week.qualified} qualified, ${usd(m.week.spend)}, ${m.week.costPerQualified === null ? 'n/a' : usd(m.week.costPerQualified)} per lead`,
    `Unknown sends: ${m.unknownSends}`,
    `Holds: ${input.holds.length ? input.holds.join(', ') : 'none'}. Needs: ${input.needs.length ? input.needs.map((need) => `FOUNDER: gtm ${need}`).join(', ') : 'none'}`,
    `Why lanes are not live: films: ${lanes.reasons.film.length}, x: ${lanes.reasons.x.length}, email: ${lanes.reasons.email.length} precondition(s) open; see the review file`,
    `Review: ${input.review ?? 'local file only'}`,
  ].join('\n');
}
