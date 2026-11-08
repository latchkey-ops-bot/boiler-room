import { ApiError } from '@usenaive-sdk/managed-agents';
import { describe, expect, it, vi } from 'vitest';
import type { Naive } from '../src/naive/client.ts';
import { siteUrlProblem } from '../src/researcher/output.ts';
import { isNotFound, runAgentName, runSuffix, teardown } from '../src/researcher/run.ts';

const notFound = () =>
  new ApiError(404, {
    type: 'invalid_request_error',
    code: 'not_found',
    message: 'no such agent: agt_gone',
    request_id: 'req_1',
  });

/** A fake client with only the calls teardown makes. */
function fakeClient(options: {
  deleteError?: () => unknown;
  statuses: string[];
  others?: { id: string; name: string; status: string }[];
}) {
  const calls = { deletes: 0, gets: 0 };
  const statuses = [...options.statuses];
  const client = {
    agents: {
      spend: async () => ({ spent_micro_usd: 1000 }),
      computer: async () => ({ id: 'cmp_mine', name: 'mine', status: 'running' }),
      delete: async () => {
        calls.deletes += 1;
        if (options.deleteError) throw options.deleteError();
        return { id: 'agt_x', deleted: true };
      },
    },
    computers: {
      get: async () => {
        calls.gets += 1;
        const status = statuses.shift() ?? 'running';
        if (status === 'gone') throw notFound();
        return { id: 'cmp_mine', status };
      },
      list: async () => ({
        data: [{ id: 'cmp_mine', name: 'mine', status: 'running' }, ...(options.others ?? [])],
        has_more: false,
        next_cursor: null,
      }),
    },
  };
  return { client: client as unknown as Naive, calls };
}

const noSleep = vi.fn(async () => {});

describe('teardown', () => {
  it('treats an agent that is already gone as deleted, and does not retry the delete', async () => {
    const { client, calls } = fakeClient({
      deleteError: notFound,
      statuses: ['running', 'destroyed'],
    });
    const result = await teardown(client, 'agt_x', { sleep: noSleep, pollMs: 1, maxWaitMs: 100 });
    expect(calls.deletes).toBe(1);
    expect(result).toMatchObject({
      agentDeleted: true,
      computerId: 'cmp_mine',
      computerGone: true,
    });
  });

  it('polls the computer by id until it is destroyed, instead of deleting again', async () => {
    const { client, calls } = fakeClient({ statuses: ['running', 'running', 'running', 'gone'] });
    const result = await teardown(client, 'agt_x', { sleep: noSleep, pollMs: 1, maxWaitMs: 100 });
    expect(calls.deletes).toBe(1);
    expect(calls.gets).toBe(4);
    expect(result.computerGone).toBe(true);
  });

  it('lists other live computers without counting them as this run’s', async () => {
    const { client } = fakeClient({
      statuses: ['destroyed'],
      others: [
        { id: 'cmp_other', name: 'someone-else', status: 'running' },
        { id: 'cmp_old', name: 'old', status: 'destroyed' },
      ],
    });
    const result = await teardown(client, 'agt_x', { sleep: noSleep, pollMs: 1, maxWaitMs: 100 });
    expect(result.others).toEqual(['cmp_other someone-else running']);
    expect(result.computerGone).toBe(true);
  });

  it('reports a computer that outlives the wait as still live', async () => {
    const { client } = fakeClient({ statuses: [] });
    const result = await teardown(client, 'agt_x', { sleep: noSleep, pollMs: 10, maxWaitMs: 30 });
    expect(result.computerGone).toBe(false);
  });
});

describe('isNotFound', () => {
  it('recognises the API error and the message the platform sends', () => {
    expect(isNotFound(notFound())).toBe(true);
    expect(isNotFound(new Error('no such agent: agt_0abc'))).toBe(true);
    expect(isNotFound(new Error('rate limited'))).toBe(false);
  });
});

describe('one agent per run', () => {
  it('names the agent after the site and a unique run id, within the 100-character limit', () => {
    const name = runAgentName('br-researcher', 'orbitly.example.org', 'lx1a2b3c');
    expect(name).toBe('br-researcher-orbitly-example-org-lx1a2b3c');
    expect(
      runAgentName('br-researcher', `${'a'.repeat(120)}.example.org`, 'x').length,
    ).toBeLessThanOrEqual(100);
  });

  it('gives two runs started in the same millisecond different agents', () => {
    expect(runSuffix(1_700_000_000_000, 'aaaaaa')).not.toBe(runSuffix(1_700_000_000_000, 'bbbbbb'));
    expect(runSuffix()).toMatch(/^[a-z0-9]+$/);
  });
});

describe('siteUrlProblem', () => {
  it('refuses an address claims could not cite, before any spend', () => {
    expect(siteUrlProblem('https://orbitly.example.org/')).toBeNull();
    expect(siteUrlProblem('http://127.0.0.1:8787/')).toContain('domain name');
    expect(siteUrlProblem('http://localhost:3000/')).toContain('domain name');
  });
});
