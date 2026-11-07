import { describe, expect, it } from 'vitest';
import { extractNumericTokens, isBacked } from '../src/numbers.ts';

const backed = (text: string, quote: string) => {
  const tokens = extractNumericTokens(text);
  const quoteTokens = extractNumericTokens(quote);
  expect(tokens.length, `no number read from "${text}"`).toBeGreaterThan(0);
  return tokens.every((token) => isBacked(token, quoteTokens));
};
const kinds = (text: string) =>
  extractNumericTokens(text).map(({ kind, value, unit }) => ({ kind, value, unit }));

describe('extractNumericTokens', () => {
  it.each([
    ['plain', '42 teams', { kind: 'number', value: 42 }],
    ['grouped', '1,200 teams', { kind: 'number', value: 1200 }],
    ['decimal', '99.9', { kind: 'number', value: 99.9 }],
    ['leading dot', '.5', { kind: 'number', value: 0.5 }],
    ['thousands suffix', '12k teams', { kind: 'number', value: 12000 }],
    ['millions suffix', '1.2M users', { kind: 'number', value: 1200000 }],
    ['billions word', '2 billion rows', { kind: 'number', value: 2000000000 }],
    ['ordinal', '2nd', { kind: 'number', value: 2 }],
    ['percent sign', '40%', { kind: 'percent', value: 40 }],
    ['percent word', '40 percent', { kind: 'percent', value: 40 }],
    ['per cent', '40 per cent', { kind: 'percent', value: 40 }],
    ['multiplier', '3x', { kind: 'multiplier', value: 3 }],
    ['upper multiplier', '3X', { kind: 'multiplier', value: 3 }],
    ['sign multiplier', '3×', { kind: 'multiplier', value: 3 }],
    ['prefix multiplier', 'x10', { kind: 'multiplier', value: 10 }],
    ['spaced multiplier', '3 x faster', { kind: 'multiplier', value: 3 }],
    ['times word', '3 times', { kind: 'multiplier', value: 3 }],
    ['fold', '10-fold', { kind: 'multiplier', value: 10 }],
    ['dollars', '$29', { kind: 'money', value: 29, unit: 'USD' }],
    ['scaled dollars', '$1.2M', { kind: 'money', value: 1200000, unit: 'USD' }],
    ['spaced scale', '$1.2 million', { kind: 'money', value: 1200000, unit: 'USD' }],
    ['euros', '€20', { kind: 'money', value: 20, unit: 'EUR' }],
    ['pounds', '£20', { kind: 'money', value: 20, unit: 'GBP' }],
    ['currency code', 'USD 20', { kind: 'money', value: 20, unit: 'USD' }],
    ['currency word', '20 dollars', { kind: 'money', value: 20, unit: 'USD' }],
    ['rank', '#1', { kind: 'rank', value: 1 }],
    ['rank abbreviation', 'No. 1', { kind: 'rank', value: 1 }],
    ['rank word', 'number one', { kind: 'rank', value: 1 }],
    ['attached unit', '10ms', { kind: 'number', value: 10, unit: 'ms' }],
    ['spaced unit', '10 seconds', { kind: 'number', value: 10, unit: 's' }],
    ['hyphenated unit', '14-day trial', { kind: 'number', value: 14, unit: 'day' }],
    ['data unit', '2GB', { kind: 'number', value: 2, unit: 'gb' }],
  ])('reads %s', (_name, text, expected) => {
    expect(kinds(text)).toEqual([{ unit: undefined, ...expected }]);
  });

  it.each([
    ['ten', 'ten teams', { kind: 'number', value: 10 }],
    ['compound', 'twenty-five teams', { kind: 'number', value: 25 }],
    ['scale', 'three hundred teams', { kind: 'number', value: 300 }],
    ['big scale', 'two million users', { kind: 'number', value: 2000000 }],
    ['article scale', 'a million users', { kind: 'number', value: 1000000 }],
    ['one with scale', 'one hundred teams', { kind: 'number', value: 100 }],
    ['zero', 'zero downtime', { kind: 'number', value: 0 }],
    ['dozen', 'a dozen teams', { kind: 'number', value: 12 }],
    ['spelled multiplier', 'ten times faster', { kind: 'multiplier', value: 10 }],
    ['fold word', 'tenfold growth', { kind: 'multiplier', value: 10 }],
    ['twice', 'twice as fast', { kind: 'multiplier', value: 2 }],
    ['doubled', 'doubled output', { kind: 'multiplier', value: 2 }],
    ['tripled', 'tripled output', { kind: 'multiplier', value: 3 }],
    ['half', 'half the time', { kind: 'percent', value: 50 }],
    ['spelled percent', 'ten percent', { kind: 'percent', value: 10 }],
    ['spelled money', 'five dollars', { kind: 'money', value: 5, unit: 'USD' }],
    ['spelled unit', 'ten minutes', { kind: 'number', value: 10, unit: 'min' }],
    ['one before a time unit', 'deploy in one minute', { kind: 'number', value: 1, unit: 'min' }],
    [
      'one before a hyphenated unit',
      'a one-month trial',
      { kind: 'number', value: 1, unit: 'month' },
    ],
    ['one percent', 'one percent fees', { kind: 'percent', value: 1 }],
    ['one per cent', 'one per cent fees', { kind: 'percent', value: 1 }],
    ['one before a currency', 'just one dollar a day', { kind: 'money', value: 1, unit: 'USD' }],
    ['one times', 'one times faster', { kind: 'multiplier', value: 1 }],
    ['one inside a compound', 'twenty one minutes', { kind: 'number', value: 21, unit: 'min' }],
    ['an article before a currency', 'a dollar a day', { kind: 'money', value: 1, unit: 'USD' }],
    ['an article after in', 'live in an hour', { kind: 'number', value: 1, unit: 'h' }],
    ['an article after under', 'live in under an hour', { kind: 'number', value: 1, unit: 'h' }],
    ['an article after within', 'within a week', { kind: 'number', value: 1, unit: 'week' }],
    ['an article after than', 'less than a minute', { kind: 'number', value: 1, unit: 'min' }],
    ['halve', 'halve your CI bill', { kind: 'percent', value: 50 }],
    ['halved', 'halved your CI bill', { kind: 'percent', value: 50 }],
    ['thrice', 'thrice as fast', { kind: 'multiplier', value: 3 }],
    ['treble', 'treble your output', { kind: 'multiplier', value: 3 }],
    ['trebled', 'trebled output', { kind: 'multiplier', value: 3 }],
    ['quintupled', 'quintupled output', { kind: 'multiplier', value: 5 }],
    ['sextupled', 'sextupled output', { kind: 'multiplier', value: 6 }],
    ['an order of magnitude', 'an order of magnitude faster', { kind: 'multiplier', value: 10 }],
    ['counted orders', 'two orders of magnitude', { kind: 'multiplier', value: 100 }],
    ['uncounted orders', 'orders of magnitude faster', { kind: 'multiplier', value: 10 }],
    ['millionfold', 'a millionfold faster', { kind: 'multiplier', value: 1000000 }],
    ['billionfold', 'a billionfold faster', { kind: 'multiplier', value: 1000000000 }],
  ])('reads a spelled out number: %s', (_name, text, expected) => {
    expect(kinds(text)).toEqual([{ unit: undefined, ...expected }]);
  });

  it('reads vague magnitudes as numbers', () => {
    expect(extractNumericTokens('thousands of teams')).toHaveLength(1);
    expect(extractNumericTokens('millions of builds')).toHaveLength(1);
  });

  it('reads fractions', () => {
    expect(extractNumericTokens('a third of the cost').length).toBeGreaterThan(0);
    expect(extractNumericTokens('one quarter of the cost').length).toBeGreaterThan(0);
    expect(extractNumericTokens('½ the cost').length).toBeGreaterThan(0);
  });

  it.each([
    ['an eighth of the cost', 8],
    ['a fourth of the cost', 4],
    ['a sixth of the cost', 6],
    ['a seventh of the cost', 7],
    ['a ninth of the cost', 9],
    ['a twentieth of the cost', 20],
    ['a hundredth of the cost', 100],
    ['a thousandth of the cost', 1000],
  ])('reads the fraction in %s', (text, denominator) => {
    expect(kinds(text).map((token) => token.value)).toEqual([1, denominator]);
  });

  it.each([
    ['a spaced letter', '$5 M', { kind: 'money', value: 5000000, unit: 'USD' }],
    ['a spaced short scale', '$5 bn', { kind: 'money', value: 5000000000, unit: 'USD' }],
    ['a spaced thousand', '40 k teams', { kind: 'number', value: 40000 }],
    ['mil', '$5mil', { kind: 'money', value: 5000000, unit: 'USD' }],
    ['mln', '$5 mln', { kind: 'money', value: 5000000, unit: 'USD' }],
    ['bln', '$5bln', { kind: 'money', value: 5000000000, unit: 'USD' }],
    ['tn', '$5tn', { kind: 'money', value: 5000000000000, unit: 'USD' }],
    ['grand', '$5 grand', { kind: 'money', value: 5000, unit: 'USD' }],
    ['a hyphenated scale word', '$5-million', { kind: 'money', value: 5000000, unit: 'USD' }],
  ])('reads a scale: %s', (_name, text, expected) => {
    expect(kinds(text)).toEqual([{ unit: undefined, ...expected }]);
  });

  it.each([
    ['minutes', '10 minutes', { kind: 'number', value: 10, unit: 'min' }],
    ['a minutes alias', '10 min', { kind: 'number', value: 10, unit: 'min' }],
    ['a spaced data unit', '10 MB', { kind: 'number', value: 10, unit: 'mb' }],
    ['a plain noun', '10 teams', { kind: 'number', value: 10 }],
    ['a word that starts like a scale', '10 miles', { kind: 'number', value: 10 }],
  ])('does not read a scale from %s', (_name, text, expected) => {
    expect(kinds(text)).toEqual([{ unit: undefined, ...expected }]);
  });

  it.each([
    ['a hyphenated percent', '40-percent faster', { kind: 'percent', value: 40 }],
    ['a double spaced percent', '40  percent faster', { kind: 'percent', value: 40 }],
    ['a hyphenated per cent', '40-per-cent faster', { kind: 'percent', value: 40 }],
    ['hyphenated times', '40-times faster', { kind: 'multiplier', value: 40 }],
    ['a hyphenated x', '40-x faster', { kind: 'multiplier', value: 40 }],
    ['a double spaced x', '40  x faster', { kind: 'multiplier', value: 40 }],
    ['a factor', 'faster by a factor of 40', { kind: 'multiplier', value: 40 }],
    ['a spelled factor', 'a factor of ten', { kind: 'multiplier', value: 10 }],
  ])('reads a suffix: %s', (_name, text, expected) => {
    expect(kinds(text)).toEqual([{ unit: undefined, ...expected }]);
  });

  it.each([
    ['a trailing euro', '40€ per seat', 40, 'EUR'],
    ['a spaced trailing euro', '40 € per seat', 40, 'EUR'],
    ['a trailing dollar', '40$ a seat', 40, 'USD'],
    ['bucks', '40 bucks a seat', 40, 'USD'],
    ['cents', '99 cents a day', 99, 'cents'],
    ['CHF', 'CHF 40 per seat', 40, 'CHF'],
    ['a trailing CHF', '40 CHF per seat', 40, 'CHF'],
    ['CAD', 'CAD 40 per seat', 40, 'CAD'],
    ['AUD', 'AUD 40 per seat', 40, 'AUD'],
    ['CA$', 'CA$40 per seat', 40, 'CAD'],
    ['AU$', 'AU$40 per seat', 40, 'AUD'],
    ['NZ$', 'NZ$40 per seat', 40, 'NZD'],
    ['HK$', 'HK$40 per seat', 40, 'HKD'],
    ['S$', 'S$40 per seat', 40, 'SGD'],
    ['R$', 'R$40 per seat', 40, 'BRL'],
    ['the won sign', '₩5000 per seat', 5000, 'KRW'],
    ['the word won', '5000 won per seat', 5000, 'KRW'],
  ])('reads money: %s', (_name, text, value, unit) => {
    expect(kinds(text)).toEqual([{ kind: 'money', value, unit }]);
  });

  it('does not read a currency sign that opens the next amount', () => {
    expect(kinds('5 $10 coupons').map(({ kind, value }) => [kind, value])).toEqual([
      ['number', 5],
      ['money', 10],
    ]);
  });

  it.each([
    ['a multiplier', '5-10x faster', 'multiplier'],
    ['a percent', '5-10% cheaper', 'percent'],
    ['an en dash', '5–10% cheaper', 'percent'],
    ['the word to', '5 to 10x faster', 'multiplier'],
  ])('gives the lower bound of a range the kind of the upper bound: %s', (_name, text, kind) => {
    expect(kinds(text).map((token) => [token.kind, token.value])).toEqual([
      [kind, 5],
      [kind, 10],
    ]);
  });

  it('gives the lower bound of a range its unit', () => {
    expect(kinds('3-5 days')).toEqual([
      { kind: 'number', value: 3, unit: 'day' },
      { kind: 'number', value: 5, unit: 'day' },
    ]);
    expect(kinds('$5-$10')[0]).toEqual({ kind: 'money', value: 5, unit: 'USD' });
  });

  it('does not read a pair as a range', () => {
    expect(kinds('24/7').map((token) => token.kind)).toEqual(['number', 'number']);
    expect(kinds('5, 10x').map((token) => token.kind)).toEqual(['number', 'multiplier']);
    expect(kinds('5 teams to 10x').map((token) => token.kind)).toEqual(['number', 'multiplier']);
  });

  it('reads every number in a range or a pair', () => {
    expect(kinds('3-5 days').map((token) => token.value)).toEqual([3, 5]);
    expect(kinds('24/7').map((token) => token.value)).toEqual([24, 7]);
    expect(kinds('10,20 users').map((token) => token.value)).toEqual([10, 20]);
  });

  it('reads full width digits', () => {
    expect(kinds('４０％')).toEqual([{ kind: 'percent', value: 40, unit: undefined }]);
  });

  it.each([
    ['a digit inside a word', 'Web3 tooling'],
    ['a digit inside an acronym', 'B2B teams'],
    ['the word one', 'one click, the one tool, someone'],
    ['a one-time fee', 'a one-time fee'],
    ['an article with no preposition', 'a day to remember, an hour of focus'],
    ['words containing number words', 'often, weight, height, tone, behalf'],
    ['ordinary copy', 'Ship with Nova.'],
  ])('ignores %s', (_name, text) => {
    expect(extractNumericTokens(text)).toEqual([]);
  });
});

describe('isBacked', () => {
  it.each([
    ['the same number', '40% faster', 'cut build times by 40%'],
    ['a percent word against a sign', '40 percent faster', 'cut build times by 40%'],
    ['a multiplier sign against x', '3× more', 'deploy 3x more often'],
    ['a spelled multiplier', 'ten times faster', 'up to 10x faster'],
    ['twice against 2x', 'twice as fast', '2x faster'],
    ['grouped digits', '1200 teams', 'More than 1,200 teams'],
    ['a suffix against digits', '1.2K teams', 'More than 1,200 teams'],
    ['a scaled amount', '$1.2M saved', 'saved $1,200,000 last year'],
    ['a scale word', '$1.2M saved', 'saved $1.2 million last year'],
    ['a currency word', '$20', 'only 20 dollars'],
    ['trailing zeros', '2.50x', 'up to 2.5x'],
    ['a hyphenated unit', '14 days', 'a 14-day trial'],
    ['a unit alias', '10 min', 'in 10 minutes'],
    ['a bare number against a quote with a unit', '10', 'in 10 minutes'],
    ['a vague magnitude', 'thousands of teams', 'used by thousands of teams'],
    ['a spelled quote', '3 teams', 'three teams'],
    ['a rank', '#1', 'the number one tool'],
    ['a plus sign', '1,200+ teams', 'More than 1,200 teams'],
  ])('accepts %s', (_name, text, quote) => {
    expect(backed(text, quote)).toBe(true);
  });

  it.each([
    ['a number that is a substring of a larger one', '10 teams', 'used by 110 teams'],
    ['a percent that is a substring of a larger one', '5%', 'grew 15%'],
    ['a decimal with the same digits', '1.5x', 'up to 15x'],
    ['digits with the same prefix', '3x', 'up to 33x'],
    ['a percent against a count', '50% of teams', 'used by 50 teams'],
    ['a count against a percent', '50 teams', 'used by 50% of teams'],
    ['a multiplier against a count', '10x', 'used by 10 teams'],
    ['money against a count', '$20', 'used by 20 teams'],
    ['the wrong currency', '€20', 'only $20'],
    ['the wrong scale', '$1.2B', 'saved $1.2M'],
    ['a scaled amount against the bare number', '$5M', 'saved $5'],
    ['the wrong time unit', '10 seconds', 'in 10 minutes'],
    ['the wrong data unit', '10GB', 'up to 10MB'],
    ['a unit the quote does not state', '10 minutes', 'score of 10'],
    ['a number missing from the quote', '40% faster', 'dramatically faster builds'],
    ['a rank against a count', '#1', 'used by 1 team'],
    ['a vague magnitude against a specific number', 'thousands of teams', 'used by 2,000 teams'],
    ['a spaced scale word against the bare amount', '$5 bn saved', 'plans cost $5 per seat'],
    ['a spaced scale letter against the bare amount', '$5 M saved', 'plans cost $5 per seat'],
    ['an unknown scale against the bare amount', '$5mil saved', 'plans cost $5 per seat'],
    ['grand against the bare amount', '$5 grand saved', 'plans cost $5 per seat'],
    ['a spaced k against a count', '40 k teams', 'More than 40 teams ship with Nova.'],
    ['a hyphenated percent against a count', '40-percent faster', 'More than 40 teams'],
    ['hyphenated times against a count', '40-times faster', 'More than 40 teams'],
    ['a factor against a count', 'faster by a factor of 40', 'More than 40 teams'],
    ['a trailing currency against a count', '40€ per seat', 'More than 40 teams'],
    ['bucks against a count', '40 bucks a seat', 'More than 40 teams'],
    ['a currency code against a count', 'CHF 40 per seat', 'More than 40 teams'],
    ['a currency prefix against a count', 'CA$40 per seat', 'More than 40 teams'],
    ['a range bound against a count', '5-10x faster', '5 teams went 10x faster'],
    ['cents against dollars', '99 cents', 'only $99'],
  ])('rejects %s', (_name, text, quote) => {
    expect(backed(text, quote)).toBe(false);
  });
});
