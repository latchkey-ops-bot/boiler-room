import { describe, expect, it } from 'vitest';
import {
  BLOCK_MS,
  blockEnd,
  chargedUsd,
  DEFAULT_TIME_MODEL,
  type EstimateInput,
  estimateCost,
  ratePerSecond,
  WORKER_SIZE,
} from '../src/cost.ts';

const at = (iso: string) => Date.parse(iso);

describe('the meter', () => {
  it('prices a computer by its vCPU and memory, as published', () => {
    // 8 × $0.000014 + 16 × $0.0000045 a second.
    expect(ratePerSecond(WORKER_SIZE)).toBeCloseTo(0.000184, 12);
    expect(ratePerSecond({ vcpu: 1, memoryMb: 1024 }) * 3600).toBeCloseTo(0.0666, 10);
  });

  it('ends a block on the next ten minutes of the clock, and starts one on a boundary', () => {
    expect(blockEnd(at('2026-11-07T23:01:09.279Z'))).toBe(at('2026-11-07T23:10:00.000Z'));
    expect(blockEnd(at('2026-11-07T23:09:59.999Z'))).toBe(at('2026-11-07T23:10:00.000Z'));
    expect(blockEnd(at('2026-11-07T23:10:00.000Z'))).toBe(at('2026-11-07T23:20:00.000Z'));
  });

  it('matches what the ledger booked for a computer created mid-block', () => {
    // A 2 vCPU, 2 GiB probe created at 23:01:09.279 was charged 19637 micro-USD at create.
    const size = { vcpu: 2, memoryMb: 2048, diskGb: 5 };
    const created = at('2026-11-07T23:01:09.279Z');
    expect(Math.round(chargedUsd(size, created, created) * 1e6)).toBe(19637);
  });

  it('charges each later block in full, and nothing more after the computer is destroyed', () => {
    const size = WORKER_SIZE;
    const created = at('2026-11-07T23:08:00.000Z');
    const firstBlock = ratePerSecond(size) * 120;
    expect(chargedUsd(size, created, at('2026-11-07T23:09:30.000Z'))).toBeCloseTo(firstBlock, 12);
    expect(chargedUsd(size, created, at('2026-11-07T23:10:05.000Z'))).toBeCloseTo(
      firstBlock + ratePerSecond(size) * (BLOCK_MS / 1000),
      12,
    );
  });
});

describe('estimateCost', () => {
  const nova: EstimateInput = {
    durationInFrames: 600,
    width: 1920,
    height: 1080,
    chunks: 4,
    framesPerChunk: 150,
    base: 'snapshot',
  };

  it('works out one worker from its setup, transfers and frames', () => {
    const estimate = estimateCost(nova);
    const { forkReadySeconds, transferSeconds, secondsPerFrame } = DEFAULT_TIME_MODEL;
    expect(estimate.secondsPerFrame).toBeCloseTo(secondsPerFrame, 12);
    expect(estimate.workerSeconds).toBeCloseTo(
      forkReadySeconds + transferSeconds + 150 * secondsPerFrame,
      9,
    );
  });

  it('expects each computer to pay half a block more than it runs', () => {
    const estimate = estimateCost(nova);
    const rate = ratePerSecond(WORKER_SIZE);
    expect(estimate.expectedUsd).toBeCloseTo(4 * rate * (estimate.workerSeconds + 300), 12);
  });

  it('bounds the cost by the margin, a whole block each and one spare computer', () => {
    const estimate = estimateCost(nova);
    const rate = ratePerSecond(WORKER_SIZE);
    expect(estimate.computers).toBe(5);
    expect(estimate.maxUsd).toBeCloseTo(
      5 * rate * (estimate.workerSeconds * DEFAULT_TIME_MODEL.margin + 600),
      12,
    );
    expect(estimate.maxUsd).toBeGreaterThan(estimate.expectedUsd);
  });

  it('keeps as many spares as retries asks for', () => {
    expect(estimateCost({ ...nova, retries: 0 }).computers).toBe(4);
    expect(estimateCost({ ...nova, retries: 3 }).computers).toBe(7);
    expect(() => estimateCost({ ...nova, retries: -1 })).toThrow(RangeError);
  });

  it('costs more when every worker sets itself up from clean', () => {
    const cold = estimateCost({ ...nova, base: 'cold' });
    const snapshot = estimateCost(nova);
    expect(cold.workerSeconds - snapshot.workerSeconds).toBeCloseTo(
      DEFAULT_TIME_MODEL.coldSetupSeconds - DEFAULT_TIME_MODEL.forkReadySeconds,
      9,
    );
    expect(cold.expectedUsd).toBeGreaterThan(snapshot.expectedUsd);
  });

  it('scales a frame with its pixels: a tall film costs what a wide one does, a square one less', () => {
    const tall = estimateCost({ ...nova, width: 1080, height: 1920 });
    const square = estimateCost({ ...nova, width: 1080, height: 1080 });
    expect(tall.expectedUsd).toBeCloseTo(estimateCost(nova).expectedUsd, 12);
    expect(square.secondsPerFrame).toBeCloseTo(DEFAULT_TIME_MODEL.secondsPerFrame * 0.5625, 12);
  });

  it('slows a frame on fewer than 8 vCPU, and does not speed it up on more', () => {
    const small = estimateCost({ ...nova, worker: { vcpu: 4, memoryMb: 8192, diskGb: 10 } });
    const big = estimateCost({ ...nova, worker: { vcpu: 16, memoryMb: 32_768, diskGb: 10 } });
    expect(small.secondsPerFrame).toBeCloseTo(2 * DEFAULT_TIME_MODEL.secondsPerFrame, 12);
    expect(big.secondsPerFrame).toBeCloseTo(DEFAULT_TIME_MODEL.secondsPerFrame, 12);
    expect(big.expectedUsd).toBeGreaterThan(estimateCost(nova).expectedUsd);
  });

  it('makes more workers cheaper per frame only until the setup and the block dominate', () => {
    const one = estimateCost({ ...nova, chunks: 1, framesPerChunk: 600 });
    const sixteen = estimateCost({ ...nova, chunks: 16, framesPerChunk: 38 });
    expect(sixteen.workerSeconds).toBeLessThan(one.workerSeconds);
    expect(sixteen.expectedUsd).toBeGreaterThan(one.expectedUsd);
  });
});
