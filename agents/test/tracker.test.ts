import { describe, expect, it } from 'vitest';
import { captureDoneLine } from '../src/capture/run.ts';
import {
  EventTracker,
  type StreamEvent,
  settleTurn,
  type TurnClient,
} from '../src/researcher/run.ts';

const DIGEST = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const SITE = 'https://orbitly.example.org/';

describe('EventTracker', () => {
  it('maps published files to their paths and collects capture digests and submissions', () => {
    const tracker = new EventTracker(SITE);
    const events = [
      {
        type: 'tool.started',
        data: {
          tool_call_id: 't1',
          name: 'publish_file',
          args: { path: '/home/tenki/br/out/site/pages.json' },
        },
      },
      {
        type: 'tool.started',
        data: { tool_call_id: 't2', name: 'bash', args: { command: 'node br-research.mjs wait' } },
      },
      {
        type: 'tool.completed',
        data: {
          tool_call_id: 't2',
          name: 'bash',
          is_error: false,
          output: `CAPTURE DONE\n${captureDoneLine(DIGEST, 3, SITE, SITE)}\nBR_JOB_DONE capture ok`,
        },
      },
      {
        type: 'tool.completed',
        data: {
          tool_call_id: 't1',
          name: 'publish_file',
          is_error: false,
          output: 'published as fil_abc123 (pages.json, 4265 bytes)',
        },
      },
      {
        type: 'tool.completed',
        data: {
          tool_call_id: 't3',
          name: 'submit_output',
          is_error: true,
          output: 'does not match the schema',
        },
      },
      {
        type: 'tool.completed',
        data: {
          tool_call_id: 't4',
          name: 'submit_output',
          is_error: false,
          output: 'Final result recorded.',
        },
      },
    ];
    for (const event of events) tracker.handle(event);
    expect(tracker.published).toEqual(
      new Map([['fil_abc123', '/home/tenki/br/out/site/pages.json']]),
    );
    expect(tracker.digests).toEqual(new Set([DIGEST]));
    expect(tracker.submissions).toBe(1);
  });

  it('ignores digests printed by a failed tool call', () => {
    const tracker = new EventTracker(SITE);
    tracker.handle({
      type: 'tool.completed',
      data: {
        tool_call_id: 'x',
        name: 'bash',
        is_error: true,
        output: captureDoneLine(DIGEST, 3, SITE, SITE),
      },
    });
    expect(tracker.digests.size).toBe(0);
  });

  // A wait on a shared computer printed another site's capture summary; its digest must never bind
  // this run's result.
  it('trusts only digests printed for the site this run researches', () => {
    const tracker = new EventTracker('https://www.orbitly.example.org');
    const completed = (output: string) =>
      tracker.handle({
        type: 'tool.completed',
        data: { tool_call_id: 'w', name: 'bash', is_error: false, output },
      });
    completed(
      captureDoneLine(OTHER, 13, 'https://nightjar.example.net/', 'https://nightjar.example.net'),
    );
    completed(`BR_CAPTURE_DONE sha256=${'c'.repeat(64)} pages=2`);
    completed(
      captureDoneLine(DIGEST, 4, 'https://orbitly.example.org/', 'https://orbitly.example.org'),
    );
    expect([...tracker.digests]).toEqual([DIGEST]);
    expect(tracker.foreign.get(OTHER)).toBe('nightjar.example.net');
    expect(tracker.foreign.has('c'.repeat(64))).toBe(true);
  });

  it('accepts a capture whose home page redirected to another domain, by the address requested', () => {
    const tracker = new EventTracker('https://orbitly.example.org');
    tracker.handle({
      type: 'tool.completed',
      data: {
        tool_call_id: 'w',
        name: 'bash',
        is_error: false,
        output: captureDoneLine(
          DIGEST,
          4,
          'https://orbitly-app.example.com/',
          'https://orbitly.example.org',
        ),
      },
    });
    expect([...tracker.digests]).toEqual([DIGEST]);
  });
});

/** A submission, as the agent's submit_output arguments and the idle event carry it. */
const result = (round: number) => ({
  evidence: { pages_file_id: `fil_round${round}` },
  claims: [],
});

/** The events of one turn that ends with an accepted submit_output. */
function submittedTurn(firstSeq: number, id: string, output: unknown, idle: unknown = output) {
  return [
    {
      seq: firstSeq,
      type: 'tool.started',
      data: { tool_call_id: id, name: 'submit_output', args: output },
    },
    {
      seq: firstSeq + 1,
      type: 'tool.completed',
      data: {
        tool_call_id: id,
        name: 'submit_output',
        is_error: false,
        output: 'Final result recorded.',
      },
    },
    ...(idle === undefined
      ? []
      : [
          {
            seq: firstSeq + 2,
            type: 'session.idle',
            data: { stop_reason: 'end_turn', structured_output: idle },
          },
        ]),
  ] satisfies StreamEvent[];
}

/**
 * A fake client whose stream plays one turn's events and whose `sessions.get` answers a stale
 * `structured_output`, as Naive can just after a turn ends.
 */
function fakeClient(events: StreamEvent[], stale: unknown) {
  const calls = { gets: 0, streamedAfter: [] as number[] };
  const client = {
    stream: (_id: string, options?: { afterSeq?: number }) => {
      calls.streamedAfter.push(options?.afterSeq ?? 0);
      return (async function* () {
        for (const event of events) if (event.seq > (options?.afterSeq ?? 0)) yield event;
      })();
    },
    sessions: {
      get: async () => {
        calls.gets += 1;
        return { id: 'ses_1', status: 'idle', stop_reason: 'end_turn', structured_output: stale };
      },
      interrupt: async () => ({}),
    },
  };
  return { client: client as unknown as TurnClient, calls };
}

describe('settleTurn', () => {
  const options = { deadline: Date.now() + 60_000, limitMinutes: 1, sleep: async () => {} };

  it('gates the submission the idle event carries, not the previous one sessions.get still answers', async () => {
    const tracker = new EventTracker(SITE);
    // Round 1 was submitted and gated earlier in the session.
    for (const event of submittedTurn(1, 'c1', result(1))) tracker.handle(event);
    const gated = tracker.submissions;
    const { client, calls } = fakeClient(submittedTurn(10, 'c2', result(2)), result(1));
    const seen: number[] = [];
    const turn = await settleTurn(client, 'ses_1', tracker, {
      ...options,
      afterSeq: 9,
      onEvent: (event) => seen.push(event.seq),
    });
    expect(turn.state.structured_output).toEqual(result(1));
    expect(turn.output).toEqual(result(2));
    expect(tracker.submissions).toBe(gated + 1);
    expect(turn.afterSeq).toBe(12);
    expect(seen).toEqual([10, 11, 12]);
    expect(calls).toEqual({ gets: 1, streamedAfter: [9] });
  });

  it('finds the first submission although sessions.get has no structured_output yet', async () => {
    const tracker = new EventTracker(SITE);
    const { client } = fakeClient(submittedTurn(1, 'c1', result(1)), null);
    const turn = await settleTurn(client, 'ses_1', tracker, { ...options, afterSeq: 0 });
    expect(turn.state.structured_output).toBeNull();
    expect(turn.output).toEqual(result(1));
  });

  it('takes the idle event over the call arguments, and the arguments when the stream ends first', async () => {
    const tracker = new EventTracker(SITE);
    const normalised = { ...result(2), note: 'as Naive stored it' };
    const { client } = fakeClient(submittedTurn(1, 'c1', result(2), normalised), result(1));
    expect(
      (await settleTurn(client, 'ses_1', tracker, { ...options, afterSeq: 0 })).output,
    ).toEqual(normalised);
    const dropped = new EventTracker(SITE);
    const cut = fakeClient(submittedTurn(1, 'c1', result(3), undefined), result(2));
    expect(
      (await settleTurn(cut.client, 'ses_1', dropped, { ...options, afterSeq: 0 })).output,
    ).toEqual(result(3));
  });

  it('counts no new submission for a turn that ends without one', async () => {
    const tracker = new EventTracker(SITE);
    for (const event of submittedTurn(1, 'c1', result(1))) tracker.handle(event);
    const idle = {
      seq: 20,
      type: 'session.idle',
      data: { stop_reason: 'max_iterations', structured_output: null },
    };
    const { client } = fakeClient([idle], result(1));
    const turn = await settleTurn(client, 'ses_1', tracker, { ...options, afterSeq: 19 });
    expect(tracker.submissions).toBe(1);
    expect(turn.output).toEqual(result(1));
  });

  it('ignores a submit_output Naive refused', () => {
    const tracker = new EventTracker(SITE);
    tracker.handle({
      type: 'tool.started',
      data: { tool_call_id: 'x', name: 'submit_output', args: result(9) },
    });
    tracker.handle({
      type: 'tool.completed',
      data: {
        tool_call_id: 'x',
        name: 'submit_output',
        is_error: true,
        output: 'does not match the schema',
      },
    });
    tracker.handle({
      type: 'session.idle',
      data: { stop_reason: 'end_turn', structured_output: result(9) },
    });
    expect(tracker.submissions).toBe(0);
    expect(tracker.output).toBeUndefined();
  });
});
