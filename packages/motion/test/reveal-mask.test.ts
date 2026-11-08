import { describe, expect, it } from 'vitest';
import { REVEAL_TRAVEL, revealMask } from '../src/components/text.tsx';

const bottomOf = (mask: string | undefined) => Number(/(-?[\d.]+)% -12%\)$/.exec(mask ?? '')?.[1]);

describe('revealMask', () => {
  it('hides a word that has not started to rise', () => {
    // The mask reaches this far below the word's box, and the word starts further down than that.
    expect(100 - bottomOf(revealMask(0))).toBeLessThan(REVEAL_TRAVEL);
  });

  it('sinks its lower edge as the word lands, so nothing is revealed early and nothing pops', () => {
    const bottoms = [0, 0.25, 0.5, 0.75, 0.99].map((landed) => -bottomOf(revealMask(landed)));
    expect(bottoms).toEqual([...bottoms].sort((a, b) => a - b));
  });

  it('leaves room below a landed word for deep descenders, such as the dots under Arabic yeh', () => {
    expect(-bottomOf(revealMask(0.99))).toBeGreaterThanOrEqual(55);
  });

  it('is gone once the word is still, so no glyph is ever cut in a settled frame', () => {
    expect(revealMask(0.9995)).toBeUndefined();
    expect(revealMask(1)).toBeUndefined();
  });
});
