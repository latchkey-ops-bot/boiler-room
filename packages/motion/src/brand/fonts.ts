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

const loaded = new Map<string, Promise<void>>();

/**
 * Loads each brand font once per page. The whole weight range is declared so that a static file is
 * used as it is, rather than thickened by the browser. A font that fails stops the render: a film
 * set in whatever the machine had installed is worse than no film, and would not be repeatable.
 */
export async function loadBrandFonts({ brand, assets }: Pick<Campaign, 'brand' | 'assets'>) {
  const requests = [brand.fonts.display, brand.fonts.body].map(({ family, source }) => {
    const url = fontUrl(source, { assets });
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
