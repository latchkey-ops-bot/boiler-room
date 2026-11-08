import type { LOGO_PLACEMENTS } from '../researcher/output.ts';
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

/** Where a logo was found: see `LOGO_PLACEMENTS`. */
export type LogoPlacement = (typeof LOGO_PLACEMENTS)[number];

export interface RankedLogo {
  candidate: RawLogoCandidate;
  source: Exclude<LogoSource, 'generated'>;
  placement: Exclude<LogoPlacement, 'uploaded' | 'generated'>;
  rank: number;
  /** Why it is where it is in the order, in a few words for the capture summary. */
  why: string;
}

function isSvgUrl(url: string | null, type: string): boolean {
  return Boolean(
    url && (/\.svg(?:$|[?#])/i.test(url) || /svg/i.test(type) || url.startsWith('data:image/svg')),
  );
}

/** A mark with its name beside it is at least twice as wide as it is tall. */
const LOCKUP_ASPECT = 2;
/** An icon this large holds up at film size; a smaller one is a favicon. */
const LARGE_ICON = 128;

const aspectOf = (candidate: RawLogoCandidate) =>
  candidate.width > 0 && candidate.height > 0 ? candidate.width / candidate.height : 0;

/**
 * Logo candidates in the order to try them.
 *
 * 1. A picture inside the header's home link: an inline SVG, an SVG or raster image, or a
 *    background image. A lockup of mark and name comes before the mark alone, an SVG before a
 *    raster, and a shown variant before one the link hides at this width. A visible SVG on the
 *    first screen that is the same logo (`twin`) in more colours comes just before the one it
 *    repeats.
 * 2. A picture in the header, or a home link elsewhere, named as a logo.
 * 3. Another picture in the header or a home link.
 * 4. An SVG icon, an apple-touch-icon, or an icon of at least 128 px, largest first.
 * 5. Smaller icons and the favicon.
 * 6. The Open Graph image: a social card, only when nothing else could be had.
 *
 * The name set in type is not a candidate: it is used only when none of these could be fetched.
 */
export function rankLogos(candidates: RawLogoCandidate[]): RankedLogo[] {
  const ranked: RankedLogo[] = [];
  const headerHome = (candidate: RawLogoCandidate) =>
    candidate.headerHome ?? (candidate.homeLink && candidate.inHeader);
  for (const candidate of candidates) {
    const placed = candidate.inHeader || candidate.homeLink;
    const looksLikeLogo = candidate.logoHint || candidate.homeLink;
    const svg = candidate.kind === 'inline-svg' || isSvgUrl(candidate.url, candidate.type);
    const source: RankedLogo['source'] =
      candidate.kind === 'inline-svg' ? 'inline-svg' : svg ? 'svg' : 'png';
    const where = candidate.inHeader ? 'header' : 'page';
    switch (candidate.kind) {
      case 'img':
      case 'background':
      case 'inline-svg': {
        if (headerHome(candidate) && !candidate.twin) {
          const lockup = aspectOf(candidate) >= LOCKUP_ASPECT;
          ranked.push({
            candidate,
            source,
            placement: 'header-home-link',
            // A lockup before the mark alone, a vector before a raster (a file before a copy cut
            // from the page), and a shown variant before a hidden one.
            rank:
              0.5 -
              (lockup ? 0.4 : 0) -
              (svg ? 0.2 : 0) +
              (candidate.kind === 'inline-svg' ? 0.05 : 0) +
              (candidate.hidden ? 0.1 : 0),
            why: `${lockup ? 'the lockup' : 'the mark'} in the header's home link${candidate.hidden ? ', a variant it hides at this width' : ''}`,
          });
          break;
        }
        if (candidate.twin) break;
        if (candidate.kind === 'inline-svg') {
          if (!(placed && looksLikeLogo) && !(candidate.inHeader && candidate.logoHint)) break;
          if (candidate.width < 16 || candidate.height < 8) break;
        } else {
          if (!(placed || candidate.logoHint)) break;
          if (!looksLikeLogo && candidate.width > 600) break;
        }
        const hinted = candidate.logoHint && placed;
        ranked.push({
          candidate,
          source,
          placement: where,
          rank: (hinted ? 1 : 2) + (svg ? 0 : 0.2) + (candidate.inHeader ? 0 : 0.4),
          why: `a picture ${candidate.inHeader ? 'in the header' : 'on the page'}${candidate.logoHint ? ' named as a logo' : ''}${candidate.homeLink ? ' in a home link' : ''}`,
        });
        break;
      }
      case 'icon':
      case 'apple-touch-icon':
      case 'manifest': {
        const size = svg ? 512 : Math.max(candidate.width, candidate.height);
        const touch = candidate.kind === 'apple-touch-icon';
        // An apple-touch-icon with no declared size is 180 px by Apple's convention.
        const large = svg || size >= LARGE_ICON || (touch && size === 0);
        ranked.push({
          candidate,
          source: 'favicon',
          placement: touch ? 'apple-touch-icon' : 'icon',
          rank: (large ? 3 : 4) + (svg ? 0 : touch ? 0.2 : 0.3) - Math.min(size, 512) / 4096,
          why: `${svg ? 'an SVG icon' : touch ? 'the apple-touch-icon' : 'an icon'}${size && !svg ? ` of ${size} px` : ''}`,
        });
        break;
      }
      case 'og-image':
        ranked.push({
          candidate,
          source: svg ? 'svg' : 'png',
          placement: 'og-image',
          rank: 5,
          why: 'the Open Graph image, a social card: the last resort',
        });
        break;
      default:
        break;
    }
  }
  // The same logo drawn again on the first screen in more colours is its full-colour version.
  for (const candidate of candidates) {
    if (!candidate.twin || candidate.kind !== 'inline-svg') continue;
    const original = ranked
      .filter(
        (item) =>
          item.placement === 'header-home-link' &&
          item.candidate.kind === 'inline-svg' &&
          Math.abs(aspectOf(item.candidate) - aspectOf(candidate)) <= 0.02 * aspectOf(candidate),
      )
      .sort((a, b) => a.rank - b.rank)[0];
    if (!original || (candidate.colors ?? 0) <= (original.candidate.colors ?? 0)) continue;
    ranked.push({
      candidate,
      source: 'inline-svg',
      placement: 'page',
      rank: original.rank - 0.01,
      why: `the header's logo drawn again in ${candidate.colors} colours on the first screen`,
    });
  }
  return ranked.sort((a, b) => a.rank - b.rank);
}

/** The long edge a saved SVG logo declares. An SVG scales freely, so this costs nothing. */
export const SVG_LONG_EDGE = 512;

export interface NormalisedSvg {
  svg: string;
  width: number;
  height: number;
  /** Width over height of its drawing: its viewBox, else its own declared size. */
  aspect: number;
}

/**
 * An SVG logo with a size of its own in its drawing's shape. A logo cut from a page carries the
 * page's sizing (`width="auto"`, a height of 24, a CSS class), which a file on its own reads as a
 * tiny or square image: a renderer then takes the mark for a favicon. The root element gets a
 * `width` and `height` in its viewBox's aspect, with the long edge at 512, and a viewBox from its
 * declared size when it has none; width and height in its inline style go. Nothing inside the
 * drawing changes. Undefined when no size can be found for it.
 */
export function normaliseSvg(
  markup: string,
  fallback?: { width: number; height: number },
): NormalisedSvg | undefined {
  const match = /<svg\b[^>]*>/i.exec(markup);
  if (!match) return undefined;
  const tag = match[0];
  const attr = (name: string) => {
    const found = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
    return found ? (found[1] ?? found[2] ?? '') : undefined;
  };
  const length = (value: string | undefined) => {
    const found = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(?:px)?\s*$/i.exec(value ?? '');
    const number = found ? Number(found[1]) : Number.NaN;
    return number > 0 ? number : undefined;
  };
  const viewBox = (attr('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [, , boxWidth = 0, boxHeight = 0] = viewBox;
  const hasViewBox = viewBox.length === 4 && boxWidth > 0 && boxHeight > 0;
  const declaredWidth = length(attr('width'));
  const declaredHeight = length(attr('height'));
  const box = hasViewBox
    ? { width: boxWidth, height: boxHeight }
    : declaredWidth && declaredHeight
      ? { width: declaredWidth, height: declaredHeight }
      : fallback && fallback.width > 0 && fallback.height > 0
        ? fallback
        : undefined;
  if (!box) return undefined;
  const scale = SVG_LONG_EDGE / Math.max(box.width, box.height);
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));
  let next = tag.replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  next = next.replace(
    /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
    (_all, double: string | undefined, single: string | undefined) => {
      const kept = (double ?? single ?? '')
        .split(';')
        .filter(
          (declaration) =>
            declaration.trim() && !/^\s*(?:min-|max-)?(?:width|height)\s*:/i.test(declaration),
        )
        .join(';');
      if (!kept) return '';
      return double !== undefined ? ` style="${kept}"` : ` style='${kept}'`;
    },
  );
  const addViewBox = hasViewBox ? '' : ` viewBox="0 0 ${box.width} ${box.height}"`;
  next = next.replace(/^<svg\b/i, `<svg width="${width}" height="${height}"${addViewBox}`);
  return {
    svg: markup.slice(0, match.index) + next + markup.slice(match.index + tag.length),
    width,
    height,
    aspect: box.width / box.height,
  };
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

/**
 * Width and height in pixels of a PNG, GIF, WebP, JPEG or ICO from its header (an ICO's first
 * image), or undefined when the header cannot be read.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : undefined;
  switch (sniff(bytes)) {
    case 'png':
      return pngSize(bytes);
    case 'gif':
      return bytes.length >= 10
        ? size(view.getUint16(6, true), view.getUint16(8, true))
        : undefined;
    case 'ico':
      // 0 means 256 in an ICO directory entry.
      return bytes.length >= 8 ? size(bytes[6] || 256, bytes[7] || 256) : undefined;
    case 'webp': {
      if (bytes.length < 30) return undefined;
      const chunk = String.fromCharCode(...bytes.subarray(12, 16));
      if (chunk === 'VP8 ')
        return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
      if (chunk === 'VP8L') {
        const bits = view.getUint32(21, true);
        return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
      }
      if (chunk === 'VP8X') {
        const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
        const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
        return size(width, height);
      }
      return undefined;
    }
    case 'jpeg': {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return undefined;
        const marker = bytes[offset + 1] ?? 0;
        // Start-of-frame markers, except DHT (C4), JPG (C8) and DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return size(view.getUint16(offset + 7), view.getUint16(offset + 5));
        offset += 2 + view.getUint16(offset + 2);
      }
      return undefined;
    }
    default:
      return undefined;
  }
}
