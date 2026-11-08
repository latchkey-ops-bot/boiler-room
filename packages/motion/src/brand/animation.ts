/**
 * Whether an image file moves on its own. An animated image drawn with `<Img>` plays on the
 * browser's clock, not the film's: a fresh tab shows its first frame and a tab that has rendered
 * for a while shows another, so chunks and tabs disagree and the film flickers. It is read from the
 * bytes, so it can be tested without a browser and gives the same answer everywhere.
 */

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));
const u32be = (bytes: Uint8Array, at: number) =>
  (((bytes[at] ?? 0) << 24) |
    ((bytes[at + 1] ?? 0) << 16) |
    ((bytes[at + 2] ?? 0) << 8) |
    (bytes[at + 3] ?? 0)) >>>
  0;
const u32le = (bytes: Uint8Array, at: number) =>
  ((bytes[at] ?? 0) |
    ((bytes[at + 1] ?? 0) << 8) |
    ((bytes[at + 2] ?? 0) << 16) |
    ((bytes[at + 3] ?? 0) << 24)) >>>
  0;

/** The size of a GIF colour table that a packed field declares, in bytes. */
const colourTable = (packed: number) => (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);

/** Past a run of GIF data sub-blocks, which ends with an empty one. */
function skipSubBlocks(bytes: Uint8Array, start: number): number {
  let at = start;
  while (at < bytes.length) {
    const size = bytes[at] ?? 0;
    at += 1 + size;
    if (size === 0) break;
  }
  return at;
}

/** More than one image in the GIF's stream. */
function gifAnimates(bytes: Uint8Array): boolean {
  let at = 13 + colourTable(bytes[10] ?? 0);
  let images = 0;
  while (at < bytes.length) {
    const block = bytes[at];
    if (block === 0x21) {
      at = skipSubBlocks(bytes, at + 2);
    } else if (block === 0x2c) {
      images += 1;
      if (images > 1) return true;
      at = skipSubBlocks(bytes, at + 10 + colourTable(bytes[at + 9] ?? 0) + 1);
    } else {
      // The trailer, or a file that does not go on.
      return false;
    }
  }
  return false;
}

/** An APNG declares its frames in `acTL`, before the first `IDAT`. */
function pngAnimates(bytes: Uint8Array): boolean {
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = u32be(bytes, at);
    const type = ascii(bytes, at + 4, 4);
    if (type === 'acTL') return u32be(bytes, at + 8) > 1;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += 12 + length;
  }
  return false;
}

/** An extended WebP sets its animation flag, and has `ANIM` and `ANMF` chunks. */
function webpAnimates(bytes: Uint8Array): boolean {
  let at = 12;
  while (at + 8 <= bytes.length) {
    const fourcc = ascii(bytes, at, 4);
    const size = u32le(bytes, at + 4);
    if (fourcc === 'VP8X') return ((bytes[at + 8] ?? 0) & 0x02) !== 0;
    if (fourcc === 'ANIM' || fourcc === 'ANMF') return true;
    at += 8 + size + (size % 2);
  }
  return false;
}

/** An AVIF image sequence names the `avis` brand in its `ftyp` box. */
function avifAnimates(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, u32be(bytes, 0));
  if (ascii(bytes, 8, 4) === 'avis') return true;
  for (let at = 16; at + 4 <= end; at += 4) {
    if (ascii(bytes, at, 4) === 'avis') return true;
  }
  return false;
}

// SMIL runs in an SVG drawn as an image, and so do CSS animations. A CSS transition does not: it
// needs a change of style, and nothing changes an image's style once it is drawn.
const SMIL = /<(?:[\w-]+:)?(?:animate|animateTransform|animateMotion|animateColor|set)[\s/>]/i;
const CSS_ANIMATION = /@(?:-[a-z]+-)?keyframes\b|\banimation(?:-name)?\s*:/i;
const EMBEDDED_IMAGE = /data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=\s]+)/g;

function svgAnimates(markup: string): boolean {
  if (SMIL.test(markup) || CSS_ANIMATION.test(markup)) return true;
  // An SVG can carry a raster of its own, which animates inside it as it would alone.
  for (const [, base64] of markup.matchAll(EMBEDDED_IMAGE)) {
    try {
      const binary = atob((base64 ?? '').replace(/\s+/g, ''));
      if (isAnimated(Uint8Array.from(binary, (char) => char.charCodeAt(0)))) return true;
    } catch {
      // Not base64 after all, so not an image the browser would draw.
    }
  }
  return false;
}

/** True when the file has more than one frame. A format this does not know is taken as still. */
export function isAnimated(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 3) === 'GIF') return gifAnimates(bytes);
  if (ascii(bytes, 1, 3) === 'PNG' && bytes[0] === 0x89) return pngAnimates(bytes);
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return webpAnimates(bytes);
  if (ascii(bytes, 4, 4) === 'ftyp') return avifAnimates(bytes);
  const head = new TextDecoder().decode(bytes.subarray(0, 4096)).trimStart();
  if (head.startsWith('<') && /<svg[\s>]/i.test(new TextDecoder().decode(bytes))) {
    return svgAnimates(new TextDecoder().decode(bytes));
  }
  return false;
}
