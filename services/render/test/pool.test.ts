import { describe, expect, it } from 'vitest';
import { BLOCK_MS, CostLimitExceeded, estimateCost, WORKER_SIZE } from '../src/cost.ts';
import { ComputerPool } from '../src/naive/pool.ts';

interface Box {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

/** Naive's computers, answering a create after a round trip, on a clock the test moves. */
function fakeNaive(clock: { now: number }) {
  const boxes: Box[] = [];
  return {
    boxes,
    client: {
      computers: {
        create: async ({ name }: { name: string }) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          const box = {
            id: `cmp_${boxes.length + 1}`,
            name,
            status: 'running',
            created_at: new Date(clock.now).toISOString(),
          };
          boxes.push(box);
          return box;
        },
        delete: async (id: string) => {
          const box = boxes.find((each) => each.id === id);
          if (box) box.status = 'destroyed';
          return {};
        },
        list: async () => ({ data: boxes, has_more: false, next_cursor: null }),
        get: async (id: string) => boxes.find((each) => each.id === id),
      },
    },
  };
}

const quiet = () => undefined;

describe('ComputerPool', () => {
  // Two chunks from the snapshot, with the limit just above the estimate, so the run may start.
  const estimate = estimateCost({
    durationInFrames: 300,
    width: 1920,
    height: 1080,
    chunks: 2,
    framesPerChunk: 150,
    base: 'snapshot',
  });
  const limitUsd = Number((estimate.maxUsd + 0.003).toFixed(3));

  async function retriesAfterBothChunksFail(concurrent: boolean) {
    const clock = {
      now: Math.floor(Date.parse('2026-11-08T01:00:00Z') / BLOCK_MS) * BLOCK_MS + 1000,
    };
    const naive = fakeNaive(clock);
    const pool = new ComputerPool(naive.client as never, {
      runId: 'race',
      limitUsd,
      log: quiet,
      onStop: quiet,
      now: () => clock.now,
    });
    const first = await Promise.all([
      pool.create('chunk1-try1', WORKER_SIZE, null),
      pool.create('chunk2-try1', WORKER_SIZE, null),
    ]);
    clock.now += 60_000;
    for (const record of first) await pool.destroy(record.id);
    const retry = (role: string) =>
      pool.create(role, WORKER_SIZE, null).then(
        () => 'created',
        (error: unknown) => (error instanceof CostLimitExceeded ? 'refused' : String(error)),
      );
    const outcomes = concurrent
      ? await Promise.all([retry('chunk1-try2'), retry('chunk2-try2')])
      : [await retry('chunk1-try2'), await retry('chunk2-try2')];
    const charged = pool.chargedUsd();
    await pool.close();
    return { outcomes, charged, created: naive.boxes.length };
  }

  it('refuses a create that would pass the limit, one at a time', async () => {
    const { outcomes, charged } = await retriesAfterBothChunksFail(false);
    expect(outcomes).toEqual(['created', 'refused']);
    expect(charged).toBeLessThanOrEqual(limitUsd);
  });

  it('counts creates still in flight, so creates that start together cannot pass the limit', async () => {
    const { outcomes, charged, created } = await retriesAfterBothChunksFail(true);
    expect(outcomes.filter((outcome) => outcome === 'created')).toHaveLength(1);
    expect(created).toBe(3);
    expect(charged).toBeLessThanOrEqual(limitUsd);
  });
});
