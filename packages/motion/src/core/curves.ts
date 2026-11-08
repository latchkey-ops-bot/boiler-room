/**
 * The motion curves of `docs/motion/reference-spec.md` (section 3) and the shared primitives of
 * `docs/motion/transitions.md`, as the spec writes them. Every value in those files is measured at
 * 30 fps, so scenes work in spec frames: frames at 30 fps, counted from the scene's own start.
 * `specFrame` is the one place another rate is converted. At 30 fps it is the frame itself, and at
 * any other rate a decay `k ** f` becomes `(k ** (30 / fps)) ** frame`, which is the conversion the
 * spec gives for decay constants, while a count of frames keeps its length in seconds.
 */
import { toFrame } from '@boiler-room/schema';
import { Easing, spring } from 'remotion';
import { type CubicBezier, inOut, morph, seams, slam } from '../tokens.ts';

export const SPEC_FPS = 30;

/** A frame at the campaign's rate, as a frame at 30 fps. It is fractional at other rates. */
export const specFrame = (frame: number, fps: number): number => (frame * SPEC_FPS) / fps;

/** A count of spec frames as whole frames at the campaign's rate, through `toFrame`. */
export const filmFrames = (spec: number, fps: number): number => toFrame(spec / SPEC_FPS, fps);

/**
 * The frames at the campaign's rate whose spec frame is still under `spec`: the frames a blank
 * of `spec` frames covers. 2 spec frames are frames 0 and 1 at 30 fps, and at 24 fps as well.
 */
export const framesBefore = (spec: number, fps: number): number =>
  Math.max(0, Math.ceil(spec / specFrame(1, fps) - 1e-9));

/** An easing token as a function of 0 to 1. */
export const ease = ([x1, y1, x2, y2]: CubicBezier) => Easing.bezier(x1, y1, x2, y2);

/**
 * An in-out token played from `f = 0` over its own frames, clamped to 0 before and 1 after.
 * `inOut.lift` over 11 frames is T2's hero-to-slot curve and the T1 anchor carry.
 */
export const inOutAt = (f: number, token: { curve: CubicBezier; frames: number }): number =>
  f <= 0 ? 0 : f >= token.frames ? 1 : ease(token.curve)(f / token.frames);

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

/**
 * T3's second line: when line 2's first word appears, line 1 is pushed up by `travel` on
 * `arrive` with `k` 0.4, so its first frame jumps 60% of the way [D]. `travel` is half a line.
 */
export const secondLinePush = (f: number, line2Start: number, travel: number): number =>
  travel * arrive(f - line2Start + 1, slam.push);

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

/** T5: the frame is ground only while `f < blank`, then the rack plays from `f = blank`. */
export const blink = (f: number, blank: number): { blank: boolean; blur: number; y: number } =>
  f < blank ? { blank: true, blur: 0, y: 0 } : { blank: false, ...rack(f - blank) };

/**
 * A T1 seam, as `docs/motion/transitions.md` writes it. Offsets are spec px, or log scale for
 * `axis: 'scale'`, which is applied as `scale(Math.exp(offset))` about the frame centre.
 */
export interface Seam {
  axis: 'x' | 'y' | 'scale';
  sign: 1 | -1;
  /** px per frame, or log scale per frame for `scale`. */
  vPeak: number;
  /** Outgoing ramp frames. */
  n: number;
  /** Outgoing speed multiplier per frame. */
  r: number;
  /** Incoming decay per frame. */
  k: number;
  /** Incoming settle frame. */
  D: number;
}

/** How far the outgoing anchor travels over its ramp, ending at `vPeak` a frame. */
export const outTravel = ({ vPeak, n, r }: Pick<Seam, 'vPeak' | 'n' | 'r'>): number =>
  (vPeak * (r ** n - 1)) / (r ** (n - 1) * (r - 1));

/**
 * The outgoing offset at `f = frame - seam`: 0 before the ramp, accelerating into the cut, and at
 * `f = -1`, the last outgoing frame, moving at `vPeak`.
 */
export const seamOut = (f: number, s: Seam): number =>
  s.sign * outTravel(s) * depart(f + s.n + 1, s.n, s.r);

/**
 * The incoming offset from rest at `f`, the incoming scene's frame: displaced against `sign` and
 * moving with it at `vPeak` on `f = 0`, decaying by `k`, and exactly 0 from `f = D`.
 */
export const seamIn = (f: number, s: Seam): number =>
  f >= s.D
    ? 0
    : (-s.sign * (s.vPeak / (1 - s.k)) * (s.k ** Math.max(f, 0) - s.k ** s.D)) / (1 - s.k ** s.D);

/** The T1 seam between two anchor velocities, with the resolver's `vPeak = sqrt(vOut * vIn)`. */
export function seamBetween(
  out: { axis: Seam['axis']; sign: 1 | -1; v: number },
  incoming: { v: number },
): Seam {
  const { n, r, k, kX, D } = seams.t1;
  return {
    axis: out.axis,
    sign: out.sign,
    vPeak: Math.sqrt(out.v * incoming.v),
    n,
    r,
    k: out.axis === 'x' ? kX : k,
    D,
  };
}

/**
 * The T1 word-gap variant on axis x: word `i` of a line takes `seamIn(f) * gain(i)`, where `d` is
 * the word's distance in words from the line's middle word, positive towards the trailing side: the
 * side the seam moves away from, so the gaps start stretched and close up.
 */
export const wordGapGain = (d: number): number => Math.min(1.4, Math.max(0.6, 1 + 0.2 * d));

export interface MorphState {
  /** The content's opacity: it fades out over the first 6 frames, and pops back in at 45. */
  contentOpacity: number;
  /** True once the new content is in, at full opacity, from `f = 45`. */
  contentIn: boolean;
  width: number;
  height: number;
}

/**
 * `MorphBox`, T8: contents fade out over frames 0 to 5 and are gone on 5, the width moves over
 * frames 6 to 17 and the height over 18 to 44, both on `step.short`'s shape, and the new contents
 * pop in at full opacity on frame 45, once the shape has settled. Those are the QC frames.
 */
export function morphBox(
  f: number,
  from: { width: number; height: number },
  to: { width: number; height: number },
): MorphState {
  const curve = ease(morph.curve);
  // A move over `[start, end)` is at rest on its first frame and done on its last.
  const span = (start: number, end: number) =>
    f <= start ? 0 : f >= end - 1 ? 1 : curve((f - start) / (end - 1 - start));
  const w = span(morph.width.from, morph.width.to);
  const h = span(morph.height.from, morph.height.to);
  const contentIn = f >= morph.height.to;
  return {
    contentOpacity: contentIn ? 1 : Math.min(1, Math.max(0, 1 - f / (morph.exitFrames - 1))),
    contentIn,
    width: from.width + (to.width - from.width) * w,
    height: from.height + (to.height - from.height) * h,
  };
}

/** The T1 anchor carry and T2's lift: 0 to 1 over 11 frames on `lift`. */
export const liftAt = (f: number): number => inOutAt(f, inOut.lift);
