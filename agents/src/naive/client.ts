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
