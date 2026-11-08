/**
 * Type for the scene library, sized from cap height as `docs/motion/scenes/README.md` says:
 * `fontSize = capPx / capRatio`, where `capRatio` is the ink height of "H" in the loaded font,
 * measured once per font on a canvas. Copy is fitted at that size and only ever made smaller to fit
 * its box, never larger.
 */
import { measureText } from '@remotion/layout-utils';
import { useBrand } from '../brand/brand-context.tsx';
import { type FitResult, fitBlock, type TextMeasure } from '../layout/fit.ts';
import type { Stage } from '../layout/stage.ts';
import { specType } from '../tokens.ts';

/** How a font's ink sits in its em, as shares of the font size. */
export interface FontMetrics {
  cap: number;
  ascent: number;
  descent: number;
}

/** Typical of a Latin face, for when no canvas can measure, as in unit tests. */
const FALLBACK: FontMetrics = { cap: 0.7, ascent: 0.95, descent: 0.25 };
const PROBE_SIZE = 200;
const metricsCache = new Map<string, FontMetrics>();

/**
 * The metrics of a loaded font. Scenes mount only once the brand fonts are loaded, so the first
 * measurement in a tab is already of the right font, and every tab measures the same file.
 */
export function fontMetrics(fontFamily: string, weight: number): FontMetrics {
  const key = `${fontFamily}|${weight}`;
  const known = metricsCache.get(key);
  if (known) return known;
  let metrics = FALLBACK;
  const context =
    typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (context) {
    context.font = `${weight} ${PROBE_SIZE}px ${fontFamily}`;
    const ink = context.measureText('H');
    if (ink.actualBoundingBoxAscent > 0) {
      metrics = {
        cap: ink.actualBoundingBoxAscent / PROBE_SIZE,
        ascent: ink.fontBoundingBoxAscent / PROBE_SIZE,
        descent: ink.fontBoundingBoxDescent / PROBE_SIZE,
      };
    }
  }
  metricsCache.set(key, metrics);
  return metrics;
}

/** Spec pixels, which are pixels at a short side of 1080, on this stage. */
export const specPx = (stage: Pick<Stage, 'width' | 'height'>, value: number): number =>
  (value * Math.min(stage.width, stage.height)) / 1080;

/** The widest a line of copy may be on this stage. */
export const lineBox = (stage: Stage): number => stage.width * specType.lineBox[stage.orientation];

export interface SpecTypeStyle {
  font: 'display' | 'body';
  weight: number;
  /** Cap height in spec pixels. */
  cap: number;
  lineHeight?: number;
  letterSpacing?: string;
}

export interface SpecFit extends FitResult {
  fontFamily: string;
  weight: number;
  lineHeight: number;
  letterSpacing: string;
  metrics: FontMetrics;
  /** The size the copy was asked to be, before any fitting. */
  targetSize: number;
}

function measurer(fontFamily: string, weight: number, letterSpacing: string): TextMeasure {
  return {
    widthOf: (line: string, fontSize: number) =>
      measureText({
        text: line,
        fontFamily,
        fontSize,
        fontWeight: weight,
        letterSpacing,
        validateFontIsLoaded: true,
      }).width,
  };
}

const fitCache = new Map<string, SpecFit>();

/**
 * Fits copy at its cap height into a box, on at most `maxLines` lines. It is a pure function of
 * its arguments once the font is loaded, memoised in a module `Map` keyed by everything it reads,
 * so an anchor's `box` can call it on any frame, in any tab, in any order.
 */
export function specFit(
  text: string,
  style: SpecTypeStyle,
  stage: Pick<Stage, 'width' | 'height'>,
  box: { width: number; maxLines: number },
  fonts: { display: string; body: string },
): SpecFit {
  const fontFamily = fonts[style.font];
  const lineHeight = style.lineHeight ?? specType.lineHeight;
  const letterSpacing = style.letterSpacing ?? specType.tracking;
  const { weight, cap } = style;
  const key = [text, fontFamily, weight, cap, lineHeight, letterSpacing, stage.width, stage.height]
    .concat([box.width, box.maxLines])
    .join('|');
  const known = fitCache.get(key);
  if (known) return known;
  const metrics = fontMetrics(fontFamily, weight);
  const targetSize = specPx(stage, cap) / metrics.cap;
  const fit = fitBlock(
    {
      text,
      maxWidth: box.width,
      maxHeight: Number.POSITIVE_INFINITY,
      maxSize: targetSize,
      maxLines: box.maxLines,
      lineHeight,
    },
    measurer(fontFamily, weight, letterSpacing),
  );
  const result = { ...fit, fontFamily, weight, lineHeight, letterSpacing, metrics, targetSize };
  fitCache.set(key, result);
  return result;
}

/**
 * Copy fitted at a cap height of at least `style.cap` spec px, fit or fail. `specFit` sets the
 * largest whole size at or under the size it is asked for, so it is asked for the whole size just
 * over the cap: a 78 px cap is never drawn at 77.7. `fits` is false when the copy needs a smaller
 * size than that, or more lines than `box.maxLines`.
 */
export function specFitAtCap(
  text: string,
  style: SpecTypeStyle,
  stage: Pick<Stage, 'width' | 'height'>,
  box: { width: number; maxLines: number },
  fonts: { display: string; body: string },
): { fit: SpecFit; size: number; fits: boolean } {
  const metrics = fontMetrics(fonts[style.font], style.weight);
  const size = Math.ceil(specPx(stage, style.cap) / metrics.cap - 1e-9);
  const asked = ((size + 1e-6) * metrics.cap * 1080) / Math.min(stage.width, stage.height);
  const fit = specFit(text, { ...style, cap: asked }, stage, box, fonts);
  const fits = fit.fontSize >= size && fit.lines.length > 0 && fit.lines.length <= box.maxLines;
  return { fit, size, fits };
}

/** `specFit` with the brand's fonts, as a hook. */
export function useSpecFit(
  text: string,
  style: SpecTypeStyle,
  stage: Stage,
  box: { width: number; maxLines: number },
): SpecFit {
  const { fonts } = useBrand();
  return specFit(text, style, stage, box, fonts);
}

/** The width of a run of copy in a fitted face, at a size of its own. */
export const widthAt = (
  fit: Pick<SpecFit, 'fontFamily' | 'weight' | 'letterSpacing'>,
  text: string,
  fontSize: number,
): number => measurer(fit.fontFamily, fit.weight, fit.letterSpacing).widthOf(text, fontSize);

/** The width of each word, and of the space between words, at a fitted size. */
export function wordWidths(
  fit: SpecFit,
  words: readonly string[],
): { words: number[]; space: number } {
  const one = widthAt(fit, 'x', fit.fontSize);
  return {
    words: words.map((word) => widthAt(fit, word, fit.fontSize)),
    space: Math.max(0, widthAt(fit, 'x x', fit.fontSize) - one * 2),
  };
}

/**
 * The distance from the top of a line box to its baseline, which is how a line is placed by its
 * baseline: CSS centres the font's ascent and descent in the line height.
 */
export const baselineOffset = (fit: Pick<SpecFit, 'fontSize' | 'lineHeight' | 'metrics'>) => {
  const { ascent, descent } = fit.metrics;
  return ((fit.lineHeight - ascent - descent) / 2 + ascent) * fit.fontSize;
};
