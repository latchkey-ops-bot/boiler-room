/**
 * Files that a determinism fixture or a test needs and that no example has: an animated GIF and an
 * animated SVG. They are made here rather than committed, so their bytes are readable in review.
 */

const hex = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((byte) => Number.parseInt(byte, 16));
const ascii = (text: string) => [...new TextEncoder().encode(text)];

/** One frame: a 10 cs delay, a 1 × 1 image at 0, 0, and its LZW data. */
const gifFrame = (lzw: string) => [
  ...hex('21 f9 04 00 0a 00 00 00'),
  ...hex('2c 00 00 00 00 01 00 01 00 00'),
  ...hex(`02 ${lzw} 00`),
];

/** A 1 × 1 GIF that loops through two frames, red then blue. */
export function twoFrameGif(): Uint8Array {
  return new Uint8Array([
    ...ascii('GIF89a'),
    // 1 × 1, with a global colour table of two colours: red and blue.
    ...hex('01 00 01 00 80 00 00  ff 00 00  00 00 ff'),
    // NETSCAPE2.0: loop forever.
    ...hex('21 ff 0b'),
    ...ascii('NETSCAPE2.0'),
    ...hex('03 01 00 00 00'),
    // Each frame is clear, one colour index, end: index 0, then index 1.
    ...gifFrame('02 44 01'),
    ...gifFrame('02 4c 01'),
    0x3b,
  ]);
}

/** The same SVG with its first shape's fill animated by SMIL, as a logo taken from a site can be. */
export function animatedSvg(svg: string): string {
  return svg.replace(
    /<rect([^>]*?)\/>/,
    '<rect$1><animate attributeName="fill" values="#7C9CFF;#FF5050;#50E070" dur="0.9s" repeatCount="indefinite"/></rect>',
  );
}
