import { measureText } from '@remotion/layout-utils';
import { type CSSProperties, useMemo } from 'react';
import { useBrand } from '../brand/brand-context.tsx';
import type { BrandTheme } from '../brand/theme.ts';
import { type FitResult, fitBlock, type TextMeasure } from '../layout/fit.ts';
import { useStage } from './scene-runtime.tsx';

export interface TextSpec {
  font: 'display' | 'body';
  weight: number;
  lineHeight: number;
  /** Stage units. */
  maxSize: number;
  maxLines: number;
  letterSpacing?: string;
  upperCase?: boolean;
  color: (theme: BrandTheme) => string;
}

/** Keeps the measured width just inside the box, since words are measured apart from each other. */
const WIDTH_MARGIN = 0.985;

/** Measures lines with `@remotion/layout-utils`, in the role's font as it will be drawn. */
function measurer(fontFamily: string, spec: TextSpec): TextMeasure {
  const shared = {
    fontFamily,
    fontWeight: spec.weight,
    letterSpacing: spec.letterSpacing,
    textTransform: spec.upperCase ? ('uppercase' as const) : undefined,
    validateFontIsLoaded: true,
  };
  return {
    widthOf: (line: string, fontSize: number) =>
      measureText({ ...shared, text: line, fontSize }).width,
  };
}

/** Fits text to a box, measured in the browser. Fonts are loaded before any scene mounts. */
function fitText(
  text: string,
  fontFamily: string,
  spec: TextSpec,
  { width, height, unit }: { width: number; height: number; unit: number },
): FitResult {
  const maxWidth = width * WIDTH_MARGIN;
  const maxSize = spec.maxSize * unit;
  return fitBlock(
    {
      text,
      maxWidth,
      maxHeight: height,
      maxSize,
      maxLines: spec.maxLines,
      lineHeight: spec.lineHeight,
    },
    measurer(fontFamily, spec),
  );
}

/** Fits several texts to one size, so that a list reads as one thing. */
export function useFits(
  texts: readonly string[],
  spec: TextSpec,
  width: number,
  height: number,
): FitResult[] {
  const { fonts } = useBrand();
  const { unit } = useStage();
  const fontFamily = fonts[spec.font];
  const key = texts.join('\n');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the contents of `texts`.
  return useMemo(() => {
    const box = { width, height, unit };
    const fits = texts.map((text) => fitText(text, fontFamily, spec, box));
    const fontSize = Math.min(...fits.map((fit) => fit.fontSize));
    return fits.map((fit) => ({
      ...fit,
      fontSize,
      height: fontSize * spec.lineHeight * fit.lines.length,
      width: fit.width * (fontSize / Math.max(1, fit.fontSize)),
    }));
  }, [key, spec, width, height, unit, fontFamily]);
}

export function useFit(text: string, spec: TextSpec, width: number, height: number): FitResult {
  const [fit] = useFits([text], spec, width, height);
  return fit as FitResult;
}

/** The CSS of a text block, once it is fitted. */
export function useTextStyle(
  spec: TextSpec,
  fit: Pick<FitResult, 'fontSize' | 'height'>,
): CSSProperties {
  const theme = useBrand();
  return {
    color: spec.color(theme),
    fontFamily: theme.fonts[spec.font],
    fontKerning: 'normal',
    fontSize: fit.fontSize,
    fontWeight: spec.weight,
    height: fit.height,
    letterSpacing: spec.letterSpacing,
    lineHeight: spec.lineHeight,
    textTransform: spec.upperCase ? 'uppercase' : undefined,
  };
}
