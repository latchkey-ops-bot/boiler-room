import { describe, expect, it } from 'vitest';
import {
  imageSize,
  normaliseSvg,
  pngSize,
  rankLogos,
  sniff,
  wordmarkSvg,
} from '../src/capture/logo.ts';
import type { RawLogoCandidate } from '../src/capture/types.ts';

const bytes = (text: string) => new TextEncoder().encode(text);
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0,
  0, 0, 1, 0,
]);

function candidate(overrides: Partial<RawLogoCandidate>): RawLogoCandidate {
  return {
    kind: 'img',
    url: null,
    svg: null,
    alt: '',
    width: 120,
    height: 32,
    inHeader: true,
    homeLink: true,
    logoHint: true,
    type: '',
    ...overrides,
  };
}

describe('sniff', () => {
  it('identifies images by their bytes', () => {
    expect(sniff(PNG)).toBe('png');
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(
      sniff(bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBe('svg');
    expect(sniff(bytes('﻿  <svg viewBox="0 0 1 1"/>'))).toBe('svg');
  });

  it('catches a soft 404: an HTML page served where a logo should be', () => {
    expect(
      sniff(
        bytes(
          '<!DOCTYPE html><html><head><title>App</title></head><body><div id="root"></div></body></html>',
        ),
      ),
    ).toBe('html');
    expect(sniff(bytes('<html lang="en"><body><svg></svg></body></html>'))).toBe('html');
    expect(sniff(bytes('not an image'))).toBe('unknown');
  });

  it('reads PNG dimensions', () => {
    expect(pngSize(PNG)).toEqual({ width: 512, height: 256 });
    expect(pngSize(bytes('<svg/>'))).toBeUndefined();
  });
});

describe('rankLogos', () => {
  it('prefers an SVG file, then inline SVG, then a raster logo, then favicons, and the social card last', () => {
    const ranked = rankLogos([
      candidate({
        kind: 'og-image',
        url: 'https://s.example/og.png',
        inHeader: false,
        homeLink: false,
        logoHint: false,
      }),
      candidate({
        kind: 'icon',
        url: 'https://s.example/favicon.ico',
        width: 0,
        height: 0,
        inHeader: false,
        homeLink: false,
        logoHint: false,
      }),
      candidate({
        kind: 'icon',
        url: 'https://s.example/icon.svg',
        type: 'image/svg+xml',
        inHeader: false,
        homeLink: false,
        logoHint: false,
      }),
      candidate({ kind: 'img', url: 'https://s.example/logo.png' }),
      candidate({ kind: 'inline-svg', svg: '<svg/>' }),
      candidate({ kind: 'img', url: 'https://s.example/logo.svg?v=2' }),
    ]);
    expect(ranked.map((item) => [item.source, item.candidate.url ?? 'inline'])).toEqual([
      ['svg', 'https://s.example/logo.svg?v=2'],
      ['inline-svg', 'inline'],
      ['png', 'https://s.example/logo.png'],
      ['favicon', 'https://s.example/icon.svg'],
      ['favicon', 'https://s.example/favicon.ico'],
      ['png', 'https://s.example/og.png'],
    ]);
    expect(ranked.map((item) => item.placement)).toEqual([
      'header-home-link',
      'header-home-link',
      'header-home-link',
      'icon',
      'icon',
      'og-image',
    ]);
  });

  // posthog.com: the header's home link shows the hedgehog mark at desktop width and holds the
  // full lockup of mark and name, hidden, for phones. The hero draws the lockup again in colour.
  // A desktop "Home" icon is a home link too, and is no logo.
  it('takes the lockup over the mark, and its full-colour twin over both', () => {
    const header = { inHeader: true, homeLink: true, headerHome: true, logoHint: false };
    const mark = candidate({
      ...header,
      kind: 'inline-svg',
      svg: '<svg viewBox="0 0 52 28"/>',
      width: 24,
      height: 12.92,
      shapes: 4,
      colors: 1,
    });
    const lockup = candidate({
      ...header,
      kind: 'inline-svg',
      svg: '<svg viewBox="0 0 160 28"/>',
      width: 160,
      height: 28,
      hidden: true,
      shapes: 8,
      colors: 1,
    });
    const twin = candidate({
      kind: 'inline-svg',
      svg: '<svg viewBox="0 0 160 28" data-colour/>',
      width: 157,
      height: 27.48,
      inHeader: true,
      homeLink: false,
      headerHome: false,
      logoHint: false,
      twin: true,
      shapes: 9,
      colors: 5,
    });
    const house = candidate({
      kind: 'inline-svg',
      svg: '<svg viewBox="0 0 36 36" data-house/>',
      width: 36,
      height: 36,
      inHeader: true,
      homeLink: true,
      headerHome: false,
      logoHint: false,
    });
    const touch = candidate({
      kind: 'apple-touch-icon',
      url: 'https://s.example/icon-512.png',
      width: 512,
      height: 512,
      inHeader: false,
      homeLink: false,
      logoHint: false,
    });
    const og = candidate({
      kind: 'og-image',
      url: 'https://s.example/og.png',
      inHeader: false,
      homeLink: false,
      logoHint: false,
    });
    const ranked = rankLogos([og, touch, house, twin, mark, lockup]);
    expect(ranked.map((item) => item.candidate)).toEqual([twin, lockup, mark, house, touch, og]);
    expect(ranked.map((item) => item.placement)).toEqual([
      'page',
      'header-home-link',
      'header-home-link',
      'header',
      'apple-touch-icon',
      'og-image',
    ]);
    expect(ranked[0]?.why).toContain('5 colours');
    expect(ranked[1]?.why).toContain('lockup');

    // A twin in no more colours than the header's own adds nothing, and is not taken.
    const plain = { ...twin, colors: 1 };
    expect(rankLogos([plain, mark, lockup]).map((item) => item.candidate)).toEqual([lockup, mark]);
  });

  it("keeps the header's picture named as a logo ahead of icons when the home link is only text", () => {
    const named = candidate({
      kind: 'img',
      url: 'https://s.example/brand.png',
      homeLink: false,
      headerHome: false,
      logoHint: true,
    });
    const icon = candidate({
      kind: 'icon',
      url: 'https://s.example/icon.svg',
      type: 'image/svg+xml',
      inHeader: false,
      homeLink: false,
      logoHint: false,
    });
    const ranked = rankLogos([icon, named]);
    expect(ranked.map((item) => [item.candidate.url, item.placement])).toEqual([
      ['https://s.example/brand.png', 'header'],
      ['https://s.example/icon.svg', 'icon'],
    ]);
  });

  it('ranks large icons and apple-touch-icons ahead of small icons, and those ahead of the social card', () => {
    const icon = (overrides: Partial<RawLogoCandidate>) =>
      candidate({ inHeader: false, homeLink: false, logoHint: false, ...overrides });
    const ranked = rankLogos([
      icon({ kind: 'og-image', url: 'https://s.example/og.png' }),
      icon({ kind: 'icon', url: 'https://s.example/favicon-32.png', width: 32, height: 32 }),
      icon({ kind: 'icon', url: 'https://s.example/icon-192.png', width: 192, height: 192 }),
      icon({ kind: 'apple-touch-icon', url: 'https://s.example/touch.png', width: 0, height: 0 }),
      icon({
        kind: 'apple-touch-icon',
        url: 'https://s.example/touch-512.png',
        width: 512,
        height: 512,
      }),
    ]);
    expect(ranked.map((item) => item.candidate.url)).toEqual([
      'https://s.example/touch-512.png',
      'https://s.example/touch.png',
      'https://s.example/icon-192.png',
      'https://s.example/favicon-32.png',
      'https://s.example/og.png',
    ]);
  });

  it('skips header images that are not logos, such as a large hero picture', () => {
    const ranked = rankLogos([
      candidate({
        url: 'https://s.example/hero.jpg',
        width: 1200,
        height: 600,
        homeLink: false,
        logoHint: false,
      }),
    ]);
    expect(ranked).toEqual([]);
  });
});

describe('wordmarkSvg', () => {
  it('sets the name as text in the brand font and colour, escaped', () => {
    const svg = wordmarkSvg('Ben & Jo’s <Lab>', 'Inter', '#4F46E5');
    expect(svg).toContain('font-family="Inter, sans-serif"');
    expect(svg).toContain('fill="#4F46E5"');
    expect(svg).toContain('Ben &amp; Jo’s &lt;Lab&gt;');
    expect(sniff(bytes(svg))).toBe('svg');
  });

  // danluu.com: the wordmark was bold Source Serif 4, but the site shows its name in the
  // browser's default Times New Roman at regular weight.
  it("sets the name in the site's own font stack and weight", () => {
    const svg = wordmarkSvg('danluu.com', '"Times New Roman"', '#000000', 'serif', 400);
    expect(svg).toContain('font-family="&quot;Times New Roman&quot;, serif"');
    expect(svg).toContain('font-weight="400"');
    expect(svg).toContain('>danluu.com</text>');
  });

  // A serif site's wordmark fell back to a sans face wherever its font was missing.
  it('falls back to the same kind of face as the brand font', () => {
    expect(wordmarkSvg('notes', 'Source Serif 4', '#000000', 'serif')).toContain(
      'font-family="Source Serif 4, serif"',
    );
  });
});

describe('normaliseSvg', () => {
  // The first real film's logo: cut from posthog.com's header, sized by the page, and read by the
  // renderer as a 45 x 24 image, too small to be a logo, so the film set the name in type.
  const CUT =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 28" aria-hidden="true" width="auto" style="color: rgb(35, 37, 29); width: 24px" class="size-8 md:size-6" height="24" color="#23251D"><path fill="currentColor" stroke-width="2" d="M0 0h52v28H0z"/><svg width="10" height="10"/></svg>';

  it('gives an SVG cut from a page a size of its own in its viewBox shape', () => {
    const fixed = normaliseSvg(CUT);
    expect(fixed).toMatchObject({ width: 512, height: 276 });
    expect(fixed?.aspect).toBeCloseTo(52 / 28, 5);
    const root = /<svg\b[^>]*>/.exec(fixed?.svg ?? '')?.[0] ?? '';
    expect(root).toContain('width="512" height="276"');
    expect(root).not.toContain('auto');
    expect(root).not.toContain('height="24"');
    expect(root).toContain('style="color: rgb(35, 37, 29)"');
    expect(root).toContain('color="#23251D"');
    // Nothing inside the drawing changes.
    expect(fixed?.svg).toContain('stroke-width="2"');
    expect(fixed?.svg).toContain('<svg width="10" height="10"/>');
  });

  it('adds a viewBox from the declared size when there is none, and uses the page box last', () => {
    const declared = normaliseSvg(
      "<svg width='120' height='30'><rect width='120' height='30'/></svg>",
    );
    expect(declared).toMatchObject({ width: 512, height: 128, aspect: 4 });
    expect(declared?.svg).toContain('viewBox="0 0 120 30"');
    expect(declared?.svg).toContain("<rect width='120' height='30'/>");

    const fluid = '<svg width="100%"><circle r="4"/></svg>';
    expect(normaliseSvg(fluid)).toBeUndefined();
    expect(normaliseSvg(fluid, { width: 40, height: 40 })).toMatchObject({
      width: 512,
      height: 512,
      aspect: 1,
    });
    expect(normaliseSvg('<png/>')).toBeUndefined();
  });

  it('keeps a long edge of 512 for a tall mark', () => {
    expect(normaliseSvg('<svg viewBox="0 0 30 90"></svg>')).toMatchObject({
      width: 171,
      height: 512,
    });
  });
});

describe('imageSize', () => {
  it('reads the size of PNG, GIF, JPEG, WebP and ICO files from their headers', () => {
    expect(imageSize(PNG)).toEqual({ width: 512, height: 256 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xc8, 0x00]);
    expect(imageSize(gif)).toEqual({ width: 320, height: 200 });
    // SOI, an APP0 segment of 16 bytes, then SOF0 with height 300 and width 400.
    const jpeg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x10,
      ...new Array(14).fill(0),
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      0x01,
      0x2c,
      0x01,
      0x90,
      0x03,
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 400, height: 300 });
    const webp = new Uint8Array(30);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    webp.set([0x56, 0x50, 0x38, 0x58], 12);
    // VP8X stores width and height minus one, in three bytes each.
    webp.set([0xff, 0x01, 0x00, 0x7f, 0x00, 0x00], 24);
    expect(imageSize(webp)).toEqual({ width: 512, height: 128 });
    const ico = new Uint8Array([0, 0, 1, 0, 1, 0, 0, 48]);
    expect(imageSize(ico)).toEqual({ width: 256, height: 48 });
    expect(imageSize(bytes('<svg/>'))).toBeUndefined();
  });
});
