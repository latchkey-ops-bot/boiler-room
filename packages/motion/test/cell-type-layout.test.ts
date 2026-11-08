import { describe, expect, it } from 'vitest';
import { type SpecFit, type SpecTypeStyle, specPx } from '../src/components/type.tsx';
import { fitBlock } from '../src/layout/fit.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../src/layout/stage.ts';
import {
  type CellGrid,
  type CellLayout,
  type CellText,
  cellClock,
  cellErrorMessage,
  cellLayout,
  cellLayoutOrThrow,
  cellState,
  clearCellCache,
  columnStart,
  dotCentre,
  dotState,
  driftScale,
  gridOf,
  growRadius,
  inPanel,
  mergeProgress,
  panelBox,
  type SampleRequest,
  sampleCells,
  sampleRequestOf,
} from '../src/scenes/cell-type-layout.ts';
import type { Fitter } from '../src/scenes/proof-bars-layout.ts';
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

const text = (headline: string): CellText[] => [
  { id: 'headline', role: 'headline', value: headline },
];
const layoutOf = (format: Format, headline = 'Ship'): CellLayout => {
  const result = cellLayout(text(headline), stageOf(format), fakeFitter(format));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.layout;
};

/** A fixed grid: the cells of the ink box are on in a checker, so on and off cells both exist. */
const gridFor = (layout: CellLayout): CellGrid => {
  const { rect } = layout.headline;
  const on: boolean[] = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      const { x, y } = dotCentre(layout.pitch, c, r);
      const inside =
        x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
      on.push(inside && (c + r) % 2 === 0);
    }
  }
  return { cols: layout.cols, rows: layout.rows, on };
};
const frames = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('layout', () => {
  it('has the pitch and grid of each format', () => {
    expect(gridOf({ width: 1920, height: 1080 })).toEqual({ pitch: 27, cols: 71, rows: 40 });
    expect(gridOf({ width: 1080, height: 1920 })).toEqual({ pitch: 27, cols: 40, rows: 71 });
    expect(gridOf({ width: 1080, height: 1080 })).toEqual({ pitch: 27, cols: 40, rows: 40 });
  });

  it('puts dot centres at ((c + 0.5) p, (r + 0.5) p)', () => {
    expect(dotCentre(27, 0, 0)).toEqual({ x: 13.5, y: 13.5 });
    expect(dotCentre(27, 3, 2)).toEqual({ x: 94.5, y: 67.5 });
  });

  it('sets the headline at capD, centred, where the table says', () => {
    const l = layoutOf('16:9', 'Ship');
    // The size is a whole number of px, as `specFit` sets it: within 1 px of `capD`.
    expect(Math.abs(l.headline.capHeight - specType.capD)).toBeLessThan(1);
    expect(l.headline.x).toBe(960);
    expect(l.headline.centreY).toBe(540);
    const p = layoutOf('9:16', 'Ship');
    expect(p.headline.centreY).toBeCloseTo(0.45 * 1920, 6);
    expect(p.headline.width).toBeLessThanOrEqual(0.86 * 1080 + 1e-6);
  });

  it('caps the size by the fit-text size, never below capS', () => {
    const l = layoutOf('1:1', 'Launch');
    expect(l.headline.width).toBeLessThanOrEqual(0.8 * 1080 + 1e-6);
    expect(l.headline.fit.fontSize).toBeLessThan(l.headline.fit.targetSize);
    expect(l.headline.fit.fontSize).toBeGreaterThanOrEqual(
      Math.floor(specPx(stageOf('1:1'), specType.capS) / METRICS.cap),
    );
  });

  it('pads the ink box by 2 cells and snaps to whole cells', () => {
    for (const format of FORMATS) {
      const l = layoutOf(format);
      const { panel, pitch, headline } = l;
      expect(panel.rect.x % pitch).toBeCloseTo(0, 6);
      expect(panel.rect.width % pitch).toBeCloseTo(0, 6);
      if (!panel.clamped) {
        expect(panel.rect.x).toBeLessThanOrEqual(headline.rect.x - 2 * pitch + 1e-6);
        expect(panel.rect.x).toBeGreaterThan(headline.rect.x - 3 * pitch);
        expect(panel.rect.y + panel.rect.height).toBeGreaterThanOrEqual(
          headline.rect.y + headline.rect.height + 2 * pitch - 1e-6,
        );
      }
      expect(panelBox(l)).toBe(panel.rect);
    }
  });

  it('clamps the panel to the grid at 9:16 and says so', () => {
    // A face wider than the fake one, so the padded ink box runs past both sides of the grid.
    const wide: Fitter = (t, style, box) => ({ ...fakeFitter('9:16')(t, style, box), width: 1040 });
    const result = cellLayout(text('Ship'), stageOf('9:16'), wide);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const l = result.layout;
    expect(l.panel.clamped).toBe(true);
    expect(l.panel.c0).toBe(0);
    expect(l.panel.c1).toBe(40);
  });

  it('refuses copy that does not fit one line, naming the scene and the text id', () => {
    // 16 characters fit one line only at a cap height under 7 cells: refused.
    const result = cellLayout(text('Sixteen chars ok'), stageOf('9:16'), fakeFitter('9:16'));
    expect(result.ok).toBe(false);
    const bad = cellLayout(text('Far too many words here'), stageOf('16:9'), fakeFitter('16:9'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues[0]?.textId).toBe('headline');
      expect(cellErrorMessage('s1', stageOf('16:9'), bad.issues)).toContain('cell-type');
      expect(cellErrorMessage('s1', stageOf('16:9'), bad.issues)).toContain('"headline"');
    }
    expect(() =>
      cellLayoutOrThrow(
        's1',
        text('This is far too long to fit'),
        stageOf('16:9'),
        fakeFitter('16:9'),
      ),
    ).toThrow(/cell-type.*headline/s);
  });

  it('refuses glyphs under 7 cells tall', () => {
    const stage = stageOf('16:9');
    const small: Fitter = (t, style, box) => {
      const fit = fakeFitter('16:9')(t, style, box);
      return { ...fit, fontSize: 100, metrics: { ...METRICS, cap: 0.5 } };
    };
    // Cap height 50 px is under 7 x 27 = 189 px, and `floor` (capS) is far above 100.
    const result = cellLayout(text('Ship'), stage, small);
    expect(result.ok).toBe(false);
    const tiny: Fitter = (t, style, box) => {
      const fit = fakeFitter('16:9')(t, style, box);
      return { ...fit, fontSize: Math.floor(fit.targetSize), metrics: { ...METRICS, cap: 0.5 } };
    };
    const r2 = cellLayout(text('Ship'), stage, tiny);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.issues[0]?.message).toMatch(/7 cells/);
  });

  it('takes 1 to 3 words of at most 16 characters', () => {
    const s = stageOf('16:9');
    expect(cellLayout(text(''), s, fakeFitter('16:9')).ok).toBe(false);
    expect(cellLayout(text('a b c d'), s, fakeFitter('16:9')).ok).toBe(false);
    expect(cellLayout(text('abcdefghijklmnopq'), s, fakeFitter('16:9')).ok).toBe(false);
    expect(cellLayout(text('Go now ok'), s, fakeFitter('16:9')).ok).toBe(true);
  });
});

describe('sampling', () => {
  const request = (): SampleRequest => sampleRequestOf(layoutOf('16:9'));

  it('calls the sampler once per key and returns the same grid', () => {
    clearCellCache();
    let calls = 0;
    const fixed: CellGrid = { cols: 2, rows: 1, on: [true, false] };
    const sampler = () => {
      calls += 1;
      return fixed;
    };
    const a = sampleCells(request(), sampler);
    const b = sampleCells(request(), sampler);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    sampleCells({ ...request(), text: 'Other' }, sampler);
    sampleCells({ ...request(), fontSize: 99 }, sampler);
    expect(calls).toBe(3);
  });

  it('carries no state across frames: the state of a frame does not depend on the frames before', () => {
    const l = layoutOf('16:9');
    const grid = gridFor(l);
    const direct = cellState(l, grid, 75);
    for (const f of [0, 107, 30, 89, 75]) cellState(l, grid, f);
    expect(cellState(l, grid, 75)).toEqual(direct);
  });
});

describe('timing', () => {
  const cols = 71;

  it('starts every column at round(24 c / cols)', () => {
    expect(columnStart(0, cols)).toBe(0);
    expect(columnStart(70, cols)).toBe(Math.round((24 * 70) / 71));
    expect(columnStart(35, cols)).toBe(Math.round((24 * 35) / 71));
  });

  it('grows on cells with 0.12 + 0.34 arriveN(f - t0, 0.3, 6)', () => {
    expect(growRadius(0, 0, cols)).toBeCloseTo(0.12, 9);
    expect(growRadius(6, 0, cols)).toBeCloseTo(0.46, 9);
    const c = 35;
    const t0 = columnStart(c, cols);
    expect(growRadius(t0, c, cols)).toBeCloseTo(0.12, 9);
    expect(growRadius(t0 + 1, c, cols)).toBeCloseTo(0.12 + (0.34 * (1 - 0.3)) / (1 - 0.3 ** 6), 9);
    expect(growRadius(t0 + 6, c, cols)).toBeCloseTo(0.46, 9);
    expect(growRadius(30, 70, cols)).toBeCloseTo(0.46, 9);
  });

  it('drifts 1 + 0.0013 (f - 30) from 30 to 59 and again from 90', () => {
    expect(driftScale(0)).toBe(1);
    expect(driftScale(29)).toBe(1);
    expect(driftScale(30)).toBe(1);
    expect(driftScale(59)).toBeCloseTo(1 + 0.0013 * 29, 9);
    expect(driftScale(90)).toBe(1);
    expect(driftScale(107)).toBeCloseTo(1 + 0.0013 * 17, 9);
  });

  it('merges on step over f 60 to 89', () => {
    expect(mergeProgress(60)).toBe(0);
    expect(mergeProgress(59)).toBe(0);
    expect(mergeProgress(90)).toBe(1);
    expect(mergeProgress(75)).toBeCloseTo(0.5, 2);
    for (const f of frames(61, 90))
      expect(mergeProgress(f)).toBeGreaterThanOrEqual(mergeProgress(f - 1));
  });

  it('moves panel dots to 0.75, off colour to ink, and outside dots to 0', () => {
    const off = { c: 3, on: false, inPanel: true };
    expect(dotState(60, off, cols)).toEqual({ radius: 0.12, inkMix: 0, alpha: 0.3 });
    const end = dotState(90, off, cols);
    expect(end.radius).toBeCloseTo(0.75, 9);
    expect(end.inkMix).toBe(1);
    expect(end.alpha).toBe(1);
    expect(dotState(90, { c: 3, on: true, inPanel: true }, cols).radius).toBeCloseTo(0.75, 9);
    expect(dotState(90, { c: 3, on: false, inPanel: false }, cols).radius).toBeCloseTo(0, 9);
    expect(dotState(90, { c: 3, on: true, inPanel: false }, cols).radius).toBeCloseTo(0, 9);
  });
});

describe('acceptance stills', () => {
  for (const format of FORMATS) {
    const l = layoutOf(format);
    const grid = gridFor(l);
    const dots = (f: number) => cellState(l, grid, f).dots;

    it(`${format} f=0: the full lattice, every dot equal`, () => {
      const d = dots(0);
      expect(d.length).toBe(l.cols * l.rows);
      expect(new Set(d.map((x) => x.radius))).toEqual(new Set([0.12]));
      expect(new Set(d.map((x) => x.alpha)).size).toBe(2);
    });

    it(`${format} f=30: on cells are larger than off cells`, () => {
      const d = dots(30);
      const on = d.filter((x) => x.on);
      const off = d.filter((x) => !x.on);
      expect(on.length).toBeGreaterThan(0);
      for (const x of on) expect(x.radius).toBeCloseTo(0.46, 9);
      for (const x of off) expect(x.radius).toBe(0.12);
    });

    it(`${format} f=75: panel dots part-merged, outside dots shrinking`, () => {
      const d = dots(75);
      for (const x of d.filter((y) => y.inPanel)) {
        expect(x.radius).toBeGreaterThan(x.on ? 0.46 : 0.12);
        expect(x.radius).toBeLessThan(0.75);
      }
      for (const x of d.filter((y) => !y.inPanel)) {
        expect(x.radius).toBeGreaterThan(0);
        expect(x.radius).toBeLessThan(x.on ? 0.46 : 0.12);
      }
    });

    it(`${format} f=89: no ground inside the panel`, () => {
      const d = dots(89).filter((x) => x.inPanel);
      // Radius 0.71 covers a cell corner to corner: from there the dots overlap and no ground shows.
      for (const x of d) expect(x.radius).toBeGreaterThan(0.71);
      expect(d.length).toBe((l.panel.c1 - l.panel.c0) * (l.panel.r1 - l.panel.r0));
    });

    it(`${format} f=90: solid panel, glyphs knocked out where they were`, () => {
      const a = cellState(l, grid, 89);
      const b = cellState(l, grid, 90);
      expect(a.solid).toBe(false);
      expect(b.solid).toBe(true);
      expect(b.glyph.knockedOut).toBe(true);
      expect(b.glyph.x).toBe(a.glyph.x);
      expect(b.glyph.baseline).toBe(a.glyph.baseline);
      expect(b.glyph.fontSize).toBe(a.glyph.fontSize);
      expect(b.scale).toBe(a.scale);
      expect(b.panel.rect).toEqual(l.panel.rect);
      expect(b.panel.radius).toBe(specPx(stageOf(format), 16));
      expect(inPanel(l.panel, l.panel.c0, l.panel.r0)).toBe(true);
    });
  }
});

describe('purity', () => {
  const l = layoutOf('16:9');
  const grid = gridFor(l);

  it('is a pure function of f over 0..107, in any order', () => {
    const forward = frames(0, 107).map((f) => cellState(l, grid, f));
    const backward = frames(0, 107)
      .reverse()
      .map((f) => cellState(l, grid, f))
      .reverse();
    expect(backward).toEqual(forward);
  });

  it('holds the last state with the drift running when the scene is longer', () => {
    const a = cellState(l, grid, 107);
    const b = cellState(l, grid, 120);
    expect(a.holding).toBe(false);
    expect(b.holding).toBe(true);
    expect(b.dots).toEqual(a.dots);
    expect(b.solid).toBe(true);
    expect(b.scale).toBeCloseTo(1 + 0.0013 * 30, 9);
    expect(b.scale).toBeGreaterThan(a.scale);
  });

  it('reads frame numbers from f only, clamped at 0', () => {
    expect(cellState(l, grid, -5)).toEqual(cellState(l, grid, 0));
    expect(cellClock.last).toBe(107);
  });
});
