import { describe, expect, it } from 'vitest';
import { oklchLightness, skinOf } from '../src/brand/skin.ts';
import {
  blink,
  filmFrames,
  framesBefore,
  inOutAt,
  liftAt,
  morphBox,
  outTravel,
  type Seam,
  seamBetween,
  seamIn,
  seamOut,
  secondLinePush,
  wordGapGain,
} from '../src/core/curves.ts';
import { groundAt, groundClock } from '../src/film/stage.tsx';
import { inOut } from '../src/tokens.ts';

const frames = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);
/** Speed on each frame: how far the value moved since the frame before. */
const speeds = (value: (f: number) => number, from: number, to: number) =>
  frames(from, to).map((f) => value(f) - value(f - 1));

/** A curve is pure when it gives the same values whatever order its frames are asked in. */
function expectPure(value: (f: number) => unknown, from = -20, to = 60) {
  const inOrder = frames(from, to).map(value);
  const backwards = frames(from, to).reverse().map(value).reverse();
  const scattered = frames(from, to)
    .map((f, index) => ({ f, key: (index * 7919) % 101 }))
    .sort((a, b) => a.key - b.key)
    .map(({ f }) => ({ f, v: value(f) }))
    .sort((a, b) => a.f - b.f)
    .map(({ v }) => v);
  expect(backwards).toEqual(inOrder);
  expect(scattered).toEqual(inOrder);
}

const seam = (axis: Seam['axis'], k: number, vPeak = 46): Seam => ({
  axis,
  sign: 1,
  vPeak,
  n: 11,
  r: 1.4,
  k,
  D: 14,
});

describe('T1 seam curves', () => {
  it('arrive at the measured speeds: 46, 33, 24, 17, 12, 9 at k 0.72', () => {
    const s = seam('y', 0.72);
    const measured = speeds((f) => seamIn(f, s), 1, 6).map(Math.abs);
    expect(measured.map(Math.round)).toEqual([46, 33, 24, 17, 12, 9]);
    // Each step is the measured one scaled by 1 / (1 - k ** D), 1.01 at D 14.
    expect(measured[0]).toBeCloseTo(46 / (1 - 0.72 ** 14), 10);
  });

  it('arrive at 46, 32, 23, 16, 11, 8 at k 0.70, the lateral override', () => {
    const s = seam('x', 0.7);
    expect(speeds((f) => seamIn(f, s), 1, 6).map((v) => Math.round(Math.abs(v)))).toEqual([
      46, 32, 23, 16, 11, 8,
    ]);
  });

  it('settle exactly on frame D, and start displaced against the sign', () => {
    for (const k of [0.7, 0.72]) {
      const s = seam('x', k);
      expect(seamIn(14, s)).toBe(0);
      expect(seamIn(40, s)).toBe(0);
      expect(seamIn(13, s)).toBeLessThan(0);
      expect(seamIn(0, s)).toBeLessThan(-100);
      expect(seamIn(0, { ...s, sign: -1 })).toBeGreaterThan(100);
    }
  });

  it('leave from rest and hit the cut at peak speed: vPeak on the last outgoing frame', () => {
    const s = seam('x', 0.7);
    expect(seamOut(-12, s)).toBe(0);
    expect(seamOut(-30, s)).toBe(0);
    expect(seamOut(-1, s)).toBeCloseTo(outTravel(s), 10);
    expect(seamOut(-1, s) - seamOut(-2, s)).toBeCloseTo(46, 10);
    // Each outgoing step is 1.4 times the one before.
    const out = speeds((f) => seamOut(f, s), -10, -1);
    for (let index = 1; index < out.length; index += 1) {
      expect((out[index] as number) / (out[index - 1] as number)).toBeCloseTo(1.4, 10);
    }
  });

  it('read as one curve: the speed into the cut is the speed out of it, the same way', () => {
    for (const axis of ['x', 'y'] as const) {
      const s = seamBetween({ axis, sign: 1, v: 46 }, { v: 46 });
      const outSpeed = seamOut(-1, s) - seamOut(-2, s);
      const inSpeed = seamIn(1, s) - seamIn(0, s);
      expect(Math.sign(outSpeed)).toBe(Math.sign(inSpeed));
      // Both are vPeak: the incoming step only carries seamIn's normalisation, under 1.01.
      expect(outSpeed).toBeCloseTo(46, 10);
      expect(inSpeed / outSpeed).toBeCloseTo(1 / (1 - s.k ** s.D), 10);
    }
  });

  it('build the resolver seam: sqrt(vOut * vIn), k 0.70 on x and 0.72 otherwise', () => {
    expect(seamBetween({ axis: 'x', sign: 1, v: 46 }, { v: 36 })).toEqual({
      axis: 'x',
      sign: 1,
      vPeak: Math.sqrt(46 * 36),
      n: 11,
      r: 1.4,
      k: 0.7,
      D: 14,
    });
    expect(seamBetween({ axis: 'scale', sign: 1, v: 0.03 }, { v: 0.03 }).k).toBe(0.72);
  });

  it('are pure functions of the frame', () => {
    const s = seam('scale', 0.72, 0.03);
    expectPure((f) => seamIn(f, s));
    expectPure((f) => seamOut(f, s), -40, 10);
  });

  it('spread words on the word-gap variant, never past 0.6 to 1.4', () => {
    expect([-4, -2, -1, 0, 1, 2, 4].map(wordGapGain)).toEqual([0.6, 0.6, 0.8, 1, 1.2, 1.4, 1.4]);
  });
});

describe('T5 blink and rack', () => {
  it('shows ground only for 2 frames, then the headline at full ink, soft, and sharp at 5', () => {
    const rows = frames(0, 7).map((f) => blink(f, 2));
    expect(rows.slice(0, 2).every(({ blank }) => blank)).toBe(true);
    expect(rows.slice(2).map(({ blur, y }) => [blur, y])).toEqual([
      [6, 13],
      [3, 7],
      [1.2, 4],
      [0, 1],
      [0, 0],
      [0, 0],
    ]);
  });

  it('shifts every row by 3 for the chapter blink: 5 blank, sharp at 8', () => {
    expect(frames(0, 4).every((f) => blink(f, 5).blank)).toBe(true);
    expect(blink(5, 5)).toEqual({ blank: false, blur: 6, y: 13 });
    expect(blink(8, 5)).toEqual({ blank: false, blur: 0, y: 1 });
    expect(blink(9, 5)).toEqual({ blank: false, blur: 0, y: 0 });
  });

  it('counts blank frames at the campaign rate: 2 spec frames are 2 frames at 24 fps too', () => {
    expect(framesBefore(2, 30)).toBe(2);
    expect(framesBefore(2, 24)).toBe(2);
    expect(framesBefore(5, 24)).toBe(4);
    expect(framesBefore(0, 24)).toBe(0);
    expect(filmFrames(11, 24)).toBe(9);
  });

  it('is a pure function of the frame', () => {
    expectPure((f) => blink(f, 2));
    expectPure((f) => blink(f, 5));
  });
});

describe('T3 word rise and the second line', () => {
  it("pushes line 1 up 60% of the way on line 2's first frame", () => {
    expect(secondLinePush(30, 30, 100)).toBeCloseTo(60, 10);
    expect(secondLinePush(29, 30, 100)).toBe(0);
    expect(secondLinePush(60, 30, 100)).toBeCloseTo(100, 6);
    expectPure((f) => secondLinePush(f, 10, 50));
  });
});

describe('in-out tokens', () => {
  it('lift from 0 to 1 over 11 frames, clamped either side', () => {
    expect(liftAt(-3)).toBe(0);
    expect(liftAt(0)).toBe(0);
    expect(liftAt(11)).toBe(1);
    expect(liftAt(20)).toBe(1);
    expect(liftAt(5.5)).toBeGreaterThan(0.3);
    expect(inOutAt(15, inOut.step)).toBeCloseTo(0.5, 6);
    expectPure(liftAt);
  });
});

describe('MorphBox', () => {
  const from = { width: 400, height: 200 };
  const to = { width: 800, height: 500 };

  it('passes its QC frames: content gone at 5, width done at 17, height at 44, content at 45', () => {
    expect(morphBox(0, from, to)).toMatchObject({ contentOpacity: 1, width: 400, height: 200 });
    expect(morphBox(5, from, to)).toMatchObject({ contentOpacity: 0, contentIn: false });
    expect(morphBox(6, from, to).width).toBe(400);
    expect(morphBox(17, from, to)).toMatchObject({ width: 800, height: 200 });
    expect(morphBox(18, from, to).height).toBe(200);
    expect(morphBox(44, from, to)).toMatchObject({ width: 800, height: 500, contentIn: false });
    expect(morphBox(44, from, to).contentOpacity).toBe(0);
    expect(morphBox(45, from, to)).toMatchObject({ contentIn: true, contentOpacity: 1 });
  });

  it('moves the width before the height, and never past either end', () => {
    for (const f of frames(0, 60)) {
      const { width, height } = morphBox(f, from, to);
      expect(width).toBeGreaterThanOrEqual(400);
      expect(width).toBeLessThanOrEqual(800);
      if (f < 18) expect(height).toBe(200);
      if (f >= 18) expect(width).toBe(800);
    }
    expectPure((f) => morphBox(f, from, to));
  });
});

describe('skin', () => {
  it("computes OKLCH lightness as the Art Director's checks give it", () => {
    expect(oklchLightness('#FFFFFF')).toBeCloseTo(1, 3);
    expect(oklchLightness('#808080')).toBeCloseTo(0.6, 3);
    expect(oklchLightness('#0B1020')).toBeCloseTo(0.177, 3);
  });

  it('puts a dark ground on Kinetic Plate and a pale one on Neutral Cut', () => {
    expect(skinOf('#0B1020')).toBe('kinetic-plate');
    expect(skinOf('#FBF7EF')).toBe('neutral-cut');
  });
});

describe('Stage ground', () => {
  const plan = {
    stillFrom: 500,
    scenes: [
      { ground: 'plate', span: { from: 0 } },
      { ground: 'event', span: { from: 100 } },
      { ground: 'plate', span: { from: 140 } },
    ],
  } as unknown as Parameters<typeof groundAt>[0] & { stillFrom: number };

  it('switches ground at the seam, and holds one ground through a scene', () => {
    expect([0, 99, 100, 139, 140, 400].map((frame) => groundAt(plan, frame))).toEqual([
      'plate',
      'plate',
      'event',
      'event',
      'plate',
      'plate',
    ]);
  });

  it('drifts on the film frame, and stops where the film holds still', () => {
    expect(groundClock(plan, 120)).toBe(120);
    expect(groundClock(plan, 520)).toBe(500);
    expectPure((frame) => [groundAt(plan, frame), groundClock(plan, frame)], 0, 600);
  });
});
