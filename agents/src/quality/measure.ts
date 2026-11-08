/**
 * Pure pixel measures. The thresholds come from the Quality Check skill: a frame is static when
 * its mean absolute difference (MAD) from the frame before is below 0.02 levels, and true black
 * when no channel of any pixel is above 12.
 */

export const STATIC_MAD = 0.02;
export const BLACK_MAX = 12;

export interface FrameStats {
  frame: number;
  /** The brightest channel value of any pixel, 0 to 255. */
  max: number;
  /** The mean of every channel of every pixel. */
  mean: number;
  /** The standard deviation of every channel of every pixel. */
  spread: number;
  /** Mean absolute difference from the frame before, in 8-bit levels. Null for frame 0. */
  mad: number | null;
}

/** Measures packed RGB frames of one size as they stream in, keeping only the previous frame. */
export class FrameScanner {
  private readonly size: number;
  private pending: Buffer = Buffer.alloc(0);
  private previous: Buffer | undefined;
  private readonly stats: FrameStats[] = [];

  constructor(width: number, height: number) {
    this.size = width * height * 3;
  }

  push(chunk: Buffer): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    while (this.pending.length >= this.size) {
      const frame = Buffer.from(this.pending.subarray(0, this.size));
      this.pending = this.pending.subarray(this.size);
      this.stats.push(measureFrame(frame, this.previous, this.stats.length));
      this.previous = frame;
    }
  }

  finish(): FrameStats[] {
    if (this.pending.length > 0) {
      throw new Error(`The decoded film ended inside a frame (${this.pending.length} bytes left).`);
    }
    return this.stats;
  }
}

export function measureFrame(
  data: Buffer,
  previous: Buffer | undefined,
  index: number,
): FrameStats {
  let max = 0;
  let sum = 0;
  let squares = 0;
  let diff = 0;
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i] as number;
    if (value > max) max = value;
    sum += value;
    squares += value * value;
    if (previous) diff += Math.abs(value - (previous[i] as number));
  }
  const mean = sum / data.length;
  return {
    frame: index,
    max,
    mean,
    spread: Math.sqrt(Math.max(0, squares / data.length - mean * mean)),
    mad: previous ? diff / data.length : null,
  };
}

export interface Run {
  /** First frame of the run. */
  from: number;
  /** Last frame of the run, inclusive. */
  to: number;
  length: number;
}

/** Consecutive frames for which `test` holds. */
export function runsWhere(
  stats: readonly FrameStats[],
  test: (stat: FrameStats) => boolean,
): Run[] {
  const runs: Run[] = [];
  let start: number | undefined;
  for (const stat of stats) {
    if (test(stat)) {
      start ??= stat.frame;
    } else if (start !== undefined) {
      runs.push({ from: start, to: stat.frame - 1, length: stat.frame - start });
      start = undefined;
    }
  }
  const last = stats.at(-1);
  if (start !== undefined && last) {
    runs.push({ from: start, to: last.frame, length: last.frame - start + 1 });
  }
  return runs;
}

/**
 * Static runs. A frame is static when it barely differs from the one before, so a run of N static
 * frames is N + 1 frames that look the same: the run starts on the frame before the first static
 * one, as a viewer sees it.
 */
export function staticRuns(stats: readonly FrameStats[]): Run[] {
  return runsWhere(stats, (stat) => stat.mad !== null && stat.mad < STATIC_MAD).map((run) => ({
    from: run.from - 1,
    to: run.to,
    length: run.length + 1,
  }));
}

export const blackRuns = (stats: readonly FrameStats[]) =>
  runsWhere(stats, (stat) => stat.max <= BLACK_MAX);

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export const rgbToHex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** The largest per-channel difference between two colours. */
export const channelDistance = (a: Rgb, b: Rgb) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** The mean colour of a square patch of a packed RGB image. */
export function patchColour(
  image: { width: number; data: Buffer },
  x: number,
  y: number,
  size: number,
): Rgb {
  const sums = [0, 0, 0];
  for (let row = y; row < y + size; row += 1) {
    for (let column = x; column < x + size; column += 1) {
      const offset = (row * image.width + column) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        sums[channel] = (sums[channel] as number) + (image.data[offset + channel] as number);
      }
    }
  }
  const count = size * size;
  return [(sums[0] as number) / count, (sums[1] as number) / count, (sums[2] as number) / count];
}

/**
 * 20 x 20 patches along the edge of a frame, inset by 2% of its width, where the ground shows in
 * every layout: the corners and the middle of each side.
 */
export function groundPatches(width: number, height: number, size = 20): [number, number][] {
  const inset = Math.round(width * 0.02);
  const right = width - inset - size;
  const bottom = height - inset - size;
  const middleX = Math.round(width / 2 - size / 2);
  const middleY = Math.round(height / 2 - size / 2);
  return [
    [inset, inset],
    [middleX, inset],
    [right, inset],
    [inset, middleY],
    [right, middleY],
    [inset, bottom],
    [middleX, bottom],
    [right, bottom],
  ];
}

/** The patch nearest a colour, and how far it is, in levels per channel. */
export function nearestPatch(
  image: { width: number; height: number; data: Buffer },
  target: Rgb,
): { colour: Rgb; distance: number; at: [number, number] } {
  let best: { colour: Rgb; distance: number; at: [number, number] } | undefined;
  for (const [x, y] of groundPatches(image.width, image.height)) {
    const colour = patchColour(image, x, y, 20);
    const distance = channelDistance(colour, target);
    if (!best || distance < best.distance) best = { colour, distance, at: [x, y] };
  }
  if (!best) throw new Error('No ground patch fits this image.');
  return best;
}

/** Mean absolute difference between two images of one size, in 8-bit levels. */
export function meanAbsoluteDifference(a: Buffer, b: Buffer): number {
  if (a.length !== b.length) throw new Error(`Images differ in size: ${a.length} and ${b.length}.`);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff += Math.abs((a[i] as number) - (b[i] as number));
  return diff / a.length;
}
