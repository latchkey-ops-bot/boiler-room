import { DISCOVERY, PRICES } from './config.ts';
import { isWellKnown, registrableDomain } from './domain.ts';
import { safeFetch, type Transport } from './fetcher.ts';
import { decodeEntities, parseHtml } from './html.ts';
import type { DataRuns } from './ports.ts';
import type { Source } from './store.ts';

/**
 * Where startups come from: Show HN, the Product Hunt feed, and launch posts on X found through
 * Google and confirmed with X's free oEmbed endpoint. All of it is code; no model searches.
 */

export interface RawCandidate {
  source: Source;
  source_url: string;
  source_at: string;
  /** The HN title, the PH name and tagline, or the X post's text. Untrusted. */
  title: string;
  site_url: string | null;
  hn_points: number | null;
  /** For Product Hunt: the entry's name and tagline. */
  ph: { name: string; tagline: string } | null;
  x_post: {
    url: string;
    author_name: string | null;
    at: string | null;
    link_domain: string | null;
  } | null;
}

export interface SourceReport {
  source: Source;
  seen: number;
  kept: number;
  data_runs: number;
  cost_micro_usd: number;
  note: string | null;
}

/**
 * One data run's outcome. A run that did not happen says why: `cap` (a data cap or the spend cap),
 * `refused` (the guard has no id for the tool, or no data runs are wired), or `failed` (the run
 * itself failed). Each reads differently in the report, so a missing tool never looks like a cap.
 */
export type DataRunResult =
  | { ok: true; data: unknown; costMicroUsd: number }
  | { ok: false; reason: 'cap' | 'refused' | 'failed'; detail: string };

/** Runs one data tool if the caller's caps allow it. */
export type GuardedDataRun = (
  tool: Parameters<DataRuns['run']>[0],
  input: Parameters<DataRuns['run']>[1],
  price: number,
) => Promise<DataRunResult>;

/** How a run that did not happen reads in a source's note. */
export function dataRunNote(result: Extract<DataRunResult, { ok: false }>): string {
  if (result.reason === 'cap') return `data-run cap reached (${result.detail})`;
  if (result.reason === 'refused') return `data run refused: ${result.detail.slice(0, 160)}`;
  return `data run failed: ${result.detail.slice(0, 160)}`;
}

const NOT_A_SITE = /\.(?:pdf|png|jpe?g|gif|mp4|zip)$|\/(?:blog|posts?|articles?|papers?|news)\//i;

/** Show HN in the last 72 hours with a URL, 5 points or more, and a startup's own site. */
export async function hackerNews(
  transport: Transport,
  userAgent: string,
  now: Date,
): Promise<{ candidates: RawCandidate[]; report: SourceReport }> {
  const since = Math.floor(now.getTime() / 1000) - DISCOVERY.window_hours * 3600;
  const url = `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=created_at_i>${since}&hitsPerPage=200`;
  const result = await safeFetch(url, transport, { userAgent, maxBytes: 2_000_000 });
  const hits = (JSON.parse(result.body) as { hits?: unknown[] }).hits ?? [];
  const candidates: RawCandidate[] = [];
  for (const hit of hits as {
    url?: string | null;
    points?: number;
    title?: string;
    created_at?: string;
    objectID?: string;
  }[]) {
    if (!hit.url || !hit.title || !hit.created_at || !hit.objectID) continue;
    if ((hit.points ?? 0) < DISCOVERY.hn_min_points_email) continue;
    let site: URL;
    try {
      site = new URL(hit.url);
    } catch {
      continue;
    }
    if (site.protocol !== 'https:' && site.protocol !== 'http:') continue;
    if (isWellKnown(site.hostname) || NOT_A_SITE.test(site.pathname)) continue;
    candidates.push({
      source: 'hn',
      source_url: `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID)}`,
      source_at: hit.created_at,
      title: hit.title,
      site_url: `${site.protocol}//${site.host}/`,
      hn_points: hit.points ?? 0,
      ph: null,
      x_post: null,
    });
  }
  return {
    candidates,
    report: {
      source: 'hn',
      seen: hits.length,
      kept: candidates.length,
      data_runs: 0,
      cost_micro_usd: 0,
      note: null,
    },
  };
}

interface FeedEntry {
  name: string;
  tagline: string;
  published: string;
  link: string;
}

/** Reads the Product Hunt Atom feed: name, tagline, publish date and the PH link. */
export function parseProductHuntFeed(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const body = match[1] ?? '';
    const name = decodeEntities(/<title>([\s\S]*?)<\/title>/.exec(body)?.[1] ?? '').trim();
    const published = (/<published>([^<]+)<\/published>/.exec(body)?.[1] ?? '').trim();
    const link = /<link[^>]+rel="alternate"[^>]+href="([^"]+)"/.exec(body)?.[1] ?? '';
    const content = decodeEntities(/<content[^>]*>([\s\S]*?)<\/content>/.exec(body)?.[1] ?? '');
    const tagline =
      parseHtml(content, 'https://www.producthunt.com/').text.split('\n')[0]?.trim() ?? '';
    if (name && published && tagline) entries.push({ name, tagline, published, link });
  }
  return entries;
}

/**
 * Product Hunt entries published in the last 72 hours, at most 10. The feed has no website and PH
 * answers scripts with 403, so one `Search Google` run per entry finds the site. Whether the site
 * really is that product is checked later against the tagline.
 */
export async function productHunt(
  transport: Transport,
  userAgent: string,
  now: Date,
  dataRun: GuardedDataRun | null,
): Promise<{ candidates: RawCandidate[]; report: SourceReport }> {
  const result = await safeFetch('https://www.producthunt.com/feed', transport, {
    userAgent,
    maxBytes: 1_000_000,
  });
  const since = now.getTime() - DISCOVERY.window_hours * 3_600_000;
  const entries = parseProductHuntFeed(result.body)
    .filter((entry) => new Date(entry.published).getTime() >= since)
    .slice(0, DISCOVERY.ph_max_entries);
  const report: SourceReport = {
    source: 'ph',
    seen: entries.length,
    kept: 0,
    data_runs: 0,
    cost_micro_usd: 0,
    note: null,
  };
  if (!dataRun) {
    report.note = 'no data runs: Product Hunt sites not looked up';
    return { candidates: [], report };
  }
  const candidates: RawCandidate[] = [];
  for (const entry of entries) {
    const run = await dataRun(
      'google',
      { query: { q: `"${entry.name}" ${entry.tagline}`, num: 10 } },
      PRICES.search_google,
    );
    if (!run.ok) {
      report.note = dataRunNote(run);
      // A cap or a missing tool stops every later entry the same way; one failed run does not.
      if (run.reason === 'failed') continue;
      break;
    }
    report.data_runs += 1;
    report.cost_micro_usd += run.costMicroUsd;
    const results = (run.data as { organic_results?: { link?: string }[] })?.organic_results ?? [];
    const site = results
      .map((item) => item.link)
      .find((link): link is string => {
        if (!link) return false;
        try {
          const host = new URL(link).hostname;
          return !isWellKnown(host);
        } catch {
          return false;
        }
      });
    if (!site) continue;
    const root = new URL('/', site);
    candidates.push({
      source: 'ph',
      source_url: entry.link,
      source_at: entry.published,
      title: `${entry.name}: ${entry.tagline}`,
      site_url: root.toString(),
      hn_points: null,
      ph: { name: entry.name, tagline: entry.tagline },
      x_post: null,
    });
  }
  report.kept = candidates.length;
  return { candidates, report };
}

/** When an X status id was posted, read from its snowflake. */
export function statusTime(statusId: string): Date | null {
  if (!/^\d{6,25}$/.test(statusId)) return null;
  const ms = Number((BigInt(statusId) >> 22n) + 1288834974657n);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

const STATUS = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{6,25})/;

export const X_QUERIES = [
  'site:x.com ("launching today" OR "we\'re live" OR "we are live") (startup OR app OR SaaS OR AI)',
  'site:x.com ("live on Product Hunt" OR "live on producthunt") (launch OR launching)',
  'site:x.com ("just launched" OR "excited to launch" OR "today we launch") (startup OR product OR app)',
];

/**
 * Confirms an X post with oEmbed and resolves its own link. The post counts as the startup's launch
 * post only when that link, followed through `t.co`, lands on a site that is not a platform.
 */
export async function confirmXPost(
  statusUrl: string,
  transport: Transport,
  userAgent: string,
): Promise<RawCandidate['x_post'] & { text: string; site_url: string | null }> {
  const oembed = await safeFetch(
    `https://publish.x.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(statusUrl)}`,
    transport,
    { userAgent, maxBytes: 200_000 },
  );
  if (oembed.status !== 200) throw new Error(`oEmbed answered ${oembed.status}`);
  const data = JSON.parse(oembed.body) as { author_name?: string; html?: string };
  const html = data.html ?? '';
  const parsed = parseHtml(html, statusUrl);
  const dateText =
    /<\/a>\)?\s*&mdash;[^<]*<a[^>]*>([^<]+)<\/a>\s*<\/blockquote>/.exec(html)?.[1] ?? null;
  let site: string | null = null;
  for (const link of parsed.links.filter((item) => /^https:\/\/t\.co\//.test(item)).slice(0, 3)) {
    try {
      const resolved = await safeFetch(link, transport, {
        userAgent,
        followScriptRedirects: true,
        maxBytes: 200_000,
      });
      const host = new URL(resolved.finalUrl).hostname;
      if (!isWellKnown(host)) {
        site = new URL('/', resolved.finalUrl).toString();
        break;
      }
    } catch {
      // An unresolvable link is no link.
    }
  }
  return {
    url: statusUrl,
    author_name: data.author_name ?? null,
    at: dateText,
    link_domain: site ? registrableDomain(site) : null,
    text: parsed.text,
    site_url: site,
  };
}

/** Launch posts on X in the last 72 hours, from 3 Google runs and 1 web-pages run. */
export async function xLaunches(
  transport: Transport,
  userAgent: string,
  now: Date,
  dataRun: GuardedDataRun | null,
): Promise<{ candidates: RawCandidate[]; report: SourceReport }> {
  const report: SourceReport = {
    source: 'x',
    seen: 0,
    kept: 0,
    data_runs: 0,
    cost_micro_usd: 0,
    note: null,
  };
  if (!dataRun) {
    report.note = 'no data runs: X not searched';
    return { candidates: [], report };
  }
  const urls = new Set<string>();
  for (const q of X_QUERIES) {
    const run = await dataRun(
      'google',
      { query: { q, tbs: 'qdr:d3', num: 10 } },
      PRICES.search_google,
    );
    if (!run.ok) {
      report.note = dataRunNote(run);
      if (run.reason === 'failed') continue;
      break;
    }
    report.data_runs += 1;
    report.cost_micro_usd += run.costMicroUsd;
    for (const item of (run.data as { organic_results?: { link?: string }[] })?.organic_results ??
      []) {
      const match = item.link ? STATUS.exec(item.link) : null;
      if (match) urls.add(`https://x.com/${match[1]}/status/${match[2]}`);
    }
  }
  const pages = await dataRun(
    'webPages',
    {
      body: {
        query: 'founder announcing their startup product launch today on X',
        site: 'x.com',
        published_after: '3d',
        mode: 'pro',
      },
    },
    PRICES.search_web_pages,
  );
  if (!pages.ok) {
    const note = dataRunNote(pages);
    report.note = report.note ? `${report.note}; ${note}` : note;
  } else {
    report.data_runs += 1;
    report.cost_micro_usd += pages.costMicroUsd;
    for (const item of (pages.data as { results?: { url?: string }[] })?.results ?? []) {
      const match = item.url ? STATUS.exec(item.url) : null;
      if (match) urls.add(`https://x.com/${match[1]}/status/${match[2]}`);
    }
  }
  report.seen = urls.size;
  const since = now.getTime() - DISCOVERY.window_hours * 3_600_000;
  const candidates: RawCandidate[] = [];
  for (const url of urls) {
    const id = STATUS.exec(url)?.[2] ?? '';
    const at = statusTime(id);
    if (!at || at.getTime() < since || at.getTime() > now.getTime() + 600_000) continue;
    try {
      const post = await confirmXPost(url, transport, userAgent);
      if (!post.site_url) continue;
      candidates.push({
        source: 'x',
        source_url: url,
        source_at: at.toISOString(),
        title: post.text,
        site_url: post.site_url,
        hn_points: null,
        ph: null,
        x_post: {
          url,
          author_name: post.author_name,
          at: at.toISOString(),
          link_domain: post.link_domain,
        },
      });
    } catch {
      // Not confirmed: dropped.
    }
  }
  report.kept = candidates.length;
  return { candidates, report };
}
