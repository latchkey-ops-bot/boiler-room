/** Clamps a value to the unit interval: below 0 is 0, above 1 is 1. Pure, for any frame. */
export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
