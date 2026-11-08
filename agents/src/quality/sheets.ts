/**
 * The sheets the agent looks at, built here from frames decoded from the film itself, so that no
 * picture the render folder holds can stand in for the film. The layout and the 5 x 7 label font
 * follow the render service's own sheets (`services/render/src/sheets.ts` on feat/motion-render),
 * so the agent sees the same thing whichever built them.
 */
import { join } from 'node:path';
import { type Campaign, sceneFrames, toFrame } from '@boiler-room/schema';
import { timecode } from './checks.ts';
import type { Flash, Run } from './measure.ts';
import { decodeFrames, type RgbImage, writePng } from './media.ts';
import type { QualityIndex } from './render-dir.ts';

const GLYPHS: Record<string, string> = {
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
const GAP = 12;
const SCALE = 2;
const PAPER: [number, number, number] = [18, 18, 20];
const INK: [number, number, number] = [235, 235, 235];

function canvas(width: number, height: number): RgbImage {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i += 3) data.set(PAPER, i);
  return { width, height, data };
}

function blit(target: RgbImage, image: RgbImage, x: number, y: number) {
  for (let row = 0; row < image.height; row += 1) {
    const ty = y + row;
    if (ty < 0 || ty >= target.height) continue;
    const from = Math.max(0, -x);
    const to = Math.min(image.width, target.width - x);
    if (to <= from) continue;
    image.data.copy(
      target.data,
      (ty * target.width + x + from) * 3,
      (row * image.width + from) * 3,
      (row * image.width + to) * 3,
    );
  }
}

function drawText(target: RgbImage, text: string, x: number, y: number) {
  let cursor = x;
  for (const character of text.toUpperCase()) {
    const glyph = GLYPHS[character] ?? (GLYPHS[' '] as string);
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        if (glyph[row * GLYPH_WIDTH + column] !== '1') continue;
        for (let dy = 0; dy < SCALE; dy += 1) {
          for (let dx = 0; dx < SCALE; dx += 1) {
            const px = cursor + column * SCALE + dx;
            const py = y + row * SCALE + dy;
            if (px < 0 || py < 0 || px >= target.width || py >= target.height) continue;
            target.data.set(INK, (py * target.width + px) * 3);
          }
        }
      }
    }
    cursor += (GLYPH_WIDTH + 1) * SCALE;
  }
}

export interface Tile {
  image: RgbImage;
  label: string;
}

/** A grid of frames, left to right and top to bottom, each with its label beneath. */
export function composeSheet(tiles: readonly Tile[], columns: number, title: string): RgbImage {
  if (tiles.length === 0) throw new RangeError('A sheet needs at least one frame.');
  const across = Math.max(1, Math.min(columns, tiles.length));
  const rows = Math.ceil(tiles.length / across);
  const tileWidth = Math.max(...tiles.map(({ image }) => image.width));
  const tileHeight = Math.max(...tiles.map(({ image }) => image.height));
  const labelHeight = GLYPH_HEIGHT * SCALE + GAP;
  const titleHeight = GLYPH_HEIGHT * SCALE + GAP;
  const sheet = canvas(
    across * tileWidth + (across + 1) * GAP,
    titleHeight + rows * (tileHeight + labelHeight) + (rows + 1) * GAP,
  );
  drawText(sheet, title, GAP, GAP);
  tiles.forEach(({ image, label }, index) => {
    const x = GAP + (index % across) * (tileWidth + GAP);
    const y = titleHeight + GAP + Math.floor(index / across) * (tileHeight + labelHeight + GAP);
    blit(sheet, image, x, y);
    drawText(sheet, label, x, y + tileHeight + Math.floor(GAP / 2));
  });
  return sheet;
}

/** Tile widths and columns by aspect ratio, as the render service lays its sheets out. */
export function layoutFor(width: number, height: number) {
  const aspect = width / height;
  if (aspect > 1.2)
    return { contactWidth: 384, contactColumns: 5, stillWidth: 640, phoneColumns: 2 };
  if (aspect < 0.8)
    return { contactWidth: 216, contactColumns: 8, stillWidth: 360, phoneColumns: 6 };
  return { contactWidth: 288, contactColumns: 6, stillWidth: 480, phoneColumns: 4 };
}

/** A phone held upright is about 390 CSS pixels wide. */
export const PHONE_WIDTH = 390;

/** What the agent is given: a file, a name, what it shows, and every frame in it. */
export interface SheetImage {
  file: string;
  name: string;
  what: string;
  frames: number[];
}

export interface SheetInput {
  film: string;
  /** The film as decoded: its size and frame count. */
  size: { width: number; height: number; frames: number };
  cut: Campaign;
  campaignId: string;
  /** The render service's transition plan, for the frames just outside each overlay. */
  index: QualityIndex;
  /** Each scene's rest frame. */
  rests: { sceneId: string; frame: number }[];
  /** Frames per render chunk, when the film was rendered in chunks. */
  framesPerChunk: number | undefined;
  outliers: { blank: Run[]; flash: Flash[] };
  work: string;
}

const tileSize = (width: number, size: { width: number; height: number }) => ({
  width,
  height: Math.max(2, Math.round((width * size.height) / size.width)),
});

/** One frame per second, as the render service's contact sheet takes them. */
export function contactFrames(cut: Pick<Campaign, 'scenes' | 'fps' | 'durationSeconds'>): number[] {
  const { fps, durationInFrames } = sceneFrames(cut);
  const frames: number[] = [];
  for (let second = 0; toFrame(second, fps) < durationInFrames; second += 1) {
    frames.push(toFrame(second, fps));
  }
  return frames;
}

/**
 * Each seam with a transition, with the frames before, during and after it. During is always the
 * boundary from `sceneFrames`. Before and after come from the render service's plan when it has
 * this boundary and its frames lie within a second of it; otherwise they are the frames either
 * side of the boundary.
 */
export function transitionStills(
  cut: Campaign,
  index: QualityIndex,
  frames: number,
): { number: number; name: string; boundary: number; stills: { when: string; frame: number }[] }[] {
  const { scenes, fps } = sceneFrames(cut);
  const clamp = (frame: number) => Math.min(frames - 1, Math.max(0, frame));
  return scenes.slice(1).flatMap((scene, at) => {
    const name = cut.scenes[at]?.transitionOut;
    if (!name) return [];
    const boundary = scene.from;
    const planned = index.transitions.find((each) => each.boundary === boundary);
    const near = (frame: number | undefined) =>
      frame !== undefined && Math.abs(frame - boundary) <= fps ? frame : undefined;
    const before =
      near(planned?.stills.find((still) => still.when === 'before')?.frame) ?? boundary - 1;
    const after =
      near(planned?.stills.find((still) => still.when === 'after')?.frame) ?? boundary + 1;
    return [
      {
        number: at + 1,
        name,
        boundary,
        stills: [
          { when: 'before', frame: clamp(before) },
          { when: 'during', frame: clamp(boundary) },
          { when: 'after', frame: clamp(after) },
        ],
      },
    ];
  });
}

/** Builds the contact, transitions, phone and seams sheets, and returns them in that order. */
export async function buildSheets(input: SheetInput): Promise<SheetImage[]> {
  const { cut, size, work, campaignId } = input;
  const fps = cut.fps;
  const layout = layoutFor(size.width, size.height);
  const inFilm = (frame: number) => frame >= 0 && frame < size.frames;
  const tiles = async (
    frames: readonly number[],
    width: number,
    labels: (frame: number) => string,
  ) => {
    const shown = frames.filter(inFilm);
    const { width: w, height: h } = tileSize(width, size);
    const decoded = await decodeFrames(input.film, shown, w, h);
    return shown.map((frame) => ({
      image: decoded.get(frame) as RgbImage,
      label: labels(frame),
      frame,
    }));
  };
  const sheets: SheetImage[] = [];
  const write = async (
    name: string,
    made: { image: RgbImage; label: string; frame: number }[],
    columns: number,
    title: string,
    what: string,
  ) => {
    if (made.length === 0) return;
    const file = join(work, `${name}.png`);
    await writePng(file, composeSheet(made, columns, title));
    sheets.push({
      file,
      name: `${campaignId}-${name}.png`,
      what,
      frames: [...new Set(made.map((tile) => tile.frame))],
    });
  };
  const scene = (frame: number) =>
    sceneFrames(cut).scenes.find(
      ({ from, durationInFrames }) => frame >= from && frame < from + durationInFrames,
    )?.id ?? '';
  const clock = (frame: number) => timecode(frame, fps).replace(/\.\d+$/, '');

  const contact = await tiles(
    contactFrames(cut),
    layout.contactWidth,
    (frame) => `${clock(frame)}  F${frame}`,
  );
  await write(
    'contact-sheet',
    contact,
    layout.contactColumns,
    `CONTACT SHEET  1 FRAME PER SECOND  ${size.frames} FRAMES AT ${fps} FPS`,
    `Contact sheet, decoded from the film: one frame per second, each labelled with its time and frame number (${contact.map((tile) => `F${tile.frame} ${scene(tile.frame)}`).join(', ')}).`,
  );

  const transitions = transitionStills(cut, input.index, size.frames);
  const stillTiles = await tiles(
    transitions.flatMap((each) => each.stills.map((still) => still.frame)),
    layout.stillWidth,
    () => '',
  );
  const byFrame = new Map(stillTiles.map((tile) => [tile.frame, tile]));
  const transitionTiles = transitions.flatMap((each) =>
    each.stills.flatMap((still) => {
      const tile = byFrame.get(still.frame);
      return tile
        ? [{ ...tile, label: `${each.number} ${each.name} ${still.when} F${still.frame}` }]
        : [];
    }),
  );
  await write(
    'transitions-sheet',
    transitionTiles,
    3,
    'TRANSITIONS  BEFORE  DURING  AFTER',
    `Transitions sheet, decoded from the film: each row is one seam, before, during (the boundary) and after: ${transitions
      .map(
        (each) =>
          `${each.number} ${each.name} at boundary F${each.boundary} (${each.stills.map((still) => `${still.when} F${still.frame}`).join(', ')})`,
      )
      .join('; ')}.`,
  );

  const restScene = new Map(input.rests.map((rest) => [rest.frame, rest.sceneId]));
  const phone = await tiles(
    input.rests.map((rest) => rest.frame),
    PHONE_WIDTH,
    (frame) => `${restScene.get(frame) ?? ''} F${frame}`,
  );
  await write(
    'phone-sheet',
    phone,
    size.width > size.height ? 2 : layout.phoneColumns,
    `PHONE SIZE  ${PHONE_WIDTH} PX WIDE`,
    `Phone sheet, decoded from the film: each scene ${PHONE_WIDTH} px wide, the width of a phone held upright (${phone.map((tile) => `${restScene.get(tile.frame)} F${tile.frame}`).join(', ')}).`,
  );

  // Chunk seams, where render faults cluster, and every frame code flagged, before and at.
  const seams: { label: string; frame: number }[] = [];
  const chunk = input.framesPerChunk;
  if (chunk && chunk > 0) {
    for (let at = chunk; at < size.frames; at += chunk) {
      seams.push(
        { label: `CHUNK SEAM ${at} BEFORE F${at - 1}`, frame: at - 1 },
        { label: `CHUNK SEAM ${at} AT F${at}`, frame: at },
      );
    }
  }
  const flagged = [
    ...input.outliers.blank.map((run) => ({ kind: 'BLANK', run })),
    ...input.outliers.flash.map((run) => ({ kind: 'FLASH', run })),
  ]
    .sort((a, b) => a.run.from - b.run.from)
    .slice(0, 6);
  for (const { kind, run } of flagged) {
    const span = run.to > run.from ? `${run.from}-${run.to}` : `${run.from}`;
    seams.push(
      { label: `${kind} ${span} BEFORE F${run.from - 1}`, frame: run.from - 1 },
      { label: `${kind} ${span} AT F${run.from}`, frame: run.from },
    );
  }
  const seamTiles = await tiles(
    seams.map((each) => each.frame),
    layout.stillWidth,
    () => '',
  );
  const seamByFrame = new Map(seamTiles.map((tile) => [tile.frame, tile]));
  await write(
    'seams-sheet',
    seams.flatMap((each) => {
      const tile = seamByFrame.get(each.frame);
      return tile ? [{ ...tile, label: each.label }] : [];
    }),
    2,
    'CHUNK SEAMS AND FLAGGED FRAMES  BEFORE  AT',
    `Seams sheet, decoded from the film: in pairs, the frame before and the frame at each place where the film was rendered in separate chunks, and at each run of frames code flagged as blank or as a flash (${seams.map((each) => each.label.toLowerCase()).join(', ')}). Look for a jump in layout, colour or content between the two frames of a pair.`,
  );
  return sheets;
}
