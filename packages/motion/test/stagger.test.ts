import { describe, expect, it } from 'vitest';
import { staggerDelays } from '../src/core/stagger.ts';
import { activeStep, stepWindows } from '../src/core/steps.ts';

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

describe('stepWindows', () => {
  it('divides the frames evenly, leaving none over', () => {
    const steps = stepWindows(3, 10, 101);
    expect(steps[0]?.from).toBe(10);
    expect(steps.at(-1)?.to).toBe(101);
    for (const [index, step] of steps.entries()) {
      if (index > 0) expect(step.from).toBe(steps[index - 1]?.to);
    }
  });

  it('holds the first step before it starts and the last after it ends', () => {
    const steps = stepWindows(3, 10, 40);
    expect(activeStep(0, steps)).toBe(0);
    expect(activeStep(25, steps)).toBe(1);
    expect(activeStep(500, steps)).toBe(2);
  });
});
