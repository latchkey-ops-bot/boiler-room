import { stagger } from '../tokens.ts';
import { framesFor } from './time.ts';

export interface StaggerOptions {
  /** Seconds between neighbours. */
  each?: number;
  /** Seconds the whole run may take. */
  maxSpread?: number;
}

/**
 * The delay of each of `count` items, in whole frames from the first. The gap narrows once the run
 * would pass `maxSpread`, so a long headline lands in the same time as a short one.
 */
export function staggerDelays(
  count: number,
  fps: number,
  { each = stagger.item, maxSpread = stagger.maxSpread }: StaggerOptions = {},
): number[] {
  if (count <= 0) return [];
  const gaps = count - 1;
  const spread = gaps * framesFor(each, fps);
  const limit = framesFor(maxSpread, fps);
  const scale = spread > limit ? limit / spread : 1;
  return Array.from({ length: count }, (_, index) =>
    Math.round(index * framesFor(each, fps) * scale),
  );
}
