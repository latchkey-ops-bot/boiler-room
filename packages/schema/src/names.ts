/**
 * Names in copy: customers, companies and products. Copy is written in sentence case (the director
 * skill forbids title case), so a capitalised word that does not start a sentence reads as a name,
 * and a name on screen must come from a claim the copy cites, like a number.
 */

/** Capitalised words that name no customer, company or product. */
const NOT_NAMES = new Set([
  'I',
  'AI',
  'API',
  'APIs',
  'SDK',
  'SDKs',
  'CLI',
  'UI',
  'UX',
  'SQL',
  'CSS',
  'HTML',
  'JS',
  'CI',
  'CD',
  'PR',
  'PRs',
  'MCP',
  'LLM',
  'LLMs',
  'SaaS',
  'B2B',
  'B2C',
  'CRM',
  'CRMs',
  'ERP',
  'HR',
  'IT',
  'QA',
  'OK',
  'ID',
  'IDs',
  'PDF',
  'CSV',
  'JSON',
  'URL',
  'URLs',
  'HTTP',
  'HTTPS',
  'DNS',
  'SEO',
  'KPI',
  'KPIs',
  'ROI',
  'CEO',
  'CTO',
  'CFO',
  'FAQ',
  'SLA',
  'SLAs',
  'SSO',
  'SAML',
  'GDPR',
  'SOC',
  'HIPAA',
  'US',
  'EU',
  'UK',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
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
]);

const WORD = /[\p{L}\p{N}][\p{L}\p{N}&.'’-]*/gu;
/** A sentence ends at one of these, followed by space. */
const SENTENCE_END = /[.!?:;…]\s+/u;

/** A word as a name: without a possessive or a closing dot, hyphen or apostrophe. */
const bare = (word: string) => word.replace(/['’]s$/u, '').replace(/[.'’-]+$/u, '');

/**
 * The names a piece of copy uses, in order: capitalised words that do not start a sentence and
 * are not common acronyms. A word that starts a sentence counts too when it is one of `known`,
 * such as a name a claim quote uses mid-sentence.
 */
export function namesIn(text: string, known: readonly string[] = []): string[] {
  const knownNames = new Set(known.map((name) => name.toLowerCase()));
  return text
    .normalize('NFKC')
    .split(SENTENCE_END)
    .flatMap((sentence) =>
      [...sentence.matchAll(WORD)].flatMap((match, index) => {
        const name = bare(match[0]);
        if (!/^\p{Lu}/u.test(name) || NOT_NAMES.has(name)) return [];
        return index > 0 || knownNames.has(name.toLowerCase()) ? [name] : [];
      }),
    );
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `text` holds `name` as a whole word, ignoring case. */
export function mentions(text: string, name: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'iu').test(
    text.normalize('NFKC'),
  );
}

export interface NameOptions {
  /** `brand.name`. Its words are the customer's own and never need a claim. */
  brandName: string;
  /** Names that count even at the start of a sentence, such as those the claim quotes use. */
  known?: readonly string[];
}

/** The names in `value` that none of `quotes` states, each once. */
export function namesNotQuoted(
  value: string,
  quotes: readonly string[],
  { brandName, known = [] }: NameOptions,
): string[] {
  const brand = new Set(
    [...brandName.normalize('NFKC').matchAll(WORD)].map((match) => bare(match[0]).toLowerCase()),
  );
  return [
    ...new Set(
      namesIn(value, known).filter(
        (name) =>
          !brand.has(name.toLowerCase()) &&
          !mentions(brandName, name) &&
          !quotes.some((quote) => mentions(quote, name)),
      ),
    ),
  ];
}
