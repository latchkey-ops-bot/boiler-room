import { readFileSync } from 'node:fs';
import { sceneRegistry } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { type SpecFit, type SpecTypeStyle, specPx } from '../src/components/type.tsx';
import { fitBlock } from '../src/layout/fit.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../src/layout/stage.ts';
import {
  type CellGrid,
  type CellText,
  cellLayout,
  cellLayoutOrThrow,
  cellState,
  dotCentre,
  panelBox,
} from '../src/scenes/cell-type-layout.ts';
import { anchorsOf, anchorVelocities, groundOf } from '../src/scenes/definition.ts';
import type { Fitter } from '../src/scenes/proof-bars-layout.ts';
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

const text = (headline: string): CellText[] => [{ id: 'h', role: 'headline', value: headline }];
const stage = stageOf('16:9');
const laid = (headline = 'Ship') => {
  const result = cellLayout(text(headline), stage, fakeFitter('16:9'));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.layout;
};
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('cell-type registration', () => {
  it("is registered under its schema name with the scene file's Registry entry", () => {
    expect(IMPLEMENTED_SCENE_TYPES).toContain('cell-type');
    const definition = definitionOf('cell-type');
    if (!definition) throw new Error('not registered');
    expect(definition.kind).toBe('setpiece');
    expect(groundOf(definition, {}, 'neutral-cut')).toBe('base');
    expect(groundOf(definition, {}, 'kinetic-plate')).toBe('plate');
    expect(sceneRegistry['cell-type']?.text).toEqual({ headline: 16 });
    expect(Object.keys(definition.roles)).toEqual(['headline']);
    expect(definition.image).toBe('none');
    expect(definition.maxImages).toBe(0);
    expect(anchorVelocities(definition, {})).toEqual([
      { id: 'panel', entry: undefined, exit: undefined },
    ]);
    expect(definition.props.safeParse({}).success).toBe(true);
    expect(definition.props.safeParse({ accent: { textId: 'h', from: 0, to: 1 } }).success).toBe(
      true,
    );
    expect(definition.props.safeParse({ copy: 'x' }).success).toBe(false);
  });

  it('builds the panel anchor as the panel box', () => {
    const definition = definitionOf('cell-type');
    if (!definition) throw new Error('not registered');
    // The anchor measures with the real fitter, which needs fonts: only its declaration is read.
    const [anchor] = anchorsOf(definition, {
      props: {},
      stage,
      theme: { fonts: { display: 'Test', body: 'Test' }, radius: 12 } as never,
      images: [],
      dur: 108,
      text: text('Ship'),
    });
    expect(anchor?.id).toBe('panel');
    expect(panelBox(laid())).toEqual(laid().panel.rect);
  });
});

describe('cell-type copy', () => {
  it('shows only scene.text, reads no prop but the accent, and uses no clock', () => {
    const source = readFileSync(new URL('../src/scenes/cell-type.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/props\.(?!accent)/);
    expect(source).not.toMatch(/Math\.random|Date\.now|setTimeout|setInterval|performance\.now/);
    expect(source).not.toMatch(/seconds\s*\*\s*fps|\*\s*fps/);
    expect(source).not.toMatch(/<Img|staticFile/);
  });

  it('throws a layout error naming the scene and the text id when copy does not fit', () => {
    for (const bad of ['One two three four', 'Extraordinarily long']) {
      expect(() =>
        cellLayoutOrThrow('scene "s1"', text(bad), stage, fakeFitter('16:9')),
      ).toThrowError(/cell-type scene "s1".*text "h"/s);
    }
  });
});

describe('cell-type motion', () => {
  const layout = laid();
  const { rect } = layout.headline;
  const on: boolean[] = [];
  for (let r = 0; r < layout.rows; r++)
    for (let c = 0; c < layout.cols; c++) {
      const { x, y } = dotCentre(layout.pitch, c, r);
      on.push(x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height);
    }
  const grid: CellGrid = { cols: layout.cols, rows: layout.rows, on };

  it('is a pure function of f over f 0..107, in any order', () => {
    const once = range(0, 107).map((f) => cellState(layout, grid, f));
    const again = range(0, 107)
      .reverse()
      .map((f) => cellState(layout, grid, f))
      .reverse();
    expect(again).toEqual(once);
  });

  it('is never blank, is solid from f = 90 and holds with drift past f = 107', () => {
    expect(cellState(layout, grid, 0).dots.every((d) => d.radius > 0)).toBe(true);
    expect(cellState(layout, grid, 89).solid).toBe(false);
    expect(cellState(layout, grid, 90).solid).toBe(true);
    const last = cellState(layout, grid, 107);
    const longer = cellState(layout, grid, 130);
    expect(longer.holding).toBe(true);
    expect(longer.solid).toBe(true);
    expect(longer.scale).toBeGreaterThan(last.scale);
  });
});
