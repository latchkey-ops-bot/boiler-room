import { type Campaign, contrastRatio, MIN_CONTRAST, readableOn } from '@boiler-room/schema';
import { fallbackRadius } from '../tokens.ts';
import { mix, withAlpha } from './color.ts';
import type { ResolvedLogo } from './logo.ts';

/**
 * Everything a scene may use to look like a brand. Scenes take every colour, font and radius from
 * here, so a new brand needs no new template.
 */
export interface BrandTheme {
  name: string;
  isDark: boolean;
  colors: {
    background: string;
    foreground: string;
    primary: string;
    /** Readable on `primary`. */
    onPrimary: string;
    /** Always visible on the background, for marks and rules rather than text. */
    accent: string;
    /** Secondary text. Always clears body contrast, whatever the brand supplied. */
    muted: string;
    /** A raised panel. */
    surface: string;
    /** The bar across the top of a browser frame. */
    chrome: string;
    /** Fine edges. */
    hairline: string;
    shadow: string;
    glow: string;
  };
  fonts: {
    display: string;
    body: string;
  };
  radius: number;
  logo: ResolvedLogo;
}

const MIN_ACCENT_CONTRAST = 3;
const BLACK = '#000000';

/** The brand's muted colour if it can be read, otherwise the closest mix that can. */
function readableMuted(muted: string | undefined, foreground: string, background: string): string {
  if (muted && contrastRatio(muted, background) >= MIN_CONTRAST.foreground) return muted;
  for (const amount of [0.4, 0.3, 0.2, 0.1]) {
    const candidate = mix(foreground, background, amount);
    if (contrastRatio(candidate, background) >= MIN_CONTRAST.foreground) return candidate;
  }
  return foreground;
}

/** A family name as CSS needs it, since a name such as `Source Serif 4` is not a valid identifier. */
export const cssFamily = (family: string): string => JSON.stringify(family);

export function resolveTheme(brand: Campaign['brand'], logo: ResolvedLogo): BrandTheme {
  const { background, foreground, primary, accent, muted } = brand.colors;
  const isDark = readableOn(background) !== BLACK;
  const usableAccent =
    accent && contrastRatio(accent, background) >= MIN_ACCENT_CONTRAST ? accent : primary;
  return {
    name: brand.name,
    isDark,
    colors: {
      background,
      foreground,
      primary,
      onPrimary: readableOn(primary),
      accent: usableAccent,
      muted: readableMuted(muted, foreground, background),
      surface: mix(background, foreground, isDark ? 0.07 : 0.03),
      chrome: mix(background, foreground, isDark ? 0.12 : 0.09),
      hairline: mix(background, foreground, isDark ? 0.2 : 0.16),
      shadow: withAlpha(mix(background, BLACK, 0.8), isDark ? 0.7 : 0.2),
      glow: withAlpha(primary, isDark ? 0.2 : 0.12),
    },
    fonts: {
      display: cssFamily(brand.fonts.display.family),
      body: cssFamily(brand.fonts.body.family),
    },
    radius: brand.radius ?? fallbackRadius,
    logo,
  };
}
