import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Campaign } from '@boiler-room/schema';
import { describe, expect, it, vi } from 'vitest';
import type { Batch } from '../src/art/apply.ts';
import { reviewBatches } from '../src/art/review.ts';
import type { StyleDecision } from '../src/art/style.ts';
import { artDirector } from '../src/definitions/art-director.ts';
import type { Naive } from '../src/naive/client.ts';

type Event = { seq: number; type: string; data: Record<string, unknown> };

/**
 * A fake Naive client with no network. `stream` is called once per connection; `get` answers
 * `sessions.get`. Every call is logged.
 */
function fakeClient(options: {
  stream: (call: number) => AsyncGenerator<Event>;
  get: (id: string) => Record<string, unknown>;
}) {
  let created = 0;
  let calls = 0;
  const log: string[] = [];
  const client = {
    skills: { push: vi.fn(async () => ({ version: 1 })) },
    agents: {
      list: vi.fn(async () => ({ data: [], has_more: false, next_cursor: null })),
      create: vi.fn(async () => ({ id: 'agt_fake', current_version: 1 })),
      update: vi.fn(async () => ({ id: 'agt_fake', current_version: 1 })),
    },
    sessions: {
      create: vi.fn(async () => {
        created += 1;
        log.push(`create ses_${created}`);
        return { id: `ses_${created}` };
      }),
      get: vi.fn(async (id: string) => options.get(id)),
      send: vi.fn(async () => ({ accepted_seq: 10 })),
      interrupt: vi.fn(async (id: string) => {
        log.push(`interrupt ${id}`);
        return {};
      }),
      cancel: vi.fn(async (id: string) => {
        log.push(`cancel ${id}`);
        return { id, status: 'cancelled' };
      }),
    },
    stream: vi.fn((_id: string, _query: { afterSeq?: number }) => {
      calls += 1;
      return options.stream(calls);
    }),
  };
  return { client: client as unknown as Naive, log, raw: client };
}

const batches: Batch[] = [1, 2, 3].map(
  (index): Batch =>
    ({
      kind: 'generated',
      id: `generated-${index}`,
      images: [
        {
          need: {
            assetId: `g${index}`,
            purpose: 'event-field',
            sceneIds: ['s'],
            prompt: 'p',
            aspectRatio: '16:9',
          },
          fileId: `fil_g${index}`,
        },
      ],
    }) as unknown as Batch,
);

const context = {
  campaign: { brand: { name: 'X' }, sourceUrl: 'https://x.example' } as unknown as Campaign,
  style: { familyName: 'Neutral Cut' } as unknown as StyleDecision,
  infos: [],
};

const options = () => ({
  budgetMicroUsd: 100_000,
  concurrency: 1,
  maxMinutesPerBatch: 0.05,
  eventsPath: join(mkdtempSync(join(tmpdir(), 'art-review-')), 'events.jsonl'),
  campaignId: 'c',
  streamRetry: { retries: 2, delayMs: 0 },
});

describe('art review sessions', () => {
  it('stops a session whose event stream fails, and counts what it spent', async () => {
    const { client, log, raw } = fakeClient({
      stream: () =>
        (async function* () {
          yield { seq: 1, type: 'tool.started', data: { name: 'view_image', tool_call_id: 'a' } };
          throw new TypeError('fetch failed');
        })(),
      get: () => ({ status: 'running', stop_reason: null, consumed_micro_usd: 400_000 }),
    });
    const run = await reviewBatches(client, artDirector, batches, context, options());

    expect(raw.sessions.create).toHaveBeenCalledTimes(1);
    expect(log).toContain('interrupt ses_1');
    expect(run.spentMicroUsd).toBe(400_000);
    expect(run.sessions[0]).toMatchObject({
      session_id: 'ses_1',
      consumed_micro_usd: 400_000,
      outcome: expect.stringMatching(/^stream failed: fetch failed/),
    });
    expect(run.results.slice(1).map((result) => result.failure)).toEqual([
      expect.stringMatching(/budget .* is spent/),
      expect.stringMatching(/budget .* is spent/),
    ]);
    // One connection and the two reconnects it is allowed, resumed from the last event seen.
    expect(raw.stream).toHaveBeenCalledTimes(3);
    expect(raw.stream.mock.calls.map((call) => call[1])).toEqual([
      { afterSeq: 0 },
      { afterSeq: 1 },
      { afterSeq: 1 },
    ]);
  });

  it('resumes a dropped stream and keeps the review', async () => {
    const review = {
      seen: true,
      scene: null,
      tiles: [],
      generated: [],
      flags: [],
    };
    const { client } = fakeClient({
      stream: (call) =>
        (async function* () {
          if (call === 1) {
            yield { seq: 1, type: 'tool.started', data: { name: 'view_image', tool_call_id: 'a' } };
            throw new TypeError('fetch failed');
          }
          yield {
            seq: 2,
            type: 'tool.completed',
            data: { name: 'submit_output', tool_call_id: 'b', is_error: false },
          };
          yield {
            seq: 3,
            type: 'session.idle',
            data: { stop_reason: 'end_turn', structured_output: review },
          };
        })(),
      get: () => ({
        status: 'idle',
        stop_reason: 'end_turn',
        consumed_micro_usd: 50_000,
        structured_output: review,
      }),
    });
    const run = await reviewBatches(client, artDirector, batches.slice(0, 1), context, {
      ...options(),
      budgetMicroUsd: 1_000_000,
    });
    expect(run.sessions[0]?.outcome).toBe('reviewed');
    expect(run.results[0]?.review).toEqual(review);
    expect(run.spentMicroUsd).toBe(50_000);
  });

  it('reads the review from the idle event, not from a stale sessions.get', async () => {
    const review = { seen: true, scene: null, tiles: [], generated: [], flags: ['from idle'] };
    const stale = { seen: false, scene: null, tiles: [], generated: [], flags: ['stale'] };
    const { client } = fakeClient({
      stream: () =>
        (async function* () {
          yield {
            seq: 1,
            type: 'tool.started',
            data: { name: 'submit_output', tool_call_id: 'b', args: review },
          };
          yield {
            seq: 2,
            type: 'tool.completed',
            data: { name: 'submit_output', tool_call_id: 'b', is_error: false },
          };
          yield {
            seq: 3,
            type: 'session.usage',
            data: {
              token_usage: { input: 10, cache_write: 17_000, cache_read: 9_000, output: 400 },
              consumed_micro_usd: 50_000,
            },
          };
          yield {
            seq: 4,
            type: 'session.idle',
            data: { stop_reason: 'end_turn', structured_output: review },
          };
        })(),
      get: () => ({
        status: 'idle',
        stop_reason: 'end_turn',
        consumed_micro_usd: 50_000,
        structured_output: stale,
      }),
    });
    const run = await reviewBatches(client, artDirector, batches.slice(0, 1), context, {
      ...options(),
      budgetMicroUsd: 1_000_000,
    });
    expect(run.results[0]?.review).toEqual(review);
    expect(run.sessions[0]).toMatchObject({ outcome: 'reviewed', input_tokens: 26_010 });
  });

  it('cancels a review paused on its budget and retries it smaller', async () => {
    const two = {
      kind: 'generated',
      id: 'generated-1',
      images: [1, 2].map((index) => ({
        need: {
          assetId: `g${index}`,
          purpose: 'event-field',
          sceneIds: ['s'],
          prompt: 'p',
          aspectRatio: '16:9',
        },
        fileId: `fil_g${index}`,
      })),
    } as unknown as Batch;
    const { client, log, raw } = fakeClient({
      stream: () =>
        (async function* () {
          yield { seq: 1, type: 'session.idle', data: { stop_reason: 'budget_paused' } };
        })(),
      get: () => ({ status: 'idle', stop_reason: 'budget_paused', consumed_micro_usd: 1_000 }),
    });
    const run = await reviewBatches(client, artDirector, [two], context, {
      ...options(),
      budgetMicroUsd: 1_000_000,
    });
    // The batch, then its two halves; the halves pause too and are not split again.
    expect(raw.sessions.create).toHaveBeenCalledTimes(3);
    expect(log.filter((line) => line.startsWith('cancel'))).toEqual([
      'cancel ses_1',
      'cancel ses_2',
      'cancel ses_3',
    ]);
    expect(run.sessions.map((each) => [each.batch, each.budget_paused])).toEqual([
      ['generated-1', true],
      ['generated-1-a', true],
      ['generated-1-b', true],
    ]);
    expect(run.sessions[0]?.outcome).toBe(
      'paused on its budget and cancelled; retried as generated-1-a and generated-1-b',
    );
    expect(run.results.map((result) => result.batch.id)).toEqual([
      'generated-1-a',
      'generated-1-b',
    ]);
    expect(run.results.every((result) => result.review === undefined)).toBe(true);
    // The send nudge is never sent to a paused session.
    expect(raw.sessions.send).not.toHaveBeenCalled();
  });

  it("starts no further review once the agent's own cap has no room", async () => {
    const { client, log, raw } = fakeClient({
      stream: () =>
        (async function* () {
          yield {
            seq: 1,
            type: 'budget.exceeded',
            data: {
              message: "the agent's budget cap has no room for this call",
              code: 'budget_exceeded',
              param: 'budget.cap_micro_usd',
            },
          };
          yield { seq: 2, type: 'session.idle', data: { stop_reason: 'budget_paused' } };
        })(),
      get: () => ({ status: 'idle', stop_reason: 'budget_paused', consumed_micro_usd: 0 }),
    });
    const run = await reviewBatches(client, artDirector, batches, context, {
      ...options(),
      concurrency: 1,
      budgetMicroUsd: 1_000_000,
    });
    // One session of a batch that cannot be split pauses at nothing spent; nothing else starts.
    expect(raw.sessions.create).toHaveBeenCalledTimes(1);
    expect(log.filter((line) => line.startsWith('cancel'))).toEqual(['cancel ses_1']);
    expect(run.sessions[0]).toMatchObject({ budget_paused: true, agent_cap_spent: true });
    expect(run.sessions[0]?.outcome).toBe(
      "paused on its budget (the agent's own cap had no room) and cancelled; no smaller batch fits, so no further review starts",
    );
    expect(run.sessions.slice(1).map((each) => each.outcome)).toEqual(
      batches
        .slice(1)
        .map(() => "not started: the agent's own budget cap has no room for a session"),
    );
    expect(run.results).toHaveLength(batches.length);
  });

  it("tries the smaller batches next after the agent's cap refused a call, then stops", async () => {
    const two = (id: string) =>
      ({
        kind: 'generated',
        id,
        images: [1, 2].map((index) => ({
          need: {
            assetId: `${id}-${index}`,
            purpose: 'event-field',
            sceneIds: ['s'],
            prompt: 'p',
            aspectRatio: '16:9',
          },
          fileId: `fil_${id}_${index}`,
        })),
      }) as unknown as Batch;
    const { client, raw } = fakeClient({
      stream: () =>
        (async function* () {
          yield { seq: 1, type: 'budget.exceeded', data: { param: 'budget.cap_micro_usd' } };
          yield { seq: 2, type: 'session.idle', data: { stop_reason: 'budget_paused' } };
        })(),
      get: () => ({ status: 'idle', stop_reason: 'budget_paused', consumed_micro_usd: 0 }),
    });
    const run = await reviewBatches(client, artDirector, [two('a'), two('b'), two('c')], context, {
      ...options(),
      concurrency: 1,
      budgetMicroUsd: 1_000_000,
    });
    // a, then its first half as the probe, which cannot be split and meets the cap: stop.
    expect(raw.sessions.create).toHaveBeenCalledTimes(2);
    expect(run.sessions.map((each) => [each.batch, each.session_id !== null])).toEqual([
      ['a', true],
      ['a-a', true],
      ['a-b', false],
      ['b', false],
      ['c', false],
    ]);
  });

  it('records a session that could not start', async () => {
    const { client, raw } = fakeClient({
      stream: () => (async function* () {})(),
      get: () => ({}),
    });
    raw.sessions.create.mockRejectedValueOnce(new Error('402 budget'));
    const run = await reviewBatches(client, artDirector, batches.slice(0, 1), context, options());
    expect(run.sessions).toEqual([
      expect.objectContaining({ session_id: null, outcome: 'session failed: 402 budget' }),
    ]);
  });
});
