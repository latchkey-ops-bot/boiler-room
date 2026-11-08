import { describe, expect, it, vi } from 'vitest';
import { runAction, skipAction } from '../src/gtm/actions.ts';
import { emptyStore } from '../src/gtm/store.ts';

const now = () => '2026-11-08T18:30:00.000Z';

describe('the action ledger', () => {
  it('writes the planned row and saves it before the call, then records the result', async () => {
    const store = emptyStore();
    const order: string[] = [];
    const save = vi.fn(() => {
      order.push(`save:${store.actions[0]?.status}`);
    });
    const outcome = await runAction(
      store,
      {
        key: 'email:quillbox.example:2026-11-08',
        kind: 'email',
        lead_id: 'ld-a',
        detail: 'lead ld-a',
        dryRun: false,
        call: async () => {
          order.push('call');
          return { provider_id: 'msg_1' };
        },
      },
      save,
      now,
    );
    expect(order).toEqual(['save:planned', 'call', 'save:sent']);
    expect(outcome.state).toBe('done');
    expect(store.actions[0]).toMatchObject({ status: 'sent', provider_id: 'msg_1' });
  });

  it('never calls twice for a key that is past planned', async () => {
    const store = emptyStore();
    const call = vi.fn(async () => ({ provider_id: 'spo_1' }));
    const request = {
      key: 'x-post:2026-11-08',
      kind: 'x-post' as const,
      lead_id: 'ld-a',
      detail: '',
      dryRun: false,
      call,
    };
    await runAction(store, request, () => {}, now);
    const again = await runAction(store, request, () => {}, now);
    expect(call).toHaveBeenCalledTimes(1);
    expect(again.state).toBe('done');
  });

  it('records a dry run without calling, and a dry run stays a dry run', async () => {
    const store = emptyStore();
    const call = vi.fn(async () => ({ provider_id: 'msg_1' }));
    const first = await runAction(
      store,
      { key: 'email:a:d', kind: 'email', lead_id: null, detail: '', dryRun: true, call },
      () => {},
      now,
    );
    const second = await runAction(
      store,
      { key: 'email:a:d', kind: 'email', lead_id: null, detail: '', dryRun: false, call },
      () => {},
      now,
    );
    expect(call).not.toHaveBeenCalled();
    expect(first.state).toBe('dry_run');
    expect(second.state).toBe('dry_run');
  });

  it('never retries an email or an X post left planned; after two ticks it becomes unknown', async () => {
    const store = emptyStore();
    const lost = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const request = {
      key: 'email:a:d',
      kind: 'email' as const,
      lead_id: null,
      detail: 'lead',
      dryRun: false,
      call: lost,
    };
    expect((await runAction(store, request, () => {}, now)).state).toBe('pending');
    expect(store.actions[0]?.status).toBe('planned');
    const retry = vi.fn(async () => ({ provider_id: 'msg_2' }));
    const tick = { ...request, call: retry, reconcile: async () => null };
    expect((await runAction(store, tick, () => {}, now)).state).toBe('pending');
    expect((await runAction(store, tick, () => {}, now)).state).toBe('unknown');
    expect((await runAction(store, tick, () => {}, now)).state).toBe('pending');
    expect(retry).not.toHaveBeenCalled();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(store.actions[0]?.status).toBe('unknown');
  });

  it('settles a planned send when the provider shows it went out', async () => {
    const store = emptyStore();
    await runAction(
      store,
      {
        key: 'x-post:d',
        kind: 'x-post',
        lead_id: null,
        detail: '',
        dryRun: false,
        call: async () => Promise.reject(new Error('timeout')),
      },
      () => {},
      now,
    );
    const settled = await runAction(
      store,
      {
        key: 'x-post:d',
        kind: 'x-post',
        lead_id: null,
        detail: '',
        dryRun: false,
        call: async () => ({ provider_id: 'never' }),
        reconcile: async () => 'spo_9',
      },
      () => {},
      now,
    );
    expect(settled.state).toBe('done');
    expect(store.actions[0]).toMatchObject({ status: 'sent', provider_id: 'spo_9' });
  });

  it('retries a film order, which the app dedupes by the same key', async () => {
    const store = emptyStore();
    const call = vi
      .fn<() => Promise<{ provider_id: string }>>()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({ provider_id: 'fo_1' });
    const request = {
      key: 'film:a:d',
      kind: 'film' as const,
      lead_id: null,
      detail: '',
      dryRun: false,
      call,
    };
    expect((await runAction(store, request, () => {}, now)).state).toBe('failed');
    store.actions[0] = {
      ...(store.actions[0] as (typeof store.actions)[number]),
      status: 'planned',
    };
    expect((await runAction(store, request, () => {}, now)).state).toBe('done');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('records a skip with its reason, once', () => {
    const store = emptyStore();
    skipAction(store, {
      key: 'email:a:d',
      kind: 'email',
      lead_id: 'ld-a',
      reason: 'suppressed',
      at: now(),
    });
    skipAction(store, {
      key: 'email:a:d',
      kind: 'email',
      lead_id: 'ld-a',
      reason: 'other',
      at: now(),
    });
    expect(store.actions).toHaveLength(1);
    expect(store.actions[0]).toMatchObject({ status: 'skipped', detail: 'suppressed' });
  });
});
