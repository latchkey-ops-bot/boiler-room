import type { RawFontFace, RawFonts } from './types.ts';

export type FontMethod =
  | 'google-fonts'
  | 'adobe-fonts'
  | 'self-hosted'
  | 'other-host'
  | 'system'
  | 'substitute';

export interface FontFace {
  family: string;
  url: string;
  weight: string;
  style: string;
  unicodeRange: string;
  format: string;
}

export interface ResolvedFont {
  role: 'display' | 'body' | 'mono';
  family: string;
  weight: number;
  method: FontMethod;
  url: string | null;
  /** For a substitute, the family the site names. */
  siteFamily: string | null;
}

/** Families every platform provides, which a site names without loading anything. */
const SYSTEM_FAMILIES = new Set(
  [
    'system-ui',
    '-apple-system',
    'blinkmacsystemfont',
    'segoe ui',
    'roboto',
    'helvetica neue',
    'helvetica',
    'arial',
    'noto sans',
    'ubuntu',
    'cantarell',
    'oxygen',
    'open sans',
    'liberation sans',
    'sans-serif',
    'serif',
    'monospace',
    'ui-sans-serif',
    'ui-serif',
    'ui-monospace',
    'sfmono-regular',
    'menlo',
    'monaco',
    'consolas',
    'courier new',
    'courier',
    'times new roman',
    'times',
    'georgia',
    'apple color emoji',
    'segoe ui emoji',
    'segoe ui symbol',
    'noto color emoji',
    'emoji',
    'math',
    'fangsong',
    'cursive',
    'fantasy',
  ].map((name) => name.toLowerCase()),
);

/** Open fonts used when a site relies on system fonts, by generic family. */
export const SUBSTITUTES = {
  sans: 'Inter',
  serif: 'Source Serif 4',
  mono: 'JetBrains Mono',
} as const;

export function families(stack: string): string[] {
  return stack
    .split(',')
    .map((name) => name.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

export function isSystemFamily(name: string): boolean {
  return SYSTEM_FAMILIES.has(name.toLowerCase());
}

export function genericOf(stack: string): keyof typeof SUBSTITUTES {
  const names = families(stack).map((name) => name.toLowerCase());
  if (names.some((name) => /mono|courier|consolas|menlo|monaco/.test(name))) return 'mono';
  if (
    names.includes('serif') ||
    names.some((name) => /georgia|times|serif 4|garamond/.test(name))
  ) {
    return names.includes('sans-serif') ? 'sans' : 'serif';
  }
  return 'sans';
}

/** `@font-face` rules in a stylesheet's text, with each source resolved against the sheet. */
export function parseFontFaces(css: string, sheetUrl: string): FontFace[] {
  const faces: FontFace[] = [];
  for (const [, body = ''] of css.matchAll(/@font-face\s*{([^}]*)}/gi)) {
    const prop = (name: string) =>
      new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(body)?.[1]?.trim() ?? '';
    const family = prop('font-family').replace(/^["']|["']$/g, '');
    const src = prop('src');
    if (!family || !src) continue;
    for (const [, rawUrl = '', format = ''] of src.matchAll(
      /url\(\s*["']?([^"')]+)["']?\s*\)(?:\s*format\(\s*["']?([^"')]+)["']?\s*\))?/gi,
    )) {
      if (rawUrl.startsWith('data:')) continue;
      let url: string;
      try {
        url = new URL(rawUrl, sheetUrl).href;
      } catch {
        continue;
      }
      faces.push({
        family,
        url,
        weight: prop('font-weight') || '400',
        style: prop('font-style') || 'normal',
        unicodeRange: prop('unicode-range'),
        format: format || (url.match(/\.(woff2?|ttf|otf)(?:$|\?)/i)?.[1] ?? '').toLowerCase(),
      });
    }
  }
  return faces;
}

/** Faces the page could read itself, already in `FontFace` form. */
export function facesFromRaw(raw: RawFontFace[], pageUrl: string): FontFace[] {
  return raw.flatMap((face) =>
    parseFontFaces(
      `@font-face{font-family:${face.family};src:${face.src};font-weight:${face.weight};font-style:${face.style};unicode-range:${face.unicodeRange}}`,
      pageUrl,
    ),
  );
}

function coversLatin(range: string): boolean {
  if (!range) return true;
  return range.split(',').some((part) => {
    const match = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part.trim());
    if (!match?.[1]) return false;
    const start = Number.parseInt(match[1].replace(/\?/g, '0'), 16);
    const end = match[2]
      ? Number.parseInt(match[2], 16)
      : Number.parseInt(match[1].replace(/\?/g, 'f'), 16);
    return start <= 0x41 && end >= 0x7a;
  });
}

function weightDistance(weight: string, wanted: number): number {
  const [low = 400, high = low] = weight
    .split(/\s+/)
    .map((part) => (part === 'bold' ? 700 : part === 'normal' ? 400 : Number(part)));
  if (wanted >= low && wanted <= high) return 0;
  return Math.min(Math.abs(wanted - low), Math.abs(wanted - high));
}

const FORMAT_RANK: Record<string, number> = {
  woff2: 0,
  woff: 1,
  truetype: 2,
  ttf: 2,
  opentype: 3,
  otf: 3,
};

/** The face file to use for a family at a weight: upright, covering Latin, closest weight, woff2 first. */
export function pickFace(faces: FontFace[], family: string, weight: number): FontFace | undefined {
  const own = faces.filter((face) => face.family.toLowerCase() === family.toLowerCase());
  return own
    .map((face) => ({
      face,
      rank: [
        face.style === 'normal' ? 0 : 1,
        coversLatin(face.unicodeRange) ? 0 : 1,
        weightDistance(face.weight, weight),
        FORMAT_RANK[face.format] ?? 9,
      ],
    }))
    .sort((a, b) => {
      for (let index = 0; index < a.rank.length; index++) {
        const diff = (a.rank[index] ?? 0) - (b.rank[index] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    })[0]?.face;
}

export function methodOf(url: string, siteHost: string): FontMethod {
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'fonts.gstatic.com' || host === 'fonts.googleapis.com') return 'google-fonts';
  if (host.endsWith('typekit.net') || host.endsWith('typekit.com')) return 'adobe-fonts';
  const bare = (name: string) => name.replace(/^www\./, '');
  if (bare(host) === bare(siteHost) || host.endsWith(`.${bare(siteHost)}`)) return 'self-hosted';
  return 'other-host';
}

/**
 * Which loaded family each role uses, and the file it loads from. A role whose stack names only
 * system fonts gets `method: "system"` and no file; the caller fills in a substitute.
 */
export function resolveFonts(fonts: RawFonts, faces: FontFace[], siteHost: string): ResolvedFont[] {
  const loaded = new Set(fonts.loaded.map((face) => face.family.toLowerCase()));
  const known = new Set(faces.map((face) => face.family.toLowerCase()));
  const roles: ResolvedFont['role'][] = ['display', 'body', 'mono'];
  return roles.flatMap((role): ResolvedFont[] => {
    const use = fonts.uses.find((item) => item.role === role);
    if (!use) return [];
    const names = families(use.stack);
    const family =
      names.find((name) => known.has(name.toLowerCase()) || loaded.has(name.toLowerCase())) ??
      names.find((name) => !isSystemFamily(name));
    if (!family) {
      return [
        {
          role,
          family: names[0] ?? 'sans-serif',
          weight: use.weight,
          method: 'system',
          url: null,
          siteFamily: null,
        },
      ];
    }
    const face = pickFace(faces, family, use.weight);
    if (!face) {
      return [{ role, family, weight: use.weight, method: 'system', url: null, siteFamily: null }];
    }
    return [
      {
        role,
        family,
        weight: use.weight,
        method: methodOf(face.url, siteHost),
        url: face.url,
        siteFamily: null,
      },
    ];
  });
}

/** The Google Fonts stylesheet that serves a substitute family at the weights given. */
export function substituteCssUrl(family: string, weights: number[]): string {
  const list = [
    ...new Set(
      weights.map((weight) => Math.min(900, Math.max(100, Math.round(weight / 100) * 100))),
    ),
  ].sort((a, b) => a - b);
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${list.join(';')}&display=swap`;
}
