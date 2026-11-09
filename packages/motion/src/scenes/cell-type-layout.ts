/**
 * `cell-type`, as `docs/motion/scenes/cell-type.md` specifies it: the dot lattice in each format,
 * the one-time sampling of the headline into on/off cells, the fit-or-fail check on the headline,
 * and the clock of the scene. Everything here is a pure function of the scene's text, the stage,
 * the fonts, the sampled grid and the spec frame `f`, so the component and the `panel` anchor draw
 * from one computation, on any frame, in any order. No component and no registry entry yet.
 *
 * Values are spec pixels at a short side of 1080 and spec frames at 30 fps. Tags are the scene
 * file's: [M] measured, [D] decided, [N] a build default of the scene file. Values this build adds
 * where the scene file is silent are marked [N, build].
 */
import type { SpecFit, SpecTypeStyle } from '../components/type.tsx';
import { specPx } from '../components/type.tsx';
import { arriveN, ease } from '../core/curves.ts';
import type { Rect } from '../layout/rect.ts';
import type { Orientation, Stage } from '../layout/stage.ts';
import { fallbackRadius, inOut, specType, type as typography } from '../tokens.ts';
import type { Fitter, ProofIssue, ProofText } from './proof-bars-layout.ts';

export type CellText = ProofText;
export type CellIssue = ProofIssue;

/** The scene's layout values, per orientation. */
export const cellGeometry = {
  /** Cells on the short side: the pitch is `S / 40` [N]. */
  cellsOnShortSide: 40,
  /** The headline's widest line, as a share of W [N]. */
  textWidth: { landscape: 0.8, portrait: 0.86, square: 0.8 },
  /** The headline's centre y as a share of H [N]. */
  textY: { landscape: 0.5, portrait: 0.45, square: 0.5 },
  /** The panel is the ink box padded by this many cells on every side [N]. */
  panelPad: 2,
  /** Glyphs are at least this many cells tall [N]. */
  minGlyphCells: 7,
  /** 1 to 3 words of at most 16 characters, one line [N]. */
  words: { min: 1, max: 3 },
  maxChars: 16,
  /** A cell is on when the glyph's alpha at its dot centre is at least this [D]. */
  alphaOn: 0.5,
} as const satisfies Record<string, unknown>;

/** The clock of every `cell-type` scene, in spec frames. Radii are in units of the pitch `p`. */
export const cellClock = {
  /** [N] Every dot at rest; on cells grow to `onRadius`. */
  restRadius: 0.12,
  onRadius: 0.46,
  /** [N] Column `c` of `cols` starts at `round(24 c / cols)`; [M] `arrive.slam` 0.3 over 6 frames. */
  sweep: 24,
  k: 0.3,
  D: 6,
  /** [M] drift rate: `scale(1 + 0.0013 (f - from))`, from `f = 30` and again from `f = 90`. */
  driftRate: 0.0013,
  driftFrom: 30,
  driftEnd: 59,
  /** [M] `step`, 30 frames from `f = 60`: panel dots reach 0.75, outside dots 0. */
  mergeFrom: 60,
  mergeFrames: inOut.step.frames,
  panelRadius: 0.75,
  /** [N] Off cells' colour is `muted` at this opacity at rest, and `ink` once merged. */
  offAlpha: 0.3,
  /** [M] M10 cell threshold: the panel is solid and the glyphs are knocked out. */
  threshold: 90,
  holdDriftFrom: 90,
  /** The scene is 108 frames, 0 to 107. */
  last: 107,
} as const;

/** The headline's style: `capD`, shrunk to fit its width but never below 7 cells tall [D]. */
export const cellStyle: SpecTypeStyle = {
  font: 'display',
  weight: typography.weight.display,
  cap: specType.capD,
};
const floorStyle: SpecTypeStyle = { ...cellStyle, cap: specType.capS };

const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------------------------------------
// Timing

/** A frame as the scene reads it: before `f = 0` is `f = 0`. */
const at = (f: number): number => Math.max(0, f);

/** Column `c` starts growing at `t0 = round(24 c / cols)`. */
export const columnStart = (c: number, cols: number): number =>
  Math.round((cellClock.sweep * c) / cols);

/** An on cell's radius while the type grows: `0.12 + 0.34 arriveN(f - t0, 0.3, 6)`. */
export const growRadius = (f: number, c: number, cols: number): number =>
  cellClock.restRadius +
  (cellClock.onRadius - cellClock.restRadius) *
    arriveN(at(f) - columnStart(c, cols), cellClock.k, cellClock.D);

/** `step` over `f` 60 to 89: 0 until `f = 60`, 1 from `f = 90`. */
export const mergeProgress = (f: number): number => {
  const t = (at(f) - cellClock.mergeFrom) / cellClock.mergeFrames;
  return t <= 0 ? 0 : t >= 1 ? 1 : ease(inOut.step.curve)(t);
};

/**
 * The whole scene's scale about the frame centre. 1 until `f = 30`, then `1 + 0.0013 (f - 30)`
 * through `f = 59`. [N, build] The scene file gives a scale to no other frame before the
 * threshold, so it is 1 for `f` 60 to 89, which is what makes `f = 89` and `f = 90` the same
 * picture; the jump at `f = 60` is flagged in the pull request. From `f = 90` it is
 * `1 + 0.0013 (f - 90)`, and it keeps running past `f = 107` when a scene is longer.
 */
export const driftScale = (f: number): number => {
  const g = at(f);
  if (g >= cellClock.holdDriftFrom) return 1 + cellClock.driftRate * (g - cellClock.holdDriftFrom);
  if (g >= cellClock.driftFrom && g <= cellClock.driftEnd) {
    return 1 + cellClock.driftRate * (g - cellClock.driftFrom);
  }
  return 1;
};

/** True from the threshold: the panel is solid and the headline is knocked out. */
export const isSolid = (f: number): boolean => at(f) >= cellClock.threshold;

export interface DotInput {
  c: number;
  on: boolean;
  inPanel: boolean;
}

export interface DotState {
  /** In units of the pitch. */
  radius: number;
  /** 0 is `muted`, 1 is `ink`. */
  inkMix: number;
  /** 0.3 for an off cell at rest, 1 once it is `ink`. */
  alpha: number;
}

/** One dot at spec frame `f`: a pure function of `f` and the dot's column, cell and place. */
export function dotState(f: number, dot: DotInput, cols: number): DotState {
  const g = at(f);
  const base = dot.on ? growRadius(g, dot.c, cols) : cellClock.restRadius;
  const e = mergeProgress(g);
  const rest: DotState = dot.on
    ? { radius: base, inkMix: 1, alpha: 1 }
    : { radius: base, inkMix: e, alpha: cellClock.offAlpha + (1 - cellClock.offAlpha) * e };
  if (e === 0) return rest;
  if (!dot.inPanel) return { ...rest, radius: base * (1 - e) };
  return { ...rest, radius: base + (cellClock.panelRadius - base) * e };
}

// ---------------------------------------------------------------------------------------------
// Sampling

/** What the sampler is asked to rasterise: the headline at the grid's own size. */
export interface SampleRequest {
  text: string;
  fontFamily: string;
  weight: number;
  letterSpacing: string;
  /** Font size in frame pixels. */
  fontSize: number;
  /** The headline's centre x and its baseline y in frame pixels. */
  x: number;
  baseline: number;
  cols: number;
  rows: number;
  pitch: number;
}

/** The on/off grid, row-major: `on[r * cols + c]`. */
export interface CellGrid {
  cols: number;
  rows: number;
  on: readonly boolean[];
}

/** Reads the headline's cells. Injectable, so tests give a fixed grid and need no canvas. */
export type Sampler = (request: SampleRequest) => CellGrid;

/**
 * [D] The headline drawn once on an offscreen canvas of `cols x rows` pixels, one pixel a cell, so
 * the pixel's alpha is the coverage at the dot's centre: a cell is on at 0.5 or more.
 */
export const canvasSampler: Sampler = (request) => {
  const { cols, rows, pitch } = request;
  if (typeof document === 'undefined')
    throw new Error('cell-type: no canvas to sample the headline on.');
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('cell-type: no 2d context to sample the headline on.');
  ctx.scale(1 / pitch, 1 / pitch);
  ctx.font = `${request.weight} ${request.fontSize}px ${request.fontFamily}`;
  ctx.letterSpacing = request.letterSpacing;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#000';
  ctx.fillText(request.text, request.x, request.baseline);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const on: boolean[] = [];
  for (let i = 0; i < cols * rows; i++) {
    on.push((data[i * 4 + 3] ?? 0) / 255 >= cellGeometry.alphaOn);
  }
  return { cols, rows, on };
};

const gridCache = new Map<string, CellGrid>();

const sampleKey = (r: SampleRequest): string =>
  [
    r.text,
    r.fontFamily,
    r.weight,
    r.letterSpacing,
    r.fontSize,
    r.x,
    r.baseline,
    r.cols,
    r.rows,
    r.pitch,
  ].join('|');

/**
 * The headline's grid, memoised in a module `Map` keyed by text, font and size (and the place it is
 * set at): a pure cache of a pure function, not state carried across frames.
 */
export function sampleCells(request: SampleRequest, sampler: Sampler = canvasSampler): CellGrid {
  const key = sampleKey(request);
  const known = gridCache.get(key);
  if (known) return known;
  const grid = sampler(request);
  gridCache.set(key, grid);
  return grid;
}

/** Empties the cache; for tests. */
export const clearCellCache = (): void => gridCache.clear();

// ---------------------------------------------------------------------------------------------
// Layout

export interface CellHeadline {
  textId: string;
  text: string;
  fit: SpecFit;
  /** Centre x, cap-box centre y and baseline y in frame pixels. */
  x: number;
  centreY: number;
  baseline: number;
  width: number;
  capHeight: number;
  /** The ink box: the cap band over the fitted width. */
  rect: Rect;
}

/** A panel in whole cells (`c1` and `r1` exclusive) and in frame pixels. */
export interface CellPanel {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  rect: Rect;
  radius: number;
  /** True when the padded ink box ran past the grid and was cut to it. */
  clamped: boolean;
}

export interface CellLayout {
  /** The pitch `p` in frame pixels. */
  pitch: number;
  cols: number;
  rows: number;
  headline: CellHeadline;
  panel: CellPanel;
}

export type CellLayoutResult =
  | { ok: true; layout: CellLayout }
  | { ok: false; issues: CellIssue[] };

export interface CellOptions {
  radius?: number;
}

/** Dot `(c, r)`'s centre in frame pixels. */
export const dotCentre = (pitch: number, c: number, r: number): { x: number; y: number } => ({
  x: (c + 0.5) * pitch,
  y: (r + 0.5) * pitch,
});

/** The pitch and grid of a stage: `p = S / 40`, 71 x 40 at 16:9, 40 x 71 at 9:16, 40 x 40 at 1:1. */
export const gridOf = (stage: Pick<Stage, 'width' | 'height'>) => {
  const pitch = Math.min(stage.width, stage.height) / cellGeometry.cellsOnShortSide;
  return {
    pitch,
    cols: Math.round(stage.width / pitch),
    rows: Math.round(stage.height / pitch),
  };
};

const px = (value: number) => `${Math.round(value)} px`;
const EPS = 1e-6;

/**
 * Lays the scene out, or says which copy does not fit. Fit or fail: the headline is set at the
 * smaller of `capD` and the size that fits one line of the stated width, and copy that needs
 * glyphs under 7 cells tall, or a cap height under `capS`, is refused naming its text id.
 */
export function cellLayout(
  text: readonly CellText[],
  stage: Stage,
  fitCopy: Fitter,
  options: CellOptions = {},
): CellLayoutResult {
  const issues: CellIssue[] = [];
  const o: Orientation = stage.orientation;
  const { pitch, cols, rows } = gridOf(stage);
  const item = text.find((t) => t.role === 'headline');
  if (!item) {
    return {
      ok: false,
      issues: [{ textId: 'headline', message: 'The scene has no headline.', fix: 'Add one.' }],
    };
  }
  const { min, max } = cellGeometry.words;
  const count = words(item.value).length;
  const chars = [...item.value.trim()].length;
  if (count < min || count > max || chars > cellGeometry.maxChars) {
    issues.push({
      textId: item.id,
      message: `The headline "${item.value}" is ${count} word(s) of ${chars} characters, and it takes ${min} to ${max} words of at most ${cellGeometry.maxChars} characters.`,
      fix: 'Shorten the headline.',
    });
  }
  const limit = stage.width * cellGeometry.textWidth[o];
  const box = { width: limit, maxLines: 1 };
  const fit = fitCopy(item.value, cellStyle, box);
  const floor = fitCopy(item.value, floorStyle, box).targetSize;
  const capHeight = fit.metrics.cap * fit.fontSize;
  const minCap = cellGeometry.minGlyphCells * pitch;
  if (fit.lines.length !== 1 || fit.fontSize < Math.floor(floor)) {
    issues.push({
      textId: item.id,
      message: `The headline "${item.value}" does not fit on one line of ${px(limit)} at its smallest size, the cap height of ${px(specPx(stage, specType.capS))}.`,
      fix: 'Shorten the headline.',
    });
  } else if (capHeight < minCap - EPS) {
    issues.push({
      textId: item.id,
      message: `The headline "${item.value}" fits one line of ${px(limit)} only at a cap height of ${px(capHeight)}, under ${cellGeometry.minGlyphCells} cells (${px(minCap)}) of ${px(pitch)}.`,
      fix: 'Shorten the headline.',
    });
  }
  if (issues.length > 0) return { ok: false, issues };

  const x = stage.width / 2;
  const centreY = stage.height * cellGeometry.textY[o];
  const rect = {
    x: x - fit.width / 2,
    y: centreY - capHeight / 2,
    width: fit.width,
    height: capHeight,
  };
  const headline: CellHeadline = {
    textId: item.id,
    text: item.value,
    fit,
    x,
    centreY,
    baseline: centreY + capHeight / 2,
    width: fit.width,
    capHeight,
    rect,
  };

  // The ink box padded by 2 cells, snapped outwards to whole cells, then cut to the grid.
  const pad = cellGeometry.panelPad;
  const c0 = Math.floor(rect.x / pitch - pad + EPS);
  const r0 = Math.floor(rect.y / pitch - pad + EPS);
  const c1 = Math.ceil((rect.x + rect.width) / pitch + pad - EPS);
  const r1 = Math.ceil((rect.y + rect.height) / pitch + pad - EPS);
  const panel: CellPanel = {
    c0: Math.max(0, c0),
    r0: Math.max(0, r0),
    c1: Math.min(cols, c1),
    r1: Math.min(rows, r1),
    rect: { x: 0, y: 0, width: 0, height: 0 },
    radius: specPx(stage, options.radius ?? fallbackRadius),
    clamped: c0 < 0 || r0 < 0 || c1 > cols || r1 > rows,
  };
  panel.rect = {
    x: panel.c0 * pitch,
    y: panel.r0 * pitch,
    width: (panel.c1 - panel.c0) * pitch,
    height: (panel.r1 - panel.r0) * pitch,
  };
  return { ok: true, layout: { pitch, cols, rows, headline, panel } };
}

/** The error a scene that cannot be laid out stops the render with, naming each text id. */
export function cellErrorMessage(
  where: string,
  stage: Pick<Stage, 'width' | 'height'>,
  issues: readonly CellIssue[],
): string {
  const lines = issues.map(({ textId, message, fix }) => `- text "${textId}": ${message} ${fix}`);
  return `Layout error in cell-type ${where} at ${stage.width}x${stage.height}: ${issues.length} item(s) do not fit, and type is never shrunk to fit.\n${lines.join('\n')}`;
}

/** The layout, or the layout error that stops the render. */
export function cellLayoutOrThrow(
  where: string,
  text: readonly CellText[],
  stage: Stage,
  fitCopy: Fitter,
  options: CellOptions = {},
): CellLayout {
  const result = cellLayout(text, stage, fitCopy, options);
  if (!result.ok) throw new Error(cellErrorMessage(where, stage, result.issues));
  return result.layout;
}

/** The request that samples this layout's headline. */
export const sampleRequestOf = (layout: CellLayout): SampleRequest => ({
  text: layout.headline.text,
  fontFamily: layout.headline.fit.fontFamily,
  weight: layout.headline.fit.weight,
  letterSpacing: layout.headline.fit.letterSpacing,
  fontSize: layout.headline.fit.fontSize,
  x: layout.headline.x,
  baseline: layout.headline.baseline,
  cols: layout.cols,
  rows: layout.rows,
  pitch: layout.pitch,
});

// ---------------------------------------------------------------------------------------------
// State

export interface CellDot extends DotState {
  c: number;
  r: number;
  /** Centre in frame pixels, before the scene's scale. */
  x: number;
  y: number;
  on: boolean;
  inPanel: boolean;
}

export interface CellState {
  /** Scale about the frame centre, for the whole scene. */
  scale: number;
  /** From `f = 90`: draw the solid panel and skip the dots. */
  solid: boolean;
  /** The panel as a solid `ink` rectangle with this corner radius; drawn only when `solid`. */
  panel: { rect: Rect; radius: number };
  /**
   * The headline's solid glyphs, knocked out in the ground colour from `f = 90`. Its place and size
   * are the layout's on every frame, so the knock-out sits where the dot glyphs were.
   */
  glyph: { x: number; baseline: number; fontSize: number; rect: Rect; knockedOut: boolean };
  dots: CellDot[];
  /** True from `f = 108`: the last state holds, the drift still running. */
  holding: boolean;
}

export const inPanel = (panel: CellPanel, c: number, r: number): boolean =>
  c >= panel.c0 && c < panel.c1 && r >= panel.r0 && r < panel.r1;

/** Everything the scene draws at spec frame `f`: a pure function of the layout, the grid and `f`. */
export function cellState(layout: CellLayout, grid: CellGrid, f: number): CellState {
  const frame = at(f);
  const { cols, rows, pitch, panel, headline } = layout;
  const dots: CellDot[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = grid.on[r * grid.cols + c] === true;
      const inside = inPanel(panel, c, r);
      dots.push({
        c,
        r,
        ...dotCentre(pitch, c, r),
        on,
        inPanel: inside,
        ...dotState(frame, { c, on, inPanel: inside }, cols),
      });
    }
  }
  return {
    scale: driftScale(frame),
    solid: isSolid(frame),
    panel: { rect: panel.rect, radius: panel.radius },
    glyph: {
      x: headline.x,
      baseline: headline.baseline,
      fontSize: headline.fit.fontSize,
      rect: headline.rect,
      knockedOut: isSolid(frame),
    },
    dots,
    holding: frame > cellClock.last,
  };
}

/** The anchor `panel`: the panel box, at rest. */
export const panelBox = (layout: CellLayout): Rect => layout.panel.rect;
