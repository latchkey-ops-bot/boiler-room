/**
 * Lays frames out on one image with a label under each, for the Quality Check agent to look at.
 * Remotion's FFmpeg has no `tile` or `drawtext`, so the grid and the labels are drawn here: the
 * labels in a 5 × 7 pixel font, scaled up, in a band below each frame so they never cover it.
 */
import type { Pixels } from './compare.ts';

export const GLYPHS: Record<string, string> = {
  A: '01110100011000111111100011000110001',
  B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110',
  E: '11111100001000011110100001000011111',
  F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111',
  H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110',
  J: '00111000100001000010000101001001100',
  K: '10001100101010011000101001001010001',
  L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001',
  N: '10001100011100110101100111000110001',
  O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101',
  R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110',
  T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100',
  W: '10001100011000110101101011010101010',
  X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100',
  Z: '11111000010001000100010001000011111',
  '0': '01110100011001110101110011000101110',
  '1': '00100011000010000100001000010001110',
  '2': '01110100010000100010001000100011111',
  '3': '11111000100010000010000011000101110',
  '4': '00010001100101010010111110001000010',
  '5': '11111100001111000001000011000101110',
  '6': '00110010001000011110100011000101110',
  '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110',
  '9': '01110100011000101111000010001001100',
  ':': '00000011000110000000011000110000000',
  '.': '00000000000000000000000000110001100',
  '-': '00000000000000011111000000000000000',
  '/': '00001000100001000100010000100010000',
  ' ': '00000000000000000000000000000000000',
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

export type Rgb = [number, number, number];

export interface Canvas extends Pixels {
  data: Uint8Array;
}

export function createCanvas(width: number, height: number, [r, g, b]: Rgb): Canvas {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
    data[index + 3] = 255;
  }
  return { width, height, data };
}

/** Copies `image` onto `canvas` with its top left corner at (`x`, `y`), clipped to the canvas. */
export function blit(canvas: Canvas, image: Pixels, x: number, y: number) {
  for (let row = 0; row < image.height; row += 1) {
    const targetY = y + row;
    if (targetY < 0 || targetY >= canvas.height) continue;
    const from = Math.max(0, -x);
    const to = Math.min(image.width, canvas.width - x);
    if (to <= from) continue;
    const source = image.data.subarray(
      (row * image.width + from) * 4,
      (row * image.width + to) * 4,
    );
    canvas.data.set(source, (targetY * canvas.width + x + from) * 4);
  }
}

export const textWidth = (text: string, scale: number) =>
  text.length === 0 ? 0 : (text.length * (GLYPH_WIDTH + 1) - 1) * scale;

/** Draws `text` in capitals; a character the font lacks is drawn as a space. */
export function drawText(
  canvas: Canvas,
  text: string,
  x: number,
  y: number,
  scale: number,
  [r, g, b]: Rgb,
) {
  let cursor = x;
  for (const character of text.toUpperCase()) {
    const glyph = GLYPHS[character] ?? (GLYPHS[' '] as string);
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        if (glyph[row * GLYPH_WIDTH + column] !== '1') continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const px = cursor + column * scale + dx;
            const py = y + row * scale + dy;
            if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
            const offset = (py * canvas.width + px) * 4;
            canvas.data[offset] = r;
            canvas.data[offset + 1] = g;
            canvas.data[offset + 2] = b;
          }
        }
      }
    }
    cursor += (GLYPH_WIDTH + 1) * scale;
  }
}

export interface SheetTile {
  image: Pixels;
  label: string;
}

export interface SheetOptions {
  columns: number;
  gap?: number;
  labelScale?: number;
  background?: Rgb;
  ink?: Rgb;
  /** A line across the top of the sheet. */
  title?: string;
}

/**
 * A grid of frames, left to right and top to bottom, each with its label beneath. Every tile is
 * given the size of the largest, so frames of one film line up.
 */
export function composeSheet(tiles: SheetTile[], options: SheetOptions): Canvas {
  if (tiles.length === 0) throw new RangeError('A sheet needs at least one frame.');
  const gap = options.gap ?? 12;
  const scale = options.labelScale ?? 2;
  const background = options.background ?? [18, 18, 20];
  const ink = options.ink ?? [235, 235, 235];
  const columns = Math.max(1, Math.min(options.columns, tiles.length));
  const rows = Math.ceil(tiles.length / columns);
  const tileWidth = Math.max(...tiles.map(({ image }) => image.width));
  const tileHeight = Math.max(...tiles.map(({ image }) => image.height));
  const labelHeight = GLYPH_HEIGHT * scale + gap;
  const titleHeight = options.title ? GLYPH_HEIGHT * scale + gap : 0;
  const width = columns * tileWidth + (columns + 1) * gap;
  const height = titleHeight + rows * (tileHeight + labelHeight) + (rows + 1) * gap;
  const canvas = createCanvas(width, height, background);
  if (options.title) drawText(canvas, options.title, gap, gap, scale, ink);
  tiles.forEach(({ image, label }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + column * (tileWidth + gap);
    const y = titleHeight + gap + row * (tileHeight + labelHeight + gap);
    blit(canvas, image, x, y);
    drawText(canvas, label, x, y + tileHeight + Math.floor(gap / 2), scale, ink);
  });
  return canvas;
}
