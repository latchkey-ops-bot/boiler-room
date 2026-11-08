/**
 * How far apart two decoded frames are. Two H.264 encodes of the same pixels are never byte equal,
 * because a chunk opens on a key frame where the whole film had a predicted one, so frames are
 * compared by how much they differ rather than whether they do. Pure, so it is tested directly.
 */

export interface Difference {
  /** Mean absolute difference over the colour channels, 0 to 255. */
  meanAbs: number;
  /** Largest difference in any channel of any pixel, 0 to 255. */
  maxDelta: number;
  /** Peak signal-to-noise ratio in dB. `Infinity` for identical frames, which JSON writes as null. */
  psnr: number;
  identical: boolean;
}

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row by row. Alpha is ignored: a film has none. */
  data: Uint8Array;
}

export function compareFrames(first: Pixels, second: Pixels): Difference {
  if (first.width !== second.width || first.height !== second.height) {
    throw new RangeError(
      `Frames of ${first.width}×${first.height} and ${second.width}×${second.height} cannot be compared.`,
    );
  }
  let absolute = 0;
  let squared = 0;
  let maxDelta = 0;
  const { data: a } = first;
  const { data: b } = second;
  for (let index = 0; index < a.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs((a[index + channel] ?? 0) - (b[index + channel] ?? 0));
      absolute += delta;
      squared += delta * delta;
      if (delta > maxDelta) maxDelta = delta;
    }
  }
  const samples = (a.length / 4) * 3;
  const mse = squared / samples;
  return {
    meanAbs: absolute / samples,
    maxDelta,
    psnr: mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / mse),
    identical: mse === 0,
  };
}
