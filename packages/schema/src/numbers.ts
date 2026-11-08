export type NumericKind = 'number' | 'percent' | 'multiplier' | 'money' | 'rank';

export interface NumericToken {
  /** The token as it reads after spelled out numbers become digits. */
  raw: string;
  kind: NumericKind;
  value: number;
  /** The currency for money, otherwise the unit, when the text states one. */
  unit: string | undefined;
  /** The word after the number, when that word is not its unit. */
  noun: string | undefined;
  /**
   * What a count counts: the words after the number (after "of" for "millions of") up to the
   * next function word such as "of", "with" or "the", at most five, in the singular. Empty for a
   * bare number.
   */
  nouns: string[];
  /** For a percent or multiplier, whether the word after it says more or less. */
  direction: Direction | undefined;
}

export type Direction = 'up' | 'down';

/**
 * `strict` is for copy, where an ambiguous word counts as a number so that nothing slips past the
 * gate. `literal` is for quotes, where the same reading would let "double-click" back "2x", so a
 * word counts only when it states the number outright.
 */
export type ReadMode = 'strict' | 'literal';

// "one" is left out on purpose: "one click" and "the one tool" are not statistics. It still counts
// inside a larger number, such as "one hundred" or "twenty one", and before a unit, such as
// "one minute".
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
  Object.entries({
    third: 3,
    quarter: 4,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    twentieth: 20,
    hundredth: 100,
    thousandth: 1000,
  }),
);

const SCALES = new Map(
  Object.entries({
    hundred: 100,
    k: 1e3,
    grand: 1e3,
    thousand: 1e3,
    m: 1e6,
    mm: 1e6,
    mn: 1e6,
    mil: 1e6,
    mln: 1e6,
    million: 1e6,
    b: 1e9,
    bn: 1e9,
    bln: 1e9,
    billion: 1e9,
    t: 1e12,
    tn: 1e12,
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
    buck: 'USD',
    bucks: 'USD',
    // Kept apart from the currency, because the word does not say which currency it divides.
    cent: 'cents',
    cents: 'cents',
    a$: 'AUD',
    au$: 'AUD',
    aud: 'AUD',
    c$: 'CAD',
    ca$: 'CAD',
    cad: 'CAD',
    chf: 'CHF',
    nz$: 'NZD',
    hk$: 'HKD',
    s$: 'SGD',
    r$: 'BRL',
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
    '₩': 'KRW',
    won: 'KRW',
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

/** Each stem takes the endings of "double": double, doubles, doubled, doubling. */
const MULTIPLE_STEMS = new Map(
  Object.entries({
    doubl: '2x',
    tripl: '3x',
    trebl: '3x',
    quadrupl: '4x',
    quintupl: '5x',
    sextupl: '6x',
    halv: '50%',
  }),
);

/** Marks "thousands of", which is a different statement from a specific 1,000. */
const VAGUE_UNIT = 'plural';

/** Shaped like a year, as a quote writes one. */
const YEAR = /^(?:19|20)\d\d$/;
const FOUR_DIGITS = /^\d{4}$/;

const CARDINAL = [...CARDINALS.keys()].join('|');
const MAGNITUDE = [...MAGNITUDES.keys()].join('|');
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}_])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])';
// "won" is left out, because "the one won" is a verb.
const CURRENCY_WORDS = [...CURRENCIES.keys()].filter((word) => /^(?!won$)[a-z]+$/.test(word));
const UNIT_WORDS = [...UNITS.keys()].filter((word) => word.length > 1);

const NUMBER_WORDS = new RegExp(
  `(?<!\\d[\\s-]?)\\b(?:(?:an?|one)[\\s-]+(?=(?:${MAGNITUDE})\\b))?(?:${CARDINAL}|${MAGNITUDE})\\b` +
    `(?:[\\s-]+(?:and[\\s-]+)?(?:one|${CARDINAL}|${MAGNITUDE})\\b)*`,
  'gi',
);

// A "third party" is not a fraction.
const FRACTION = new RegExp(
  `\\b(?:an?|one)[\\s-](${[...FRACTION_DENOMINATORS.keys()].join('|')})\\b(?![\\s-]+part(?:y|ies)\\b)`,
  'gi',
);

const ONE_BEFORE_UNIT = new RegExp(
  `\\bone(?=[\\s-]+(?:${[...UNIT_WORDS, ...CURRENCY_WORDS].join('|')}|per[\\s-]?cent|pct|times)\\b)`,
  'gi',
);
const AN_AMOUNT = /\ban?(?=\s+(?:dollar|euro|pound|buck)\b)/gi;
const AN_AMOUNT_OF_TIME =
  /\b(in|under|within|than)\s+an?(?=\s+(?:second|minute|hour|day|week|month|year)\b)/gi;
const COUNTED_ORDERS = /\b(?:(?:an?|one)\s+order|(\d+)\s+orders)\s+of\s+magnitude\b/gi;
const STEM = [...MULTIPLE_STEMS.keys()].join('|');
const MULTIPLES = new RegExp(`\\b(${STEM})(?:e[sd]?|ing)\\b`, 'gi');
// "double-click" and "triple A" are names, so the bare word counts only before what it multiplies.
const LITERAL_MULTIPLES = new RegExp(
  `(?<!-)\\b(${STEM})(?:e[sd]|ing|e(?=\\s+(?:the|your)\\b))\\b(?!-)`,
  'gi',
);
// "half the cost" and "cut in half" state 50%. "the first half of the year" and "half an hour" do not.
const LITERAL_HALF =
  /(?<!-)\b(?:half(?=\s+(?:the|as)\b)|(?<=\b(?:in|by)\s+)half(?!\s+an?\b))\b(?!-)/gi;

const TOKEN = new RegExp(
  `${NOT_WORD_BEFORE}(?<rank>#|no\\.\\s?)?` +
    '(?:(?<currency>us\\$|ca\\$|au\\$|nz\\$|hk\\$|a\\$|c\\$|s\\$|r\\$|\\$|€|£|¥|₹|₩|usd|eur|gbp|chf|cad|aud)\\s?)?' +
    '(?<prefix>[x×]\\s?)?' +
    '(?<digits>\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|\\.\\d+)' +
    `(?:(?:st|nd|rd|th)${NOT_WORD_AFTER})?` +
    `(?:[\\s-]*(?<scaleWord>hundred|thousand|million|billion|trillion|grand)\\b|\\s*(?<scaleLetter>k|mm|mn|mil|mln|m|bn|bln|b|tn|t)${NOT_WORD_AFTER})?` +
    '(?:\\s?(?<symbol>[$€£¥₹₩])(?![\\d.]))?' +
    `(?:[\\s-]*(?<suffix>%|per[\\s-]?cent\\b|pct\\b|[x×]${NOT_WORD_AFTER}|times\\b|fold\\b))?`,
  'giu',
);

/** Words that say a percent or multiplier is more, or less. Only these pairs are compared. */
const DIRECTIONS = new Map<string, Direction>([
  ...['more', 'greater', 'higher', 'larger', 'bigger', 'longer', 'faster', 'up', 'increase'].map(
    (word): [string, Direction] => [word, 'up'],
  ),
  ...['less', 'fewer', 'lower', 'smaller', 'shorter', 'slower', 'down', 'decrease', 'cheaper'].map(
    (word): [string, Direction] => [word, 'down'],
  ),
]);

/** Words skipped when reading what a count counts. */
const FUNCTION_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'and',
  'or',
  'to',
  'in',
  'on',
  'at',
  'for',
  'with',
  'by',
  'from',
  'per',
  'every',
  'each',
  'all',
  'our',
  'your',
  'their',
  'its',
  'this',
  'that',
  'these',
  'those',
  'more',
  'than',
  'over',
  'plus',
  'about',
  'around',
  'some',
]);

/** Different words for one thing, after the plural is taken off. */
const SAME_NOUN = new Map(
  Object.entries({
    people: 'person',
    client: 'customer',
    organization: 'organisation',
  }),
);

const singular = (word: string) => {
  const one = /ies$/.test(word)
    ? `${word.slice(0, -3)}y`
    : word.length > 3 && /[^su]s$/.test(word)
      ? word.slice(0, -1)
      : word;
  return SAME_NOUN.get(one) ?? one;
};

/** Up to six words straight after a number, before any punctuation. */
function wordsAfter(rest: string): string[] {
  const run = /^\+?((?:[\s-]+\p{L}[\p{L}'’]*){1,6})/u.exec(rest)?.[1] ?? '';
  return run
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

/** The phrase a count counts: content words up to the next function word, in the singular. */
function countedPhrase(words: readonly string[]): string[] {
  const start = words.findIndex((word) => !FUNCTION_WORDS.has(word));
  if (start < 0) return [];
  const end = words.findIndex((word, index) => index > start && FUNCTION_WORDS.has(word));
  return words
    .slice(start, end < 0 ? undefined : end)
    .slice(0, 5)
    .map(singular);
}

/** What may sit between the bounds of a range. */
const RANGE_GAP = /^\s*(?:-|–|—|to)\s*$/i;

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

function readMultiples(text: string, mode: ReadMode): string {
  const multiple = (_match: string, stem: string) => `${MULTIPLE_STEMS.get(stem.toLowerCase())}`;
  if (mode === 'literal') {
    return text
      .replace(/(?<!-)\btwice\b(?!-)/gi, '2x')
      .replace(/(?<!-)\bthrice\b(?!-)/gi, '3x')
      .replace(LITERAL_HALF, '50%')
      .replace(LITERAL_MULTIPLES, multiple);
  }
  return text
    .replace(/\borders?\s+of\s+magnitude\b/gi, '10x')
    .replace(/\btwice\b/gi, '2x')
    .replace(/\bthrice\b/gi, '3x')
    .replace(/\bhalf\b/gi, '50%')
    .replace(MULTIPLES, multiple);
}

function spelledToDigits(text: string, mode: ReadMode): string {
  const digits = text
    .normalize('NFKC')
    .replace(/\bnumber[\s-]one\b/gi, '#1')
    .replace(new RegExp(`\\b(${CARDINAL}|${MAGNITUDE})fold\\b`, 'gi'), '$1 fold')
    .replace(
      FRACTION,
      (_match, word: string) => `1/${FRACTION_DENOMINATORS.get(word.toLowerCase())}`,
    )
    .replace(new RegExp(`\\b(${MAGNITUDE})s\\b`, 'gi'), (_match, word: string) => {
      return `${MAGNITUDES.get(word.toLowerCase())}${VAGUE_UNIT}`;
    })
    .replace(NUMBER_WORDS, (phrase) => String(wordsToNumber(phrase)))
    .replace(ONE_BEFORE_UNIT, '1')
    .replace(AN_AMOUNT, '1')
    .replace(AN_AMOUNT_OF_TIME, '$1 1')
    .replace(/\b(?:a\s+)?factor\s+of\s+(?=\.?\d)/gi, 'x')
    .replace(COUNTED_ORDERS, (_match, count?: string) => `${10 ** Number(count ?? 1)}x`);
  return readMultiples(digits, mode);
}

interface TrailingWords {
  word: string;
  attached: boolean;
  /** The word after that one, which is the unit when `word` is an adjective. */
  next: string | undefined;
}

const TRAILING_WORDS =
  /^(?:(?<attached>\p{L}+)|\+?[\s-]+(?<spaced>\p{L}+))(?:\s+(?<next>\p{L}+))?/u;

function readTrailingWords(rest: string): TrailingWords | undefined {
  const { attached, spaced, next } = TRAILING_WORDS.exec(rest)?.groups ?? {};
  const word = (attached ?? spaced)?.toLowerCase();
  if (!word) return undefined;
  return { word, attached: attached !== undefined, next: next?.toLowerCase() };
}

function readUnit({ word, attached, next }: TrailingWords): string | undefined {
  if (attached) return UNITS.get(word) ?? word;
  return UNITS.get(word) ?? (next && UNITS.get(next));
}

/**
 * Finds every numeric statement in a piece of copy. Both the copy and a claim's quote go through
 * this, so they are compared as values and never as substrings: "10" is not backed by "110".
 */
export function extractNumericTokens(text: string, mode: ReadMode = 'strict'): NumericToken[] {
  const normalized = spelledToDigits(text, mode);
  const matches = [...normalized.matchAll(TOKEN)];
  const tokens = matches.map((match) => readToken(match, normalized));
  return tokens.map((token, index) => {
    const upper = tokens[index + 1];
    if (!upper || token.kind !== 'number' || token.unit !== undefined) return token;
    const [lowerMatch, upperMatch] = [matches[index], matches[index + 1]];
    const gap = normalized.slice(
      (lowerMatch?.index ?? 0) + (lowerMatch?.[0].length ?? 0),
      upperMatch?.index,
    );
    return RANGE_GAP.test(gap)
      ? {
          ...token,
          kind: upper.kind,
          unit: upper.unit,
          noun: upper.noun,
          nouns: upper.nouns,
          direction: upper.direction,
        }
      : token;
  });
}

function readToken(match: RegExpExecArray, normalized: string): NumericToken {
  const {
    rank,
    currency,
    prefix,
    digits = '',
    scaleWord,
    scaleLetter,
    symbol,
    suffix,
  } = match.groups ?? {};
  const scale = SCALES.get((scaleWord ?? scaleLetter ?? '').toLowerCase()) ?? 1;
  const value = Number((Number(digits.replaceAll(',', '')) * scale).toPrecision(12));
  const raw = match[0].trim();
  const rest = normalized.slice(match.index + match[0].length);
  const trailing = readTrailingWords(rest);
  const after = wordsAfter(rest);
  const direction = DIRECTIONS.get(after[0] ?? '');
  const read = {
    raw,
    value,
    unit: undefined,
    noun: trailing?.word,
    nouns: [],
    direction: undefined,
  };

  if (rank) return { ...read, kind: 'rank' };
  const moneySign = currency ?? symbol;
  if (moneySign) {
    return { ...read, kind: 'money', unit: CURRENCIES.get(moneySign.toLowerCase()) };
  }
  if (prefix || (suffix && /^(?:[x×]|times|fold)$/i.test(suffix))) {
    return { ...read, kind: 'multiplier', direction };
  }
  if (suffix) return { ...read, kind: 'percent', direction };

  const trailingCurrency = trailing && CURRENCIES.get(trailing.word);
  if (trailingCurrency) {
    return { ...read, kind: 'money', unit: trailingCurrency, noun: undefined };
  }
  const unit = trailing && readUnit(trailing);
  // "1000000plural of people": what a vague magnitude counts follows its "of".
  const counted = unit === VAGUE_UNIT ? wordsAfter(` ${rest.replace(/^\p{L}+/u, '')}`) : after;
  return {
    ...read,
    kind: 'number',
    unit,
    noun: unit === undefined ? trailing?.word : undefined,
    nouns: unit === undefined || unit === VAGUE_UNIT ? countedPhrase(counted) : [],
  };
}

/** True when the text is one number and nothing else, such as "1,200", "10K", "#1" or "Ten". */
export function isWholeNumber(text: string): boolean {
  const [token, ...others] = extractNumericTokens(text);
  if (!token || others.length > 0) return false;
  return !/[\p{L}\p{N}]/u.test(spelledToDigits(text, 'strict').replace(token.raw, ''));
}

const readsAsYear = ({ kind, unit, raw }: NumericToken) =>
  kind === 'number' && unit === undefined && YEAR.test(raw);

/**
 * True when copy counts what the quote counts: the first word of one phrase is in the other.
 * Either may qualify the noun, and a verb may follow it, so "50,000 teams use it" and "900+ third
 * party data sources" are backed by "50,000 product teams" and "900+ sources", while "50,000
 * paying customers" and "10,000 paying users" against "10,000 free users" are not. A bare number
 * counts anything the quote counts.
 */
function sameNoun(copy: NumericToken, quoted: NumericToken): boolean {
  const [first] = copy.nouns;
  const [quotedFirst] = quoted.nouns;
  if (first === undefined || quotedFirst === undefined) return true;
  return quoted.nouns.includes(first) || copy.nouns.includes(quotedFirst);
}

/**
 * True when the quote states this value. A number on its own may match a quote that adds a unit,
 * but a number with a noun may not: "10" is backed by "10 minutes", and "10 teams" is not. A
 * count must count what the quote counts, and a percent or multiplier may not turn the quote's
 * "less" into "more".
 */
export function isBacked(token: NumericToken, quoteTokens: readonly NumericToken[]): boolean {
  return quoteTokens.some((quoted) => {
    if (quoted.kind !== token.kind || quoted.value !== token.value) return false;
    if (readsAsYear(quoted) && !FOUR_DIGITS.test(token.raw)) return false;
    if (token.direction && quoted.direction && token.direction !== quoted.direction) return false;
    if (quoted.unit === VAGUE_UNIT) return token.unit === VAGUE_UNIT && sameNoun(token, quoted);
    if (token.unit !== undefined) return quoted.unit === token.unit;
    if (quoted.unit !== undefined) return token.noun === undefined;
    return token.kind !== 'number' || sameNoun(token, quoted);
  });
}
