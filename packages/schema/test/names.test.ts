import { describe, expect, it } from 'vitest';
import { namesIn, namesNotQuoted } from '../src/names.ts';

describe('namesIn', () => {
  it('reads capitalised words that do not start a sentence as names', () => {
    expect(namesIn('Used at Stripe, Notion and Figma.')).toEqual(['Stripe', 'Notion', 'Figma']);
    expect(namesIn('Deel, Vercel and Ramp book here.')).toEqual(['Vercel', 'Ramp']);
    expect(namesIn('Fast. Stripe next. Vercel: done')).toEqual([]);
  });

  it('strips possessives and closing dots, and keeps dotted names', () => {
    expect(namesIn("Built with Ramp's team and Cal.com.")).toEqual(['Ramp', 'Cal.com']);
  });

  it('skips common acronyms and the pronoun I', () => {
    expect(namesIn('Ship AI agents, APIs and PRs as I like')).toEqual([]);
    expect(namesIn('Trusted by IBM')).toEqual(['IBM']);
  });

  it('reads a sentence-initial word as a name when it is a known name', () => {
    expect(namesIn('Stripe uses it.', ['Stripe'])).toEqual(['Stripe']);
    expect(namesIn('Stripe uses it.')).toEqual([]);
  });
});

describe('namesNotQuoted', () => {
  const brandName = 'Plausible Analytics';
  it('passes names a cited quote states, and the brand', () => {
    expect(
      namesNotQuoted('Loved at Deel, by Plausible Analytics', ['Deel spends less time.'], {
        brandName,
      }),
    ).toEqual([]);
  });

  it('returns the names no cited quote states', () => {
    expect(
      namesNotQuoted('Deel, Vercel and Ramp book here.', ['Deel spends 35% less time.'], {
        brandName,
      }),
    ).toEqual(['Vercel', 'Ramp']);
    expect(namesNotQuoted('Used at Stripe and Notion.', [], { brandName })).toEqual([
      'Stripe',
      'Notion',
    ]);
  });

  it('matches a name as a whole word', () => {
    expect(namesNotQuoted('Run at Ramp', ['Rampant growth'], { brandName })).toEqual(['Ramp']);
  });
});
