/** Pure helpers of the render scripts, kept apart so they can be tested without a browser. */

/** A seeded shuffle, so a failure can be repeated with the same order. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [result[index], result[other]] = [result[other] as T, result[index] as T];
  }
  return result;
}

/** Frames spread over the film, plus the first and last. */
export function sampleFrames(durationInFrames: number, count: number): number[] {
  const step = durationInFrames / count;
  const frames = Array.from({ length: count }, (_, index) => Math.floor(index * step + step / 2));
  return [...new Set([0, ...frames, durationInFrames - 1])].sort((a, b) => a - b);
}

export interface PlanShape {
  durationInFrames: number;
  scenes: { span: { id: string; from: number; durationInFrames: number } }[];
}

/** The frames that show each scene once its copy has landed, each boundary, and the last frame. */
export function framesWorthSeeing(plan: PlanShape): { label: string; frame: number }[] {
  const frames: { label: string; frame: number }[] = [];
  for (const { span } of plan.scenes) {
    frames.push({
      label: `${span.id}-settled`,
      frame: span.from + Math.round(span.durationInFrames * 0.62),
    });
    if (span.from > 0) frames.push({ label: `${span.id}-boundary`, frame: span.from });
  }
  frames.push({ label: 'last', frame: plan.durationInFrames - 1 });
  return frames.sort((a, b) => a.frame - b.frame);
}

/**
 * How two RGBA images of one size differ: how many pixels, and the largest change in any channel.
 * A change of a level or two on a few edge pixels is raster variance in Chrome, while a frame that
 * depends on its history in our code moves whole shapes.
 */
export function pixelDifference(
  first: Uint8Array,
  second: Uint8Array,
): { pixels: number; maxDelta: number } {
  if (first.length !== second.length) return { pixels: Number.POSITIVE_INFINITY, maxDelta: 255 };
  let pixels = 0;
  let maxDelta = 0;
  for (let index = 0; index < first.length; index += 4) {
    let pixelDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs((first[index + channel] ?? 0) - (second[index + channel] ?? 0));
      pixelDelta = Math.max(pixelDelta, delta);
    }
    if (pixelDelta > 0) pixels += 1;
    maxDelta = Math.max(maxDelta, pixelDelta);
  }
  return { pixels, maxDelta };
}
