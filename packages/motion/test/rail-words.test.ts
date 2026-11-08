import { readFileSync } from 'node:fs';
import { sceneRegistry } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { type SpecFit, type SpecTypeStyle, specPx } from '../src/components/type.tsx';
import { fitBlock } from '../src/layout/fit.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../src/layout/stage.ts';
import { anchorsOf, anchorVelocities, groundOf } from '../src/scenes/definition.ts';
import type { Fitter } from '../src/scenes/proof-bars-layout.ts';
import {
  type RailText,
  railBlur,
  railErrorMessage,
  railLayout,
  railLayoutOrThrow,
  railState,
  railVelocity,
} from '../src/scenes/rail-words-layout.ts';
import { definitionOf, IMPLEMENTED_SCENE_TYPES } from '../src/scenes/registry.ts';

const stageOf = (format: Format) => {
  const { width, height } = FORMAT_SIZES[format];
  return stageFor(width, height);
};

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
  { id: 'h', role: 'headline', value: headline },
  { id: 's', role: 'subhead', value: subhead },
];
const stage = stageOf('16:9');
const laid = (headline = 'Fast', subhead = 'Everywhere') => {
  const result = railLayout(text(headline, subhead), stage, fakeFitter('16:9'));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.layout;
};
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('rail-words registration', () => {
  it("is registered under its schema name with the scene file's Registry entry", () => {
    expect(IMPLEMENTED_SCENE_TYPES).toContain('rail-words');
    const definition = definitionOf('rail-words');
    if (!definition) throw new Error('not registered');
    expect(definition.kind).toBe('product');
    expect(groundOf(definition, {}, 'neutral-cut')).toBe('base');
    expect(groundOf(definition, {}, 'kinetic-plate')).toBe('plate');
    expect(sceneRegistry['rail-words']?.text).toEqual({ headline: 14, subhead: 14 });
    expect(Object.keys(definition.roles).sort()).toEqual(['headline', 'subhead']);
    expect(anchorVelocities(definition, {})).toEqual([
      {
        id: 'rails',
        entry: { axis: 'x', sign: -1, v: 46 },
        exit: { axis: 'x', sign: -1, v: 46 },
      },
    ]);
    expect(definition.props.safeParse({}).success).toBe(true);
    expect(definition.props.safeParse({ copy: 'x' }).success).toBe(false);
  });

  it('builds the rails anchor as the top rail box', () => {
    const definition = definitionOf('rail-words');
    if (!definition) throw new Error('not registered');
    const fonts = { display: 'Test', body: 'Test' };
    const [anchor] = anchorsOf(definition, {
      props: {},
      stage,
      theme: { fonts, radius: 12 } as never,
      images: [],
      dur: 63,
      text: text('Fast', 'Everywhere'),
    });
    expect(anchor?.id).toBe('rails');
  });
});

describe('rail-words copy', () => {
  it('shows only the words of scene.text, and greeks the centre with no numerals', () => {
    const layout = laid('Fast', 'Everywhere now');
    expect(layout.top.text).toBe('Fast');
    expect(layout.bottom.text).toBe('Everywhere now');
    expect(layout.band.greek).toBeDefined();
    const source = readFileSync(new URL('../src/scenes/rail-words.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/props\.(?!accent)/);
    expect(source).not.toMatch(/Math\.random|Date\.now|setTimeout|setInterval|performance\.now/);
  });

  it('throws a layout error naming the scene and the text id when copy does not fit', () => {
    const bad = text('Fast', 'Far too many words here');
    expect(() => railLayoutOrThrow('scene "s1"', bad, stage, fakeFitter('16:9'))).toThrowError(
      /rail-words scene "s1".*text "s"/s,
    );
    const result = railLayout(bad, stage, fakeFitter('16:9'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(railErrorMessage('x', stage, result.issues)).toContain('text "s"');
  });
});

describe('rail-words motion', () => {
  const layout = laid();

  it('is a pure function of f over f 0..62, in any order', () => {
    const once = range(0, 62).map((f) => railState(layout, stage, f));
    const again = range(0, 62)
      .reverse()
      .map((f) => railState(layout, stage, f))
      .reverse();
    expect(again).toEqual(once);
  });

  it('blurs only while a rail moves faster than 30 px/f, and never scales glyphs', () => {
    for (const f of range(0, 62)) {
      const fast = Math.max(railVelocity(f, 'top'), railVelocity(f, 'bottom')) > 30;
      expect(railBlur(f) > 0).toBe(fast);
      const state = railState(layout, stage, f);
      expect(state.top.scale).toBe(1);
      expect(state.bottom.scale).toBe(1);
      expect(state.top.blur > 0).toBe(fast);
    }
    expect(railBlur(0)).toBeCloseTo(0.08 * 211, 9);
    expect(railBlur(20)).toBe(0);
  });

  it('runs the T1 exit over f 52..62 and holds from f 63 with the cruise drifting', () => {
    expect(railState(layout, stage, 51).top.x - railState(layout, stage, 50).top.x).toBeCloseTo(
      railState(layout, stage, 50).top.x - railState(layout, stage, 49).top.x,
      0,
    );
    expect(railVelocity(62, 'top')).toBeGreaterThan(46);
    expect(railState(layout, stage, 62).holding).toBe(false);
    expect(railState(layout, stage, 63).holding).toBe(true);
    const a = railState(layout, stage, 70);
    const b = railState(layout, stage, 71);
    expect(a.top.x).toBeGreaterThan(b.top.x);
    expect(b.bottom.x).toBeGreaterThan(a.bottom.x);
  });

  it('lights exactly one rim at f = 40, with the centre element at rest in the band', () => {
    const state = railState(layout, stage, 40);
    expect(state.centre.rimLit).toBe(1);
    expect(state.centre.arrived).toBe(true);
  });
});
