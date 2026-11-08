import { timeline } from './timeline.ts';

/**
 * The one place a time in seconds becomes a frame number. Scene boundaries are rounded here, so
 * every scene starts on a whole frame and the next one starts exactly where it ends.
 */
export const toFrame = (seconds: number, fps: number = timeline.fps): number =>
  Math.round(seconds * fps);

export function sceneFrames(
  span: { start: number; end: number },
  fps: number = timeline.fps,
): { from: number; durationInFrames: number } {
  const from = toFrame(span.start, fps);
  return { from, durationInFrames: toFrame(span.end, fps) - from };
}
