import { describe, expect, it, vi } from 'vitest';
import type { Chunk } from '../src/chunks.ts';
import { CostLimitExceeded } from '../src/cost.ts';
import type { ChunkAttempt } from '../src/manifest.ts';
import { Aborted } from '../src/naive/exec.ts';
import {
  chunkFailed,
  chunksFailure,
  MotionRefused,
  renderChunkOnNaive,
  type WorkerContext,
} from '../src/naive/workers.ts';

const chunk: Chunk = { index: 0, frameRange: [0, 337], frames: 338 };

const REFUSAL =
  'TYPE_CARD_LAYOUT at scene "value", text "value-line": "The product development system" does not fit on one line of 1248 px at a cap height of 78 px. Shorten the copy: a type card never sets type below its cap height.';
const OTHER =
  'TYPE_CARD_LAYOUT at scene "name", text "name-descriptor": "Your product\'s context layer" does not fit on one line of 1248 px at a cap height of 78 px. Shorten the copy: a type card never sets type below its cap height.';
const DROPPED =
  'POST /v1/computers/cmp_2/exec/stream ended without an exit frame; the command may have run';

const attemptRecord = (attempt: number, error: string): ChunkAttempt => ({
  attempt,
  computerId: `cmp_${attempt}`,
  fromSnapshot: true,
  startedAt: '2026-11-08T08:21:00.000Z',
  provisionSeconds: null,
  readySeconds: null,
  fetchSeconds: null,
  renderSeconds: null,
  renderWallSeconds: null,
  returnSeconds: null,
  totalSeconds: 1,
  ok: false,
  error,
});

const context = () => ({ log: vi.fn() }) as unknown as WorkerContext;

describe('renderChunkOnNaive', () => {
  it('does not try a chunk again on a new computer when motion refused its copy', async () => {
    const refused = new MotionRefused([REFUSAL], 'chunk 1 on cmp_1');
    const attempt = vi.fn(async (_context: WorkerContext, _chunk: Chunk, tries: number) => ({
      attempt: attemptRecord(tries, refused.message),
      refused,
    }));
    await expect(renderChunkOnNaive(context(), chunk, attempt)).rejects.toBe(refused);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('names what every try met, not only the last', async () => {
    // linear.app, 8 November: try 1 met a refusal the old matcher missed, try 2 a dropped stream.
    const errors = [`A command on cmp_1 exited with -1:\n${REFUSAL}`, DROPPED];
    const attempt = vi.fn(async (_context: WorkerContext, _chunk: Chunk, tries: number) => ({
      attempt: attemptRecord(tries, errors[tries - 1] ?? ''),
    }));
    const error = await renderChunkOnNaive(context(), chunk, attempt).catch((cause) => cause);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(error.message).toContain(REFUSAL);
    expect(error.message).toContain(DROPPED);
  });
});

describe('chunkFailed', () => {
  it('lists each try', () => {
    const error = chunkFailed(chunk, [attemptRecord(1, 'first'), attemptRecord(2, 'second')]);
    expect(error.message).toBe('Chunk 1 failed on 2 computer(s): try 1: first\ntry 2: second');
  });
});

describe('chunksFailure', () => {
  const ok = { status: 'fulfilled', value: {} } as const;
  const rejected = (reason: unknown) => ({ status: 'rejected', reason }) as const;

  it('is nothing when every chunk rendered', () => {
    expect(chunksFailure([ok, ok], undefined)).toBeUndefined();
  });

  it('names every chunk refusal in one failure', () => {
    // posthog.com, 8 November: chunk 4 and chunk 1 each refused a different scene.
    const failure = chunksFailure(
      [
        rejected(new MotionRefused([REFUSAL], 'chunk 1')),
        ok,
        ok,
        rejected(new MotionRefused([OTHER], 'chunk 4')),
      ],
      undefined,
    );
    expect(failure).toBeInstanceOf(MotionRefused);
    expect((failure as MotionRefused).refusals).toEqual([REFUSAL, OTHER]);
  });

  it('keeps a refusal that another failure stopped the run after', () => {
    const stopper = new Error(`Chunk 2 failed on 2 computer(s): try 1: ${DROPPED}`);
    const failure = chunksFailure(
      [rejected(new MotionRefused([REFUSAL])), rejected(stopper), rejected(new Aborted())],
      stopper,
    );
    expect(failure).toBeInstanceOf(MotionRefused);
    expect((failure as MotionRefused).refusals).toEqual([REFUSAL]);
    expect(failure?.message).toContain('the run also failed on: Chunk 2 failed on 2 computer(s)');
  });

  it('finds a refusal in the text of a chunk that failed on every try', () => {
    const failure = chunksFailure(
      [rejected(chunkFailed(chunk, [attemptRecord(1, `exited with 1:\n${REFUSAL}`)]))],
      undefined,
    );
    expect((failure as MotionRefused).refusals).toEqual([REFUSAL]);
  });

  it('gives the stop itself for a stop and for the cost limit', () => {
    const stop = new Aborted();
    expect(chunksFailure([rejected(new MotionRefused([REFUSAL])), rejected(stop)], stop)).toBe(
      stop,
    );
    const limit = new CostLimitExceeded(2, 2.1, 'The run');
    expect(chunksFailure([rejected(limit)], limit)).toBe(limit);
  });

  it('gives the failure that stopped the run when nothing was refused', () => {
    const stopper = new Error('Chunk 2 failed');
    expect(chunksFailure([rejected(stopper), rejected(new Aborted())], stopper)).toBe(stopper);
    expect(chunksFailure([rejected(stopper)], undefined)).toBe(stopper);
  });
});
