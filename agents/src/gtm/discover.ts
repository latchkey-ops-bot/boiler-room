import { cap } from './caps.ts';
import { PRICES } from './config.ts';
import { isWellKnown, registrableDomain, stableId } from './domain.ts';
import {
  brandFlags,
  finderAddresses,
  hnName,
  jurisdictionHint,
  noSolicitationNotice,
  phMatches,
  productName,
  publishedAddresses,
} from './extract.ts';
import type { Transport } from './fetcher.ts';
import { readSite, type SiteRead } from './site.ts';
import {
  type GuardedDataRun,
  hackerNews,
  productHunt,
  type RawCandidate,
  type SourceReport,
  xLaunches,
} from './sources.ts';
import type { LeadRow, StoreData } from './store.ts';
import { dropReason } from './suppression.ts';

/** One startup the scout will judge: the draft lead, the site as read, and the raw source item. */
export interface Candidate {
  candidate_id: string;
  lead: LeadRow;
  read: SiteRead;
  raw: RawCandidate;
}

export interface DiscoverResult {
  candidates: Candidate[];
  reports: SourceReport[];
  /** Candidates dropped before the scout, by reason. */
  dropped: Record<string, number>;
  finder_runs: number;
}

export interface DiscoverContext {
  store: StoreData;
  transport: Transport;
  userAgent: string;
  now: Date;
  date: string;
  dataRun: GuardedDataRun | null;
  log: (line: string) => void;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Finds today's candidates: the three sources, then the drop rules (suppressed, emailed in 90
 * days, filmed, well-known, already a lead today), then each site read and checked. A Product Hunt
 * entry whose site does not carry its tagline is dropped: it is likely another company of the same
 * name. At most 40 reach the scout.
 */
export async function discover(context: DiscoverContext): Promise<DiscoverResult> {
  const { store, transport, userAgent, now, date, log } = context;
  const reports: SourceReport[] = [];
  const raws: RawCandidate[] = [];
  const sources = [
    ['hn', () => hackerNews(transport, userAgent, now)],
    ['ph', () => productHunt(transport, userAgent, now, context.dataRun)],
    ['x', () => xLaunches(transport, userAgent, now, context.dataRun)],
  ] as const;
  for (const [source, run] of sources) {
    try {
      const result = await run();
      reports.push(result.report);
      raws.push(...result.candidates);
      log(
        `discover  ${source}: ${result.report.seen} seen, ${result.report.kept} kept${result.report.note ? ` (${result.report.note})` : ''}`,
      );
    } catch (error) {
      const note = error instanceof Error ? error.message.slice(0, 120) : 'failed';
      reports.push({
        source,
        seen: 0,
        kept: 0,
        data_runs: 0,
        cost_micro_usd: 0,
        note: `failed: ${note}`,
      });
      log(`discover  ${source}: failed (${note})`);
    }
  }

  // An X post whose own link lands on a domain is that domain's launch post, whichever source won.
  const xPosts = new Map<string, NonNullable<RawCandidate['x_post']>>();
  for (const raw of raws) {
    if (raw.x_post?.link_domain && !xPosts.has(raw.x_post.link_domain)) {
      xPosts.set(raw.x_post.link_domain, raw.x_post);
    }
  }

  const order = { hn: 0, ph: 1, x: 2 } as const;
  raws.sort((a, b) => order[a.source] - order[b.source] || (b.hn_points ?? 0) - (a.hn_points ?? 0));

  const dropped: Record<string, number> = {};
  const drop = (reason: string) => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
  };
  const chosen: { raw: RawCandidate; domain: string }[] = [];
  const seen = new Set<string>();
  const limit = cap(store, 'candidates_day');
  for (const raw of raws) {
    const domain = raw.site_url ? registrableDomain(raw.site_url) : null;
    if (!domain) {
      drop('no_site');
      continue;
    }
    if (seen.has(domain)) {
      drop('duplicate');
      continue;
    }
    seen.add(domain);
    if (isWellKnown(domain)) {
      drop('well_known');
      continue;
    }
    const reason = dropReason(store, domain, date, now);
    if (reason) {
      drop(reason);
      continue;
    }
    if (chosen.length >= limit) {
      drop('over_cap');
      continue;
    }
    chosen.push({ raw, domain });
  }

  const reads = await mapLimit(chosen, 4, async ({ raw }) =>
    readSite(raw.site_url as string, transport, userAgent, now),
  );
  const candidates: Candidate[] = [];
  let finderRuns = 0;
  for (const [index, { raw, domain }] of chosen.entries()) {
    const read = reads[index] as SiteRead;
    if (read.failure) {
      drop(read.failure.startsWith('refused') ? 'fetch_refused' : read.failure);
      continue;
    }
    const home = read.pages.find((page) => page.id === 'p1');
    if (raw.ph && !phMatches(home, raw.ph.tagline)) {
      drop('ph_site_mismatch');
      continue;
    }
    const sourceName = raw.source === 'hn' ? hnName(raw.title) : (raw.ph?.name ?? null);
    const xPost = xPosts.get(domain) ?? null;
    let addresses = publishedAddresses(read, domain);
    const closed = noSolicitationNotice(read) ? 'no_solicitation_notice' : null;
    const hint = jurisdictionHint(domain, read);
    if (
      !addresses.length &&
      !closed &&
      hint === 'unknown' &&
      context.dataRun &&
      finderRuns < cap(store, 'finder_runs_day')
    ) {
      const run = await context.dataRun(
        'domainEmails',
        { body: { domain, limit: 10, type: 'generic' } },
        PRICES.find_domain_emails,
      );
      if (run) {
        finderRuns += 1;
        addresses = finderAddresses(run.data, domain);
      }
    }
    const lead: LeadRow = {
      id: stableId('ld', `${domain}|${date}`),
      date,
      domain,
      site_url: read.site,
      source: raw.source,
      source_url: raw.source_url,
      source_at: raw.source_at,
      hn_points: raw.hn_points,
      x_post: xPost
        ? {
            url: xPost.url,
            verified: xPost.link_domain === domain,
            author_name: xPost.author_name,
            at: xPost.at,
          }
        : null,
      product_name: productName(home, sourceName),
      addresses,
      email_closed: closed,
      jurisdiction_hint: hint,
      brand_flags: brandFlags(...read.pages.map((page) => page.parsed.text), raw.title),
      verdict: null,
      picked: [],
      found_at: now.toISOString(),
    };
    candidates.push({
      candidate_id: `c${String(candidates.length + 1).padStart(2, '0')}`,
      lead,
      read,
      raw,
    });
  }
  return { candidates, reports, dropped, finder_runs: finderRuns };
}
