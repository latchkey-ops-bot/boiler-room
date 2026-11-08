const channels = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const toHex = (channel: number) => Math.round(channel).toString(16).padStart(2, '0');

/** `amount` of the way from one #RRGGBB colour to another. */
export function mix(from: string, to: string, amount: number): string {
  const [r0, g0, b0] = channels(from);
  const [r1, g1, b1] = channels(to);
  const at = (a: number, b: number) => toHex(a + (b - a) * amount);
  return `#${at(r0, r1)}${at(g0, g1)}${at(b0, b1)}`.toUpperCase();
}

/** A #RRGGBB colour at an opacity, as #RRGGBBAA. */
export const withAlpha = (hex: string, alpha: number): string =>
  `${hex}${toHex(Math.min(1, Math.max(0, alpha)) * 255)}`.toUpperCase();
