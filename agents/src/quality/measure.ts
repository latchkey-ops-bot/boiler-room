/**
 * Pure pixel measures. The thresholds come from the Quality Check skill: a frame is static when
 * its mean absolute difference (MAD) from the frame before is below 0.02 levels, and true black
 * when no channel of any pixel is above 12. Blank and flash frames are measured on every frame,
 * not only the frames the agent is shown.
 */

export const STATIC_MAD = 0.02;
export const BLACK_MAX = 12;

/**
 * A frame shows nothing but ground when it has at most this many edge pixels at 320 x 180: pixels
 * whose colour differs by more than `EDGE_LEVELS` in some channel from the pixel two to the right
 * or two below. A gradient, a vignette or grain has none; type, a logo or a screenshot has
 * hundreds. Measured on every render so far: empty frames 0 to 30, frames with content 150 and up.
 */
export const BLANK_EDGES = 30;
export const EDGE_LEVELS = 24;

/**
 * A flash: the picture jumps away (a change from the frame before of at least `SPIKE_MIN` levels,
 * and `SPIKE_FACTOR` times the scene's usual change) and jumps back within `FLASH_WINDOW` frames to
 * within `RETURN_FRACTION` of that jump of the frame before it left. A cut or a transition jumps
 * once and does not come back.
 */
export const FLASH_WINDOW = 12;
export const SPIKE_MIN = 6;
export const SPIKE_FACTOR = 4;
export const RETURN_FRACTION = 0.3;
/** Frames either side of a jump whose median change is the scene's usual change. */
const LOCAL_SPAN = 15;
/** Every this many pixels across and down, for comparing a frame with earlier ones. */
const ECHO_STEP = 4;

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
  /** Edge pixels (see `BLANK_EDGES`). Absent when the frame was measured without its width. */
  edges?: number;
  /**
   * Mean absolute difference, on every fourth pixel across and down, from each of the frames 2 to
   * `FLASH_WINDOW + 1` before this one, nearest first. Absent when not measured.
   */
  echo?: number[];
}

/** Every `ECHO_STEP`th pixel across and down, as packed RGB. */
function sample(data: Buffer, width: number, height: number): Uint8Array {
  const out = new Uint8Array(Math.ceil(width / ECHO_STEP) * Math.ceil(height / ECHO_STEP) * 3);
  let at = 0;
  for (let y = 0; y < height; y += ECHO_STEP) {
    for (let x = 0; x < width; x += ECHO_STEP) {
      const offset = (y * width + x) * 3;
      out[at] = data[offset] as number;
      out[at + 1] = data[offset + 1] as number;
      out[at + 2] = data[offset + 2] as number;
      at += 3;
    }
  }
  return out;
}

function difference(a: Uint8Array, b: Uint8Array): number {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff += Math.abs((a[i] as number) - (b[i] as number));
  return diff / a.length;
}

/**
 * Measures packed RGB frames of one size as they stream in. It keeps the previous frame, and a
 * small sample of the `FLASH_WINDOW + 1` frames before it to see whether the picture came back.
 */
export class FrameScanner {
  private readonly size: number;
  private readonly width: number;
  private readonly height: number;
  private pending: Buffer = Buffer.alloc(0);
  private previous: Buffer | undefined;
  /** Samples of the latest frames, nearest first. */
  private readonly recent: Uint8Array[] = [];
  private readonly stats: FrameStats[] = [];

  constructor(width: number, height: number) {
    this.size = width * height * 3;
    this.width = width;
    this.height = height;
  }

  push(chunk: Buffer): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    while (this.pending.length >= this.size) {
      const frame = Buffer.from(this.pending.subarray(0, this.size));
      this.pending = this.pending.subarray(this.size);
      const stat = measureFrame(frame, this.previous, this.stats.length, this.width);
      const sampled = sample(frame, this.width, this.height);
      // recent[0] is the frame before this one, so the echo starts two frames back.
      stat.echo = this.recent.slice(1).map((earlier) => difference(sampled, earlier));
      this.stats.push(stat);
      this.recent.unshift(sampled);
      this.recent.length = Math.min(this.recent.length, FLASH_WINDOW + 1);
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

/** Edge pixels of a packed RGB frame: see `BLANK_EDGES`. */
export function edgePixels(data: Buffer, width: number): number {
  const height = Math.floor(data.length / 3 / width);
  const right = 2 * 3;
  const down = 2 * width * 3;
  let edges = 0;
  for (let y = 0; y < height - 2; y += 1) {
    for (let x = 0; x < width - 2; x += 1) {
      const i = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = data[i + channel] as number;
        if (
          Math.abs(value - (data[i + channel + right] as number)) > EDGE_LEVELS ||
          Math.abs(value - (data[i + channel + down] as number)) > EDGE_LEVELS
        ) {
          edges += 1;
          break;
        }
      }
    }
  }
  return edges;
}

export function measureFrame(
  data: Buffer,
  previous: Buffer | undefined,
  index: number,
  width?: number,
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
    ...(width ? { edges: edgePixels(data, width) } : {}),
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

/** Runs of frames that show only ground: no edges, and not black (black is its own check). */
export const blankRuns = (stats: readonly FrameStats[]) =>
  runsWhere(
    stats,
    (stat) => stat.edges !== undefined && stat.edges <= BLANK_EDGES && stat.max > BLACK_MAX,
  );

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** A run of frames that left the picture and came back: see `FLASH_WINDOW`. */
export interface Flash extends Run {
  /** The change into the first frame of the run, and out of its last, in levels. */
  jumpIn: number;
  jumpOut: number;
  /** How far the frame after the run is from the frame before it, in levels. */
  back: number;
}

export function flashRuns(stats: readonly FrameStats[]): Flash[] {
  const flashes: Flash[] = [];
  const change = (index: number) => stats[index]?.mad ?? 0;
  const usual = (index: number) =>
    median(
      stats
        .slice(Math.max(1, index - LOCAL_SPAN), index + LOCAL_SPAN + 1)
        .map((stat) => stat.mad ?? 0),
    );
  const jumps = (index: number) =>
    change(index) >= Math.max(SPIKE_MIN, SPIKE_FACTOR * usual(index));
  for (let from = 1; from < stats.length; from += 1) {
    if (!jumps(from)) continue;
    for (
      let after = from + 1;
      after <= Math.min(stats.length - 1, from + FLASH_WINDOW);
      after += 1
    ) {
      if (!jumps(after)) continue;
      // The frame after the run against the frame before it: `after - (from - 1)` frames back.
      const back = stats[after]?.echo?.[after - from - 1];
      if (back === undefined) break;
      if (back <= RETURN_FRACTION * Math.min(change(from), change(after))) {
        flashes.push({
          from,
          to: after - 1,
          length: after - from,
          jumpIn: change(from),
          jumpOut: change(after),
          back,
        });
        from = after;
        break;
      }
    }
  }
  return flashes;
}

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
