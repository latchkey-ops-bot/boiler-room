export type NumericKind = 'number' | 'percent' | 'multiplier' | 'money' | 'rank';

export interface NumericToken {
  /** The token as it reads after spelled out numbers become digits. */
  raw: string;
  kind: NumericKind;
  value: number;
  /** The currency for money, otherwise the unit, when the text states one. */
  unit: string | undefined;
}

// "one" is left out on purpose: "one click" and "the one tool" are not statistics. It still counts
// inside a larger number, such as "one hundred" or "twenty one".
const CARDINALS = new Map(
  Object.entries({
    zero: 0,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  }),
);

const MAGNITUDES = new Map(
  Object.entries({
    dozen: 12,
    hundred: 100,
    thousand: 1e3,
    million: 1e6,
    billion: 1e9,
    trillion: 1e12,
  }),
);

const FRACTION_DENOMINATORS = new Map(
  Object.entries({ third: 3, quarter: 4, fifth: 5, tenth: 10 }),
);

const SCALES = new Map(
  Object.entries({
    hundred: 100,
    k: 1e3,
    thousand: 1e3,
    m: 1e6,
    mm: 1e6,
    mn: 1e6,
    million: 1e6,
    b: 1e9,
    bn: 1e9,
    billion: 1e9,
    t: 1e12,
    trillion: 1e12,
  }),
);

const CURRENCIES = new Map(
  Object.entries({
    $: 'USD',
    us$: 'USD',
    usd: 'USD',
    dollar: 'USD',
    dollars: 'USD',
    a$: 'AUD',
    c$: 'CAD',
    '€': 'EUR',
    eur: 'EUR',
    euro: 'EUR',
    euros: 'EUR',
    '£': 'GBP',
    gbp: 'GBP',
    pound: 'GBP',
    pounds: 'GBP',
    '¥': 'JPY',
    '₹': 'INR',
  }),
);

const UNITS = new Map(
  Object.entries({
    ms: 'ms',
    millisecond: 'ms',
    milliseconds: 'ms',
    s: 's',
    sec: 's',
    secs: 's',
    second: 's',
    seconds: 's',
    min: 'min',
    mins: 'min',
    minute: 'min',
    minutes: 'min',
    h: 'h',
    hr: 'h',
    hrs: 'h',
    hour: 'h',
    hours: 'h',
    d: 'day',
    day: 'day',
    days: 'day',
    week: 'week',
    weeks: 'week',
    month: 'month',
    months: 'month',
    yr: 'year',
    yrs: 'year',
    year: 'year',
    years: 'year',
    kb: 'kb',
    mb: 'mb',
    gb: 'gb',
    tb: 'tb',
    pb: 'pb',
  }),
);

/** Marks "thousands of", which is a different statement from a specific 1,000. */
const VAGUE_UNIT = 'plural';

const CARDINAL = [...CARDINALS.keys()].join('|');
const MAGNITUDE = [...MAGNITUDES.keys()].join('|');
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}_])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])';

const NUMBER_WORDS = new RegExp(
  `(?<!\\d[\\s-]?)\\b(?:(?:an?|one)[\\s-]+(?=(?:${MAGNITUDE})\\b))?(?:${CARDINAL}|${MAGNITUDE})\\b` +
    `(?:[\\s-]+(?:and[\\s-]+)?(?:one|${CARDINAL}|${MAGNITUDE})\\b)*`,
  'gi',
);

const TOKEN = new RegExp(
  `${NOT_WORD_BEFORE}(?<rank>#|no\\.\\s?)?` +
    '(?:(?<currency>us\\$|a\\$|c\\$|\\$|€|£|¥|₹|usd|eur|gbp)\\s?)?' +
    '(?<prefix>[x×]\\s?)?' +
    '(?<digits>\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|\\.\\d+)' +
    `(?:(?:st|nd|rd|th)${NOT_WORD_AFTER})?` +
    `(?:\\s?(?<scaleWord>hundred|thousand|million|billion|trillion)\\b|(?<scaleLetter>k|mm|mn|m|bn|b|t)${NOT_WORD_AFTER})?` +
    `(?:\\s?(?<suffix>%|per\\s?cent\\b|pct\\b|[x×]${NOT_WORD_AFTER}|times\\b|-?fold\\b))?`,
  'giu',
);

function wordsToNumber(phrase: string): number {
  let total = 0;
  let current = 0;
  for (const word of phrase.toLowerCase().split(/[\s-]+/)) {
    const magnitude = MAGNITUDES.get(word);
    if (magnitude === undefined) {
      current += word === 'one' ? 1 : (CARDINALS.get(word) ?? 0);
    } else if (magnitude < 1000) {
      current = (current || 1) * magnitude;
    } else {
      total += (current || 1) * magnitude;
      current = 0;
    }
  }
  return total + current;
}

function spelledToDigits(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\bnumber[\s-]one\b/gi, '#1')
    .replace(new RegExp(`\\b(${CARDINAL}|hundred|thousand)fold\\b`, 'gi'), '$1 fold')
    .replace(
      /\b(?:a|one)[\s-](third|quarter|fifth|tenth)\b/gi,
      (_match, word: string) => `1/${FRACTION_DENOMINATORS.get(word.toLowerCase())}`,
    )
    .replace(new RegExp(`\\b(${MAGNITUDE})s\\b`, 'gi'), (_match, word: string) => {
      return `${MAGNITUDES.get(word.toLowerCase())}${VAGUE_UNIT}`;
    })
    .replace(NUMBER_WORDS, (phrase) => String(wordsToNumber(phrase)))
    .replace(/\b(?:twice|doubl(?:e[sd]?|ing))\b/gi, '2x')
    .replace(/\btripl(?:e[sd]?|ing)\b/gi, '3x')
    .replace(/\bquadrupl(?:e[sd]?|ing)\b/gi, '4x')
    .replace(/\b(?:half|halv(?:e[sd]|ing))\b/gi, '50%');
}

function readTrailingWord(rest: string): { word: string; attached: boolean } | undefined {
  const attached = /^\p{L}+/u.exec(rest)?.[0];
  if (attached) return { word: attached.toLowerCase(), attached: true };
  const spaced = /^[\s-]+(\p{L}+)/u.exec(rest)?.[1];
  return spaced ? { word: spaced.toLowerCase(), attached: false } : undefined;
}

/**
 * Finds every numeric statement in a piece of copy. Both the copy and a claim's quote go through
 * this, so they are compared as values and never as substrings: "10" is not backed by "110".
 */
export function extractNumericTokens(text: string): NumericToken[] {
  const normalized = spelledToDigits(text);
  return [...normalized.matchAll(TOKEN)].map((match) => {
    const {
      rank,
      currency,
      prefix,
      digits = '',
      scaleWord,
      scaleLetter,
      suffix,
    } = match.groups ?? {};
    const scale = SCALES.get((scaleWord ?? scaleLetter ?? '').toLowerCase()) ?? 1;
    const value = Number((Number(digits.replaceAll(',', '')) * scale).toPrecision(12));
    const raw = match[0].trim();

    if (rank) return { raw, kind: 'rank', value, unit: undefined };
    if (currency) {
      return { raw, kind: 'money', value, unit: CURRENCIES.get(currency.toLowerCase()) };
    }
    if (prefix || (suffix && /^(?:[x×]|times|-?fold)$/i.test(suffix))) {
      return { raw, kind: 'multiplier', value, unit: undefined };
    }
    if (suffix) return { raw, kind: 'percent', value, unit: undefined };

    const trailing = readTrailingWord(normalized.slice(match.index + match[0].length));
    const trailingCurrency = trailing && CURRENCIES.get(trailing.word);
    if (trailingCurrency) return { raw, kind: 'money', value, unit: trailingCurrency };
    const unit =
      trailing && (UNITS.get(trailing.word) ?? (trailing.attached ? trailing.word : undefined));
    return { raw, kind: 'number', value, unit };
  });
}

/** True when the quote states this value. A bare number may match a quote that adds a unit. */
export function isBacked(token: NumericToken, quoteTokens: readonly NumericToken[]): boolean {
  return quoteTokens.some(
    (quoted) =>
      quoted.kind === token.kind &&
      quoted.value === token.value &&
      (token.unit === undefined || quoted.unit === token.unit),
  );
}
