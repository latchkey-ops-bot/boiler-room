function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const rgb = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((rgb >> 16) & 255) +
    0.7152 * channel((rgb >> 8) & 255) +
    0.0722 * channel(rgb & 255)
  );
}

/** The WCAG 2.2 contrast ratio of two #RRGGBB colours, from 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Black or white, whichever reads better on this colour. One always clears 4.5:1. */
export function readableOn(background: string): string {
  const black = '#000000';
  const white = '#FFFFFF';
  return contrastRatio(black, background) >= contrastRatio(white, background) ? black : white;
}
