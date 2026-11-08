import type { CSSProperties, ReactNode } from 'react';
import { morphBox } from '../core/curves.ts';
import type { Rect } from '../layout/rect.ts';

/**
 * `MorphBox`, T8, the container morph of `docs/motion/transitions.md`: one rounded rectangle
 * changes shape instead of crossfading to a new object. The old contents fade out over 6 frames,
 * the width moves over `[6, 18)` and the height over `[18, 45)`, both on `step.short`'s shape, and
 * the new contents pop in at full opacity on frame 45, never fading in. The box keeps the centre of
 * `from` and `to` on the same curve. Contents are absolutely positioned and never scale with it, so
 * type is never distorted: lay them out in the box's own coordinates.
 */
export const MorphBox = ({
  f,
  from,
  to,
  radius,
  style,
  before,
  after,
}: {
  /** Spec frames from the start of the morph. */
  f: number;
  from: Rect;
  to: Rect;
  radius: number;
  style?: CSSProperties;
  /** What the box holds before it changes shape. */
  before?: ReactNode;
  /** What it holds once it has, from frame 45. */
  after?: ReactNode;
}) => {
  const state = morphBox(f, from, to);
  const centreX = from.x + from.width / 2;
  const centreY = from.y + from.height / 2;
  const toX = to.x + to.width / 2;
  const toY = to.y + to.height / 2;
  const widthShare =
    to.width === from.width ? 1 : (state.width - from.width) / (to.width - from.width);
  const heightShare =
    to.height === from.height ? 1 : (state.height - from.height) / (to.height - from.height);
  const x = centreX + (toX - centreX) * widthShare - state.width / 2;
  const y = centreY + (toY - centreY) * heightShare - state.height / 2;
  return (
    <div
      style={{
        ...style,
        borderRadius: radius,
        height: state.height,
        left: x,
        overflow: 'hidden',
        position: 'absolute',
        top: y,
        width: state.width,
      }}
    >
      {state.contentIn ? (
        <div style={{ inset: 0, position: 'absolute' }}>{after}</div>
      ) : state.contentOpacity > 0 ? (
        <div style={{ inset: 0, opacity: state.contentOpacity, position: 'absolute' }}>
          {before}
        </div>
      ) : null}
    </div>
  );
};
