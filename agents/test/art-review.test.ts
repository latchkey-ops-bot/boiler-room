import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Campaign } from '@boiler-room/schema';
import { describe, expect, it, vi } from 'vitest';
import type { Batch } from '../src/art/apply.ts';
import { NOT_REVIEWED, reviewBatches } from '../src/art/review.ts';
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

/** A `view_image` call for `ids` and its result, which lists each id as Naive attaches it. */
function viewed(ids: string[], seq = 0): Event[] {
  return [
    {
      seq,
      type: 'tool.started',
      data: { name: 'view_image', tool_call_id: `v${seq}`, args: { file_ids: ids } },
    },
    {
      seq: seq + 0.5,
      type: 'tool.completed',
      data: {
        name: 'view_image',
        tool_call_id: `v${seq}`,
        is_error: false,
        output: `${ids.length} image(s), in order:\n${ids.map((id) => `[image] ${id} image/png`).join('\n')}`,
      },
    },
  ];
}

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
            yield {
              seq: 1,
              type: 'tool.started',
              data: { name: 'view_image', tool_call_id: 'a', args: { file_ids: ['fil_g1'] } },
            };
            throw new TypeError('fetch failed');
          }
          yield {
            seq: 2,
            type: 'tool.completed',
            data: { name: 'view_image', tool_call_id: 'a', output: '[image] fil_g1 image/png' },
          };
          yield {
            seq: 3,
            type: 'tool.started',
            data: { name: 'submit_output', tool_call_id: 'b', args: review },
          };
          yield {
            seq: 4,
            type: 'tool.completed',
            data: { name: 'submit_output', tool_call_id: 'b', is_error: false },
          };
          yield {
            seq: 5,
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
          yield* viewed(['fil_g1'], -1);
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

  // ses_gwshmye25aef0eme127hehcjty, 8 November: view_image succeeded, seen: true with a detailed
  // reason, and then this, in the session's last message.
  const CONFESSION =
    "I submitted `home-screen` for the \"surface\" scene, but the reason I gave isn't reliable, and `seen: true` was wrong.\n\nThe four screenshots never showed up in my conversation. I only received the text captions with file names and links. The reason I wrote describes the home page's headline, nav and product UI, and compares it with the other three pages. I didn't see any of that, so I made it up.";

  const seenReview = {
    seen: true,
    scene: null,
    tiles: [],
    generated: [{ asset_id: 'g1', accept: true, reason: 'A smooth gradient, edge to edge.' }],
    flags: [],
  };

  /** One session's turn: optionally view `ids`, submit `output`, then say `after`. */
  function turn(options: { view?: string[]; output: unknown; after?: string }): Event[] {
    const events: Event[] = options.view ? viewed(options.view, 1) : [];
    events.push(
      {
        seq: 3,
        type: 'tool.started',
        data: { name: 'submit_output', tool_call_id: 's', args: options.output },
      },
      {
        seq: 4,
        type: 'tool.completed',
        data: { name: 'submit_output', tool_call_id: 's', is_error: false },
      },
    );
    if (options.after)
      events.push({
        seq: 5,
        type: 'message.completed',
        data: { role: 'assistant', content: options.after },
      });
    events.push({
      seq: 6,
      type: 'session.idle',
      data: { stop_reason: 'end_turn', structured_output: options.output },
    });
    return events;
  }

  const idle = () => ({ status: 'idle', stop_reason: 'end_turn', consumed_micro_usd: 50_000 });

  it('does not take seen: true without a view_image result for the picture, and asks once more', async () => {
    const { client, raw } = fakeClient({
      stream: (call) =>
        (async function* () {
          // The first session never views the picture; the second does.
          yield* turn(
            call === 1 ? { output: seenReview } : { view: ['fil_g1'], output: seenReview },
          );
        })(),
      get: idle,
    });
    const run = await reviewBatches(client, artDirector, batches.slice(0, 1), context, {
      ...options(),
      budgetMicroUsd: 1_000_000,
    });
    expect(raw.sessions.create).toHaveBeenCalledTimes(2);
    const second = raw.sessions.create.mock.calls[1] as unknown as [{ message: string }];
    expect(second[0].message).toMatch(/^This review was asked for once already/);
    expect(second[0].message).toContain('no view_image result for fil_g1');
    expect(run.sessions.map((each) => [each.batch, each.outcome])).toEqual([
      [
        'generated-1',
        "not seen: the session's events show no view_image result for fil_g1 before it submitted; asked again in a new session with the pictures attached again",
      ],
      ['generated-1-again', 'reviewed'],
    ]);
    expect(run.results).toHaveLength(1);
    expect(run.results[0]?.review).toEqual(seenReview);
  });

  it('takes a review as not seen when the agent says afterwards the pictures never arrived', async () => {
    const { client, raw } = fakeClient({
      stream: () =>
        (async function* () {
          yield* turn({ view: ['fil_g1'], output: seenReview, after: CONFESSION });
        })(),
      get: idle,
    });
    const run = await reviewBatches(client, artDirector, batches.slice(0, 1), context, {
      ...options(),
      budgetMicroUsd: 1_000_000,
    });
    // Twice, and neither proven seen: the code's choice, recorded as such.
    expect(raw.sessions.create).toHaveBeenCalledTimes(2);
    expect(run.sessions[0]?.not_seen).toMatch(
      /the agent said afterwards that the pictures did not reach it \("The four screenshots never showed up in my conversation\."\)/,
    );
    expect(run.results).toEqual([
      expect.objectContaining({
        review: undefined,
        notReviewed: true,
        failure: expect.stringMatching(new RegExp(`^${NOT_REVIEWED}: `)),
      }),
    ]);
  });

  it('asks again when the agent says it did not see, and keeps the rule if it still cannot', async () => {
    const unseen = { seen: false, scene: null, tiles: [], generated: [], flags: [] };
    const { client, raw } = fakeClient({
      stream: () =>
        (async function* () {
          yield* turn({ view: ['fil_g1'], output: unseen });
        })(),
      get: idle,
    });
    const run = await reviewBatches(client, artDirector, batches.slice(0, 1), context, {
      ...options(),
      budgetMicroUsd: 1_000_000,
    });
    expect(raw.sessions.create).toHaveBeenCalledTimes(2);
    expect(run.results[0]).toMatchObject({
      notReviewed: true,
      failure: `${NOT_REVIEWED}: the agent said it did not see every picture`,
    });
  });

  it('leaves a second look the budget cannot pay for to the rule, and says so', async () => {
    const { client, raw } = fakeClient({
      stream: () =>
        (async function* () {
          yield* turn({ output: seenReview });
        })(),
      get: () => ({ status: 'idle', stop_reason: 'end_turn', consumed_micro_usd: 200_000 }),
    });
    const run = await reviewBatches(client, artDirector, batches.slice(0, 1), context, {
      ...options(),
      budgetMicroUsd: 150_000,
    });
    expect(raw.sessions.create).toHaveBeenCalledTimes(1);
    expect(run.results[0]).toMatchObject({
      notReviewed: true,
      failure: expect.stringMatching(
        /^chosen by rule, not reviewed: .*; then not started: the run's review budget/,
      ),
    });
  });
});
