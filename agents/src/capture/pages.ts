import { normaliseUrl, normaliseWhitespace } from '../researcher/text.ts';

export const MAX_PAGES = 15;

/** Paths every site is probed at for public product UI. */
export const PROBE_PATHS = [
  '/demo',
  '/tour',
  '/playground',
  '/sandbox',
  '/product',
  '/how-it-works',
] as const;

/** A path no site has, whose answer shows what the site sends for a missing page. */
export const BASELINE_PATH = '/br-research-missing-page-7f3a9c';

export type LinkKind =
  | 'home'
  | 'pricing'
  | 'product'
  | 'docs'
  | 'about'
  | 'demo'
  | 'customers'
  | 'blog'
  | 'login'
  | 'legal'
  | 'careers'
  | 'contact'
  | 'other';

const RULES: [LinkKind, RegExp][] = [
  [
    'login',
    /(^|\/)(log-?in|sign-?in|signin|sign-?up|signup|register|auth|sso|account|dashboard|console|app)(\/|$)/,
  ],
  [
    'legal',
    /(^|\/)(privacy|terms|legal|cookies?|gdpr|dpa|imprint|impressum|security\.txt|tos|eula|licen[cs]e)/,
  ],
  ['careers', /(^|\/)(careers?|jobs|hiring|join-us)(\/|$)/],
  ['pricing', /(^|\/)(pricing|plans|price|prices|buy|purchase)(\/|$)/],
  ['demo', /(^|\/)(demo|tour|playground|sandbox|try|interactive|live-demo|how-it-works)(\/|$)/],
  [
    'docs',
    /(^|\/)(docs?|documentation|developers?|api|guides?|reference|help|support|learn|manual)(\/|$)/,
  ],
  ['about', /(^|\/)(about|about-us|company|team|story|mission|who-we-are)(\/|$)/],
  ['customers', /(^|\/)(customers?|case-studies|case-study|stories|testimonials|showcase)(\/|$)/],
  ['blog', /(^|\/)(blog|news|changelog|updates|press|articles?|posts?)(\/|$)/],
  ['contact', /(^|\/)(contact|contact-us|talk-to-sales|sales)(\/|$)/],
  [
    'product',
    /(^|\/)(product|products|features?|platform|solutions?|use-cases?|integrations?|why|overview|capabilities)(\/|$)/,
  ],
];

const TEXT_RULES: [LinkKind, RegExp][] = [
  ['login', /^(log ?in|sign ?in|sign ?up|dashboard|console|open app|my account)$/i],
  ['pricing', /^(pricing|plans|plans (&|and) pricing)$/i],
  ['docs', /^(docs|documentation|developers|api|guides)$/i],
  ['about', /^(about|about us|company|our story|team)$/i],
  // A demo behind a sales form is a contact page; a demo anyone can open is public product UI.
  ['contact', /\b(book|request|schedule|get|talk to|contact)\b.*\b(demo|call|meeting|sales)\b/i],
  ['demo', /\b(demo|tour|playground|sandbox|how it works|see it in action)\b/i],
  ['product', /^(product|products|features|platform|solutions?)$/i],
  ['customers', /^(customers|case studies|stories)$/i],
  ['blog', /^(blog|news|changelog)$/i],
];

/** What a link on a site points at, from its path and its text. */
export function classifyLink(url: string, text = '', home?: string): LinkKind {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'other';
  }
  if (home && normaliseUrl(url) === normaliseUrl(home)) return 'home';
  if (/^(app|dashboard|console|login|auth|accounts?)\./i.test(parsed.hostname)) return 'login';
  if (parsed.pathname === '/' && !parsed.search) return 'home';
  const path = parsed.pathname.toLowerCase();
  const label = normaliseWhitespace(text);
  for (const [kind, rule] of TEXT_RULES) if (rule.test(label)) return kind;
  for (const [kind, rule] of RULES) if (rule.test(path)) return kind;
  return 'other';
}

export function sameSite(url: string, site: string): boolean {
  try {
    const bare = (host: string) => host.toLowerCase().replace(/^www\./, '');
    return bare(new URL(url).hostname) === bare(new URL(site).hostname);
  } catch {
    return false;
  }
}

export interface ProbeResult {
  path: string;
  url: string;
  status: number | null;
  final_url: string | null;
  content_type: string | null;
  title: string;
  length: number;
  found: boolean;
  reason: string;
}

export interface ProbeResponse {
  status: number | null;
  final_url: string | null;
  content_type: string | null;
  title: string;
  length: number;
}

/**
 * Whether a probed path is a real page. A status code is not enough (trap: soft 404s answer 200
 * with an app shell or the home page), so the answer is also compared with what the site sends
 * for a path that cannot exist, and a redirect to the home page or a sign-in page is not a find.
 */
export function judgeProbe(
  path: string,
  url: string,
  response: ProbeResponse,
  baseline: ProbeResponse | null,
  home: string,
): ProbeResult {
  const result = { path, url, ...response };
  const verdict = (found: boolean, reason: string): ProbeResult => ({ ...result, found, reason });
  if (response.status === null) return verdict(false, 'no response');
  if (response.status >= 400) return verdict(false, `HTTP ${response.status}`);
  if (!response.content_type?.includes('html'))
    return verdict(false, `not a page (${response.content_type ?? 'no type'})`);
  if (response.final_url) {
    if (normaliseUrl(response.final_url) === normaliseUrl(home))
      return verdict(false, 'redirects to the home page');
    if (classifyLink(response.final_url) === 'login')
      return verdict(false, `redirects to sign-in (${response.final_url})`);
    if (!sameSite(response.final_url, home))
      return verdict(false, `redirects off the site (${response.final_url})`);
  }
  if (baseline && baseline.status !== null && baseline.status < 400) {
    const sameTitle = baseline.title.trim() === response.title.trim();
    const close =
      baseline.length > 0 && Math.abs(baseline.length - response.length) / baseline.length < 0.05;
    if (sameTitle && close)
      return verdict(false, 'same as the answer for a missing page (soft 404)');
  }
  return verdict(true, `HTTP ${response.status}`);
}

/** `Disallow` rules for every crawler (`User-agent: *`), from a robots.txt. */
export function parseRobots(text: string): {
  disallow: string[];
  allow: string[];
  delaySeconds: number | null;
} {
  const disallow: string[] = [];
  const allow: string[] = [];
  let delaySeconds: number | null = null;
  let applies = false;
  let inAgents = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();
    if (key === 'user-agent') {
      if (!inAgents) applies = false;
      inAgents = true;
      if (value === '*') applies = true;
      continue;
    }
    inAgents = false;
    if (!applies) continue;
    if (key === 'disallow' && value) disallow.push(value);
    if (key === 'allow' && value) allow.push(value);
    if (key === 'crawl-delay' && Number.isFinite(Number(value))) delaySeconds = Number(value);
  }
  return { disallow, allow, delaySeconds };
}

function ruleMatches(rule: string, path: string): boolean {
  const pattern = rule
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\\\$$/, '$');
  return new RegExp(`^${pattern}`).test(path);
}

/** Whether robots.txt lets any crawler fetch a path. The longest matching rule wins. */
export function robotsAllow(
  robots: { disallow: string[]; allow: string[] },
  path: string,
): boolean {
  let best = { length: -1, allowed: true };
  for (const rule of robots.allow)
    if (ruleMatches(rule, path) && rule.length > best.length)
      best = { length: rule.length, allowed: true };
  for (const rule of robots.disallow)
    if (ruleMatches(rule, path) && rule.length > best.length)
      best = { length: rule.length, allowed: false };
  return best.allowed;
}

export interface CandidateLink {
  url: string;
  text: string;
  where: string;
  kind: LinkKind;
}

const KIND_ORDER: LinkKind[] = [
  'home',
  'pricing',
  'product',
  'demo',
  'docs',
  'about',
  'customers',
  'other',
  'blog',
  'contact',
];
const NEVER: Set<LinkKind> = new Set(['login', 'legal', 'careers']);

/**
 * Up to `max` pages to capture, most useful first: the home page, then one page of each kind a
 * launch film needs (pricing, product, docs landing, about), every probe that found a page, then
 * more product and demo pages, preferring links in the navigation and shallow paths. Sign-in,
 * legal and careers pages are never chosen.
 */
export function suggestPages(
  home: string,
  links: CandidateLink[],
  probes: ProbeResult[],
  max = MAX_PAGES,
): CandidateLink[] {
  const chosen: CandidateLink[] = [];
  const seen = new Set<string>();
  const take = (link: CandidateLink) => {
    const key = normaliseUrl(link.url);
    if (!key || seen.has(key) || chosen.length >= max) return;
    seen.add(key);
    chosen.push(link);
  };
  const depth = (url: string) => new URL(url).pathname.split('/').filter(Boolean).length;
  const rank = (link: CandidateLink) =>
    (link.where === 'nav' || link.where === 'header' ? 0 : link.where === 'body' ? 1 : 2) * 10 +
    depth(link.url);
  const usable = links
    .filter((link) => sameSite(link.url, home) && !NEVER.has(link.kind))
    .filter(
      (link) =>
        !/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|xml|txt|json)$/i.test(new URL(link.url).pathname),
    )
    .sort((a, b) => rank(a) - rank(b));

  take({ url: home, text: 'Home', where: 'home', kind: 'home' });
  for (const kind of ['pricing', 'product', 'docs', 'about'] as const) {
    const first = usable.find((link) => link.kind === kind);
    if (first) take(first);
  }
  for (const probe of probes) {
    if (probe.found)
      take({
        url: probe.final_url ?? probe.url,
        text: probe.path,
        where: 'probe',
        kind: classifyLink(probe.final_url ?? probe.url) === 'product' ? 'product' : 'demo',
      });
  }
  // Links that open a public demo, such as "View live demo", show the product itself.
  for (const link of usable.filter((item) => item.kind === 'demo').slice(0, 2)) take(link);
  for (const kind of KIND_ORDER) {
    const perKind = kind === 'product' || kind === 'demo' ? 4 : kind === 'other' ? 3 : 1;
    for (const link of usable
      .filter((item) => item.kind === kind && depth(item.url) <= 2)
      .slice(0, perKind))
      take(link);
  }
  return chosen;
}
