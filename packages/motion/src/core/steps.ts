export interface Step {
  from: number;
  to: number;
}

/** Divides the frames from `from` to `to` evenly between `count` steps, with no frame left over. */
export function stepWindows(count: number, from: number, to: number): Step[] {
  const size = Math.max(0, to - from) / Math.max(1, count);
  return Array.from({ length: count }, (_, index) => ({
    from: Math.round(from + index * size),
    to: Math.round(from + (index + 1) * size),
  }));
}

/** The step in progress, holding the first before it starts and the last after it ends. */
export function activeStep(frame: number, steps: readonly Step[]): number {
  const index = steps.findIndex(({ to }) => frame < to);
  return index === -1 ? Math.max(0, steps.length - 1) : index;
}
