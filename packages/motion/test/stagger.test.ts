import { describe, expect, it } from 'vitest';
import { staggerDelays } from '../src/core/stagger.ts';

describe('staggerDelays', () => {
  it('starts at 0 and steps by whole frames', () => {
    expect(staggerDelays(4, 30, { each: 0.1 })).toEqual([0, 3, 6, 9]);
  });

  it('narrows the gap so a long run fits its spread', () => {
    const delays = staggerDelays(40, 30, { each: 0.1, maxSpread: 0.5 });
    expect(delays.at(-1)).toBe(15);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(delays.every(Number.isInteger)).toBe(true);
  });

  it('returns nothing for nothing', () => {
    expect(staggerDelays(0, 30)).toEqual([]);
  });
});
