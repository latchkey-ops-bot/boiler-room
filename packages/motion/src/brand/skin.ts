import type { Skin } from '../scenes/definition.ts';

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** OKLCH lightness of a #RRGGBB colour, as `skills/art-director` computes it. */
export function oklchLightness(hex: string): number {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  const r = linear((value >> 16) & 255);
  const g = linear((value >> 8) & 255);
  const b = linear(value & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/**
 * The film's skin, from the background's lightness: Neutral Cut at `L >= 0.90`, Kinetic Plate at
 * `L <= 0.22` [D]. The Art Director keeps a background out of the band between. One that reaches
 * the renderer anyway takes the nearer family, split at the band's middle [N].
 */
export const skinOf = (background: string): Skin =>
  oklchLightness(background) <= 0.56 ? 'kinetic-plate' : 'neutral-cut';
