import { describe, expect, it, vi } from 'vitest';
import { duplicateTitles, HELD_STOP_REASONS, heldSessions } from '../src/company/status.ts';
import type { Naive } from '../src/naive/client.ts';

describe('sessions waiting for a person', () => {
  it('lists every budget_paused and awaiting_approval session of each agent, oldest first', async () => {
    const list = vi.fn(async (query: { agent_id?: string; stop_reason?: string }) => {
      const rows: Record<string, { id: string; created_at: string }[]> = {
        'agt_ceo/budget_paused': [
          { id: 'ses_resumes_on_raise', created_at: '2026-11-08T01:49:54Z' },
        ],
        'agt_ceo/awaiting_approval': [
          { id: 'ses_holds_a_call', created_at: '2026-11-08T01:40:00Z' },
        ],
        'agt_lead/budget_paused': [{ id: 'ses_lead', created_at: '2026-11-08T02:00:00Z' }],
      };
      const data = (rows[`${query.agent_id}/${query.stop_reason}`] ?? []).map((row) => ({
        ...row,
        deployment_id: query.agent_id === 'agt_ceo' ? 'dep_sweep' : null,
      }));
      return { data, has_more: false, next_cursor: null };
    });
    const client = { sessions: { list } } as unknown as Naive;
    const held = await heldSessions(client, [
      { name: 'br-ceo', id: 'agt_ceo' },
      { name: 'br-eng-lead', id: 'agt_lead' },
    ]);
    expect(held).toEqual([
      {
        agent: 'br-ceo',
        id: 'ses_holds_a_call',
        stop_reason: 'awaiting_approval',
        deployment_id: 'dep_sweep',
        created_at: '2026-11-08T01:40:00Z',
      },
      {
        agent: 'br-ceo',
        id: 'ses_resumes_on_raise',
        stop_reason: 'budget_paused',
        deployment_id: 'dep_sweep',
        created_at: '2026-11-08T01:49:54Z',
      },
      {
        agent: 'br-eng-lead',
        id: 'ses_lead',
        stop_reason: 'budget_paused',
        deployment_id: null,
        created_at: '2026-11-08T02:00:00Z',
      },
    ]);
    expect(list).toHaveBeenCalledTimes(2 * HELD_STOP_REASONS.length);
    for (const [query] of list.mock.calls) {
      expect(HELD_STOP_REASONS).toContain(query.stop_reason);
    }
  });
});

describe('duplicate titles on the board', () => {
  it('names each title two sessions made, oldest card first, and nothing else', () => {
    expect(
      duplicateTitles([
        {
          id: 'crd_b',
          title: 'RELEASE: zz',
          status: 'blocked',
          created_at: '2026-11-08T01:00:01.1Z',
        },
        {
          id: 'crd_a',
          title: 'RELEASE: zz',
          status: 'blocked',
          created_at: '2026-11-08T01:00:00.0Z',
        },
        { id: 'crd_c', title: 'DIR: zz', status: 'done', created_at: '2026-11-08T00:00:00Z' },
      ]),
    ).toEqual([{ title: 'RELEASE: zz', cards: ['crd_a blocked', 'crd_b blocked'] }]);
    expect(duplicateTitles([])).toEqual([]);
  });
});
