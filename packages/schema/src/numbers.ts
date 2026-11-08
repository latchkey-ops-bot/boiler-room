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
}

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

const SCALE_WORDS = [...SCALES.keys()].sort((a, b) => b.length - a.length).join('|');

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

const UNIT_OR_CURRENCY_WORDS = [...UNIT_WORDS, ...CURRENCY_WORDS]
  .sort((a, b) => b.length - a.length)
  .join('|');

/**
 * Text that, right after a number, changes what the number states: a percent sign, a multiplier,
 * a scale, a unit or a currency. "Nova 9" names a product, and "Nova 9%" or "Nova 9 times" does not.
 */
const STATES_MORE = new RegExp(
  `^[\\s-]*(?:%|per[\\s-]?cent\\b|percent\\b|pct\\b|[x×](?![\\p{L}\\p{N}])|times\\b|fold\\b|` +
    `(?:${SCALE_WORDS})(?![\\p{L}\\p{N}])|(?:${UNIT_OR_CURRENCY_WORDS})(?!\\p{L})|[$€£¥₹₩])`,
  'iu',
);
/** A sign before a number that makes it money or a rank, such as the "$" of "$3M". */
const MONEY_OR_RANK_BEFORE = /(?:[$€£¥₹₩#]|\bno\.)\s?$/iu;

/** True when the text after a number, `after`, or before it, `before`, would make it a statistic. */
export function changesNumber(before: string, after: string): boolean {
  return STATES_MORE.test(spelledToDigits(after, 'strict')) || MONEY_OR_RANK_BEFORE.test(before);
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

/** A decimal digit of any script but Latin. NFKC folds full width digits, and not these. */
const OTHER_DIGIT = /[^\P{Nd}0-9]/gu;
const IS_DIGIT = /\p{Nd}/u;

/**
 * A digit's value. Unicode encodes every script's decimal digits as runs of ten, 0 to 9, some runs
 * back to back, so the value is the distance from where the run starts, modulo ten.
 */
function digitValue(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  let start = code;
  while (start > 0 && IS_DIGIT.test(String.fromCodePoint(start - 1))) start -= 1;
  return (code - start) % 10;
}

/** Arabic's own percent sign and separators, which NFKC leaves as they are. */
const ARABIC_PUNCTUATION: Record<string, string> = { '٪': '%', '٫': '.', '٬': ',' };

/** Latin digits for every script's, so "٧٠٪" and "७०%" read as 70%. */
const latinDigits = (text: string) =>
  text
    .replace(OTHER_DIGIT, (char) => String(digitValue(char)))
    .replace(/[٪٫٬]/g, (char) => ARABIC_PUNCTUATION[char] ?? char);

const SIGNS = '[$€£¥₹₩#]';
const STATEMENT_SUFFIX = `\\s?(?:${SCALE_WORDS})?\\s?(?:%|per[\\s-]?cent\\b|pct\\b|[x×](?![\\p{L}\\p{N}])|times\\b|fold\\b)`;
/**
 * A number glued to the letter before it, where it reads as a percentage, a multiplier, money or
 * a rank: "by40%", "l0x", "Get$50", "Rated#1". A space is put before it, so it is read. A plain
 * number glued to letters, as in "Web3" or "B2B", is still part of a name.
 */
// Not inside a prefixed dollar sign, such as the "CA" of "CA$10", which is its own currency.
const NOT_DOLLAR_PREFIX = '(?!(?<=(?<![\\p{L}\\p{N}_])(?:us|ca|au|nz|hk|a|c|s|r))\\$)';
const GLUED_STATEMENT = new RegExp(
  `(?<=\\p{L})${NOT_DOLLAR_PREFIX}(?:(?=(?:${SIGNS}\\s?)?\\.?\\d[\\d,]*(?:\\.\\d+)?${STATEMENT_SUFFIX})|(?=${SIGNS}\\s?\\.?\\d))`,
  'giu',
);

function spelledToDigits(text: string, mode: ReadMode): string {
  const digits = latinDigits(text.normalize('NFKC'))
    .replace(GLUED_STATEMENT, ' ')
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
      ? { ...token, kind: upper.kind, unit: upper.unit, noun: upper.noun }
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
  const trailing = readTrailingWords(normalized.slice(match.index + match[0].length));
  const read = { raw, value, unit: undefined, noun: trailing?.word };

  if (rank) return { ...read, kind: 'rank' };
  const moneySign = currency ?? symbol;
  if (moneySign) {
    return { ...read, kind: 'money', unit: CURRENCIES.get(moneySign.toLowerCase()) };
  }
  if (prefix || (suffix && /^(?:[x×]|times|fold)$/i.test(suffix))) {
    return { ...read, kind: 'multiplier' };
  }
  if (suffix) return { ...read, kind: 'percent' };

  const trailingCurrency = trailing && CURRENCIES.get(trailing.word);
  if (trailingCurrency) {
    return { ...read, kind: 'money', unit: trailingCurrency, noun: undefined };
  }
  const unit = trailing && readUnit(trailing);
  return { ...read, kind: 'number', unit, noun: unit === undefined ? trailing?.word : undefined };
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
 * True when the quote states this value. A number on its own may match a quote that adds a unit,
 * but a number with a noun may not: "10" is backed by "10 minutes", and "10 teams" is not.
 */
export function isBacked(token: NumericToken, quoteTokens: readonly NumericToken[]): boolean {
  return quoteTokens.some((quoted) => {
    if (quoted.kind !== token.kind || quoted.value !== token.value) return false;
    if (readsAsYear(quoted) && !FOUR_DIGITS.test(token.raw)) return false;
    if (quoted.unit === VAGUE_UNIT) return token.unit === VAGUE_UNIT;
    if (token.unit !== undefined) return quoted.unit === token.unit;
    return quoted.unit === undefined || token.noun === undefined;
  });
}
