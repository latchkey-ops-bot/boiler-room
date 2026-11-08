import { toFrame } from '@boiler-room/schema';
import { Easing } from 'remotion';
import type { CubicBezier } from '../tokens.ts';

/** A token time in whole frames, never less than one. */
export const framesFor = (seconds: number, fps: number): number =>
  Math.max(1, toFrame(seconds, fps));

/** Turns an easing token into the function `interpolate` takes. */
export const bezier = ([x1, y1, x2, y2]: CubicBezier) => Easing.bezier(x1, y1, x2, y2);

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;
