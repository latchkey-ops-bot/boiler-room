import type { CSSProperties, ReactNode } from 'react';
import { Img } from 'remotion';
import { useBrand } from '../brand/brand-context.tsx';
import { type Pose, poseTransform } from '../core/camera.ts';
import type { Rect } from '../layout/rect.ts';
import { chromeHeight } from '../layout/scenes.ts';

export interface BrowserFrameProps {
  rect: Rect;
  src: string;
  pose: Pose;
  /** Drawn over the frame and not clipped by it, such as a cursor. */
  overlay?: ReactNode;
  style?: CSSProperties;
}

/**
 * A browser window around an image. The address bar is a shape with no text in it: a URL would be
 * copy that does not come from `scene.text`. Its colours follow the brand, which is why this is
 * drawn here and not taken from a mockup package with a fixed palette.
 */
export const BrowserFrame = ({ rect, src, pose, overlay, style }: BrowserFrameProps) => {
  const { colors, radius } = useBrand();
  const chrome = chromeHeight(rect.width);
  const dot = chrome * 0.26;
  return (
    <div
      style={{
        ...style,
        boxShadow: `0 ${rect.width * 0.03}px ${rect.width * 0.09}px ${colors.shadow}`,
        borderRadius: radius,
        height: rect.height,
        left: rect.x,
        position: 'absolute',
        top: rect.y,
        width: rect.width,
      }}
    >
      <div
        style={{
          background: colors.surface,
          borderRadius: radius,
          boxShadow: `inset 0 0 0 1px ${colors.hairline}`,
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
        }}
      >
        <div
          style={{
            alignItems: 'center',
            background: colors.chrome,
            display: 'flex',
            gap: dot * 0.7,
            height: chrome,
            paddingLeft: chrome * 0.45,
            position: 'relative',
          }}
        >
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              style={{ background: colors.hairline, borderRadius: dot, height: dot, width: dot }}
            />
          ))}
          <div
            style={{
              background: colors.surface,
              borderRadius: chrome,
              height: chrome * 0.52,
              left: '30%',
              position: 'absolute',
              right: '30%',
            }}
          />
        </div>
        <div style={{ inset: `${chrome}px 0 0 0`, overflow: 'hidden', position: 'absolute' }}>
          <Img
            src={src}
            style={{
              display: 'block',
              height: '100%',
              transform: poseTransform(pose),
              transformOrigin: '0 0',
              width: '100%',
            }}
          />
        </div>
      </div>
      {overlay}
    </div>
  );
};
