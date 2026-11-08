import { describe, expect, it } from 'vitest';
import {
  imageToViewport,
  lerpPose,
  type Pose,
  poseAt,
  poseTransform,
  WHOLE_IMAGE,
} from '../src/core/camera.ts';

/** The part of the image a pose shows, as fractions of the image. */
const shown = ({ center, zoom }: Pose) => ({
  left: center.x - 0.5 / zoom,
  right: center.x + 0.5 / zoom,
  top: center.y - 0.5 / zoom,
  bottom: center.y + 0.5 / zoom,
});

describe('camera', () => {
  it('never shows past the edge of the image', () => {
    for (const x of [0, 0.1, 0.5, 0.95, 1]) {
      for (const zoom of [0.5, 1, 1.4, 3]) {
        const view = shown(poseAt({ x, y: 1 - x }, zoom));
        expect(view.left).toBeGreaterThanOrEqual(-1e-9);
        expect(view.top).toBeGreaterThanOrEqual(-1e-9);
        expect(view.right).toBeLessThanOrEqual(1 + 1e-9);
        expect(view.bottom).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('puts the centre of the pose in the middle of the viewport', () => {
    const pose = poseAt({ x: 0.7, y: 0.4 }, 2);
    expect(imageToViewport(pose, pose.center)).toEqual({ x: 0.5, y: 0.5 });
    expect(imageToViewport(WHOLE_IMAGE, { x: 0.2, y: 0.9 })).toEqual({ x: 0.2, y: 0.9 });
  });

  it('starts and ends a move on its two poses, and zooms geometrically', () => {
    const to = poseAt({ x: 0.7, y: 0.4 }, 4);
    expect(lerpPose(WHOLE_IMAGE, to, 0)).toEqual(WHOLE_IMAGE);
    expect(lerpPose(WHOLE_IMAGE, to, 1)).toEqual(to);
    expect(lerpPose(WHOLE_IMAGE, to, 0.5).zoom).toBeCloseTo(2);
  });

  it('writes a transform that leaves the whole image untouched', () => {
    expect(poseTransform(WHOLE_IMAGE)).toBe('scale(1) translate(0%, 0%)');
  });
});
