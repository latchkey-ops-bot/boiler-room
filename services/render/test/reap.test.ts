import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKER_SIZE } from '../src/cost.ts';
import { ComputerPool } from '../src/naive/pool.ts';
import { REAP_AFTER_MS, RUN_DEADLINE_MS, reapOrphans } from '../src/naive/reap.ts';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function fakeNaive() {
  const computers = [
    {
      id: 'cmp_orphan',
      name: 'br-render-20261108t080000-aaaaaa-chunk1-try1',
      status: 'running',
      created_at: ago(240),
    },
    {
      id: 'cmp_paused_orphan',
      name: 'br-render-20261108t080000-aaaaaa-chunk2-try1',
      status: 'paused',
      created_at: ago(240),
    },
    {
      id: 'cmp_live_run',
      name: 'br-render-20261108t115000-bbbbbb-chunk1-try1',
      status: 'running',
      created_at: ago(10),
    },
    {
      id: 'cmp_gone',
      name: 'br-render-20261108t080000-aaaaaa-chunk3-try1',
      status: 'destroyed',
      created_at: ago(240),
    },
    { id: 'cmp_agent', name: 'agent agt_123', status: 'paused', created_at: ago(10_000) },
  ];
  const files = [
    {
      id: 'fil_old_payload',
      name: 'boiler-room-20261108t080000-aaaaaa-payload.tgz',
      created_at: ago(240),
    },
    {
      id: 'fil_old_chunk',
      name: 'boiler-room-br-render-20261108t080000-aaaaaa-chunk-1.ts',
      created_at: ago(240),
    },
    {
      id: 'fil_live_payload',
      name: 'boiler-room-20261108t115000-bbbbbb-payload.tgz',
      created_at: ago(10),
    },
    { id: 'fil_base', name: 'render-base-0123456789abcdef.json', created_at: ago(10_000) },
    { id: 'fil_other', name: 'boiler-room-notes.txt', created_at: ago(10_000) },
  ];
  const destroyed: string[] = [];
  const deleted: string[] = [];
  const page = <T>(data: T[]) => ({ data, has_more: false, next_cursor: null });
  return {
    destroyed,
    deleted,
    client: {
      computers: {
        list: async () => page(computers),
        delete: async (id: string) => {
          destroyed.push(id);
          return {};
        },
      },
      files: {
        list: async () => page(files),
        deleteMany: async ({ ids }: { ids: string[] }) => {
          deleted.push(...ids);
          return { file_ids: ids };
        },
      },
    },
  };
}

const quiet = () => undefined;

describe('reapOrphans', () => {
  it('destroys run computers older than any run can be, and leaves everything else', async () => {
    const naive = fakeNaive();
    const reaped = await reapOrphans(naive.client as never, { now: NOW, log: quiet });
    expect(naive.destroyed.sort()).toEqual(['cmp_orphan', 'cmp_paused_orphan']);
    expect(reaped.computers.sort()).toEqual(['cmp_orphan', 'cmp_paused_orphan']);
  });

  it("deletes those runs' payload and chunk files, and never the base record", async () => {
    const naive = fakeNaive();
    await reapOrphans(naive.client as never, { now: NOW, log: quiet });
    expect(naive.deleted.sort()).toEqual(['fil_old_chunk', 'fil_old_payload']);
  });

  it('destroys one named run at any age, for a run left by a third Ctrl-C', async () => {
    const naive = fakeNaive();
    await reapOrphans(naive.client as never, {
      now: NOW,
      runId: '20261108t115000-bbbbbb',
      log: quiet,
    });
    expect(naive.destroyed).toEqual(['cmp_live_run']);
    expect(naive.deleted).toEqual(['fil_live_payload']);
  });

  it('waits longer than a run may hold computers', () => {
    expect(REAP_AFTER_MS).toBeGreaterThan(RUN_DEADLINE_MS);
  });
});

describe("a run's deadline", () => {
  afterEach(() => vi.useRealTimers());

  it('stops a run that has held computers past it, and refuses new ones', async () => {
    vi.useFakeTimers();
    let now = NOW;
    const onStop = vi.fn();
    const client = {
      computers: {
        create: async ({ name }: { name: string }) => ({
          id: 'cmp_1',
          name,
          created_at: new Date(now).toISOString(),
        }),
      },
    };
    const pool = new ComputerPool(client as never, {
      runId: 'deadline',
      limitUsd: 100,
      log: quiet,
      onStop,
      now: () => now,
    });
    await pool.create('chunk1-try1', WORKER_SIZE, null);
    now += RUN_DEADLINE_MS - 60_000;
    vi.advanceTimersByTime(10_000);
    expect(onStop).not.toHaveBeenCalled();
    now += 120_000;
    vi.advanceTimersByTime(10_000);
    expect(onStop).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('deadline') }),
    );
    await expect(pool.create('chunk2-try1', WORKER_SIZE, null)).rejects.toThrow(/deadline/);
  });
});
