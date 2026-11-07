import { getLength, getPointAtLength } from '@remotion/paths';
import { MousePointer2 } from 'lucide-react';
import { useBrand } from '../brand/brand-context.tsx';
import type { Point } from '../core/camera.ts';

/** A gentle arc from one point to another, bowing to one side like a hand on a mouse. */
export function cursorPath(from: Point, to: Point): string {
  const control = {
    x: (from.x + to.x) / 2 + (to.y - from.y) * 0.25,
    y: (from.y + to.y) / 2 - (to.x - from.x) * 0.25,
  };
  return `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`;
}

/** The point `t` of the way along a path. */
export function alongPath(path: string, t: number): Point {
  const point = getPointAtLength(path, getLength(path) * t);
  if (!point) throw new Error(`No point ${t} of the way along ${path}.`);
  return { x: point.x, y: point.y };
}

/** Where the tip of the arrow sits in the icon's box. */
const TIP = 0.17;

export const Cursor = ({
  at,
  size,
  pressed,
  opacity,
}: {
  at: Point;
  size: number;
  /** 0 at rest, 1 fully pressed. */
  pressed: number;
  opacity: number;
}) => {
  const { colors } = useBrand();
  return (
    <div
      style={{
        height: size,
        left: at.x - size * TIP,
        opacity,
        position: 'absolute',
        top: at.y - size * TIP,
        transform: `scale(${1 - pressed * 0.14})`,
        transformOrigin: `${TIP * 100}% ${TIP * 100}%`,
        width: size,
      }}
    >
      <MousePointer2
        color={colors.background}
        fill={colors.foreground}
        size={size}
        strokeWidth={1.2}
      />
    </div>
  );
};

/** The ring a click leaves. `progress` runs from 0 to 1 once per click. */
export const ClickRing = ({
  at,
  size,
  progress,
}: {
  at: Point;
  size: number;
  progress: number;
}) => {
  const { colors } = useBrand();
  if (progress <= 0 || progress >= 1) return null;
  const diameter = size * (0.4 + progress * 1.6);
  return (
    <div
      style={{
        border: `${size * 0.05}px solid ${colors.primary}`,
        borderRadius: '50%',
        height: diameter,
        left: at.x - diameter / 2,
        opacity: 1 - progress,
        position: 'absolute',
        top: at.y - diameter / 2,
        width: diameter,
      }}
    />
  );
};
