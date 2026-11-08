import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { C, F, pixelFrame } from './brand.ts';

export const SIDE = 160;
const FADE = 8;

const ease = Easing.bezier(0.16, 1, 0.3, 1);

/** 0 to 1 over `duration` frames, starting at `delay`. A pure function of the frame. */
export function enter(frame: number, delay = 0, duration = 14): number {
  return interpolate(frame, [delay, delay + duration], [0, 1], {
    easing: ease,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/** A scene: the cream page, with its content fading in at the start and out at the end. */
export function SceneShell({
  duration,
  children,
  background = C.paper,
}: {
  duration: number;
  children: ReactNode;
  background?: string;
}) {
  const frame = useCurrentFrame();
  const opacity = Math.min(
    interpolate(frame, [0, FADE], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    interpolate(frame, [duration - FADE, duration], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  return (
    <AbsoluteFill style={{ backgroundColor: background }}>
      <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
}

/** Rises a little and fades in, `delay` frames into the scene. */
export function Rise({
  delay = 0,
  children,
  style,
}: {
  delay?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const p = enter(useCurrentFrame(), delay);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 28}px)`, ...style }}>
      {children}
    </div>
  );
}

/** The small upper-case label at the top of each scene. */
export function Kicker({ children, top = 96 }: { children: ReactNode; top?: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: SIDE,
        fontFamily: F.mono,
        fontWeight: 600,
        fontSize: 26,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: C.muted,
      }}
    >
      {children}
    </div>
  );
}

export const display = (size: number, color: string = C.deep): CSSProperties => ({
  fontFamily: F.display,
  fontWeight: 800,
  fontSize: size,
  lineHeight: 1.04,
  letterSpacing: '-0.02em',
  color,
  margin: 0,
});

export const body = (size: number, color: string = C.ink, weight = 600): CSSProperties => ({
  fontFamily: F.body,
  fontWeight: weight,
  fontSize: size,
  lineHeight: 1.3,
  color,
  margin: 0,
});

/** A card in the site's pixel frame. */
export function PixelBox({
  children,
  style,
  frame = C.ink,
  drop = C.sky,
  fill = C.white,
  lift = 12,
}: {
  children: ReactNode;
  style?: CSSProperties;
  frame?: string;
  drop?: string;
  fill?: string;
  lift?: number;
}) {
  return (
    <div style={{ background: fill, boxShadow: pixelFrame(frame, drop, 4, lift), ...style }}>
      {children}
    </div>
  );
}

/** Words that rise one after another: the problem section's kinetic type. */
export function Words({
  text,
  delay = 0,
  stagger = 3,
  style,
}: {
  text: string;
  delay?: number;
  stagger?: number;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const words = text.split(' ');
  return (
    <p style={style}>
      {words.map((word, i) => {
        const p = enter(frame, delay + i * stagger, 12);
        return (
          <span
            // Words repeat, so the position is the identity of each one.
            // biome-ignore lint/suspicious/noArrayIndexKey: the list never reorders
            key={i}
            style={{
              display: 'inline-block',
              opacity: p,
              transform: `translateY(${(1 - p) * 0.35}em)`,
              marginRight: '0.24em',
            }}
          >
            {word}
          </span>
        );
      })}
    </p>
  );
}

/** A small rounded tag, like the site's status pills. */
export function Pill({
  children,
  fill = C.skySoft,
  color = C.deep,
  size = 24,
}: {
  children: ReactNode;
  fill?: string;
  color?: string;
  size?: number;
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        background: fill,
        color,
        fontFamily: F.mono,
        fontWeight: 600,
        fontSize: size,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        padding: `${size * 0.3}px ${size * 0.6}px`,
        boxShadow: pixelFrame(color, 'transparent', 3, 0),
      }}
    >
      {children}
    </span>
  );
}
