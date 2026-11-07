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
