/**
 * What a render costs on Naive, before it starts and as it runs. Pure, so the money arithmetic is
 * tested without a computer.
 *
 * Naive bills a computer you create ahead, in 10-minute blocks of the wall clock (:00, :10, …).
 * At create it charges from that moment to the end of the current block, and it charges each later
 * block in full as the clock enters it. Disk is not metered. The rates are the published ones, and
 * the ledger agrees with them to the micro-dollar: a 2 vCPU, 2 GiB computer created 531 s before a
 * block ended was charged 19637 micro-USD, which is 531 × (2 × 14 + 2 × 4.5) micro-USD.
 */

export const RATES = {
  vcpuPerSecond: 0.000014,
  gibPerSecond: 0.0000045,
} as const;

export const BLOCK_MS = 600_000;

export interface ComputerSize {
  vcpu: number;
  memoryMb: number;
  diskGb: number;
}

/** 8 vCPU per chunk: one Remotion process stops scaling well before 16, so chunks go wide instead. */
export const WORKER_SIZE: ComputerSize = { vcpu: 8, memoryMb: 16_384, diskGb: 10 };

export const ratePerSecond = ({ vcpu, memoryMb }: Pick<ComputerSize, 'vcpu' | 'memoryMb'>) =>
  vcpu * RATES.vcpuPerSecond + (memoryMb / 1024) * RATES.gibPerSecond;

/** The end of the 10-minute block that `ms` falls in. A moment on a boundary starts a new block. */
export const blockEnd = (ms: number) => (Math.floor(ms / BLOCK_MS) + 1) * BLOCK_MS;

/**
 * What a computer created at `createdMs` has been charged by `untilMs`, which is either now or the
 * moment it was destroyed. Every block it was alive in is paid for to its end.
 */
export function chargedUsd(size: ComputerSize, createdMs: number, untilMs: number): number {
  const end = blockEnd(Math.max(createdMs, untilMs));
  return (ratePerSecond(size) * (end - createdMs)) / 1000;
}

/** How long each step takes, in seconds. Measured on Naive and written down in the README. */
export interface TimeModel {
  /** Rendering and encoding one 1920 × 1080 frame on one 8 vCPU computer. */
  secondsPerFrame: number;
  /** Create a fork of the base snapshot and check it is ready. */
  forkReadySeconds: number;
  /** Install Chrome's libraries, the renderer and its browser on a clean computer. */
  coldSetupSeconds: number;
  /** Fetch and unpack the bundle, then send the chunk back. */
  transferSeconds: number;
  /** Margin on every measured time, for a slow machine or a slow network. */
  margin: number;
}

/**
 * Rounded up from what was measured on Naive with the example films (README, "Measured"): about
 * 0.03 s a 1080p frame on 8 vCPU, 3 to 22 s for a fork to be ready, 41 s to set up from clean, and
 * 5 to 7 s to fetch the payload and send a chunk back. Heavier scenes render slower, so the frame
 * time is kept well above what the examples took.
 */
export const DEFAULT_TIME_MODEL: TimeModel = {
  secondsPerFrame: 0.1,
  forkReadySeconds: 25,
  coldSetupSeconds: 60,
  transferSeconds: 15,
  margin: 1.5,
};

/** Whether the workers start from the base snapshot, or each installs the renderer itself. */
export type BaseState = 'snapshot' | 'cold';

export interface EstimateInput {
  durationInFrames: number;
  width: number;
  height: number;
  /** Chunks actually rendered, which `splitFrames` can make fewer than the workers asked for. */
  chunks: number;
  framesPerChunk: number;
  base: BaseState;
  worker?: ComputerSize;
  timeModel?: TimeModel;
  /** Spare computers kept in the estimate for chunks that fail and are rendered again. */
  retries?: number;
}

export interface CostEstimate {
  secondsPerFrame: number;
  /** One worker, from create to destroy. */
  workerSeconds: number;
  /** Workers, counting the spares kept for retries. */
  computers: number;
  /** What the run costs if each computer is created halfway through a billing block. */
  expectedUsd: number;
  /** The most it can cost: the margin on every time, and each computer created just after a block began. */
  maxUsd: number;
}

const FULL_HD_PIXELS = 1920 * 1080;

/**
 * Estimates a run from its frame count and size. A frame's time scales with its pixels, and fewer
 * than 8 vCPU slow it in proportion; more do not speed it up, which is what was measured.
 */
export function estimateCost(input: EstimateInput): CostEstimate {
  const worker = input.worker ?? WORKER_SIZE;
  const model = input.timeModel ?? DEFAULT_TIME_MODEL;
  const retries = input.retries ?? 1;
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError(`retries must be a whole number, not ${retries}.`);
  }
  const secondsPerFrame =
    model.secondsPerFrame *
    ((input.width * input.height) / FULL_HD_PIXELS) *
    Math.max(1, 8 / worker.vcpu);
  const setupSeconds = input.base === 'cold' ? model.coldSetupSeconds : model.forkReadySeconds;
  const workerSeconds =
    setupSeconds + model.transferSeconds + input.framesPerChunk * secondsPerFrame;
  const computers = input.chunks + retries;
  const rate = ratePerSecond(worker);
  // A computer created halfway through a block pays half a block more than it runs, on average,
  // and one created just after a block began pays for nearly a whole block it does not use.
  const expectedUsd = input.chunks * rate * (workerSeconds + BLOCK_MS / 2000);
  const maxUsd = computers * rate * (workerSeconds * model.margin + BLOCK_MS / 1000);
  return { secondsPerFrame, workerSeconds, computers, expectedUsd, maxUsd };
}

/** Thrown before a run starts, or before it would spend past its limit. */
export class CostLimitExceeded extends Error {
  readonly limitUsd: number;
  readonly neededUsd: number;

  constructor(limitUsd: number, neededUsd: number, when: string) {
    super(
      `${when}: this would cost up to $${neededUsd.toFixed(4)}, over the limit of $${limitUsd.toFixed(4)}. ` +
        'Raise maxCostUsd (--max-cost), or render with fewer workers.',
    );
    this.name = 'CostLimitExceeded';
    this.limitUsd = limitUsd;
    this.neededUsd = neededUsd;
  }
}
