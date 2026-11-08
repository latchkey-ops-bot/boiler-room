import { clamp, lerp } from './time.ts';

export interface Point {
  x: number;
  y: number;
}

/**
 * What a viewport shows of an image: the point at its centre, as a fraction of the image, and how
 * far it is zoomed. `center` is always legal for `zoom`, so the viewport never shows past the edge.
 */
export interface Pose {
  center: Point;
  zoom: number;
}

export const WHOLE_IMAGE: Pose = { center: { x: 0.5, y: 0.5 }, zoom: 1 };

/** The pose that shows as much of `focus` as `zoom` allows without leaving the image. */
export function poseAt(focus: Point, zoom: number): Pose {
  const zoomed = Math.max(1, zoom);
  const margin = 0.5 / zoomed;
  return {
    center: {
      x: clamp(focus.x, margin, 1 - margin),
      y: clamp(focus.y, margin, 1 - margin),
    },
    zoom: zoomed,
  };
}

/** Zoom moves geometrically, because a linear zoom looks like it is speeding up. */
export const lerpPose = (from: Pose, to: Pose, t: number): Pose =>
  poseAt(
    { x: lerp(from.center.x, to.center.x, t), y: lerp(from.center.y, to.center.y, t) },
    from.zoom * (to.zoom / from.zoom) ** t,
  );

/** Where a point of the image lands in the viewport, both as fractions. */
export const imageToViewport = ({ center, zoom }: Pose, point: Point): Point => ({
  x: (point.x - center.x) * zoom + 0.5,
  y: (point.y - center.y) * zoom + 0.5,
});

/** The CSS transform of an image that fills its viewport. Its origin must be the top left. */
export const poseTransform = ({ center, zoom }: Pose): string => {
  const shift = (axis: number) => (0.5 / zoom - axis) * 100;
  return `scale(${zoom}) translate(${shift(center.x)}%, ${shift(center.y)}%)`;
};
