import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as tokens from '../src/tokens.ts';

describe('tokens', () => {
  it('say they are provisional', () => {
    const source = readFileSync(new URL('../src/tokens.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/^\/\*\*\n \* PROVISIONAL/);
  });

  it('give every easing curve x values inside 0 to 1, as a cubic bezier requires', () => {
    for (const [x1, , x2] of Object.values(tokens.easing)) {
      for (const x of [x1, x2]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });

  it('order the durations from short to long', () => {
    const values = Object.values(tokens.duration);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('give every spring a positive config', () => {
    for (const config of Object.values(tokens.spring)) {
      expect(Math.min(config.damping, config.mass, config.stiffness)).toBeGreaterThan(0);
    }
  });
});
