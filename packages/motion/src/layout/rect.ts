import { lerp } from '../core/time.ts';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Align = 'start' | 'center' | 'end';

const offset = (spare: number, align: Align) =>
  align === 'start' ? 0 : align === 'center' ? spare / 2 : spare;

/** The largest rect of this aspect inside a box. Nothing is cropped, by construction. */
export function fitContain(
  box: Rect,
  aspect: number,
  alignX: Align = 'center',
  alignY = alignX,
): Rect {
  const width = Math.min(box.width, box.height * aspect);
  const height = width / aspect;
  return {
    x: box.x + offset(box.width - width, alignX),
    y: box.y + offset(box.height - height, alignY),
    width,
    height,
  };
}

/** Cuts a rect in two along an axis, with a gap between them. `ratio` is the first part's share. */
export function split(
  rect: Rect,
  axis: 'x' | 'y',
  ratio: number,
  gap: number,
): readonly [first: Rect, second: Rect] {
  const size = axis === 'x' ? rect.width : rect.height;
  const first = (size - gap) * ratio;
  const second = size - gap - first;
  if (axis === 'x') {
    return [
      { ...rect, width: first },
      { ...rect, x: rect.x + first + gap, width: second },
    ];
  }
  return [
    { ...rect, height: first },
    { ...rect, y: rect.y + first + gap, height: second },
  ];
}

export const lerpRect = (from: Rect, to: Rect, t: number): Rect => ({
  x: lerp(from.x, to.x, t),
  y: lerp(from.y, to.y, t),
  width: lerp(from.width, to.width, t),
  height: lerp(from.height, to.height, t),
});

/** True when `inner` is inside `outer`, allowing for sub-pixel rounding. */
export const contains = (outer: Rect, inner: Rect): boolean => {
  const slack = 0.5;
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
};

export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
