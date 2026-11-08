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
  /** The height of the bar across the top. 0 draws the image alone, with the frame's corners. */
  chrome?: number;
  /** Copy in the address bar, which comes from `scene.text`. Without it the bar is empty. */
  address?: { text: string; opacity?: number } | undefined;
  /**
   * False draws no shadow. A carried frame changes size every frame, and a blur that changes
   * every frame was drawn differently by tabs that had drawn different frames before it.
   */
  shadow?: boolean;
  /** Drawn over the frame and not clipped by it, such as a cursor. */
  overlay?: ReactNode;
  style?: CSSProperties;
}

/**
 * A browser window around an image, which fills the window and is cropped to it, centred. Its
 * colours follow the brand, which is why this is drawn here and not taken from a mockup package
 * with a fixed palette. The address bar shows copy only when the scene's text gives it some.
 */
/** The address is set at half the bar's height: 22 px in a bar of 44, as `site-hero` gives it. */
const ADDRESS_SHARE = 0.5;

/** The rect with its edges on whole pixels. */
const snap = ({ x, y, width, height }: Rect): Rect => {
  const left = Math.round(x);
  const top = Math.round(y);
  return {
    x: left,
    y: top,
    width: Math.round(x + width) - left,
    height: Math.round(y + height) - top,
  };
};

export const BrowserFrame = ({
  rect: exact,
  src,
  pose,
  chrome: chromeIn,
  address,
  shadow = true,
  overlay,
  style,
}: BrowserFrameProps) => {
  const { colors, radius, fonts } = useBrand();
  // Whole pixels, because Chrome reuses a blurred shadow it drew at one sub-pixel offset for the
  // next, which made a moving frame's shadow differ by the frames rendered before it.
  const rect = snap(exact);
  const chrome = Math.round(chromeIn ?? chromeHeight(rect.width));
  const dot = chrome * 0.26;
  return (
    <div
      style={{
        ...style,
        // On whole pixels, like the frame itself.
        boxShadow: shadow
          ? `0 ${Math.round(rect.width * 0.03)}px ${Math.round(rect.width * 0.09)}px ${colors.shadow}`
          : undefined,
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
        {chrome > 0 ? (
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
                alignItems: 'center',
                background: colors.surface,
                borderRadius: chrome,
                display: 'flex',
                height: chrome * 0.68,
                justifyContent: 'center',
                left: '28%',
                overflow: 'hidden',
                position: 'absolute',
                right: '28%',
              }}
            >
              {address ? (
                <div
                  style={{
                    color: colors.muted,
                    fontFamily: fonts.body,
                    fontSize: chrome * ADDRESS_SHARE,
                    lineHeight: 1,
                    opacity: address.opacity ?? 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'pre',
                  }}
                >
                  {address.text}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div style={{ inset: `${chrome}px 0 0 0`, overflow: 'hidden', position: 'absolute' }}>
          <Img
            src={src}
            style={{
              display: 'block',
              height: '100%',
              objectFit: 'cover',
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
