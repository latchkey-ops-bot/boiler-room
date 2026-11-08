/**
 * Live updates by polling. The film page and the films list ask the API again every few seconds
 * while the crew is working, slow down while a film waits for the founder, and stop once every
 * film is delivered. Each request also brings the film up to date with its pipeline run, so a poll
 * is one small JSON read and nothing runs between polls.
 *
 * Kept free of React and of the DOM so the tests can drive it with fake timers.
 */
import type { FilmStatus } from './film.ts';

/** How often to ask again. */
export const POLL_MS = {
  /** The crew is working: stations change every few seconds. */
  working: 3_000,
  /** The list, while any film is being made. */
  listWorking: 5_000,
  /** Waiting for the founder. Only they, or a teammate in another tab, can move it on. */
  waiting: 20_000,
  /** The longest wait between retries when the API is failing. */
  maxBackoff: 60_000,
} as const;

/** The next poll for one film, or null when nothing more can change. */
export function filmPollDelay(status: FilmStatus): number | null {
  if (status === 'queued' || status === 'working') return POLL_MS.working;
  if (status === 'needs_you') return POLL_MS.waiting;
  return null;
}

/** The next poll for the films list, or null when every film is finished. */
export function filmsPollDelay(statuses: FilmStatus[]): number | null {
  if (statuses.some((status) => status === 'queued' || status === 'working')) {
    return POLL_MS.listWorking;
  }
  if (statuses.includes('needs_you')) return POLL_MS.waiting;
  return null;
}

/** One load: the data, or a failure that is worth retrying (a 5xx, the network) or not (a 4xx). */
export type PollResult<T> = { ok: true; data: T } | { ok: false; retry: boolean };

export interface PollTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface PollVisibility {
  hidden(): boolean;
  /** Calls `run` when the page is visible again. Returns a function that cancels it. */
  onVisible(run: () => void): () => void;
}

export interface PollOptions<T> {
  /** The data the page rendered with. Its delay sets the first poll. */
  first: T;
  load(signal: AbortSignal): Promise<PollResult<T>>;
  delayFor(data: T): number | null;
  onData(data: T): void;
  timers?: PollTimers;
  visibility?: PollVisibility;
}

/**
 * Starts polling and returns the function that stops it. A hidden tab makes no requests; when it
 * comes back it loads at once. Failures back off, doubling up to a minute. A 4xx stops polling.
 */
export function startPolling<T>(options: PollOptions<T>): () => void {
  const timers = options.timers ?? browserTimers;
  const visibility = options.visibility ?? browserVisibility();
  let stopped = false;
  let handle: unknown;
  let controller: AbortController | null = null;
  let cancelVisible: (() => void) | null = null;
  let failures = 0;
  let lastDelay = options.delayFor(options.first);

  const schedule = (ms: number) => {
    handle = timers.set(() => void tick(), ms);
  };

  const tick = async () => {
    handle = undefined;
    if (stopped) return;
    if (visibility.hidden()) {
      cancelVisible = visibility.onVisible(() => {
        cancelVisible = null;
        void tick();
      });
      return;
    }
    controller = new AbortController();
    let result: PollResult<T>;
    try {
      result = await options.load(controller.signal);
    } catch {
      result = { ok: false, retry: true };
    }
    controller = null;
    if (stopped) return;
    if (result.ok) {
      failures = 0;
      options.onData(result.data);
      lastDelay = options.delayFor(result.data);
      if (lastDelay !== null) schedule(lastDelay);
      return;
    }
    if (!result.retry || lastDelay === null) return;
    failures += 1;
    schedule(Math.min(POLL_MS.maxBackoff, lastDelay * 2 ** failures));
  };

  if (lastDelay !== null) schedule(lastDelay);

  return () => {
    stopped = true;
    if (handle !== undefined) timers.clear(handle);
    controller?.abort();
    cancelVisible?.();
  };
}

/** Loads JSON from the API for a poll. */
export async function fetchJson<T>(url: string, signal: AbortSignal): Promise<PollResult<T>> {
  const response = await fetch(url, {
    signal,
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (response.ok) return { ok: true, data: (await response.json()) as T };
  // Signed out, gone or refused: asking again will not help.
  return { ok: false, retry: response.status >= 500 || response.status === 429 };
}

const browserTimers: PollTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function browserVisibility(): PollVisibility {
  return {
    hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    onVisible(run) {
      const listener = () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', listener);
          run();
        }
      };
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}
