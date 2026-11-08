import { describe, expect, it } from 'vitest';
import { interiorPair, seamsOf, splitFrames } from '../src/chunks.ts';
import { framesToCompare } from '../src/verify.ts';

describe('splitFrames', () => {
  it('splits evenly when the frames divide', () => {
    const plan = splitFrames(600, 4);
    expect(plan.framesPerChunk).toBe(150);
    expect(plan.chunks.map(({ frameRange }) => frameRange)).toEqual([
      [0, 149],
      [150, 299],
      [300, 449],
      [450, 599],
    ]);
  });

  it('rounds the chunk length up, so only the last chunk is shorter', () => {
    const plan = splitFrames(601, 4);
    expect(plan.framesPerChunk).toBe(151);
    expect(plan.chunks.map(({ frames }) => frames)).toEqual([151, 151, 151, 148]);
    expect(plan.chunks.at(-1)?.frameRange).toEqual([453, 600]);
  });

  it('gives back fewer chunks than workers rather than an empty one', () => {
    // ceil(10 / 6) = 2 frames a chunk, and five chunks of two use every frame.
    const plan = splitFrames(10, 6);
    expect(plan.framesPerChunk).toBe(2);
    expect(plan.chunks).toHaveLength(5);
    expect(plan.chunks.every(({ frames }) => frames === 2)).toBe(true);
  });

  it('never makes more chunks than frames', () => {
    const plan = splitFrames(3, 8);
    expect(plan.framesPerChunk).toBe(1);
    expect(plan.chunks.map(({ frameRange }) => frameRange)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it('renders a film on one worker as one chunk', () => {
    expect(splitFrames(432, 1)).toEqual({
      framesPerChunk: 432,
      chunks: [{ index: 0, frameRange: [0, 431], frames: 432 }],
    });
  });

  it('covers every frame exactly once, in order, for any length and worker count', () => {
    for (let duration = 1; duration <= 130; duration += 1) {
      for (let workers = 1; workers <= 12; workers += 1) {
        const { framesPerChunk, chunks } = splitFrames(duration, workers);
        expect(chunks.length).toBeLessThanOrEqual(workers);
        let next = 0;
        for (const [index, chunk] of chunks.entries()) {
          expect(chunk.index).toBe(index);
          expect(chunk.frameRange[0]).toBe(next);
          expect(chunk.frames).toBe(chunk.frameRange[1] - chunk.frameRange[0] + 1);
          expect(chunk.frames).toBeGreaterThan(0);
          // Remotion's rule: every chunk is framesPerChunk long, except the last.
          if (index < chunks.length - 1) expect(chunk.frames).toBe(framesPerChunk);
          else expect(chunk.frames).toBeLessThanOrEqual(framesPerChunk);
          next = chunk.frameRange[1] + 1;
        }
        expect(next).toBe(duration);
      }
    }
  });

  it('refuses a length or worker count that is not a whole number of at least 1', () => {
    expect(() => splitFrames(0, 4)).toThrow(RangeError);
    expect(() => splitFrames(600, 0)).toThrow(RangeError);
    expect(() => splitFrames(600.5, 4)).toThrow(RangeError);
    expect(() => splitFrames(600, Number.NaN)).toThrow(RangeError);
  });
});

describe('seamsOf', () => {
  it('names the last frame of each chunk and the first of the next', () => {
    expect(seamsOf(splitFrames(600, 4))).toEqual([
      { index: 0, before: 149, after: 150 },
      { index: 1, before: 299, after: 300 },
      { index: 2, before: 449, after: 450 },
    ]);
  });

  it('puts the seam after the short chunk where the last one is short', () => {
    expect(seamsOf(splitFrames(432, 5))).toEqual([
      { index: 0, before: 86, after: 87 },
      { index: 1, before: 173, after: 174 },
      { index: 2, before: 260, after: 261 },
      { index: 3, before: 347, after: 348 },
    ]);
  });

  it('has no seam for a single chunk', () => {
    expect(seamsOf(splitFrames(600, 1))).toEqual([]);
  });

  it('always pairs neighbouring frames', () => {
    for (const workers of [2, 3, 7, 16]) {
      for (const seam of seamsOf(splitFrames(1000, workers))) {
        expect(seam.after).toBe(seam.before + 1);
      }
    }
  });
});

describe('interiorPair', () => {
  it('picks two neighbouring frames in the middle of a chunk', () => {
    expect(interiorPair({ index: 1, frameRange: [150, 299], frames: 150 })).toEqual([224, 225]);
    expect(interiorPair({ index: 0, frameRange: [0, 1], frames: 2 })).toEqual([0, 1]);
  });

  it('keeps clear of the chunk edges, where the seams are', () => {
    for (const chunk of splitFrames(600, 4).chunks) {
      const [first, second] = interiorPair(chunk) as [number, number];
      expect(first).toBeGreaterThan(chunk.frameRange[0]);
      expect(second).toBeLessThan(chunk.frameRange[1]);
    }
  });

  it('has no pair in a chunk of one frame', () => {
    expect(interiorPair({ index: 0, frameRange: [5, 5], frames: 1 })).toBeUndefined();
  });
});

describe('framesToCompare', () => {
  it('reads both sides of every seam and an interior pair of every chunk, once each', () => {
    expect(framesToCompare(splitFrames(600, 4))).toEqual([
      74, 75, 149, 150, 224, 225, 299, 300, 374, 375, 449, 450, 524, 525,
    ]);
  });

  it('reads a frame that is both a seam side and an interior frame once', () => {
    // Chunks of two frames: each chunk's interior pair is its two seam sides.
    expect(framesToCompare(splitFrames(6, 3))).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
