/**
 * The style family a campaign renders in. It is not a field in `campaign.json`: the renderer
 * derives it from the OKLCH lightness of `brand.colors.background`, and the Art Director sets the
 * colours so the background lands cleanly on one side. Both read the thresholds from here.
 */

export const STYLE_FAMILIES = ['neutral-cut', 'kinetic-plate'] as const;
export type StyleFamily = (typeof STYLE_FAMILIES)[number];

/** Neutral Cut needs a background at or above this OKLCH lightness. */
export const NEUTRAL_CUT_MIN_L = 0.9;
/** Kinetic Plate needs a background at or below this OKLCH lightness. */
export const KINETIC_PLATE_MAX_L = 0.22;

/** Lightness 0 to 1, chroma 0 up, hue in degrees. `h` is `undefined` for a neutral grey. */
export interface Oklch {
  l: number;
  c: number;
  h: number | undefined;
}

/** Below this chroma a colour has no meaningful hue, as in CSS Color 4's powerless hue. */
const ACHROMATIC = 1e-4;

const toLinear = (channel: number) => {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

const toGamma = (linear: number) =>
  linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;

/** OKLab of an opaque `#RRGGBB` colour, by Björn Ottosson's matrices. */
function oklab(hex: string): [l: number, a: number, b: number] {
  const rgb = Number.parseInt(hex.slice(1), 16);
  const r = toLinear((rgb >> 16) & 255);
  const g = toLinear((rgb >> 8) & 255);
  const b = toLinear(rgb & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Linear sRGB of an OKLCH colour, which can fall outside 0 to 1 when it is out of gamut. */
function linearRgb({ l, c, h }: Oklch): [r: number, g: number, b: number] {
  const angle = ((h ?? 0) * Math.PI) / 180;
  const a = c * Math.cos(angle);
  const b = c * Math.sin(angle);
  const lms = [
    l + 0.3963377774 * a + 0.2158037573 * b,
    l - 0.1055613458 * a - 0.0638541728 * b,
    l - 0.0894841775 * a - 1.291485548 * b,
  ].map((value) => value ** 3) as [number, number, number];
  const [x, y, z] = lms;
  return [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
  ];
}

const GAMUT_EPSILON = 1e-6;
const inGamut = (rgb: readonly number[]) =>
  rgb.every((value) => value >= -GAMUT_EPSILON && value <= 1 + GAMUT_EPSILON);

export function toOklch(hex: string): Oklch {
  const [l, a, b] = oklab(hex);
  const c = Math.hypot(a, b);
  if (c < ACHROMATIC) return { l, c: 0, h: undefined };
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { l, c, h: h < 0 ? h + 360 : h };
}

/**
 * The opaque `#RRGGBB` nearest an OKLCH colour. A colour outside sRGB keeps its lightness and hue
 * and loses chroma until it fits, which is how CSS Color 4 maps a colour into gamut.
 */
export function fromOklch(colour: Oklch): string {
  const l = Math.min(1, Math.max(0, colour.l));
  let rgb = linearRgb({ ...colour, l });
  if (!inGamut(rgb)) {
    let low = 0;
    let high = colour.c;
    for (let step = 0; step < 40; step++) {
      const mid = (low + high) / 2;
      if (inGamut(linearRgb({ l, c: mid, h: colour.h }))) low = mid;
      else high = mid;
    }
    rgb = linearRgb({ l, c: low, h: colour.h });
  }
  const hex = rgb
    .map((value) => Math.round(toGamma(Math.min(1, Math.max(0, value))) * 255))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `#${hex.toUpperCase()}`;
}

/** The OKLCH lightness of an opaque `#RRGGBB` colour: 1 for white, 0.6 for `#808080`. */
export function oklchLightness(hex: string): number {
  return oklab(hex)[0];
}

/** The family a background renders in, or `undefined` for a mid-tone that fits neither. */
export function styleFamily(background: string): StyleFamily | undefined {
  const l = oklchLightness(background);
  if (l >= NEUTRAL_CUT_MIN_L) return 'neutral-cut';
  if (l <= KINETIC_PLATE_MAX_L) return 'kinetic-plate';
  return undefined;
}

/**
 * `color-mix(in oklch, first weight, second)`: lightness and chroma mixed linearly, hue on the
 * shorter arc. A neutral colour has no hue, so the mix takes the other colour's, as CSS does.
 */
export function mixOklch(first: string, weight: number, second: string): string {
  const a = toOklch(first);
  const b = toOklch(second);
  const mix = (x: number, y: number) => x * weight + y * (1 - weight);
  let h: number | undefined;
  if (a.h === undefined) h = b.h;
  else if (b.h === undefined) h = a.h;
  else {
    let delta = b.h - a.h;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    h = (a.h + delta * (1 - weight) + 360) % 360;
  }
  return fromOklch({ l: mix(a.l, b.l), c: mix(a.c, b.c), h });
}

/** How much of the primary tints a replacement ground. */
export const GROUND_TINT = 0.03;
export const LIGHT_BASE = '#FFFFFF';
export const DARK_BASE = '#0B0B0B';

/**
 * The ground that replaces a mid-tone background: 3% of the primary in white for a light-leaning
 * site, or in `#0b0b0b` for a dark-leaning one. The light one is always Neutral Cut and the dark
 * one always Kinetic Plate.
 */
export function tintedGround(primary: string, lean: 'light' | 'dark'): string {
  return mixOklch(primary, GROUND_TINT, lean === 'light' ? LIGHT_BASE : DARK_BASE);
}
