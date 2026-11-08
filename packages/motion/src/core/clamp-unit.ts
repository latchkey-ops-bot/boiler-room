/** The value clamped to [0, 1]: below 0 gives 0, above 1 gives 1, anything else is unchanged. */
export function clampUnit(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
