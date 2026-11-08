import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@usenaive-sdk/managed-agents';

export const NAIVE_BASE_URL = 'https://api.vetta.sh';

/** Where the key lives. It is read at run time and never printed, logged or passed in argv. */
export const ENV_FILE = process.env.BOILER_ROOM_ENV ?? join(homedir(), '.boiler-room.env');

export type Naive = ReturnType<typeof createClient>;

/** Every secret read so far. `scrub` removes each of them from text before it is printed or saved. */
const secrets = new Set<string>();

/** Reads one variable from the env file at run time. It is never printed, logged or passed in argv. */
export function readSecret(name: string): string {
  let text: string;
  try {
    text = readFileSync(ENV_FILE, 'utf8');
  } catch {
    throw new Error(`Cannot read ${ENV_FILE}. Put ${name}=... in it.`);
  }
  const value = new RegExp(`^(?:export\\s+)?${name}=["']?([^"'\\s]+)`, 'm').exec(text)?.[1];
  if (!value) throw new Error(`${ENV_FILE} has no ${name}.`);
  secrets.add(value);
  return value;
}

export function naiveClient(): Naive {
  return createClient({ baseUrl: NAIVE_BASE_URL, apiKey: readSecret('NAIVE_API_KEY') });
}

/** Removes every secret read so far from any text before it is printed or saved. */
export function scrub(text: string): string {
  let out = text;
  for (const value of secrets) out = out.split(value).join('[REDACTED]');
  return out;
}

export const usd = (micro: number) => `$${(micro / 1e6).toFixed(4)}`;

/** Every item of a cursor-paginated list. */
export async function listAll<T>(
  page: (query: {
    limit: number;
    after?: string;
  }) => Promise<{ data: T[]; has_more: boolean; next_cursor?: string | null }>,
  max = 1000,
): Promise<T[]> {
  const items: T[] = [];
  let after: string | undefined;
  for (;;) {
    const result = await page({ limit: 100, ...(after ? { after } : {}) });
    items.push(...result.data);
    if (!result.has_more || !result.next_cursor || items.length >= max) return items;
    after = result.next_cursor;
  }
}

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export interface StreamRetry {
  /** Reconnects after the SDK's own have failed. */
  retries?: number;
  /** The wait before the first reconnect, doubled for each one after it. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A session's events after `afterSeq`. The SDK's stream reconnects five times with no wait and
 * then throws, and throws at once on a 4xx other than 429. This reconnects from the last
 * event seen, after a wait that doubles, up to `retries` more times without a new event, then
 * throws. A caller that catches
 * it must stop the session and still count what the session spent.
 */
export async function* sessionEvents<E extends { seq: number }>(
  client: { stream: (sessionId: string, options?: { afterSeq?: number }) => AsyncIterable<E> },
  sessionId: string,
  afterSeq: number,
  { retries = 3, delayMs = 1000, sleep = pause }: StreamRetry = {},
): AsyncGenerator<E> {
  let seq = afterSeq;
  let failures = 0;
  for (;;) {
    try {
      for await (const event of client.stream(sessionId, { afterSeq: seq })) {
        // Only a new event is progress: a connection that replays what was seen and drops again
        // still counts as a failure.
        if (event.seq > seq) {
          seq = event.seq;
          failures = 0;
        }
        yield event;
      }
      return;
    } catch (cause) {
      failures += 1;
      if (failures > retries) throw cause;
      await sleep(delayMs * 2 ** (failures - 1));
    }
  }
}
