import { describe, expect, it } from 'vitest';
import { compareFrames, type Difference } from '../src/compare.ts';
import { judgeSeam } from '../src/verify.ts';

const frame = (width: number, height: number, fill: (index: number) => number) => {
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data[pixel * 4] = fill(pixel);
    data[pixel * 4 + 1] = fill(pixel);
    data[pixel * 4 + 2] = fill(pixel);
    data[pixel * 4 + 3] = 255;
  }
  return { width, height, data };
};

describe('compareFrames', () => {
  it('calls equal frames identical, with no noise', () => {
    const a = frame(4, 4, (index) => index * 10);
    const difference = compareFrames(
      a,
      frame(4, 4, (index) => index * 10),
    );
    expect(difference).toEqual({
      meanAbs: 0,
      maxDelta: 0,
      psnr: Number.POSITIVE_INFINITY,
      identical: true,
    });
  });

  it('measures a uniform difference of one level as 48.13 dB', () => {
    const difference = compareFrames(
      frame(8, 8, () => 100),
      frame(8, 8, () => 101),
    );
    expect(difference.meanAbs).toBe(1);
    expect(difference.maxDelta).toBe(1);
    expect(difference.psnr).toBeCloseTo(20 * Math.log10(255), 9);
    expect(difference.identical).toBe(false);
  });

  it('ignores alpha, which a film does not have', () => {
    const a = frame(2, 2, () => 50);
    const b = frame(2, 2, () => 50);
    b.data[3] = 0;
    expect(compareFrames(a, b).identical).toBe(true);
  });

  it('refuses frames of different sizes', () => {
    expect(() =>
      compareFrames(
        frame(2, 2, () => 0),
        frame(2, 3, () => 0),
      ),
    ).toThrow(RangeError);
  });
});

const db = (psnr: number): Difference => ({
  meanAbs: 0,
  maxDelta: 0,
  psnr,
  identical: psnr === Number.POSITIVE_INFINITY,
});

const seam = { index: 0, before: 149, after: 150 };

describe('judgeSeam', () => {
  it('passes a seam whose frames match their own frames of the full render', () => {
    const verdict = judgeSeam(
      {
        seam,
        before: db(47.6),
        after: db(48.2),
        beforeAgainstAfter: db(35.3),
        afterAgainstBefore: db(35.3),
        motion: db(35.5),
      },
      44.7,
    );
    expect(verdict).toMatchObject({ aligned: true, withinBar: true, ok: true });
  });

  it('fails a seam that repeats a frame: the first frame of the chunk is its neighbour', () => {
    // Frame 150 shows what frame 149 should, so it is closer to 149 of the full render.
    const verdict = judgeSeam(
      {
        seam,
        before: db(47.6),
        after: db(35.3),
        beforeAgainstAfter: db(35.3),
        afterAgainstBefore: db(47.9),
        motion: db(35.5),
      },
      30,
    );
    expect(verdict).toMatchObject({ aligned: false, ok: false });
  });

  it('fails a seam frame that is further from the full render than the interior frames allow', () => {
    const verdict = judgeSeam(
      {
        seam,
        before: db(47.6),
        after: db(39.0),
        beforeAgainstAfter: db(30),
        afterAgainstBefore: db(30),
        motion: db(30),
      },
      44.7,
    );
    expect(verdict).toMatchObject({ aligned: true, withinBar: false, ok: false });
  });

  it('does not ask for alignment where the picture does not move across the seam', () => {
    // A held frame: a repeat would be invisible, and the cross comparisons cannot tell.
    const verdict = judgeSeam(
      {
        seam,
        before: db(52),
        after: db(52),
        beforeAgainstAfter: db(53),
        afterAgainstBefore: db(53),
        motion: db(60),
      },
      44.7,
    );
    expect(verdict).toMatchObject({ aligned: true, ok: true });
  });

  it('passes frames identical to the full render', () => {
    const verdict = judgeSeam(
      {
        seam,
        before: db(Number.POSITIVE_INFINITY),
        after: db(Number.POSITIVE_INFINITY),
        beforeAgainstAfter: db(30),
        afterAgainstBefore: db(30),
        motion: db(30),
      },
      44.7,
    );
    expect(verdict.ok).toBe(true);
  });
});
