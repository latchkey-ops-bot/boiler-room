import { normaliseWhitespace } from '../researcher/text.ts';
import { DISCOVERY } from './config.ts';
import { claimProblems } from './copy.ts';
import { emailDomain, normalise, registrableDomain, singleAddress } from './domain.ts';
import type { SitePage, SiteRead } from './site.ts';
import type { Jurisdiction, LeadAddress } from './store.ts';

/**
 * Deterministic reading of a startup's site: its published contact addresses, the product name
 * copy may use, jurisdiction hints, notices that close the email lane, and brand-safety flags.
 */

/** The only addresses GTM writes to: role addresses the business published. */
export const ROLE_LOCAL_PARTS = [
  'hello',
  'contact',
  'team',
  'founders',
  'info',
  'partnerships',
  'press',
  'media',
] as const;

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PAGE_ORDER = [
  'contact page',
  'homepage',
  'about page',
  'imprint page',
  'privacy page',
  'terms page',
];

/**
 * Whether an address is one role address on the lead's own registrable domain. It must be exactly
 * one address (`singleAddress`): a second `@`, a comma, `?` or whitespace makes it no address at all,
 * so the role check, suppression, dedupe and the MX lookup all read the same single domain.
 */
export function isRoleAddressOn(address: string, domain: string): boolean {
  const normal = singleAddress(address);
  if (!normal) return false;
  const local = normal.split('@')[0] ?? '';
  return (
    (ROLE_LOCAL_PARTS as readonly string[]).includes(local) &&
    emailDomain(normal) !== null &&
    emailDomain(normal) === registrableDomain(domain)
  );
}

/**
 * The role addresses the site publishes on its own domain, from `mailto:` links and plain text,
 * each with the page it was found on. Best first: a contact page before the homepage, `hello@`
 * before `media@`.
 */
export function publishedAddresses(read: Pick<SiteRead, 'pages'>, domain: string): LeadAddress[] {
  const found = new Map<string, LeadAddress>();
  for (const page of read.pages) {
    if (registrableDomain(page.final_url) !== registrableDomain(domain)) continue;
    const candidates = [...page.parsed.mailto, ...(page.parsed.text.match(ADDRESS) ?? [])];
    for (const raw of candidates) {
      const address = singleAddress(raw.trim().replace(/[.,;:]+$/, ''));
      if (!address || !isRoleAddressOn(address, domain) || found.has(address)) continue;
      found.set(address, {
        address,
        source_url: page.final_url,
        page_label: page.label,
        provenance: 'site',
      });
    }
  }
  const rank = (item: LeadAddress) => {
    const local = (item.address ?? '').split('@')[0] ?? '';
    const page = PAGE_ORDER.indexOf(item.page_label);
    return (page < 0 ? 9 : page) * 10 + (ROLE_LOCAL_PARTS as readonly string[]).indexOf(local);
  };
  return [...found.values()].sort((a, b) => rank(a) - rank(b));
}

/** Keeps only `Find Domain Emails` results that are `found`, role addresses, sourced on the domain. */
export function finderAddresses(data: unknown, domain: string): LeadAddress[] {
  const emails = (data as { data?: { emails?: unknown[] } })?.data?.emails;
  if (!Array.isArray(emails)) return [];
  const out: LeadAddress[] = [];
  for (const item of emails as {
    value?: string;
    provenance?: string;
    source_type?: string;
    sources?: { uri?: string }[];
  }[]) {
    if (!item.value || item.provenance !== 'found' || item.source_type !== 'found') continue;
    const address = singleAddress(item.value);
    if (!address || !isRoleAddressOn(address, domain)) continue;
    const source = item.sources?.find(
      (entry) => entry.uri && registrableDomain(entry.uri) === registrableDomain(domain),
    );
    if (!source?.uri) continue;
    out.push({
      address,
      source_url: source.uri,
      page_label: 'website',
      provenance: 'found',
    });
  }
  return out;
}

/**
 * A site notice that it wants no unsolicited email, or that it will not give, sell or transfer
 * email addresses. Harvesting from such a site is an aggravating factor under CAN-SPAM, and CASL's
 * published-address exception fails, so the email lane closes for the lead.
 */
const NO_SOLICITATION = [
  /\bno solicit(?:ing|ations?)\b/i,
  /\b(?:no|not accept(?:ing)?|do(?:es)? not (?:accept|want|wish to receive)|refuse)\s+(?:any\s+)?(?:unsolicited|cold)\b/i,
  /\bunsolicited (?:commercial |marketing |promotional |sales )?(?:e-?mails?|messages|solicitations?|offers)\b[^.]{0,60}\b(?:not|prohibited|unwelcome|forbidden|ignored)\b/i,
  /\b(?:will|do|shall|does) not (?:give|sell|share|rent|trade|transfer|disclose)\b[^.]{0,80}\be-?mail addresse?s?\b/i,
  /\be-?mail addresse?s?\b[^.]{0,80}\b(?:will|shall) not be (?:given|sold|shared|rented|traded|transferred|disclosed)\b/i,
];

export function noSolicitationNotice(read: Pick<SiteRead, 'pages'>): string | null {
  for (const page of read.pages) {
    const text = normaliseWhitespace(page.parsed.text);
    for (const pattern of NO_SOLICITATION) {
      if (pattern.test(text)) return page.id;
    }
  }
  return null;
}

/**
 * Brand safety: words that keep a startup off our X account. Any match in the site text or the
 * film's script closes the X lane for it. The scout's excluded categories are a model's reading of
 * the startup's own page, so this list is the deterministic check behind them.
 */
export const BRAND_UNSAFE: Readonly<Record<string, readonly string[]>> = {
  slur: ['nigger', 'nigga', 'faggot', 'retard', 'kike', 'spic', 'chink', 'tranny', 'wetback'],
  adult: [
    'porn',
    'porno',
    'xxx',
    'nsfw',
    'onlyfans',
    'escort',
    'escorts',
    'camgirl',
    'hentai',
    'erotic',
    'sex toy',
    'sex toys',
    'nude',
    'nudes',
    'adult content',
  ],
  gambling: [
    'casino',
    'sportsbook',
    'betting',
    'bet now',
    'poker',
    'slots',
    'gambling',
    'wager',
    'jackpot',
    'roulette',
  ],
  weapons: [
    'firearm',
    'firearms',
    'handgun',
    'handguns',
    'ammunition',
    'ammo',
    'rifle',
    'rifles',
    'ghost gun',
    'gun shop',
    'explosives',
  ],
  crypto_sale: [
    'token sale',
    'presale',
    'pre-sale',
    'ico',
    'airdrop',
    'memecoin',
    'meme coin',
    'buy our token',
    'nft mint',
    'staking rewards',
  ],
  health_claim: [
    'cures',
    'cure for',
    'treats cancer',
    'weight loss pill',
    'diet pill',
    'miracle',
    'clinically proven',
    'detox',
    'kratom',
    'cbd',
  ],
};

/** Apple's AirDrop, with its capital D, is file sharing between devices, not a token giveaway. */
const APPLE_AIRDROP = /(?<![\p{L}\p{N}])AirDrop(?![\p{L}\p{N}])/gu;
/** Words that make any "airdrop" a crypto one, however it is spelled. */
const CRYPTO_CONTEXT =
  /(?<![\p{L}\p{N}])(?:crypto|cryptocurrency|token|tokens|nft|nfts|coin|coins|blockchain|web3|memecoin|on-chain)(?![\p{L}\p{N}])/iu;

/** Every brand-safety term found in the texts, as `category:term`. */
export function brandFlags(...texts: readonly string[]): string[] {
  const flags = new Set<string>();
  const joined = texts.join('\n');
  const haystack = normalise(
    CRYPTO_CONTEXT.test(joined) ? joined : joined.replace(APPLE_AIRDROP, ' '),
  );
  for (const [category, terms] of Object.entries(BRAND_UNSAFE)) {
    for (const term of terms) {
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
        'u',
      );
      if (pattern.test(haystack)) flags.add(`${category}:${term}`);
    }
  }
  return [...flags].sort();
}

const NAME_CHARS = /^[\p{L}\p{N} .-]+$/u;
const GENERIC_NAMES = new Set([
  'home',
  'homepage',
  'welcome',
  'index',
  'untitled',
  'landing',
  'app',
  'show hn',
  'launch',
  'beta',
]);

/** Splits a title on its separators: "Quillbox – shared lists | Home" gives three parts. */
const titleParts = (title: string) =>
  title
    .split(/\s[|–—·•:]\s|\s-\s|\s?\|\s?|:\s/)
    .map((part) => part.trim())
    .filter(Boolean);

/** A name that reads as a domain, such as "logo.deal": X would link it, and copy never names a domain. */
const DOMAIN_LIKE = /[\p{L}\p{N}]\.[\p{L}]{2,}/u;

/**
 * A name copy may use. Besides its shape, it passes the claims screen every lane applies: a page
 * title such as "Best Stripe Partner" makes a superlative and a claim about another company, so it is
 * no product name, and the lead cannot qualify.
 */
const validName = (name: string) =>
  name.length > 0 &&
  name.length <= DISCOVERY.product_name_max &&
  NAME_CHARS.test(name) &&
  !DOMAIN_LIKE.test(name) &&
  !GENERIC_NAMES.has(name.toLowerCase()) &&
  claimProblems(name).length === 0;

/**
 * The product name copy may use. It must appear in the homepage's `<title>`, `og:site_name` or
 * first `<h1>`, be at most 30 characters, and hold only letters, digits, spaces, `.` and `-`. A
 * name the source gives (an HN title, a Product Hunt entry) is preferred when the site carries it.
 */
export function productName(home: SitePage | undefined, sourceName: string | null): string | null {
  if (!home) return null;
  const fields = [home.parsed.siteName ?? '', home.parsed.title, home.parsed.h1 ?? ''];
  const candidates = [
    home.parsed.siteName ?? '',
    ...titleParts(home.parsed.title),
    home.parsed.h1 ?? '',
  ]
    .map((item) => normaliseWhitespace(item))
    .filter(validName)
    .filter((name) => fields.some((field) => normaliseWhitespace(field).includes(name)));
  if (sourceName) {
    const wanted = normaliseWhitespace(sourceName).toLowerCase();
    const exact = candidates.find((name) => name.toLowerCase() === wanted);
    if (exact) return exact;
  }
  const site = home.parsed.siteName ? normaliseWhitespace(home.parsed.siteName) : null;
  if (site && candidates.includes(site)) return site;
  return candidates.find((name) => name.split(' ').length <= 3) ?? null;
}

/** The name an HN title gives: "Show HN: Quillbox – shared lists" gives "Quillbox". */
export function hnName(title: string): string | null {
  const rest = title.replace(/^\s*show hn\s*:\s*/i, '');
  const first = titleParts(rest)[0] ?? '';
  const name = first.split(/\s[-–—]\s|,/)[0]?.trim() ?? '';
  return validName(name) && name.split(' ').length <= 3 ? name : null;
}

const words = (text: string) =>
  new Set(
    normalise(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 2),
  );

/** The share of `needle`'s words that `haystack` contains. */
export function tokenOverlap(needle: string, haystack: string): number {
  const wanted = words(needle);
  if (!wanted.size) return 0;
  const have = words(haystack);
  let hit = 0;
  for (const word of wanted) if (have.has(word)) hit += 1;
  return hit / wanted.size;
}

/**
 * A Product Hunt lead is the right company only when its homepage carries the PH tagline (at least
 * 80% of its words) or links to producthunt.com. An older company with the same name fails both.
 */
export function phMatches(home: SitePage | undefined, tagline: string): boolean {
  if (!home) return false;
  if (home.parsed.links.some((link) => registrableDomain(link) === 'producthunt.com')) return true;
  const text = [home.parsed.title, home.parsed.description ?? '', home.parsed.text].join('\n');
  return tokenOverlap(tagline, text) >= DISCOVERY.ph_tagline_overlap;
}

const EU_TLDS = new Set([
  'at',
  'be',
  'bg',
  'hr',
  'cy',
  'cz',
  'dk',
  'ee',
  'fi',
  'fr',
  'gr',
  'hu',
  'ie',
  'it',
  'lv',
  'lt',
  'lu',
  'mt',
  'nl',
  'pl',
  'pt',
  'ro',
  'sk',
  'si',
  'es',
  'se',
  'eu',
]);
const DE_TLDS = new Set(['de', 'at', 'ch']);

const EU_COUNTRIES =
  /\b(?:Austria|Belgium|Bulgaria|Croatia|Cyprus|Czechia|Czech Republic|Denmark|Estonia|Finland|France|Greece|Hungary|Ireland|Italy|Latvia|Lithuania|Luxembourg|Malta|Netherlands|Poland|Portugal|Romania|Slovakia|Slovenia|Spain|Sweden)\b/;
const DE_COUNTRIES = /\b(?:Germany|Deutschland|Österreich|Schweiz|Switzerland)\b/;
const CANADA = /\b(?:Canada|Ontario|Quebec|Québec|British Columbia|Alberta|Manitoba|Nova Scotia)\b/;

const US_STATES =
  'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming';
const US_STATE_ABBR =
  'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';

/**
 * A quote that names a US state of incorporation, or a US postal address. "Inc." alone is not one.
 * "BasedAI, Inc., a Delaware company" names one: the state with "corporation", "LLC" and the like,
 * or "a <state> company".
 */
export function usEvidence(quote: string): boolean {
  const incorporated = new RegExp(
    `\\b(?:${US_STATES})\\s+(?:corporation|limited liability company|LLC|C-corp|C corporation|public benefit corporation|PBC)\\b|\\ban?\\s+(?:${US_STATES})\\s+company\\b|\\b(?:incorporated|organized|registered) (?:in|under the laws of)(?: the State of)? (?:${US_STATES})\\b`,
    'i',
  );
  const postal = new RegExp(`,\\s*(?:${US_STATE_ABBR})\\s+\\d{5}(?:-\\d{4})?\\b`);
  return incorporated.test(quote) || postal.test(quote);
}

/** A quote that shows a UK limited company: its registration, or a Companies House number. */
export function ukLtdEvidence(quote: string): boolean {
  return (
    /registered in (?:England and Wales|England & Wales|Scotland|Northern Ireland)/i.test(quote) ||
    /\bcompany (?:registration )?(?:number|no\.?)\s*:?\s*(?:SC|NI|OC)?\d{6,8}\b/i.test(quote) ||
    /\bCompanies House\b[^.]{0,40}\b(?:SC|NI|OC)?\d{6,8}\b/i.test(quote)
  );
}

/**
 * Code's overrides, applied after the scout's verified jurisdiction: the TLD first (`.de`, `.at` and
 * `.ch` are `de`, other EU country TLDs `eu`, `.ca` `other`), then an imprint page or a postal
 * address in the EU or Canada.
 */
export function jurisdictionOverride(
  domain: string,
  read: Pick<SiteRead, 'pages'>,
): Jurisdiction | null {
  const tld = (registrableDomain(domain) ?? domain).split('.').pop() ?? '';
  if (DE_TLDS.has(tld)) return 'de';
  if (EU_TLDS.has(tld)) return 'eu';
  if (tld === 'ca') return 'other';
  if (read.pages.some((page) => page.label === 'imprint page')) return 'de';
  // "Northern Ireland" is in the UK, so it must not read as Ireland.
  const text = read.pages
    .map((page) => page.parsed.text)
    .join('\n')
    .replace(/Northern Ireland/g, '');
  if (DE_COUNTRIES.test(text)) return 'de';
  if (EU_COUNTRIES.test(text)) return 'eu';
  if (CANADA.test(text)) return 'other';
  return null;
}

/** Code's own reading before the scout: the overrides, else `unknown`. */
export function jurisdictionHint(domain: string, read: Pick<SiteRead, 'pages'>): Jurisdiction {
  return jurisdictionOverride(domain, read) ?? 'unknown';
}
