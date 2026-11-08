import type { FORMATS } from '@boiler-room/schema';
import type { Rect } from './rect.ts';

export type Format = (typeof FORMATS)[number];

export const FORMAT_SIZES: Record<Format, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

export type Orientation = 'landscape' | 'portrait' | 'square';

/** The composition, read for layout. Scenes lay out from this and never from a format name. */
export interface Stage {
  width: number;
  height: number;
  orientation: Orientation;
  /** 1% of the short side, which sizes everything so that all formats share one scale. */
  unit: number;
  /** Where content may sit. Tall video keeps clear of the captions and buttons apps draw on top. */
  safe: Rect;
}

/**
 * The safe areas of `docs/motion/scenes/README.md`, as shares of the frame: 96 and 54 px at 16:9,
 * 54 px at the sides with 192 above and 288 below at 9:16, and 54 px all round at 1:1.
 */
const SAFE_INSETS: Record<Orientation, { side: number; top: number; bottom: number }> = {
  landscape: { side: 0.05, top: 0.05, bottom: 0.05 },
  portrait: { side: 0.05, top: 0.1, bottom: 0.15 },
  square: { side: 0.05, top: 0.05, bottom: 0.05 },
};

function orientationOf(width: number, height: number): Orientation {
  const ratio = width / height;
  if (ratio > 1.2) return 'landscape';
  return ratio < 0.8 ? 'portrait' : 'square';
}

export function stageFor(width: number, height: number): Stage {
  const orientation = orientationOf(width, height);
  const { side, top, bottom } = SAFE_INSETS[orientation];
  return {
    width,
    height,
    orientation,
    unit: Math.min(width, height) / 100,
    safe: {
      x: Math.round(width * side),
      y: Math.round(height * top),
      width: Math.round(width * (1 - side * 2)),
      height: Math.round(height * (1 - top - bottom)),
    },
  };
}
