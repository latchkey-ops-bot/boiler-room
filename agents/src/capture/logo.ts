import type { RawLogoCandidate } from './types.ts';

export type LogoSource = 'svg' | 'inline-svg' | 'png' | 'favicon' | 'generated';

export type Sniffed = 'svg' | 'png' | 'jpeg' | 'webp' | 'gif' | 'ico' | 'html' | 'unknown';

/**
 * What a downloaded file really is, from its first bytes. A status code and a content type are
 * not trusted: many sites answer a missing logo with HTTP 200 and their HTML app shell.
 */
export function sniff(bytes: Uint8Array): Sniffed {
  const starts = (...sig: number[]) => sig.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45) return 'webp';
  if (starts(0x00, 0x00, 0x01, 0x00)) return 'ico';
  const text = new TextDecoder()
    .decode(bytes.subarray(0, 2048))
    .replace(/^﻿/, '')
    .trimStart()
    .toLowerCase();
  if (
    text.startsWith('<!doctype html') ||
    text.startsWith('<html') ||
    /<(head|body)[\s>]/.test(text)
  )
    return 'html';
  if (text.includes('<svg')) return 'svg';
  return 'unknown';
}

export interface RankedLogo {
  candidate: RawLogoCandidate;
  source: Exclude<LogoSource, 'generated'>;
  rank: number;
}

function isSvgUrl(url: string | null, type: string): boolean {
  return Boolean(
    url && (/\.svg(?:$|[?#])/i.test(url) || /svg/i.test(type) || url.startsWith('data:image/svg')),
  );
}

/**
 * Logo candidates in the order to try them: an SVG logo from the header (a file, then inline), a
 * raster logo from the header, then favicons (SVG, then the largest raster). An Open Graph image
 * is a social card, not a logo, and is never chosen.
 */
export function rankLogos(candidates: RawLogoCandidate[]): RankedLogo[] {
  const ranked: RankedLogo[] = [];
  for (const candidate of candidates) {
    const placed = candidate.inHeader || candidate.homeLink;
    const looksLikeLogo = candidate.logoHint || candidate.homeLink;
    const bonus =
      (candidate.homeLink ? 0 : 0.3) +
      (candidate.logoHint ? 0 : 0.2) +
      (candidate.inHeader ? 0 : 0.4);
    switch (candidate.kind) {
      case 'img':
      case 'background':
        if (!(placed || candidate.logoHint)) break;
        if (!looksLikeLogo && candidate.width > 600) break;
        if (isSvgUrl(candidate.url, candidate.type))
          ranked.push({ candidate, source: 'svg', rank: 0 + bonus });
        else ranked.push({ candidate, source: 'png', rank: 2 + bonus });
        break;
      case 'inline-svg':
        if (!(placed && looksLikeLogo) && !(candidate.inHeader && candidate.logoHint)) break;
        if (candidate.width < 16 || candidate.height < 8) break;
        ranked.push({ candidate, source: 'inline-svg', rank: 1 + bonus });
        break;
      case 'icon':
      case 'apple-touch-icon':
      case 'manifest': {
        const svg = isSvgUrl(candidate.url, candidate.type);
        const size = Math.max(candidate.width, candidate.height);
        ranked.push({
          candidate,
          source: 'favicon',
          rank: 3 + (svg ? 0 : 0.5) - Math.min(size, 512) / 2048,
        });
        break;
      }
      default:
        break;
    }
  }
  return ranked.sort((a, b) => a.rank - b.rank);
}

const escapeXml = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (char) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char] ?? char,
  );

/**
 * A wordmark set in the brand's own font, weight and colour, used only when the site has no logo
 * at all. `family` may be a whole font stack, as the site's computed style gives it.
 * It is not a logo design: it is the product's name as text, and the output says it was generated.
 */
export function wordmarkSvg(
  name: string,
  family: string,
  color: string,
  generic: 'serif' | 'sans-serif' | 'monospace' = 'sans-serif',
  weight = 700,
): string {
  const width = Math.max(120, Math.round(name.length * 34 + 40));
  // A viewer without the font falls back to the same kind of face, so a serif brand stays serif.
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="96" viewBox="0 0 ${width} 96">`,
    `<text x="20" y="64" font-family="${escapeXml(family)}, ${generic}" font-size="56" font-weight="${Math.round(weight)}" fill="${color}">${escapeXml(name)}</text>`,
    '</svg>',
  ].join('');
}

/** Width and height of a PNG from its header, or undefined for anything else. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (sniff(bytes) !== 'png' || bytes.length < 24) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
