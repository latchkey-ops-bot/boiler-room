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
  ])('rejects %s', (_name, text, quote) => {
    expect(backed(text, quote)).toBe(false);
  });
});
