import { describe, expect, it } from 'vitest';
import { stem, unbackedWords, wordsOf } from '../src/researcher/words.ts';

describe('wordsOf', () => {
  it('reads words without case, accents, possessives or hyphens, and leaves figures out', () => {
    expect(wordsOf("Linear's purpose-built Café, 10x faster: $12per user/month")).toEqual([
      'linear',
      'purpose',
      'built',
      'cafe',
      'faster',
      'user',
      'month',
    ]);
  });
});

describe('stem', () => {
  it('sets the forms of one word side by side', () => {
    for (const [a, b] of [
      ['shipping', 'ship'],
      ['organizations', 'organization'],
      ['organisations', 'organizations'],
      ['planning', 'plan'],
      ['companies', 'company'],
      ['yearly', 'year'],
      ['billed', 'bill'],
      ['pricing', 'price'],
    ])
      expect(stem(a ?? ''), `${a} ~ ${b}`).toBe(stem(b ?? ''));
  });

  it('keeps different words apart', () => {
    expect(stem('online')).not.toBe(stem('one'));
    expect(stem('custom')).not.toBe(stem('customer'));
    expect(stem('number')).not.toBe(stem('numb'));
  });
});

describe('unbackedWords', () => {
  const home = [
    'The product development system for teams and agents',
    'Purpose-built for planning and building products. Designed for the AI era.',
  ];

  // The linear.app field test: "shipping" is in neither cited quote.
  it('finds the word no cited quote says', () => {
    expect(
      unbackedWords(
        'Linear is a product development system for planning, building and shipping products.',
        home,
        { names: ['Linear'] },
      ),
    ).toEqual(['shipping']);
  });

  it('passes a sentence built only from the quotes, the name and words that build it', () => {
    expect(
      unbackedWords(
        'Linear is the product development system for teams and agents, purpose-built for planning and building products.',
        home,
        { names: ['Linear'] },
      ),
    ).toEqual([]);
  });

  // cal.com: the brief swapped "the products built on it" for "organizations".
  it('refuses a word swapped in for the quote’s own', () => {
    expect(
      unbackedWords(
        'A scheduling platform for individuals, teams and organizations',
        ['the scheduling platform for individuals, teams and the products built on it'],
        {},
      ),
    ).toEqual(['organizations']);
  });

  it('leaves figures to the number check, and allows the words it is told to', () => {
    expect(unbackedWords('Ten seats for $12 per month', ['$12 per month'], {})).toEqual(['seats']);
    expect(
      unbackedWords('The pricing page lists $12 per month', ['$12 per month'], {
        allowed: ['pricing', 'page', 'lists'],
      }),
    ).toEqual([]);
  });

  it('reads two quote words written as one', () => {
    expect(unbackedWords('Signup is free', ['Sign up free'], {})).toEqual([]);
  });

  it('never lets a negation through', () => {
    expect(unbackedWords('No credit card required', ['Credit card required'], {})).toEqual(['no']);
  });
});
