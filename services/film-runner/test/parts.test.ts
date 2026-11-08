/** The runner's parts on their own: the outbox, the tail, the signed client and the scrubber. */
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CallAborted, FatalCallError, RunnerClient } from '../src/client.ts';
import {
  type Bootstrap,
  deriveRunKey,
  HEADERS,
  RUNNER_EXIT,
  type RunnerEvent,
} from '../src/contract.ts';
import { Outbox } from '../src/outbox.ts';
import { Scrubber } from '../src/scrub.ts';
import { EventTail } from '../src/tail.ts';
import { FILM_ID, MASTER, RUN_ID, tempDir } from './helpers.ts';

const heartbeat = () =>
  ({
    type: 'runner.heartbeat',
    at: new Date().toISOString(),
    phase: 'script',
    filmPid: 1,
    load1: 0,
    memUsedMb: 1,
  }) as const;

describe('the outbox', () => {
  it('numbers events across launches and resends the unconfirmed ones under the same numbers', () => {
    const dir = tempDir();
    const first = new Outbox(dir);
    expect(first.takeSeq()).toBe(1);
    expect(first.push(heartbeat()).seq).toBe(2);
    expect(first.push(heartbeat()).seq).toBe(3);
    first.ack(2);
    expect(first.pending().map((event) => event.seq)).toEqual([3]);

    const second = new Outbox(dir);
    expect(second.pending().map((event) => event.seq)).toEqual([3]);
    expect(second.push(heartbeat()).seq).toBe(4);
    second.ack(4);
    expect(second.size).toBe(0);
    expect(new Outbox(dir).takeSeq()).toBe(5);
  });

  it('skips a line cut short by a crash', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'outbox.jsonl'),
      `${JSON.stringify({ seq: 1, ...heartbeat() })}\n{"seq":2,"ty`,
    );
    expect(new Outbox(dir).pending().map((event: RunnerEvent) => event.seq)).toEqual([1]);
  });
});

describe('the tail', () => {
  it('hands over whole lines once, in order, and a last line with no newline at the end', () => {
    const dir = tempDir();
    const file = join(dir, 'events.jsonl');
    const lines: string[] = [];
    const tail = new EventTail(file, (line) => lines.push(line));
    tail.read();
    appendFileSync(file, 'one\ntw');
    tail.read();
    expect(lines).toEqual(['one']);
    appendFileSync(file, 'o\n\nthree');
    tail.read();
    expect(lines).toEqual(['one', 'two']);
    tail.stop();
    expect(lines).toEqual(['one', 'two', 'three']);
  });
});

describe('the signed client', () => {
  async function client(
    responses: Array<() => Response>,
    options: { now?: () => number; unreachableMs?: number } = {},
  ) {
    const bootstrap: Bootstrap = {
      v: 1,
      filmId: FILM_ID,
      runId: RUN_ID,
      callbackBase: 'https://site.test/api/runner/v1',
      key: await deriveRunKey(MASTER, FILM_ID, RUN_ID),
      issuedAt: 1,
    };
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    const instance = new RunnerClient({
      bootstrap,
      fetch: (async (url: URL, init: RequestInit) => {
        requests.push({ url: String(url), headers: init.headers as Record<string, string> });
        const next = responses.shift();
        if (!next) throw new TypeError('fetch failed');
        return next();
      }) as unknown as typeof fetch,
      sleep: async () => undefined,
      ...options,
    });
    return { instance, requests };
  }
  const json =
    (status: number, body: unknown, headers: Record<string, string> = {}) =>
    () =>
      new Response(JSON.stringify(body), { status, headers });

  it('retries server errors with a new nonce each time', async () => {
    const { instance, requests } = await client([
      json(503, {}),
      json(502, {}),
      json(200, { ok: true }),
    ]);
    expect(await instance.json('POST', `/api/runner/v1/films/${FILM_ID}/events`, { a: 1 })).toEqual(
      { ok: true },
    );
    expect(requests).toHaveLength(3);
    expect(new Set(requests.map((request) => request.headers[HEADERS.nonce])).size).toBe(3);
    expect(requests[0]?.url).toBe(`https://site.test/api/runner/v1/films/${FILM_ID}/events`);
  });

  it('corrects its clock from a stale answer and tries again at once', async () => {
    const serverSeconds = Math.floor(Date.now() / 1000) + 3600;
    const { instance, requests } = await client([
      json(401, { error: { code: 'stale' }, serverTime: serverSeconds }),
      json(200, { ok: true }),
    ]);
    await instance.json('GET', `/api/runner/v1/films/${FILM_ID}/instructions`);
    const ts = Number(requests[1]?.headers[HEADERS.ts]);
    expect(Math.abs(ts - serverSeconds)).toBeLessThan(5);
  });

  it('gives up after three 401s in a row', async () => {
    const { instance } = await client([json(401, {}), json(401, {}), json(401, {})]);
    const error = await instance
      .json('POST', '/api/runner/v1/films/x/hello', {})
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FatalCallError);
    expect(error).toMatchObject({ exitCode: RUNNER_EXIT.unauthorized });
  });

  it('stops at once when the website refuses the run', async () => {
    const { instance, requests } = await client([json(409, { error: { code: 'wrong_state' } })]);
    const error = await instance
      .json('POST', '/api/runner/v1/films/x/events', {})
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ exitCode: RUNNER_EXIT.refused, code: 'wrong_state' });
    expect(requests).toHaveLength(1);
  });

  it('gives up when nothing has succeeded for too long', async () => {
    let now = 0;
    const { instance } = await client(
      Array.from({ length: 10 }, () => () => {
        now += 60_000;
        return new Response('{}', { status: 503 });
      }),
      { now: () => now, unreachableMs: 120_000 },
    );
    const error = await instance
      .json('POST', '/api/runner/v1/films/x/events', {})
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ exitCode: RUNNER_EXIT.unreachable });
  });

  it('stops retrying when told to', async () => {
    const controller = new AbortController();
    const { instance } = await client([
      () => {
        controller.abort();
        return new Response('{}', { status: 503 });
      },
    ]);
    const error = await instance
      .json('POST', '/api/runner/v1/films/x/events', {}, { signal: controller.signal })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CallAborted);
  });
});

describe('the scrubber', () => {
  it('takes keys out of text', () => {
    const scrubber = new Scrubber(['abcdef0123456789']);
    expect(
      scrubber.scrub(
        'key abcdef0123456789, sk_live_AbCdEf123456789 and Bearer xyz.abc.def123 NAIVE_API_KEY=secretvalue',
      ),
    ).toBe('key [REDACTED], [REDACTED] and [REDACTED] [REDACTED]');
  });
});
