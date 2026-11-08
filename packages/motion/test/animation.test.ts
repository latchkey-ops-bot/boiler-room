import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { animatedSvg, twoFrameGif } from '../scripts/fixture-files.ts';
import { isAnimated } from '../src/brand/animation.ts';

const EXAMPLES = path.resolve(import.meta.dirname, '../../schema/examples');
const example = (file: string) => new Uint8Array(readFileSync(path.join(EXAMPLES, file)));
const text = (value: string) => new TextEncoder().encode(value);
const ascii = (value: string) => [...text(value)];
const u32be = (value: number) => [
  value >>> 24,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];
const u32le = (value: number) => [...u32be(value)].reverse();

/** The first frame of the two-frame GIF and its trailer: a still GIF. */
function oneFrameGif(): Uint8Array {
  const bytes = twoFrameGif();
  const secondFrame = bytes.lastIndexOf(0x21, bytes.length - 20);
  return new Uint8Array([...bytes.slice(0, secondFrame), 0x3b]);
}

const pngChunk = (type: string, data: number[]) => [
  ...u32be(data.length),
  ...ascii(type),
  ...data,
  0,
  0,
  0,
  0,
];
const png = (...chunks: number[][]) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunks.flat()]);
const ihdr = pngChunk('IHDR', [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0]);
const actl = (frames: number) => pngChunk('acTL', [...u32be(frames), ...u32be(0)]);
const idat = pngChunk('IDAT', [0x78, 0x9c]);

const riffChunk = (fourcc: string, data: number[]) => [
  ...ascii(fourcc),
  ...u32le(data.length),
  ...data,
  ...(data.length % 2 ? [0] : []),
];
const webp = (...chunks: number[][]) => {
  const body = [...ascii('WEBP'), ...chunks.flat()];
  return new Uint8Array([...ascii('RIFF'), ...u32le(body.length), ...body]);
};
const vp8x = (flags: number) => riffChunk('VP8X', [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

const avif = (major: string, ...compatible: string[]) => {
  const box = [...ascii('ftyp'), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)];
  return new Uint8Array([...u32be(box.length + 4), ...box]);
};

describe('isAnimated', () => {
  it('finds a GIF with a second frame', () => {
    expect(isAnimated(twoFrameGif())).toBe(true);
    expect(isAnimated(oneFrameGif())).toBe(false);
  });

  it('finds an APNG, which a plain PNG reader shows as its first frame', () => {
    expect(isAnimated(png(ihdr, actl(6), idat))).toBe(true);
    expect(isAnimated(png(ihdr, actl(1), idat))).toBe(false);
    expect(isAnimated(png(ihdr, idat))).toBe(false);
    expect(isAnimated(example('assets/nova/dashboard.png'))).toBe(false);
  });

  it('finds an animated WebP', () => {
    expect(isAnimated(webp(vp8x(0x02)))).toBe(true);
    expect(isAnimated(webp(vp8x(0x10)))).toBe(false);
    expect(isAnimated(webp(riffChunk('VP8L', [0x2f, 0, 0, 0])))).toBe(false);
  });

  it('finds an AVIF image sequence', () => {
    expect(isAnimated(avif('avis', 'avif', 'mif1'))).toBe(true);
    expect(isAnimated(avif('avif', 'mif1', 'avis'))).toBe(true);
    expect(isAnimated(avif('avif', 'mif1', 'miaf'))).toBe(false);
  });

  it('finds an SVG that animates with SMIL or CSS', () => {
    const logo = readFileSync(path.join(EXAMPLES, 'assets/nova/logo.svg'), 'utf8');
    expect(isAnimated(text(logo))).toBe(false);
    expect(isAnimated(text(animatedSvg(logo)))).toBe(true);
    for (const markup of [
      '<svg><rect><animateTransform attributeName="transform"/></rect></svg>',
      '<svg><circle><animateMotion path="M0 0"/></circle></svg>',
      '<svg><rect><set attributeName="fill" to="red" begin="1s"/></rect></svg>',
      '<svg><style>@keyframes spin { to { transform: rotate(1turn) } }</style></svg>',
      '<svg><rect style="animation: spin 2s infinite"/></svg>',
      '<svg><style>.a { animation-name: pulse }</style></svg>',
    ]) {
      expect(isAnimated(text(markup)), markup).toBe(true);
    }
  });

  it('finds an animated image inside an SVG', () => {
    const gif = Buffer.from(twoFrameGif()).toString('base64');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/gif;base64,${gif}"/></svg>`;
    expect(isAnimated(text(svg))).toBe(true);
    const still = Buffer.from(oneFrameGif()).toString('base64');
    expect(isAnimated(text(svg.replace(gif, still)))).toBe(false);
  });

  it('takes a JPEG and anything it does not know as still', () => {
    expect(isAnimated(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]))).toBe(false);
    expect(isAnimated(new Uint8Array([]))).toBe(false);
    expect(isAnimated(text('not an image'))).toBe(false);
  });

  it('does not run past the end of a cut-off file', () => {
    const gif = twoFrameGif();
    for (let length = 0; length < gif.length; length += 1) {
      expect(() => isAnimated(gif.slice(0, length))).not.toThrow();
    }
  });
});
