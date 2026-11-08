import { describe, expect, it, vi } from 'vitest';
import { type CloseClient, closeSession, SessionTracker } from '../src/naive/session.ts';

function client(states: Record<string, unknown>[]) {
  let read = 0;
  const sessions = {
    get: vi.fn(async () => states[Math.min(read++, states.length - 1)]),
    interrupt: vi.fn(async () => ({})),
    cancel: vi.fn(async () => ({ status: 'cancelled' })),
  };
  return { sessions, as: { sessions } as unknown as CloseClient };
}

describe('closeSession', () => {
  it('cancels a session parked on its budget, so it never waits for the founder', async () => {
    const fake = client([{ status: 'idle', stop_reason: 'budget_paused', consumed_micro_usd: 7 }]);
    const closed = await closeSession(fake.as, 'ses_1');
    expect(fake.sessions.cancel).toHaveBeenCalledWith('ses_1');
    expect(fake.sessions.interrupt).not.toHaveBeenCalled();
    expect(closed).toMatchObject({
      status: 'cancelled',
      budgetPaused: true,
      cancelled: true,
      consumedMicroUsd: 7,
    });
  });

  it('interrupts a running session and leaves a finished one alone', async () => {
    const running = client([
      { status: 'running', stop_reason: null },
      { status: 'idle', stop_reason: 'interrupted', consumed_micro_usd: 3 },
    ]);
    expect(await closeSession(running.as, 'ses_2')).toMatchObject({
      status: 'idle',
      budgetPaused: false,
      cancelled: false,
      consumedMicroUsd: 3,
    });
    expect(running.sessions.interrupt).toHaveBeenCalledWith('ses_2');

    const finished = client([{ status: 'idle', stop_reason: 'end_turn' }]);
    await closeSession(finished.as, 'ses_3');
    expect(finished.sessions.interrupt).not.toHaveBeenCalled();
    expect(finished.sessions.cancel).not.toHaveBeenCalled();
  });

  it('tries a failed cancel once more and says so when it cannot', async () => {
    const fake = client([{ status: 'idle', stop_reason: 'budget_paused' }]);
    fake.sessions.cancel.mockRejectedValue(new Error('503'));
    const closed = await closeSession(fake.as, 'ses_4');
    expect(fake.sessions.cancel).toHaveBeenCalledTimes(2);
    expect(closed).toMatchObject({ budgetPaused: true, cancelled: false });
  });
});

describe('SessionTracker', () => {
  it('reads the output from the idle event, and sizes the input from the events', () => {
    const tracker = new SessionTracker();
    const events = [
      { type: 'tool.started', data: { tool_call_id: 'a', name: 'submit_output', args: { n: 1 } } },
      { type: 'tool.completed', data: { tool_call_id: 'a', name: 'submit_output' } },
      {
        type: 'span.model_request.end',
        data: { token_usage: { input: 5, cache_write: 1000, cache_read: 0 } },
      },
      {
        type: 'span.model_request.end',
        data: { token_usage: { input: 5, cache_write: 200, cache_read: 1000 } },
      },
      {
        type: 'session.usage',
        data: {
          token_usage: { input: 10, cache_write: 1200, cache_read: 1000, output: 9, reasoning: 0 },
          consumed_micro_usd: 42,
        },
      },
      { type: 'session.idle', data: { stop_reason: 'end_turn', structured_output: { n: 2 } } },
    ];
    for (const event of events) tracker.handle(event);
    expect(tracker.output).toEqual({ n: 2 });
    expect(tracker.submissions).toBe(1);
    expect(tracker.consumedMicroUsd).toBe(42);
    expect(tracker.inputSize()).toEqual({
      input_tokens: 2210,
      model_requests: 2,
      largest_request_input_tokens: 1205,
    });
  });

  it('keeps no idle output before any accepted submission, and marks a budget pause', () => {
    const tracker = new SessionTracker();
    tracker.handle({
      type: 'session.idle',
      data: { stop_reason: 'budget_paused', structured_output: { stale: true } },
    });
    expect(tracker.output).toBeUndefined();
    expect(tracker.budgetPaused).toBe(true);
  });
});
