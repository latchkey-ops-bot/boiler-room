/**
 * The motion curves of `docs/motion/reference-spec.md` (section 3) and the shared primitives of
 * `docs/motion/transitions.md`, as the spec writes them. Every value in those files is measured at
 * 30 fps, so scenes work in spec frames: frames at 30 fps, counted from the scene's own start.
 * `specFrame` is the one place another rate is converted. At 30 fps it is the frame itself, and at
 * any other rate a decay `k ** f` becomes `(k ** (30 / fps)) ** frame`, which is the conversion the
 * spec gives for decay constants, while a count of frames keeps its length in seconds.
 */
import { spring } from 'remotion';

export const SPEC_FPS = 30;

/** A frame at the campaign's rate, as a frame at 30 fps. It is fractional at other rates. */
export const specFrame = (frame: number, fps: number): number => (frame * SPEC_FPS) / fps;

/** 0 to 1, starting at peak speed. `k` is the share of the remaining travel left after a frame. */
export const arrive = (f: number, k: number): number => (f <= 0 ? 0 : 1 - k ** f);

/** `arrive` normalised to reach exactly 1 at `f = D`, so that "settled" is a frame. */
export const arriveN = (f: number, k: number, D: number): number =>
  f <= 0 ? 0 : f >= D ? 1 : (1 - k ** f) / (1 - k ** D);

/** 0 to 1 over `n` frames. Speed multiplies by `r` each frame, so it ends at peak speed. */
export const depart = (f: number, n: number, r: number): number =>
  f <= 0 ? 0 : f >= n ? 1 : (r ** f - 1) / (r ** n - 1);

/**
 * Word `i` of a run: visible at full opacity from `f = i * stagger` (a pop), and `y` pixels below
 * its rest, closing by `k` each frame. Type never springs or overshoots.
 */
export const wordRise = (f: number, i: number, stagger = 1, rise = 72, k = 0.75) => {
  const t = f - i * stagger;
  return { visible: t >= 0, y: rise * k ** Math.max(t, 0) };
};

/** Type drifts larger about the frame centre while it holds, so a card is never static. */
export const typeDrift = (f: number): number => 1 + 0.0013 * f;

/**
 * `spring.pop`, for a UI node and never for type: the spring from 0.46 to 1, shown from its third
 * frame, so the first visible frame is at 0.794 and the peak, 1.066, three frames later.
 */
export const springPop = (f: number): number =>
  spring({
    frame: f + 2,
    fps: SPEC_FPS,
    config: { mass: 1, damping: 26, stiffness: 550 },
    from: 0.46,
    to: 1,
  });

/**
 * The rack an element is in focus through after a blink: blur in pixels and lift in pixels for its
 * first five frames, then sharp and at rest.
 */
const RACK_BLUR = [6, 3, 1.2, 0];
const RACK_LIFT = [13, 7, 4, 1, 0];

export const rack = (f: number): { blur: number; y: number } => {
  if (f < 0) return { blur: RACK_BLUR[0] as number, y: RACK_LIFT[0] as number };
  const at = (series: number[]) => {
    const index = Math.floor(f);
    if (index >= series.length - 1) return 0;
    const from = series[index] as number;
    const to = series[index + 1] as number;
    return from + (to - from) * (f - index);
  };
  return { blur: at(RACK_BLUR), y: at(RACK_LIFT) };
};
