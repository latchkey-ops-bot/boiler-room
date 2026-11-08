import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  fromOklch,
  mixOklch,
  oklchLightness,
  styleFamily,
  tintedGround,
  toOklch,
} from '../src/index.ts';

describe('oklchLightness', () => {
  it('matches the check values in the art-director skill', () => {
    expect(oklchLightness('#FFFFFF')).toBeCloseTo(1, 3);
    expect(oklchLightness('#808080')).toBeCloseTo(0.6, 3);
    expect(oklchLightness('#0B1020')).toBeCloseTo(0.177, 3);
    expect(oklchLightness('#000000')).toBe(0);
  });

  it('reads lower-case hex the same', () => {
    expect(oklchLightness('#0b1020')).toBe(oklchLightness('#0B1020'));
  });
});

describe('toOklch and fromOklch', () => {
  it.each([
    '#FFFFFF',
    '#000000',
    '#808080',
    '#08090A',
    '#828FFF',
    '#5850EC',
    '#0000EE',
    '#F9FAFB',
    '#FF0000',
  ])('round-trips %s exactly', (hex) => {
    expect(fromOklch(toOklch(hex))).toBe(hex);
  });

  it('gives a neutral grey no hue', () => {
    expect(toOklch('#808080')).toMatchObject({ c: 0, h: undefined });
  });

  it('maps an out-of-gamut colour into sRGB by dropping chroma, keeping lightness', () => {
    const hex = fromOklch({ l: 0.7, c: 0.4, h: 145 });
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(oklchLightness(hex)).toBeCloseTo(0.7, 2);
    expect(toOklch(hex).c).toBeLessThan(0.4);
  });
});

describe('styleFamily', () => {
  it('puts a pale background in Neutral Cut and a dark one in Kinetic Plate', () => {
    expect(styleFamily('#FFFFFF')).toBe('neutral-cut');
    expect(styleFamily('#F9FAFB')).toBe('neutral-cut');
    expect(styleFamily('#08090A')).toBe('kinetic-plate');
    expect(styleFamily('#0B1020')).toBe('kinetic-plate');
  });

  it('leaves a mid-tone background in neither', () => {
    expect(styleFamily('#808080')).toBeUndefined();
    expect(styleFamily('#3B4A6B')).toBeUndefined();
    expect(styleFamily('#D9D9D9')).toBeUndefined();
  });

  it('splits at L 0.90 and L 0.22', () => {
    // #DEDEDE is L 0.9006 and #DDDDDD is L 0.8975. #1A1A1A is L 0.2178 and #1B1B1B is L 0.2221.
    expect(styleFamily('#DEDEDE')).toBe('neutral-cut');
    expect(styleFamily('#DDDDDD')).toBeUndefined();
    expect(styleFamily('#1A1A1A')).toBe('kinetic-plate');
    expect(styleFamily('#1B1B1B')).toBeUndefined();
  });
});

describe('mixOklch', () => {
  it('returns either input at the ends', () => {
    expect(mixOklch('#5850EC', 1, '#FFFFFF')).toBe('#5850EC');
    expect(mixOklch('#5850EC', 0, '#FFFFFF')).toBe('#FFFFFF');
  });

  it("takes the chromatic colour's hue when mixed with a neutral", () => {
    const tint = toOklch(mixOklch('#5850EC', 0.5, '#FFFFFF'));
    expect(tint.h).toBeCloseTo(toOklch('#5850EC').h ?? Number.NaN, 0);
  });

  it('mixes hue on the shorter arc', () => {
    const between = toOklch(
      mixOklch(fromOklch({ l: 0.6, c: 0.1, h: 350 }), 0.5, fromOklch({ l: 0.6, c: 0.1, h: 10 })),
    );
    const hue = between.h ?? Number.NaN;
    expect(Math.min(hue, 360 - hue)).toBeLessThan(3);
  });
});

describe('tintedGround', () => {
  it.each([
    ['#5850EC', 'light', 'neutral-cut'],
    ['#5850EC', 'dark', 'kinetic-plate'],
    ['#FFD400', 'light', 'neutral-cut'],
    ['#FFD400', 'dark', 'kinetic-plate'],
    ['#00FF88', 'dark', 'kinetic-plate'],
  ] as const)('tints %s into a %s ground in %s', (primary, lean, family) => {
    const ground = tintedGround(primary, lean);
    expect(ground).toMatch(/^#[0-9A-F]{6}$/);
    expect(styleFamily(ground)).toBe(family);
  });

  it('keeps a hint of the primary', () => {
    const ground = toOklch(tintedGround('#5850EC', 'light'));
    expect(ground.c).toBeGreaterThan(0);
    expect(ground.h).toBeCloseTo(toOklch('#5850EC').h ?? Number.NaN, -1);
  });

  it('lets black or white text read on the ground', () => {
    expect(contrastRatio('#000000', tintedGround('#5850EC', 'light'))).toBeGreaterThan(15);
    expect(contrastRatio('#FFFFFF', tintedGround('#5850EC', 'dark'))).toBeGreaterThan(15);
  });
});
