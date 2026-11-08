import type { Asset, Campaign } from '@boiler-room/schema';

/**
 * Type and logo checks from `skills/art-director/SKILL.md` section 3. A font whose licence is not
 * known to be open falls back to Inter, declared as a library asset. The logo is never generated,
 * redrawn or recoloured, so problems with it are flagged for a human.
 */

/** Inter, variable, latin, weights 400 to 700, from Google Fonts (OFL-1.1). */
export const FALLBACK_FONT = {
  id: 'inter-library',
  family: 'Inter',
  asset: {
    kind: 'font',
    src: 'https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2',
    provenance: 'library',
    license: 'OFL-1.1',
    sourceUrl: 'https://fonts.google.com/specimen/Inter',
  } satisfies Asset,
} as const;

/** Families published under an open licence (OFL-1.1 or Apache-2.0), wherever they are hosted. */
const OPEN_FAMILIES =
  /^(inter( variable| display| tight)?|source (sans|serif|code)( pro| 3| 4)?|roboto( flex| mono| serif)?|open sans|ibm plex (sans|serif|mono)|geist( mono)?|manrope|dm sans|work sans|space grotesk|plus jakarta sans|nunito( sans)?|lato|montserrat|poppins|noto (sans|serif)|figtree|outfit|onest|instrument sans|public sans|rubik|archivo|mulish|karla|barlow|lexend|sora|urbanist)$/i;

/** Google Fonts serves only open-licensed families (OFL, Apache or the Ubuntu Font Licence). */
const OPEN_HOSTS = new Set(['fonts.gstatic.com', 'fonts.googleapis.com']);

export type FontLicence = 'open' | 'unknown';

export interface FontCheck {
  role: 'display' | 'body';
  family: string;
  source: string;
  licence: FontLicence;
  why: string;
}

function hostOf(source: string, assets: Campaign['assets']): string | undefined {
  const url = Object.hasOwn(assets, source) ? assets[source]?.src : source;
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
}

export function fontLicence(
  family: string,
  source: string,
  assets: Campaign['assets'],
): { licence: FontLicence; why: string } {
  const declared = Object.hasOwn(assets, source) ? assets[source] : undefined;
  if (declared?.license) return { licence: 'open', why: `declared licence ${declared.license}` };
  if (OPEN_FAMILIES.test(family.trim())) return { licence: 'open', why: 'an open-licensed family' };
  const host = hostOf(source, assets);
  if (host && OPEN_HOSTS.has(host)) return { licence: 'open', why: 'served by Google Fonts' };
  return { licence: 'unknown', why: 'licence not known to be open' };
}

export interface BrandCheck {
  fonts: FontCheck[];
  /** The brand with any font fallback applied. */
  brand: Campaign['brand'];
  /** Assets to declare for the fallback. */
  assets: Record<string, Asset>;
  changes: string[];
  flags: string[];
}

export function checkBrand(campaign: Campaign): BrandCheck {
  const brand: Campaign['brand'] = {
    ...campaign.brand,
    fonts: { ...campaign.brand.fonts },
  };
  const assets: Record<string, Asset> = {};
  const changes: string[] = [];
  const flags: string[] = [];
  const fonts: FontCheck[] = [];

  for (const role of ['display', 'body'] as const) {
    const { family, source } = campaign.brand.fonts[role];
    const { licence, why } = fontLicence(family, source, campaign.assets);
    fonts.push({ role, family, source, licence, why });
    if (licence === 'unknown') {
      const id = Object.hasOwn(campaign.assets, FALLBACK_FONT.id)
        ? `${FALLBACK_FONT.id}-b`
        : FALLBACK_FONT.id;
      assets[id] = { ...FALLBACK_FONT.asset };
      brand.fonts[role] = { family: FALLBACK_FONT.family, source: id };
      changes.push(
        `${role} font ${family} has no known open licence: fell back to Inter (OFL-1.1), declared as "${id}".`,
      );
    }
  }

  const logo = Object.hasOwn(campaign.assets, brand.logoAssetId)
    ? campaign.assets[brand.logoAssetId]
    : undefined;
  if (logo?.provenance === 'generated') {
    flags.push(
      `The logo "${brand.logoAssetId}" is a generated wordmark, not the brand's own. Ask the customer for the real logo; it is never generated or redrawn here.`,
    );
  }
  if (logo && logo.kind === 'image') {
    flags.push(
      `The logo is raster${logo.width ? ` (${logo.width}x${logo.height ?? '?'} px)` : ''}: it never renders above its natural size. A vector logo would scale.`,
    );
  }
  return { fonts, brand, assets, changes, flags };
}
