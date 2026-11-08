import { describe, expect, it } from 'vitest';
import { pngSize, rankLogos, sniff, wordmarkSvg } from '../src/capture/logo.ts';
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
  it('prefers an SVG file, then inline SVG, then a raster logo, then favicons, and never the social card', () => {
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
