import { extractNumericTokens } from '@boiler-room/schema';
import { normaliseWhitespace } from '../researcher/text.ts';
import { sha256 } from './domain.ts';
import type { SiteRead } from './site.ts';
import { verifyQuote } from './site.ts';
import type { CopyRow, LeadRow, Source } from './store.ts';
import { daysSince, weekdayOf } from './time.ts';

/**
 * Every word GTM puts in front of someone outside the company. Agents choose; code writes. The X
 * caption is template-only: `br-social` picks a template and a verified quote, and code fills it.
 * The email's subject and opener come from the GTM lead and pass the checks below; code writes the
 * body, the footer and every link.
 */

// ---------------------------------------------------------------------------------------------
// Quotes

export interface VerifiedQuote {
  /** `q1`, `q2`, ...: what an agent cites. */
  ref: string;
  page: string;
  url: string;
  /** The page's path: copy says "your homepage" only for `/`. */
  path: string;
  quote: string;
}

const SENTENCE_END = /[.!?]["'”’)]*$/;

/**
 * Why a quote cannot be used in GTM copy, or null. It must be `found` on its page (not in a
 * mockup, not missing), hold no digit (a plain fetch cannot tell a mockup's sample figures from a
 * claim), be at most 100 characters, and start and end at a block or sentence boundary, so
 * "HIPAA compliant" cut from "We are not HIPAA compliant" is refused.
 */
export function quoteProblem(
  read: Pick<SiteRead, 'bundle' | 'pages'>,
  pageId: string,
  quote: string,
): string | null {
  const needle = normaliseWhitespace(quote);
  if (!needle) return 'empty';
  if (needle.length > 100) return 'too_long';
  if (/\d/.test(needle)) return 'has_digit';
  if (/["“”<>]/.test(needle)) return 'has_quote_mark';
  const { verdict, page } = verifyQuote(read, pageId, needle);
  if (!page || verdict !== 'found') return `quote_${verdict}`;
  const blocks = page.parsed.text
    .split('\n')
    .map(normaliseWhitespace)
    .filter((block) => block !== '');
  for (const [number, block] of blocks.entries()) {
    let from = 0;
    for (;;) {
      const index = block.indexOf(needle, from);
      if (index < 0) break;
      const before = block.slice(0, index).trimEnd();
      const after = block.slice(index + needle.length);
      // A line break inside a sentence is no boundary: "No account, and no video" cut from "No
      // account, and no video / leaving your machine." says the opposite of the site.
      const startOk =
        index === 0 ? !continues(blocks[number - 1], needle) : SENTENCE_END.test(before);
      const endOk =
        after.trim() === ''
          ? SENTENCE_END.test(needle) || !continues(needle, blocks[number + 1])
          : SENTENCE_END.test(needle) || /^[.!?]/.test(after);
      if (startOk && endOk) return null;
      from = index + 1;
    }
  }
  return 'not_at_boundary';
}

/**
 * Whether `next` reads as the rest of a sentence `previous` left open: no end mark, then a lower-case
 * word. A first word with a capital inside it ("ivyNote", "iPhone") is a name that starts a sentence.
 */
function continues(previous: string | undefined, next: string | undefined): boolean {
  if (!previous || !next) return false;
  return (
    !/[.!?:;]["'”’)]*$/.test(previous) && /^\p{Ll}/u.test(next) && !/^\p{Ll}+\p{Lu}/u.test(next)
  );
}

// ---------------------------------------------------------------------------------------------
// Word lists

const SUPERLATIVES = [
  'best',
  'fastest',
  'first',
  'only',
  '#1',
  'number one',
  'leading',
  'better than',
  'greatest',
  'cheapest',
  'easiest',
  'ultimate',
  'revolutionary',
  'world-class',
  "world's",
  'top-rated',
  'unrivalled',
  'unmatched',
];

/** Claims about another company GTM never makes: funding, backers, customers, awards. */
const COMPANY_CLAIMS = [
  'funding',
  'funded',
  'raised',
  'raise',
  'raising',
  'backed',
  'series',
  'seed',
  'pre-seed',
  'yc',
  'y combinator',
  'investor',
  'investors',
  'customer',
  'customers',
  'user',
  'users',
  'client',
  'clients',
  'trusted',
  'partnered',
  'partner',
  'partners',
  'partnership',
  'award',
  'awards',
  'award-winning',
  'acquired',
  'valuation',
];

/** Openers that pretend to a relationship, or describe a film the lead cannot see. */
const PRETENCE = [
  /\bas discussed\b/i,
  /\bfollowing up\b/i,
  /\bfollow(?:ing)?-up\b/i,
  /\bper our\b/i,
  /\bour (?:call|chat|conversation|meeting)\b/i,
  /\bmet (?:you|at)\b/i,
  /\bgreat to (?:meet|see)\b/i,
  /\bas promised\b/i,
  /\byou asked\b/i,
  /\bopening shot\b/i,
  /\bopens with\b/i,
  /\bthe film (?:shows|features|uses|starts|opens|ends)\b/i,
  /\bin the film\b/i,
];

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const escapeRegex = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termIn = (text: string, term: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])`, 'iu').test(text);

/**
 * The claims screen for words that came from outside: superlatives and claims about a company. Every
 * lane runs it: on model-written lines, on the product name wherever one is accepted, and on the X
 * caption's quote. A verified quote may carry the startup's own superlative (`superlatives: false`),
 * never a claim about funding, backers, customers or partners.
 */
export function claimProblems(
  text: string,
  { superlatives = true, companyClaims = true } = {},
): string[] {
  const problems: string[] = [];
  if (superlatives)
    for (const term of SUPERLATIVES) if (termIn(text, term)) problems.push(`superlative:${term}`);
  if (companyClaims)
    for (const term of COMPANY_CLAIMS)
      if (termIn(text, term)) problems.push(`company_claim:${term}`);
  return problems;
}

const LINK = /https?:\/\/|www\./i;
const DOMAIN = /(?<![\p{L}\p{N}@])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?![\p{L}\p{N}])/iu;

/** Splits text into the parts outside quotation marks and the quoted spans. */
export function quotedSpans(text: string): { outside: string; quotes: string[] } {
  const quotes: string[] = [];
  const outside = text.replace(/["“]([^"“”]*)["”]/g, (_whole, inner: string) => {
    quotes.push(inner);
    return ' ';
  });
  return { outside, quotes };
}

/**
 * Every capitalised word outside the quotes must be the product name, "Boiler Room", a weekday,
 * a month, or the first word of a sentence. That keeps people's names, investors and other
 * companies out of lines a model wrote from untrusted text.
 */
export function strayCapitals(outside: string, productName: string): string[] {
  const allowed = new Set([...productName.split(/\s+/), 'Boiler', 'Room', ...WEEKDAYS, ...MONTHS]);
  const stray: string[] = [];
  const pattern = /[\p{Lu}][\p{L}\p{N}'’-]*/gu;
  for (const match of outside.matchAll(pattern)) {
    const word = match[0];
    const before = outside.slice(0, match.index).trimEnd();
    const sentenceStart = before === '' || /[.!?:]$/.test(before);
    if (allowed.has(word) || (sentenceStart && word !== word.toUpperCase())) continue;
    if (sentenceStart && word.length === 1) continue;
    stray.push(word);
  }
  return stray;
}

interface LineContext {
  productName: string;
  /** The lead's verified quotes. A quoted span must be one of them, exactly. */
  quotes: readonly VerifiedQuote[];
  /** People's names the executor knows, such as a launch post's author: never in a line. */
  blockedNames?: readonly string[];
}

/** Problems shared by every model-written line. */
function lineProblems(text: string, context: LineContext): string[] {
  const problems: string[] = [];
  const { outside, quotes } = quotedSpans(text);
  if (LINK.test(text) || DOMAIN.test(outside)) problems.push('link_or_domain');
  if (/@/.test(text)) problems.push('at_sign');
  if (/#/.test(text)) problems.push('hashtag');
  // No number at all: quotes with digits are refused, and a spelled-out figure is still a figure.
  if (/\d/.test(text) || extractNumericTokens(outside).length) problems.push('number');
  for (const quote of quotes) {
    const normal = normaliseWhitespace(quote);
    if (!context.quotes.some((item) => normaliseWhitespace(item.quote) === normal)) {
      problems.push('unverified_quote');
    }
  }
  problems.push(
    ...claimProblems(outside, { companyClaims: false }),
    ...claimProblems(text, { superlatives: false }),
  );
  for (const pattern of PRETENCE) if (pattern.test(text)) problems.push('pretence');
  const stray = strayCapitals(outside, context.productName);
  if (stray.length) problems.push(`capitalised:${stray.slice(0, 3).join(',')}`);
  const product = new Set(context.productName.toLowerCase().split(/\s+/));
  for (const name of context.blockedNames ?? []) {
    for (const part of name.split(/[^\p{L}]+/u).filter((item) => item.length >= 3)) {
      if (!product.has(part.toLowerCase()) && termIn(text, part)) problems.push('person_name');
    }
  }
  return [...new Set(problems)];
}

/** Checks an email subject: at most 60 characters, the product name, no digits, no `Re:`. */
export function subjectProblems(subject: string, context: LineContext): string[] {
  const problems = lineProblems(subject, context);
  if (subject.length > 60) problems.push('too_long');
  if (!subject.includes(context.productName)) problems.push('no_product_name');
  if (/\b(?:re|fwd?|fw|aw|wg)\s*:/i.test(subject)) problems.push('reply_prefix');
  if (/!/.test(subject)) problems.push('exclamation');
  const caps = subject
    .split(/[^\p{L}]+/u)
    .filter(
      (word) =>
        word.length >= 2 && word === word.toUpperCase() && !context.productName.includes(word),
    );
  if (caps.length) problems.push('all_caps');
  if (/["“”]/.test(subject)) problems.push('quote_in_subject');
  return problems;
}

/**
 * Checks an email opener: at most 240 characters, every quoted span verified, and "homepage"
 * only for a quote on `/`; otherwise the line says "your website".
 */
export function openerProblems(opener: string, context: LineContext): string[] {
  const problems = lineProblems(opener, context);
  if (opener.length > 240) problems.push('too_long');
  if (!opener.trim()) problems.push('empty');
  if (/\bhome\s?page\b/i.test(opener)) {
    const { quotes } = quotedSpans(opener);
    const onHome = quotes.every((quote) =>
      context.quotes.some(
        (item) =>
          normaliseWhitespace(item.quote) === normaliseWhitespace(quote) && item.path === '/',
      ),
    );
    if (!quotes.length || !onHome) problems.push('homepage_not_home');
  }
  return [...new Set(problems)];
}

// ---------------------------------------------------------------------------------------------
// What the source shows

/**
 * Only what the source shows, on the day it shows it: never "launched this week". A Product Hunt
 * feed date is the day the entry was featured, and "this week" stops being true on Monday.
 */
export function sourcePhrase(source: Source, sourceAt: string): string {
  if (source === 'hn') return `posted a Show HN on ${weekdayOf(sourceAt)}`;
  if (source === 'ph') return `was on Product Hunt on ${weekdayOf(sourceAt)}`;
  return `announced on X on ${weekdayOf(sourceAt)}`;
}

// ---------------------------------------------------------------------------------------------
// The X caption

export interface CaptionTemplate {
  id: string;
  /** `{product}`, `{source}` and, when `needsQuote`, `{quote}`. */
  text: string;
  needsQuote: boolean;
}

/** The founder approves these (the hash below); code never writes a caption outside them. */
export const CAPTION_TEMPLATES: readonly CaptionTemplate[] = [
  {
    id: 't1',
    text: '{product} {source}. Their website says: "{quote}" We made that public website into a short launch film.',
    needsQuote: true,
  },
  {
    id: 't2',
    text: '{product} {source}, so we made them a short launch film from their public website.',
    needsQuote: false,
  },
  {
    id: 't3',
    text: 'A short launch film for {product}, made from their public website. "{quote}"',
    needsQuote: true,
  },
  {
    id: 't4',
    text: 'We read the public website of {product}, which {source}, and turned it into a launch film.',
    needsQuote: false,
  },
  {
    id: 't5',
    text: '"{quote}" So says the public website of {product}, which {source}. Here is our launch film of it.',
    needsQuote: true,
  },
  {
    id: 't6',
    text: 'From a public website to a launch film: {product}, which {source}.',
    needsQuote: false,
  },
  {
    id: 't7',
    text: '{product} {source}. We gave their website the launch-film treatment. "{quote}"',
    needsQuote: true,
  },
  {
    id: 't8',
    text: 'Launch film of the day: {product}, which {source}. Made from their public website.',
    needsQuote: false,
  },
];

/** What the founder approves: a template set is live only while its hash is the approved one. */
export const templatesHash = () =>
  sha256(
    JSON.stringify(CAPTION_TEMPLATES.map(({ id, text, needsQuote }) => [id, text, needsQuote])),
  );

/** Every caption ends with this. Every template already says the film comes from a public website. */
export const captionLabel = (product: string) =>
  `Made by Boiler Room, not by ${product}. Removal on request: see our bio.`;

/** What Naive appends to a post with `ai_generated: true`. */
export const AI_LABEL = '\n\n#AIgenerated';
export const X_LIMIT = 280;

/** Words of the variable part: the product name and the quote. */
const variableWords = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2),
  );

/** The share of today's variable words already used in one earlier caption. */
export function overlap(today: string, earlier: string): number {
  const a = variableWords(today);
  const b = variableWords(earlier);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/** Templates not used on X in the last 7 days. */
export function freshTemplates(history: readonly CopyRow[], now: Date): CaptionTemplate[] {
  const recent = new Set(
    history
      .filter(
        (row) => row.lane === 'x' && row.template_id && daysSince(`${row.date}T12:00:00Z`, now) < 7,
      )
      .map((row) => row.template_id),
  );
  return CAPTION_TEMPLATES.filter((template) => !recent.has(template.id));
}

export interface CaptionInput {
  lead: Pick<LeadRow, 'id' | 'product_name' | 'source' | 'source_at'>;
  template_id: string;
  quote: VerifiedQuote | null;
  history: readonly CopyRow[];
  now: Date;
}

export type CaptionResult =
  | { ok: true; caption: string; variable: string; template_id: string }
  | { ok: false; problems: string[] };

/** Fills a template. Code alone writes the caption; every check runs on the result. */
export function buildCaption(input: CaptionInput): CaptionResult {
  const problems: string[] = [];
  const product = input.lead.product_name;
  if (!product) return { ok: false, problems: ['no_product_name'] };
  const template = CAPTION_TEMPLATES.find((item) => item.id === input.template_id);
  if (!template) return { ok: false, problems: ['unknown_template'] };
  if (!freshTemplates(input.history, input.now).some((item) => item.id === template.id)) {
    problems.push('template_used_in_7_days');
  }
  if (template.needsQuote && !input.quote) problems.push('template_needs_quote');
  const quote = template.needsQuote && input.quote ? normaliseWhitespace(input.quote.quote) : '';
  // A quote with no end mark, followed by more of the template, ends its sentence outside the
  // quotation marks, so the quote stays verbatim and the caption does not run on.
  const text = SENTENCE_END.test(quote)
    ? template.text
    : template.text.replace(/"\{quote\}"(?=\s+\S)/, '"{quote}".');
  const body = text
    .replaceAll('{product}', product)
    .replaceAll('{source}', sourcePhrase(input.lead.source, input.lead.source_at))
    .replaceAll('{quote}', quote);
  const caption = `${body}\n\n${captionLabel(product)}`;
  if (caption.length + AI_LABEL.length > X_LIMIT) problems.push('too_long');
  const { outside } = quotedSpans(body);
  if (LINK.test(caption) || DOMAIN.test(outside)) problems.push('link_or_domain');
  if (/@|#/.test(caption)) problems.push('at_or_hash');
  if (/\d/.test(caption)) problems.push('digit');
  // The same claims screen the email lines pass: the product name is outside any quote, so neither a
  // superlative nor a company claim; the quote may keep a superlative but no company claim.
  problems.push(...claimProblems(product), ...claimProblems(quote, { superlatives: false }));
  const variable = `${product} ${quote}`.trim();
  const since = input.history.filter(
    (row) => row.lane === 'x' && daysSince(`${row.date}T12:00:00Z`, input.now) < 30,
  );
  if (since.some((row) => overlap(variable, row.variable) >= 0.6)) problems.push('too_similar');
  if (problems.length) return { ok: false, problems };
  return { ok: true, caption, variable, template_id: template.id };
}

// ---------------------------------------------------------------------------------------------
// The cold email

export const FOOTER_LINES = {
  promo: (postal: string) => `This is a promotional email from Boiler Room, ${postal}.`,
  found: (address: string, label: string) =>
    label === 'website'
      ? `We found ${address} listed on your website.`
      : `We found ${address} on your website's ${label}.`,
  stop: (optOutUrl: string) =>
    `To stop all email from us, reply "unsubscribe" or open ${optOutUrl}.`,
  object:
    'You can object to our use of your details at any time, and we will delete the film and your address on request.',
} as const;

/** The fixed footer phrases, without their variable parts, for stripping our own text from replies. */
export const FOOTER_PHRASES = [
  'This is a promotional email from Boiler Room',
  'To stop all email from us, reply "unsubscribe" or open',
  FOOTER_LINES.object,
];

export interface EmailDraft {
  subject: string;
  text: string;
  headers: Record<string, string>;
  /** The only links in the text, in order. */
  links: string[];
}

export interface ComposeInput {
  lead: Pick<LeadRow, 'product_name' | 'source' | 'source_at'>;
  address: { address: string; page_label: string };
  subject: string;
  opener: string;
  filmPageUrl: string;
  /** From the film's file; null leaves the length out. */
  durationSeconds: number | null;
  optOutUrl: string;
  /** Null renders a placeholder that blocks every send. */
  postalAddress: string | null;
}

export const POSTAL_PLACEHOLDER = '[POSTAL ADDRESS NOT SET]';

/** Writes the whole email around the lead's two lines: body, film link, footer and headers. */
export function composeEmail(input: ComposeInput): EmailDraft {
  const product = input.lead.product_name ?? '';
  const length =
    input.durationSeconds !== null &&
    Number.isFinite(input.durationSeconds) &&
    input.durationSeconds > 0
      ? `a ${Math.round(input.durationSeconds)}-second launch film`
      : 'a short launch film';
  const text = [
    `Hi ${product} team,`,
    '',
    input.opener.trim(),
    '',
    `${product} ${sourcePhrase(input.lead.source, input.lead.source_at)}, so we turned your public website into ${length}. It's free, and you can watch and download it here:`,
    '',
    input.filmPageUrl,
    '',
    "If you'd like a different cut, reply and tell us.",
    '',
    'Boiler Room',
    '',
    '--',
    FOOTER_LINES.promo(input.postalAddress ?? POSTAL_PLACEHOLDER),
    FOOTER_LINES.found(input.address.address, input.address.page_label),
    FOOTER_LINES.stop(input.optOutUrl),
    FOOTER_LINES.object,
  ].join('\n');
  return {
    subject: input.subject.trim(),
    text,
    headers: {
      'List-Unsubscribe': `<${input.optOutUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    links: [input.filmPageUrl, input.optOutUrl],
  };
}

/** What a send needs from the finished email: exactly two links, a real postal address, the footer. */
export function emailProblems(draft: EmailDraft, postalAddress: string | null): string[] {
  const problems: string[] = [];
  const links = draft.text.match(/https?:\/\/[^\s]+/g) ?? [];
  const cleaned = links.map((link) => link.replace(/[.,]$/, ''));
  if (cleaned.length !== 2 || cleaned.some((link, index) => link !== draft.links[index])) {
    problems.push('links');
  }
  if (!postalAddress?.trim() || draft.text.includes(POSTAL_PLACEHOLDER))
    problems.push('no_postal_address');
  for (const phrase of FOOTER_PHRASES) if (!draft.text.includes(phrase)) problems.push('footer');
  if (!draft.headers['List-Unsubscribe']) problems.push('list_unsubscribe');
  return [...new Set(problems)];
}
