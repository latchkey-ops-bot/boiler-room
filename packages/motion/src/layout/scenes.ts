import type { Rect } from './rect.ts';
import type { Stage } from './stage.ts';

/** The bar across the top of a browser frame, as a share of the frame's width. */
const CHROME_SHARE = 0.042;

export const chromeHeight = (frameWidth: number): number => frameWidth * CHROME_SHARE;

/** The corner of the safe area that holds the brand mark in most scenes. */
export function markBox({ safe, unit, orientation }: Stage): Rect {
  const height = unit * (orientation === 'portrait' ? 6 : 5);
  return { x: safe.x, y: safe.y, width: safe.width * 0.46, height };
}
