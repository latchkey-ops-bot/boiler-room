import { fitContain, type Rect, split } from './rect.ts';
import type { Stage } from './stage.ts';

/** The bar across the top of a browser frame, as a share of the frame's width. */
const CHROME_SHARE = 0.042;

export const chromeHeight = (frameWidth: number): number => frameWidth * CHROME_SHARE;

/** The largest browser frame in a box that shows a whole image of this aspect, chrome included. */
export function browserFrameRect(
  box: Rect,
  imageAspect: number,
  alignX: 'start' | 'center' = 'center',
  alignY: 'start' | 'center' | 'end' = 'center',
): Rect {
  const frameAspect = 1 / (1 / imageAspect + CHROME_SHARE);
  return fitContain(box, frameAspect, alignX, alignY);
}

const gapOf = ({ unit }: Stage) => unit * 5;

/** The corner of the safe area that holds the brand mark in most scenes. */
export function markBox({ safe, unit, orientation }: Stage): Rect {
  const height = unit * (orientation === 'portrait' ? 6 : 5);
  return { x: safe.x, y: safe.y, width: safe.width * 0.46, height };
}

/** The safe area below the corner mark. */
function contentArea(stage: Stage): Rect {
  const { safe } = stage;
  const mark = markBox(stage);
  const top = mark.y + mark.height + stage.unit * 3;
  return { ...safe, y: top, height: safe.y + safe.height - top };
}

export interface TitleLayout {
  text: Rect;
}

export const titleLayout = (stage: Stage): TitleLayout => ({ text: contentArea(stage) });

export interface InterfaceLayout {
  text: Rect;
  media: Rect;
}

export function interfaceLayout(stage: Stage, imageAspect: number): InterfaceLayout {
  const area = contentArea(stage);
  const gap = gapOf(stage);
  if (stage.orientation === 'landscape') {
    const [text, column] = split(area, 'x', 0.34, gap);
    return { text, media: browserFrameRect(column, imageAspect) };
  }
  const [text, row] = split(area, 'y', stage.orientation === 'portrait' ? 0.4 : 0.34, gap);
  return { text, media: browserFrameRect(row, imageAspect, 'center', 'start') };
}

export interface FeatureLayout {
  text: Rect;
  media: Rect | undefined;
}

export function featureLayout(stage: Stage, imageAspect: number | undefined): FeatureLayout {
  const area = contentArea(stage);
  if (imageAspect === undefined) return { text: area, media: undefined };
  const gap = gapOf(stage);
  if (stage.orientation === 'landscape') {
    const [column, text] = split(area, 'x', 0.58, gap);
    return { text, media: browserFrameRect(column, imageAspect) };
  }
  const [row, text] = split(area, 'y', stage.orientation === 'portrait' ? 0.4 : 0.46, gap);
  return { text, media: browserFrameRect(row, imageAspect, 'center', 'start') };
}

export interface CtaLayout {
  mark: Rect;
  text: Rect;
  button: Rect;
}

/** The copy of an end card reads as one group with its mark and button, not spread to the edges. */
const CTA_TEXT_UNITS = 44;

export function ctaLayout(stage: Stage): CtaLayout {
  const { safe, unit } = stage;
  const gap = unit * 4;
  const markHeight = unit * 11;
  const buttonHeight = unit * 13;
  const textHeight = Math.min(
    safe.height - markHeight - buttonHeight - gap * 2,
    unit * CTA_TEXT_UNITS,
  );
  const group = markHeight + textHeight + buttonHeight + gap * 2;
  const top = safe.y + (safe.height - group) / 2;
  const row = (y: number, height: number): Rect => ({ x: safe.x, y, width: safe.width, height });
  return {
    mark: row(top, markHeight),
    text: row(top + markHeight + gap, textHeight),
    button: row(top + markHeight + gap + textHeight + gap, buttonHeight),
  };
}
