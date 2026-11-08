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
          yield { seq: 3, type: 'session.idle', data: { stop_reason: 'end_turn' } };
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
    expect(run.sessions[0]?.outcome).not.toMatch(/failed/);
    expect(run.spentMicroUsd).toBe(50_000);
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
