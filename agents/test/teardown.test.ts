import { ApiError } from '@usenaive-sdk/managed-agents';
import { describe, expect, it, vi } from 'vitest';
import { researcher } from '../src/definitions/researcher.ts';
import type { Naive } from '../src/naive/client.ts';
import { siteUrlProblem } from '../src/researcher/output.ts';
import {
  isNotFound,
  liveSessions,
  releaseComputer,
  runDirFor,
  runSuffix,
} from '../src/researcher/run.ts';

const notFound = () =>
  new ApiError(404, {
    type: 'invalid_request_error',
    code: 'not_found',
    message: 'no such computer: cmp_gone',
    request_id: 'req_1',
  });

interface FakeSession {
  id: string;
  status: string;
  created_at: string;
}

/** A fake client with only the calls a release makes. */
function fakeClient(options: {
  computer?: { id: string; name: string; status: string } | null;
  sessions?: FakeSession[];
  /** Statuses the computer reads after it is asked to pause, one per read. */
  afterPause?: string[];
  pauseError?: () => unknown;
  others?: { id: string; name: string; status: string }[];
}) {
  const calls = { pauses: 0, gets: 0, execs: [] as string[], deletes: 0 };
  const computer =
    options.computer === undefined
      ? { id: 'cmp_mine', name: 'br-researcher', status: 'running' }
      : options.computer;
  const afterPause = [...(options.afterPause ?? ['paused'])];
  const sessions = options.sessions ?? [];
  const client = {
    agents: {
      computer: async () => computer,
      delete: async () => {
        calls.deletes += 1;
        return { id: 'agt_x', deleted: true };
      },
    },
    sessions: {
      list: async (query: { status?: string }) => ({
        data: sessions.filter((session) => session.status === query.status),
        has_more: false,
        next_cursor: null,
      }),
    },
    computers: {
      exec: async (_id: string, command: string) => {
        calls.execs.push(command);
        return { stdout: 'nothing left running\n', stderr: '', exit_code: 0 };
      },
      pause: async () => {
        calls.pauses += 1;
        const error = options.pauseError?.();
        if (error) throw error;
        return { ...computer, status: afterPause.shift() ?? 'running' };
      },
      get: async () => {
        calls.gets += 1;
        const status = afterPause.shift() ?? 'running';
        if (status === 'gone') throw notFound();
        return { ...computer, status };
      },
      list: async () => ({
        data: [...(computer ? [computer] : []), ...(options.others ?? [])],
        has_more: false,
        next_cursor: null,
      }),
    },
  };
  return { client: client as unknown as Naive, calls };
}

const noSleep = vi.fn(async () => {});
const fast = { sleep: noSleep, pollMs: 1, maxWaitMs: 50 };

describe('releaseComputer', () => {
  it('stops this run’s processes and pauses the agent’s computer, and never deletes the agent', async () => {
    const { client, calls } = fakeClient({ afterPause: ['running', 'paused'] });
    const result = await releaseComputer(client, 'agt_x', { ...fast, sessionId: 'ses_mine' });
    expect(calls.execs).toHaveLength(1);
    expect(calls.execs[0]).toContain("pkill -f '[c]hrome-headless-shell'");
    expect(calls.execs[0]).toContain("pkill -f '[/]br/'");
    expect(calls.pauses).toBe(1);
    expect(calls.deletes).toBe(0);
    expect(result).toMatchObject({
      computerId: 'cmp_mine',
      computerStatus: 'paused',
      idle: true,
      stopped: 'nothing left running',
      busy: [],
    });
  });

  it('leaves the computer running while another session of the agent uses it', async () => {
    const { client, calls } = fakeClient({
      sessions: [
        { id: 'ses_mine', status: 'running', created_at: '2026-11-08T03:00:00Z' },
        { id: 'ses_other', status: 'queued', created_at: '2026-11-08T03:01:00Z' },
      ],
    });
    const result = await releaseComputer(client, 'agt_x', { ...fast, sessionId: 'ses_mine' });
    expect(calls.execs).toEqual([]);
    expect(calls.pauses).toBe(0);
    expect(result.busy).toEqual(['ses_other queued since 2026-11-08T03:01:00Z']);
    expect(result.idle).toBe(false);
  });

  it('has nothing to do when the agent has no computer, or it is already paused', async () => {
    const none = fakeClient({ computer: null });
    expect(await releaseComputer(none.client, 'agt_x', fast)).toMatchObject({
      computerId: null,
      idle: true,
    });
    const paused = fakeClient({ computer: { id: 'cmp_mine', name: 'x', status: 'paused' } });
    const result = await releaseComputer(paused.client, 'agt_x', fast);
    expect(paused.calls.pauses).toBe(0);
    expect(paused.calls.execs).toEqual([]);
    expect(result).toMatchObject({ computerStatus: 'paused', idle: true });
  });

  it('reports a computer that does not read paused within the wait', async () => {
    const { client } = fakeClient({ afterPause: [] });
    const result = await releaseComputer(client, 'agt_x', fast);
    expect(result).toMatchObject({ computerStatus: 'running', idle: false });
  });

  // Live, the platform refused the pause for a few minutes after the session's last turn.
  it('keeps asking for the pause until the computer has rested', async () => {
    let refusals = 3;
    const { client, calls } = fakeClient({
      pauseError: () => {
        if (refusals-- > 0)
          return new Error(
            "a session or a person is using the agent's computer; try again when it rests",
          );
        return undefined;
      },
    });
    const result = await releaseComputer(client, 'agt_x', { ...fast, maxWaitMs: 100 });
    expect(calls.pauses).toBe(4);
    expect(result).toMatchObject({ computerStatus: 'paused', idle: true });
  });

  it('stops asking after three failures of another kind', async () => {
    const { client, calls } = fakeClient({
      pauseError: () => new Error('internal error'),
      afterPause: [],
    });
    const result = await releaseComputer(client, 'agt_x', { ...fast, maxWaitMs: 100 });
    expect(calls.pauses).toBe(3);
    expect(result.idle).toBe(false);
  });

  it('counts a computer that is gone as nothing running', async () => {
    const { client } = fakeClient({ pauseError: notFound });
    expect((await releaseComputer(client, 'agt_x', fast)).idle).toBe(true);
  });

  it('lists other agents’ live computers without touching them', async () => {
    const { client } = fakeClient({
      others: [
        { id: 'cmp_other', name: 'agent br-design', status: 'running' },
        { id: 'cmp_old', name: 'old', status: 'paused' },
      ],
    });
    const result = await releaseComputer(client, 'agt_x', fast);
    expect(result.others).toEqual(['cmp_other agent br-design running']);
  });
});

describe('one agent for every run', () => {
  it('runs as the br-researcher agent itself, not a copy per run', () => {
    expect(researcher.name).toBe('br-researcher');
  });

  it('lists only the agent’s running and queued sessions, without this run’s own', async () => {
    const { client } = fakeClient({
      sessions: [
        { id: 'ses_mine', status: 'running', created_at: 'a' },
        { id: 'ses_q', status: 'queued', created_at: 'b' },
        { id: 'ses_idle', status: 'idle', created_at: 'c' },
      ],
    });
    expect((await liveSessions(client, 'agt_x', 'ses_mine')).map((item) => item.id)).toEqual([
      'ses_q',
    ]);
  });

  it('gives each run its own folder on the shared computer', () => {
    expect(runSuffix(1_700_000_000_000, 'aaaaaa')).not.toBe(runSuffix(1_700_000_000_000, 'bbbbbb'));
    expect(runSuffix()).toMatch(/^[a-z0-9]+$/);
    expect(runDirFor('lx1a2b3c')).toBe('br/lx1a2b3c');
  });
});

describe('isNotFound', () => {
  it('recognises the API error and the message the platform sends', () => {
    expect(isNotFound(notFound())).toBe(true);
    expect(isNotFound(new Error('no such agent: agt_0abc'))).toBe(true);
    expect(isNotFound(new Error('rate limited'))).toBe(false);
  });
});

describe('siteUrlProblem', () => {
  it('refuses an address claims could not cite, before any spend', () => {
    expect(siteUrlProblem('https://orbitly.example.org/')).toBeNull();
    expect(siteUrlProblem('http://127.0.0.1:8787/')).toContain('domain name');
    expect(siteUrlProblem('http://localhost:3000/')).toContain('domain name');
  });
});
