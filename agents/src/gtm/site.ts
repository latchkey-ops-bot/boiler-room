import { normaliseWhitespace } from '../researcher/text.ts';
import {
  checkQuote,
  PageIndex,
  type PagesBundle,
  type QuoteVerdict,
  type StoredPage,
} from '../researcher/verify.ts';
import { DISCOVERY } from './config.ts';
import { sameSite } from './domain.ts';
import { FetchRefused, robotsAllows, safeFetch, type Transport } from './fetcher.ts';
import { type ParsedPage, parseHtml } from './html.ts';

/**
 * Reads a startup's public website: at most 6 pages, `/`, `/about`, `/contact`, `/privacy`,
 * `/terms`, and `/imprint` or `/impressum` when the homepage links to one, with robots.txt honoured.
 * The text is stored as a pages bundle in the shape `researcher/verify.ts` reads, so the existing
 * `checkQuote` verifies any quote against it. A plain fetch has no rendered text, so `rendered`,
 * `dom` and `clean` all hold the visible text, and `illustrative` is empty.
 */

export const SITE_PATHS = ['/', '/about', '/contact', '/privacy', '/terms'] as const;
const IMPRINT = /^\/(imprint|impressum)\/?$/i;

export interface SitePage {
  /** `p1` is the homepage. */
  id: string;
  path: string;
  label: string;
  url: string;
  final_url: string;
  parsed: ParsedPage;
}

export interface SiteRead {
  site: string;
  pages: SitePage[];
  bundle: PagesBundle;
  /** Why the site could not be read, if it could not. */
  failure: string | null;
}

/** How the footer names a page: "We found hello@... on your website's contact page." */
export function pageLabel(path: string): string {
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/') return 'homepage';
  if (/^\/contact/i.test(clean)) return 'contact page';
  if (/^\/about/i.test(clean)) return 'about page';
  if (/^\/privacy/i.test(clean)) return 'privacy page';
  if (/^\/terms/i.test(clean)) return 'terms page';
  if (IMPRINT.test(clean)) return 'imprint page';
  return 'website';
}

function storedPage(page: SitePage, status: number, contentType: string | null): StoredPage {
  const visible = page.parsed.text;
  const meta = [page.parsed.title, page.parsed.siteName ?? '', page.parsed.description ?? '']
    .filter(Boolean)
    .join('\n');
  return {
    url: page.url,
    final_url: page.final_url,
    origin: 'site',
    file_id: null,
    status,
    content_type: contentType,
    title: page.parsed.title,
    text: { rendered: visible, dom: visible, meta, clean: visible, illustrative: '' },
  };
}

export async function readSite(
  siteUrl: string,
  transport: Transport,
  userAgent: string,
  now: Date,
): Promise<SiteRead> {
  const root = new URL('/', siteUrl);
  const pages: SitePage[] = [];
  const stored: StoredPage[] = [];
  const empty = (failure: string): SiteRead => ({
    site: root.toString(),
    pages,
    bundle: { version: 1, site: root.toString(), captured_at: now.toISOString(), pages: stored },
    failure,
  });

  let robots = '';
  try {
    const result = await safeFetch(new URL('/robots.txt', root).toString(), transport, {
      userAgent,
      maxBytes: 100_000,
    });
    if (result.status === 200) robots = result.body;
  } catch (error) {
    if (error instanceof FetchRefused) return empty(`refused: ${error.code}`);
  }

  const paths: string[] = [...SITE_PATHS];
  for (let index = 0; index < paths.length && pages.length < DISCOVERY.pages_per_site; index++) {
    const path = paths[index] as string;
    if (!robotsAllows(robots, userAgent, path)) {
      if (path === '/') return empty('robots_disallow');
      continue;
    }
    const url = new URL(path, root).toString();
    let result: Awaited<ReturnType<typeof safeFetch>>;
    try {
      result = await safeFetch(url, transport, { userAgent });
    } catch (error) {
      if (path === '/')
        return empty(error instanceof FetchRefused ? `refused: ${error.code}` : 'fetch_failed');
      continue;
    }
    if (result.status !== 200 || !/html/i.test(result.contentType ?? 'text/html')) {
      if (path === '/') return empty(`status_${result.status}`);
      continue;
    }
    // A page counts only on the site's own registrable domain.
    if (!sameSite(result.finalUrl, root.toString())) {
      if (path === '/') return empty('redirects_off_site');
      continue;
    }
    const finalPath = new URL(result.finalUrl).pathname;
    // `/about` that redirects to `/` is the homepage again, not a second page.
    if (pages.some((page) => page.final_url === result.finalUrl)) continue;
    const parsed = parseHtml(result.body, result.finalUrl);
    const page: SitePage = {
      id: `p${pages.length + 1}`,
      path: finalPath,
      label: pageLabel(path === '/' ? '/' : finalPath),
      url,
      final_url: result.finalUrl,
      parsed,
    };
    pages.push(page);
    stored.push(storedPage(page, result.status, result.contentType));
    if (path === '/') {
      const imprint = parsed.links.find((link) => {
        try {
          const target = new URL(link);
          return sameSite(link, root.toString()) && IMPRINT.test(target.pathname);
        } catch {
          return false;
        }
      });
      if (imprint) paths.push(new URL(imprint).pathname);
    }
  }
  if (!pages.length) return empty('no_pages');
  // A site with too little plain-HTML text, such as a page drawn only by scripts, is unreadable.
  const text = pages.map((page) => page.parsed.text).join('\n');
  return {
    ...empty('site_unreadable'),
    failure: normaliseWhitespace(text).length < 120 ? 'site_unreadable' : null,
  };
}

/** Looks a quote up on one page of a site read: `found`, `illustrative` or `missing`. */
export function verifyQuote(
  read: Pick<SiteRead, 'bundle' | 'pages'>,
  pageId: string,
  quote: string,
): {
  verdict: QuoteVerdict;
  page: SitePage | null;
} {
  const page = read.pages.find((item) => item.id === pageId) ?? null;
  if (!page) return { verdict: 'missing', page: null };
  const index = new PageIndex(read.bundle);
  const text = index.find(page.final_url);
  if (!text) return { verdict: 'missing', page };
  return { verdict: checkQuote(text, quote), page };
}
