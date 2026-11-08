import { isAnimated } from './animation.ts';
import type { LogoProbe } from './logo.ts';

const SAMPLE_SIZE = 48;

const toHex = (value: number) => Math.round(value).toString(16).padStart(2, '0');

function loadImage(url: string, crossOrigin: boolean): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = url;
  });
}

/** Channels are rounded to 16 levels, which keeps a logo's palette to a handful of colours. */
const quantize = (channel: number) => Math.min(15, Math.round(channel / 17)) * 17;
const PALETTE_SIZE = 24;

/** How far a pixel may be from the plate's colour, in any channel, and still be the plate. */
const PLATE_TOLERANCE = 24;
/** The share of the border that must be the plate's colour. */
const PLATE_BORDER_SHARE = 0.9;

type Rgb = [number, number, number];
const rgbAt = (data: Uint8ClampedArray, index: number): Rgb => [
  data[index] ?? 0,
  data[index + 1] ?? 0,
  data[index + 2] ?? 0,
];
const hexOf = (rgb: Rgb) =>
  `#${rgb.map((channel) => toHex(quantize(channel))).join('')}`.toUpperCase();
const near = (a: Rgb, b: Rgb) =>
  a.every((channel, index) => Math.abs(channel - (b[index] ?? 0)) <= PLATE_TOLERANCE);

/**
 * The colour of an opaque box the mark sits on, such as the white of a JPEG logo or of a PNG
 * exported without transparency: every border pixel opaque, and nearly all of one colour.
 */
function findPlate(data: Uint8ClampedArray, size: number): Rgb | undefined {
  const border: Rgb[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (x !== 0 && y !== 0 && x !== size - 1 && y !== size - 1) continue;
      const index = (y * size + x) * 4;
      if ((data[index + 3] ?? 0) < 250) return undefined;
      border.push(rgbAt(data, index));
    }
  }
  const counts = new Map<string, Rgb[]>();
  for (const rgb of border) {
    const key = hexOf(rgb);
    counts.set(key, [...(counts.get(key) ?? []), rgb]);
  }
  const [, common = []] =
    [...counts].sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))[0] ?? [];
  const mean = [0, 1, 2].map(
    (channel) =>
      common.reduce((sum, rgb) => sum + (rgb[channel] ?? 0), 0) / Math.max(1, common.length),
  ) as Rgb;
  const matching = border.filter((rgb) => near(rgb, mean)).length;
  return matching >= border.length * PLATE_BORDER_SHARE ? mean : undefined;
}

/**
 * What a logo's pixels show: its plate, if it sits on an opaque box of one colour, and its ink,
 * which is every visible pixel that is not the plate. Counting a white box as ink drew it as a slab
 * on a dark brand, and rejected a plainly visible mark as faint on a white one.
 */
export function analysePixels(
  data: Uint8ClampedArray,
  size: number,
): Pick<LogoProbe, 'coverage' | 'palette' | 'plate'> {
  const plate = findPlate(data, size);
  const weights = new Map<string, number>();
  let ink = 0;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = (data[index + 3] ?? 0) / 255;
    if (alpha === 0) continue;
    const rgb = rgbAt(data, index);
    if (plate && near(rgb, plate)) continue;
    const color = hexOf(rgb);
    weights.set(color, (weights.get(color) ?? 0) + alpha);
    ink += alpha;
  }
  const coverage = ink / (size * size);
  const plateColor = plate ? { plate: hexOf(plate) } : {};
  if (ink === 0) return { coverage, ...plateColor };
  const palette = [...weights]
    .sort(([a, wa], [b, wb]) => wb - wa || a.localeCompare(b))
    .slice(0, PALETTE_SIZE)
    .map(([color, weight]) => ({ color, share: weight / ink }));
  return { coverage, palette, ...plateColor };
}

/** Reads the visible pixels, which a host that sends no CORS header does not allow. */
function readPixels(image: HTMLImageElement): Pick<LogoProbe, 'coverage' | 'palette' | 'plate'> {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return {};
  try {
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return analysePixels(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data, SAMPLE_SIZE);
  } catch {
    return {};
  }
}

/** Whether the file animates, from its bytes. Undefined when the host will not let them be read. */
async function readAnimated(url: string): Promise<boolean | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return isAnimated(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return undefined;
  }
}

/** Loads an image to learn its size and, where it is allowed, what it looks like and if it moves. */
export async function probeImage(url: string): Promise<LogoProbe> {
  const readable = await loadImage(url, true);
  const image = readable ?? (await loadImage(url, false));
  if (!image) return { loaded: false };
  const animated = readable ? await readAnimated(url) : undefined;
  return {
    loaded: true,
    width: image.naturalWidth,
    height: image.naturalHeight,
    ...(animated === undefined ? {} : { animated }),
    ...(readable ? readPixels(readable) : {}),
  };
}

export async function fileIsReachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}
