/** Colour arithmetic for brand tokens. Every colour here is an opaque `#RRGGBB` string. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#([0-9a-f]{6})$/i;

export function isHex(value: string): boolean {
  return HEX.test(value);
}

export function toRgb(hex: string): Rgb {
  const match = HEX.exec(hex);
  if (!match?.[1]) throw new Error(`Not an opaque #RRGGBB colour: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/** A colour with alpha laid over an opaque one, as the browser paints it. */
export function blend(hex: string, alpha: number, over: string): string {
  if (alpha >= 1) return hex.toUpperCase();
  const top = toRgb(hex);
  const bottom = toRgb(over);
  const mix = (a: number, b: number) => a * alpha + b * (1 - alpha);
  return toHex({ r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b) });
}

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, from 0 for black to 1 for white. */
export function luminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The WCAG 2.2 contrast ratio of two colours, from 1 to 21. Same formula as the validator. */
export function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Black or white, whichever reads better on this colour. */
export function readableOn(background: string): string {
  return contrast('#000000', background) >= contrast('#FFFFFF', background) ? '#000000' : '#FFFFFF';
}

/** HSL saturation and lightness, each from 0 to 1, and hue in degrees. */
export function hsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = toRgb(hex);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** How far a colour is from grey, from 0 to 1. Brand colours sit well above 0.15. */
export function chroma(hex: string): number {
  const { r, g, b } = toRgb(hex);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Euclidean distance in RGB, from 0 to about 441. */
export function distance(first: string, second: string): number {
  const a = toRgb(first);
  const b = toRgb(second);
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

export function hueDistance(first: string, second: string): number {
  const diff = Math.abs(hsl(first).h - hsl(second).h);
  return Math.min(diff, 360 - diff);
}
