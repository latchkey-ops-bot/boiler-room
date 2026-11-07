import { describe, expect, it } from 'vitest';
import { framesWorthSeeing, sampleFrames, shuffled } from '../scripts/sampling.ts';

describe('render script helpers', () => {
  it('shuffles the same way for the same seed, and keeps every item', () => {
    const items = Array.from({ length: 20 }, (_, index) => index);
    const once = shuffled(items, 7);
    expect(shuffled(items, 7)).toEqual(once);
    expect(once).not.toEqual(items);
    expect([...once].sort((a, b) => a - b)).toEqual(items);
  });

  it('samples the first and last frame and frames between', () => {
    const frames = sampleFrames(600, 12);
    expect(frames[0]).toBe(0);
    expect(frames.at(-1)).toBe(599);
    expect(frames.length).toBe(14);
  });

  it('picks a settled frame for each scene and its boundary', () => {
    const frames = framesWorthSeeing({
      durationInFrames: 200,
      scenes: [
        { span: { id: 'a', from: 0, durationInFrames: 100 } },
        { span: { id: 'b', from: 100, durationInFrames: 100 } },
      ],
    });
    expect(frames).toEqual([
      { label: 'a-settled', frame: 62 },
      { label: 'b-boundary', frame: 100 },
      { label: 'b-settled', frame: 162 },
      { label: 'last', frame: 199 },
    ]);
  });
});
