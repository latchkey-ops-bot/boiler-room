import { describe, expect, it } from 'vitest';
import { type SpecFit, type SpecTypeStyle, specPx } from '../src/components/type.tsx';
import { fitBlock } from '../src/layout/fit.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../src/layout/stage.ts';
import type { Fitter } from '../src/scenes/proof-bars-layout.ts';
import {
  centreOffset,
  insideSafe,
  type RailLayout,
  type RailText,
  railBlur,
  railClock,
  railDistance,
  railErrorMessage,
  railExit,
  railLayout,
  railLayoutOrThrow,
  railOffset,
  railSpeed,
  railState,
  railVelocity,
  rimLitCount,
} from '../src/scenes/rail-words-layout.ts';
import { specType } from '../src/tokens.ts';

const FORMATS: Format[] = ['16:9', '9:16', '1:1'];
const stageOf = (format: Format) => {
  const { width, height } = FORMAT_SIZES[format];
  return stageFor(width, height);
};

/** A face whose every character is 0.5 em wide, with a cap height of 0.7 em, fitted as `specFit` fits. */
const METRICS = { cap: 0.7, ascent: 0.95, descent: 0.25 };
const fakeFitter =
  (format: Format): Fitter =>
  (text: string, style: SpecTypeStyle, box: { width: number; maxLines: number }): SpecFit => {
    const targetSize = specPx(stageOf(format), style.cap) / METRICS.cap;
    const fit = fitBlock(
      {
        text,
        maxWidth: box.width,
        maxHeight: Number.POSITIVE_INFINITY,
        maxSize: targetSize,
        maxLines: box.maxLines,
        lineHeight: 1.1,
      },
      { widthOf: (line, size) => [...line].length * size * 0.5 },
    );
    return {
      ...fit,
      fontFamily: 'Test',
      weight: style.weight,
      lineHeight: 1.1,
      letterSpacing: '0',
      metrics: METRICS,
      targetSize,
    };
  };

const text = (headline: string, subhead: string): RailText[] => [
  { id: 'headline', role: 'headline', value: headline },
  { id: 'subhead', role: 'subhead', value: subhead },
];
const layoutOf = (format: Format, headline = 'Fast', subhead = 'Everywhere'): RailLayout => {
  const result = railLayout(text(headline, subhead), stageOf(format), fakeFitter(format));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.layout;
};
const frames = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('timing', () => {
  it('v(0) is 46 and v(f) tends to 6', () => {
    expect(railSpeed(0)).toBe(46);
    expect(railSpeed(60)).toBeCloseTo(6, 6);
    expect(railSpeed(1)).toBeCloseTo(6 + 40 * 0.72, 9);
  });

  it('D(f) is the sum of v', () => {
    expect(railDistance(0)).toBe(0);
    let sum = 0;
    for (let f = 0; f < 30; f += 1) {
      expect(railDistance(f)).toBeCloseTo(sum, 9);
      sum += railSpeed(f);
    }
    expect(railDistance(22)).toBeCloseTo(6 * 22 + (40 * (1 - 0.72 ** 22)) / 0.28, 9);
  });

  it('the rails are centred at f = 22 and move in opposite directions at 46 px/f at f = 0', () => {
    const stage = stageOf('16:9');
    const layout = layoutOf('16:9');
    const at = railState(layout, stage, 22);
    expect(at.top.x).toBeCloseTo(stage.width / 2, 9);
    expect(at.bottom.x).toBeCloseTo(stage.width / 2, 9);
    for (const f of frames(0, 40)) {
      expect(railOffset(f, 'top') - railExit(f, 'top')).toBeCloseTo(
        -(railDistance(f) - railDistance(22)),
        9,
      );
      expect(railOffset(f, 'bottom') - railExit(f, 'bottom')).toBeCloseTo(
        railDistance(f) - railDistance(22),
        9,
      );
    }
    const dTop = railOffset(1, 'top') - railOffset(0, 'top');
    const dBottom = railOffset(1, 'bottom') - railOffset(0, 'bottom');
    expect(dTop).toBeCloseTo(-46, 9);
    expect(dBottom).toBeCloseTo(46, 9);
    expect(railVelocity(0, 'top')).toBe(46);
  });

  it('the centre element enters from +0.3 W, settles over 14 frames, then drifts left 7.8 px/f', () => {
    const stage = stageOf('16:9');
    expect(centreOffset(0, stage)).toBeCloseTo(0.3 * stage.width, 9);
    expect(centreOffset(14, stage)).toBeCloseTo(0, 9);
    for (const f of frames(14, 50)) {
      expect(centreOffset(f + 1, stage) - centreOffset(f, stage)).toBeCloseTo(-7.8, 9);
    }
    expect(centreOffset(8, stage)).toBeLessThan(centreOffset(7, stage));
  });

  it('exactly one rim is lit on every frame', () => {
    for (const f of frames(0, 62)) expect(rimLitCount(f)).toBe(1);
  });

  it('the blur is 0.08 capD while a rail moves faster than 30 px/f, and 0 otherwise', () => {
    expect(railBlur(0)).toBeCloseTo(0.08 * specType.capD, 9);
    expect(railBlur(1)).toBeCloseTo(0.08 * specType.capD, 9);
    for (const f of frames(2, 50)) expect(railBlur(f)).toBe(0);
    for (const f of frames(0, 70)) {
      const fast = Math.max(railVelocity(f, 'top'), railVelocity(f, 'bottom')) > 30;
      expect(railBlur(f) > 0).toBe(fast);
    }
    expect(railBlur(62)).toBeGreaterThan(0);
  });

  it('the exit is a seamOut on top of the cruise, top -1 and bottom +1, 46 px/f at f = 62', () => {
    for (const f of frames(0, 51)) {
      expect(railExit(f, 'top')).toBe(0);
      expect(railExit(f, 'bottom')).toBe(0);
    }
    for (const f of frames(53, 70)) {
      expect(railExit(f, 'top')).toBeLessThan(0);
      expect(railExit(f, 'bottom')).toBeGreaterThan(0);
    }
    expect(Math.abs(railExit(62, 'top') - railExit(61, 'top'))).toBeCloseTo(46, 6);
    expect(railExit(62, 'bottom')).toBeCloseTo(-railExit(62, 'top'), 9);
    expect(railOffset(60, 'top') - railOffset(59, 'top')).toBeLessThan(
      railOffset(59, 'top') - railOffset(58, 'top'),
    );
  });

  it('is a pure function of f, in any order, and holds past f = 62 with the cruise running', () => {
    const stage = stageOf('16:9');
    const layout = layoutOf('16:9');
    const order = [40, 3, 62, 0, 22, 62, 40];
    const first = order.map((f) => railState(layout, stage, f));
    const again = [...order].reverse().map((f) => railState(layout, stage, f));
    expect(first).toEqual([...again].reverse());
    const a = railState(layout, stage, 70);
    const b = railState(layout, stage, 80);
    expect(a.holding).toBe(true);
    expect(railState(layout, stage, 62).holding).toBe(false);
    expect(a.top.x - b.top.x).toBeCloseTo(specPx(stage, 10 * railClock.cruise), 6);
    expect(railExit(80, 'top')).toBe(railExit(70, 'top'));
  });

  it('glyph scale is 1 on every frame', () => {
    const stage = stageOf('1:1');
    const layout = layoutOf('1:1');
    for (const f of frames(0, 62)) {
      const s = railState(layout, stage, f);
      expect(s.top.scale).toBe(1);
      expect(s.bottom.scale).toBe(1);
    }
  });
});

describe.each(FORMATS)('layout at %s', (format) => {
  const stage = stageOf(format);

  it('places the rails and the centre band per the Layout table', () => {
    const layout = layoutOf(format);
    const y = {
      '16:9': [0.22, 0.78, 0.28],
      '9:16': [0.26, 0.74, 0.24],
      '1:1': [0.2, 0.8, 0.24],
    }[format];
    expect(layout.top.centreY).toBeCloseTo(stage.height * (y[0] as number), 9);
    expect(layout.bottom.centreY).toBeCloseTo(stage.height * (y[1] as number), 9);
    expect(layout.band.rect.height).toBeCloseTo(stage.height * (y[2] as number), 9);
    expect(layout.band.rect.y + layout.band.rect.height / 2).toBeCloseTo(stage.height / 2, 9);
    expect(layout.band.rect.x + layout.band.rect.width / 2).toBeCloseTo(stage.width / 2, 9);
    expect(layout.band.greek?.shares.length).toBeGreaterThan(0);
  });

  it('sets a short word at display size and a long one smaller, never below capS', () => {
    const short = layoutOf(format, 'Fast', 'Go');
    const target = specPx(stage, specType.capD) / 0.7;
    expect(short.top.fit.fontSize).toBe(Math.floor(target));
    const long = layoutOf(format, 'Everything', 'Everywhere');
    expect(long.top.fit.fontSize).toBeLessThanOrEqual(Math.floor(target));
    expect(long.top.fit.fontSize).toBeGreaterThanOrEqual(
      Math.floor(specPx(stage, specType.capS) / 0.7),
    );
    expect(long.top.width).toBeLessThanOrEqual(
      stage.width * { landscape: 0.8, portrait: 0.86, square: 0.8 }[stage.orientation],
    );
  });

  it('at f = 22 each word is wholly inside the safe area, centred; f 14 to 34 stays inside', () => {
    for (const [h, s] of [
      ['Fast', 'Go'],
      ['Everything', 'Everywhere'],
      ['Ship it', 'Now'],
    ] as const) {
      const layout = layoutOf(format, h, s);
      const at = railState(layout, stage, 22);
      for (const word of [at.top, at.bottom]) {
        expect(insideSafe(stage, word.rect)).toBe(true);
        expect(word.x).toBeCloseTo(stage.width / 2, 9);
      }
      expect(at.top.rect.height).toBeCloseTo(layout.top.capHeight, 9);
      if (format === '16:9') {
        for (const f of frames(14, 34)) {
          const state = railState(layout, stage, f);
          expect(insideSafe(stage, state.top.rect)).toBe(true);
          expect(insideSafe(stage, state.bottom.rect)).toBe(true);
        }
      }
    }
  });

  it('refuses copy that does not fit, naming the scene and the text id', () => {
    const result = railLayout(text('Fast', 'Extraordinarily'), stage, fakeFitter(format));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.textId)).toEqual(['subhead']);
    expect(railErrorMessage('scene 1', stage, result.issues)).toContain('rail-words');
    expect(() =>
      railLayoutOrThrow('scene 1', text('Fast', 'Extraordinarily'), stage, fakeFitter(format)),
    ).toThrow(/rail-words[\s\S]*"subhead"/);
    const both = railLayout(text('One two three', 'Go'), stage, fakeFitter(format));
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.issues[0]?.textId).toBe('headline');
  });

  it('takes one or two words a rail', () => {
    expect(railLayout(text('Fast', 'Go'), stage, fakeFitter(format)).ok).toBe(true);
    expect(railLayout(text('Fast now', 'Go on'), stage, fakeFitter(format)).ok).toBe(true);
    expect(railLayout(text('', 'Go'), stage, fakeFitter(format)).ok).toBe(false);
  });
});

describe('centre element at rest', () => {
  it('at f = 40 is in the band, vertically centred, with one rim lit', () => {
    const stage = stageOf('16:9');
    const layout = layoutOf('16:9');
    const s = railState(layout, stage, 40);
    expect(s.centre.arrived).toBe(true);
    expect(s.centre.rimLit).toBe(1);
    expect(s.centre.rect.y).toBeCloseTo((stage.height - s.centre.rect.height) / 2, 9);
    expect(s.centre.rect.height).toBeCloseTo(0.28 * stage.height, 9);
    expect(railState(layout, stage, 5).centre.arrived).toBe(false);
  });
});
