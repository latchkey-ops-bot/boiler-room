/** Clamp a value to the range [0, 1]. */
export function clampUnit(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
