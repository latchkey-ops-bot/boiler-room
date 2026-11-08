/**
 * How a film's frames are split between computers, and which frames sit on either side of each
 * join. Pure, so the arithmetic that decides where seams fall is tested without a render.
 */

/** Inclusive at both ends, as Remotion's `frameRange` is. */
export type FrameRange = [first: number, last: number];

export interface Chunk {
  index: number;
  frameRange: FrameRange;
  frames: number;
}

export interface ChunkPlan {
  /** Every chunk renders this many frames except the last, which may render fewer. */
  framesPerChunk: number;
  chunks: Chunk[];
}

const assertCount = (value: number, name: string) => {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a whole number of at least 1, not ${value}.`);
  }
};

/**
 * Splits `durationInFrames` into at most `workers` chunks. Remotion's distributed rendering needs
 * every chunk to be the same length except the last, and `combineChunks` takes that one length,
 * so the length is rounded up rather than spread evenly. Rounding up can leave nothing for the
 * last workers (10 frames for 6 workers is 2, 2, 2, 2, 2), so fewer chunks than workers come back
 * in that case, and never an empty one.
 */
export function splitFrames(durationInFrames: number, workers: number): ChunkPlan {
  assertCount(durationInFrames, 'durationInFrames');
  assertCount(workers, 'workers');
  const framesPerChunk = Math.ceil(durationInFrames / Math.min(workers, durationInFrames));
  const count = Math.ceil(durationInFrames / framesPerChunk);
  const chunks = Array.from({ length: count }, (_, index): Chunk => {
    const first = index * framesPerChunk;
    const last = Math.min(durationInFrames, first + framesPerChunk) - 1;
    return { index, frameRange: [first, last], frames: last - first + 1 };
  });
  return { framesPerChunk, chunks };
}

/** A join between two chunks: the last frame one computer drew, and the first the next one drew. */
export interface Seam {
  index: number;
  before: number;
  after: number;
}

export function seamsOf({ chunks }: Pick<ChunkPlan, 'chunks'>): Seam[] {
  return chunks.slice(1).map((chunk, index) => ({
    index,
    before: (chunks[index] as Chunk).frameRange[1],
    after: chunk.frameRange[0],
  }));
}

/**
 * A pair of neighbouring frames well inside one chunk, drawn by one computer in one encode. Two
 * frames compared there show how much a frame differs from the reference when no seam is involved,
 * which is the bar the frames at a seam are held to. `undefined` for a chunk under two frames.
 */
export function interiorPair(chunk: Chunk): [number, number] | undefined {
  if (chunk.frames < 2) return undefined;
  const first = chunk.frameRange[0] + Math.floor((chunk.frames - 2) / 2);
  return [first, first + 1];
}
