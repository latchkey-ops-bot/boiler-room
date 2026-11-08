import { describe, expect, it, vi } from 'vitest';
import { checkSubmission } from '../src/director/checks.ts';
import { type CheckResult, type LoopClient, runDirectorSession } from '../src/director/loop.ts';
import { directorOutputJsonSchema } from '../src/director/output.ts';
import { CONTINUE_MESSAGE } from '../src/director/prompt.ts';
import { exampleBrief, exampleResearch, exampleSubmission } from './director-fixtures.ts';

/** A turn that ends without calling submit_output. */
const NO_SUBMISSION = Symbol('no submission');

/**
 * A fake Naive client. Each stream is one turn of the agent: it submits the next scripted output,
 * or submits nothing, and goes idle. Like Naive, the session keeps its last structured_output, and
 * the idle event that ends a turn carries it. With `staleGet`, `sessions.get` answers the output
 * before the latest, as Naive did live on a repair round.
 */
function fakeClient(turns: unknown[], { staleGet = false } = {}) {
  let turn = 0;
  let seq = 0;
  const outputs: unknown[] = [];
  const client = {
    sessions: {
      create: vi.fn(async (_body: Record<string, unknown>) => ({ id: 'ses_director' })),
      get: vi.fn(async (_id: string) => ({
        status: 'idle',
        stop_reason: 'end_turn',
        structured_output: outputs.at(staleGet && outputs.length > 1 ? -2 : -1) ?? null,
        consumed_micro_usd: 100_000 * turn,
      })),
      send: vi.fn(async (_id: string, _body: { message: string; queue?: boolean }) => ({
        accepted_seq: seq,
      })),
      interrupt: vi.fn(async () => ({})),
    },
    stream: vi.fn((_id: string, _query: { afterSeq: number }) =>
      (async function* () {
        const next = turns[turn];
        turn += 1;
        if (next !== NO_SUBMISSION && next !== undefined) {
          outputs.push(next);
          const call = { tool_call_id: `call_${turn}`, name: 'submit_output' };
          seq += 1;
          yield { seq, type: 'tool.started', data: { ...call, args: next } };
          seq += 1;
          yield { seq, type: 'tool.completed', data: { ...call, is_error: false } };
        }
        seq += 1;
        yield {
          seq,
          type: 'session.idle',
          data: { stop_reason: 'end_turn', structured_output: outputs.at(-1) ?? null },
        };
      })(),
    ),
  };
  return client;
}

const issue = (code: string) => ({
  code,
  severity: 'error' as const,
  path: 'campaign.scenes[6].text[0].value',
  message: `${code} message`,
  fix: `${code} fix text`,
  owner: 'director' as const,
});

/** Passes an output marked good, and returns one issue for anything else. */
const fakeCheck = async (output: unknown): Promise<CheckResult> =>
  (output as { good?: boolean }).good
    ? { blocking: [], other: [] }
    : { blocking: [issue('CLAIM_UNBACKED')], other: [] };

const run = (client: ReturnType<typeof fakeClient>, check = fakeCheck) =>
  runDirectorSession({
    client: client as unknown as LoopClient,
    agentId: 'agt_director',
    task: 'Write the campaign.',
    outputSchema: directorOutputJsonSchema,
    budgetMicroUsd: 1_500_000,
    maxRepairs: 3,
    maxMinutes: 5,
    check,
    sleep: async () => {},
  });

const sentMessages = (client: ReturnType<typeof fakeClient>) =>
  client.sessions.send.mock.calls.map(([id, body]) => ({ id, message: body.message }));

describe('runDirectorSession', () => {
  it('starts one typed session and accepts a first submission that passes', async () => {
    const client = fakeClient([{ good: true }]);
    const result = await run(client);
    expect(result).toMatchObject({ ok: true, sessionId: 'ses_director', output: { good: true } });
    expect(result.rounds).toHaveLength(1);
    expect(client.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'agt_director',
        budget_micro_usd: 1_500_000,
        output_schema: directorOutputJsonSchema,
        structured_output_required: true,
      }),
    );
    expect(client.sessions.send).not.toHaveBeenCalled();
  });

  it('sends the issues with their fix text back into the same session until it passes', async () => {
    const client = fakeClient([{ good: false }, { good: false }, { good: true }]);
    const result = await run(client);
    expect(result.ok).toBe(true);
    expect(result.rounds.map((round) => round.blocking.length)).toEqual([1, 1, 0]);
    const sent = sentMessages(client);
    expect(sent).toHaveLength(2);
    for (const [index, { id, message }] of sent.entries()) {
      expect(id).toBe('ses_director');
      expect(message).toContain('CLAIM_UNBACKED at campaign.scenes[6].text[0].value');
      expect(message).toContain('Fix: CLAIM_UNBACKED fix text');
      expect(message).toContain(`repair round ${index + 1} of 3`);
    }
    expect(client.sessions.create).toHaveBeenCalledTimes(1);
  });

  it('stops the session and counts its cost when the event stream fails for good', async () => {
    const client = fakeClient([{ good: true }]);
    client.stream.mockImplementation(() =>
      (async function* () {
        yield* [];
        throw new TypeError('fetch failed');
      })(),
    );
    client.sessions.get.mockImplementation(async () => ({
      status: 'running',
      stop_reason: 'end_turn',
      structured_output: null,
      consumed_micro_usd: 300_000,
    }));
    const result = await run(client);
    expect(result).toMatchObject({
      ok: false,
      sessionId: 'ses_director',
      reason: 'the event stream failed: fetch failed',
      consumedMicroUsd: 300_000,
    });
    expect(client.sessions.interrupt).toHaveBeenCalledWith('ses_director');
    // The first connection and three reconnects.
    expect(client.stream).toHaveBeenCalledTimes(4);
  });

  it('gives up after 3 repair rounds and returns the remaining issues', async () => {
    const client = fakeClient([{}, {}, {}, {}, { good: true }]);
    const result = await run(client);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rounds).toHaveLength(4);
    expect(result.reason).toBe('3 repair rounds did not clear every issue');
    expect(result.remaining).toEqual([issue('CLAIM_UNBACKED')]);
    expect(client.sessions.send).toHaveBeenCalledTimes(3);
  });

  it('never counts the session’s last output twice, and nudges a turn that submitted nothing', async () => {
    const client = fakeClient([{ good: false }, NO_SUBMISSION, { good: true }]);
    const result = await run(client);
    expect(result.ok).toBe(true);
    expect(result.rounds).toHaveLength(2);
    expect(sentMessages(client).map(({ message }) => message.split('\n')[0])).toEqual([
      expect.stringContaining('repair round 1 of 3'),
      CONTINUE_MESSAGE,
    ]);
  });

  it('checks the submission the events carry when sessions.get still answers the last one', async () => {
    const client = fakeClient(
      [
        { good: false, n: 1 },
        { good: true, n: 2 },
      ],
      { staleGet: true },
    );
    const result = await run(client);
    expect(result).toMatchObject({ ok: true, output: { good: true, n: 2 } });
    expect(result.rounds.map((round) => round.output)).toEqual([
      { good: false, n: 1 },
      { good: true, n: 2 },
    ]);
  });

  it('ignores a submit_output call that Naive refused against the schema', async () => {
    const client = fakeClient([{ good: true }]);
    const stream = client.stream.getMockImplementation();
    client.stream.mockImplementationOnce((id, query) =>
      (async function* () {
        yield {
          seq: 1,
          type: 'tool.started',
          data: { tool_call_id: 'bad', name: 'submit_output', args: { good: 'wrong' } },
        };
        yield {
          seq: 2,
          type: 'tool.completed',
          data: { tool_call_id: 'bad', name: 'submit_output', is_error: true },
        };
        for await (const event of stream?.(id, query) ?? []) yield event;
      })(),
    );
    const result = await run(client);
    expect(result).toMatchObject({ ok: true, output: { good: true } });
    expect(result.rounds).toHaveLength(1);
  });

  it('fails when the agent stops submitting', async () => {
    const client = fakeClient([NO_SUBMISSION, NO_SUBMISSION, NO_SUBMISSION, NO_SUBMISSION]);
    const result = await run(client);
    expect(result).toMatchObject({
      ok: false,
      rounds: [],
      reason: expect.stringMatching(/without a new submission/),
    });
    expect(client.sessions.send).toHaveBeenCalledTimes(3);
  });

  it('repairs a real validator issue with the real checks', async () => {
    const wrong = exampleSubmission();
    const proof = wrong.campaign.scenes[6]?.text[0];
    if (proof) proof.value = 'Under 60 s';
    const client = fakeClient([wrong, exampleSubmission()]);
    const result = await run(client, (output) =>
      checkSubmission(output, exampleResearch(), exampleBrief()),
    );
    expect(result.ok).toBe(true);
    const [message] = sentMessages(client).map((sent) => sent.message);
    expect(message).toContain('CLAIM_UNBACKED at campaign.scenes[6].text[0].value');
    expect(message).toContain(
      'Fix: Cite a claim whose quote states "60" in scenes[6].text[0].claimIds, or remove "60" from the text.',
    );
  });
});
