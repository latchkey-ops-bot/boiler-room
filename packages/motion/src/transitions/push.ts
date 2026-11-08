import type { CSSProperties } from 'react';
import { bezier } from '../core/time.ts';
import type { Stage } from '../layout/stage.ts';
import { easing } from '../tokens.ts';
import { type TransitionWindow, windowProgress } from './timeline.ts';

const curve = bezier(easing.expressive);

/** A tall frame pushes up, the way a phone feed moves. Everything else pushes sideways. */
export const pushAxis = ({ orientation }: Stage): 'x' | 'y' =>
  orientation === 'portrait' ? 'y' : 'x';

export const pushProgress = (frame: number, window: TransitionWindow): number =>
  curve(windowProgress(frame, window));

const translate = (axis: 'x' | 'y', pixels: number) =>
  axis === 'x' ? `translateX(${pixels}px)` : `translateY(${pixels}px)`;

/** The incoming scene and the outgoing one move as one sheet, with no gap between them. */
export function pushStyle(
  progress: number,
  side: 'in' | 'out',
  stage: Stage,
): Pick<CSSProperties, 'transform'> {
  const axis = pushAxis(stage);
  const travel = axis === 'x' ? stage.width : stage.height;
  const pixels = side === 'out' ? -progress * travel : (1 - progress) * travel;
  return { transform: translate(axis, pixels) };
}
