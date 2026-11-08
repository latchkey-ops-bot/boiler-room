import type { Campaign } from '@boiler-room/schema';
import { loadFont } from '@remotion/fonts';
import { assetUrl } from './assets.ts';

const FORMATS: Record<string, 'woff2' | 'woff' | 'opentype' | 'truetype'> = {
  woff2: 'woff2',
  woff: 'woff',
  otf: 'opentype',
  ttf: 'truetype',
};

const formatOf = (url: string) =>
  FORMATS[url.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase() ?? ''] ?? 'woff2';

export function fontUrl(source: string, { assets }: Pick<Campaign, 'assets'>): string {
  const asset = Object.hasOwn(assets, source) ? assets[source] : undefined;
  return assetUrl(asset?.src ?? source);
}

export type FontRole = 'display' | 'body';
type BrandFont = Campaign['brand']['fonts'][FontRole];

/** FNV-1a, so that a name is the same in every tab and on every machine. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The family a role's file is registered under. It is the brand's name for the family plus the role
 * and its file, so that two files the brand calls by one name, such as a bold and a regular from one
 * kit, never compete: two faces of one family with the same descriptors leave the browser to use
 * whichever loaded last, which changes from tab to tab.
 */
export const brandFontFamily = (role: FontRole, { family, source }: BrandFont): string =>
  `${family} [${role} ${fnv1a(`${family}\0${source}`)}]`;

const loaded = new Map<string, Promise<void>>();

/**
 * Loads each brand font once per page, each role under its own family. The whole weight range is
 * declared so that a static file is used as it is, rather than thickened by the browser. A font that
 * fails stops the render: a film set in whatever the machine had installed is worse than no film,
 * and would not be repeatable.
 */
export async function loadBrandFonts({ brand, assets }: Pick<Campaign, 'brand' | 'assets'>) {
  const roles: FontRole[] = ['display', 'body'];
  const requests = roles.map((role) => {
    const font = brand.fonts[role];
    const family = brandFontFamily(role, font);
    const url = fontUrl(font.source, { assets });
    const key = `${family}|${url}`;
    const existing = loaded.get(key);
    if (existing) return existing;
    // FontFace takes the name as it is, so it is not quoted here as it is in CSS.
    const request = loadFont({
      family,
      url,
      format: formatOf(url),
      weight: '100 900',
    });
    loaded.set(key, request);
    return request;
  });
  await Promise.all(requests);
}
