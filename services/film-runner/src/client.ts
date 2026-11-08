/**
 * Signed calls from the runner to the website. Every request carries a fresh nonce and timestamp,
 * so a retry is a new request with a new signature. Failures are sorted into ones worth another try
 * (the network, 408, 429, 5xx, a stale clock) and ones that end the run (a key the site rejects
 * three times, a run the site no longer accepts).
 */
import { createHash } from 'node:crypto';
import {
  type Bootstrap,
  EMPTY_SHA256,
  parseServerTime,
  RUNNER_API_PREFIX,
  RUNNER_EXIT,
  signRequest,
} from './contract.ts';

export class FatalCallError extends Error {
  readonly exitCode: number;
  readonly code: string;
  readonly status: number | null;

  constructor(exitCode: number, code: string, message: string, status: number | null = null) {
    super(message);
    this.name = 'FatalCallError';
    this.exitCode = exitCode;
    this.code = code;
    this.status = status;
  }
}

export class CallAborted extends Error {
  constructor() {
    super('The call was abandoned.');
    this.name = 'CallAborted';
  }
}

export interface ClientOptions {
  bootstrap: Bootstrap;
  fetch?: typeof fetch;
  /** Milliseconds. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  log?: (line: string) => void;
  /** No successful call for this long ends the run. 15 minutes. */
  unreachableMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Per attempt. Uploads get `uploadTimeoutMs`. */
  requestTimeoutMs?: number;
  uploadTimeoutMs?: number;
}

export interface CallOptions {
  /** Attempts before giving up on errors worth retrying. Unlimited when left out. */
  attempts?: number;
  signal?: AbortSignal;
  contentType?: string;
  /** Learn the server's clock from the answer. */
  learnClock?: boolean;
}

export function sha256OfBytes(bytes: Uint8Array | null): string {
  if (!bytes || bytes.byteLength === 0) return EMPTY_SHA256;
  return createHash('sha256').update(bytes).digest('hex');
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new CallAborted());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new CallAborted());
      },
      { once: true },
    );
  });

interface ErrorBody {
  code: string | undefined;
  serverTime: number | null;
}

function readErrorBody(text: string): ErrorBody {
  try {
    const body = JSON.parse(text) as {
      code?: unknown;
      serverTime?: unknown;
      error?: { code?: unknown; serverTime?: unknown } | string;
    };
    const error = typeof body.error === 'object' && body.error !== null ? body.error : undefined;
    const code =
      typeof error?.code === 'string'
        ? error.code
        : typeof body.error === 'string'
          ? body.error
          : typeof body.code === 'string'
            ? body.code
            : undefined;
    return { code, serverTime: parseServerTime(body.serverTime ?? error?.serverTime) };
  } catch {
    return { code: undefined, serverTime: null };
  }
}

export class RunnerClient {
  /** Server clock minus local clock, in milliseconds. */
  offsetMs = 0;
  lastSuccessAt: number;
  private consecutiveUnauthorized = 0;
  private readonly bootstrap: Bootstrap;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly log: (line: string) => void;
  private readonly unreachableMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly requestTimeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly origin: string;

  constructor(options: ClientOptions) {
    this.bootstrap = options.bootstrap;
    this.doFetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.log = options.log ?? (() => undefined);
    this.unreachableMs = options.unreachableMs ?? 15 * 60_000;
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? 5 * 60_000;
    this.lastSuccessAt = this.now();
    // The routes are absolute paths under the prefix; the base may sit below a path of its own.
    this.origin = this.bootstrap.callbackBase.slice(0, -RUNNER_API_PREFIX.length);
  }

  /** Unix seconds on the server's clock, as far as the runner knows it. */
  serverSeconds(): number {
    return Math.floor((this.now() + this.offsetMs) / 1000);
  }

  serverMs(): number {
    return this.now() + this.offsetMs;
  }

  private learn(serverMs: number | null) {
    if (serverMs === null) return;
    const offset = serverMs - this.now();
    if (Math.abs(offset - this.offsetMs) > 1000) {
      this.log(`clock: the website's clock is ${Math.round(offset / 1000)} s from this computer's`);
    }
    this.offsetMs = offset;
  }

  /**
   * One call, retried as the error allows. `path` is a route from the contract, such as
   * `/api/runner/v1/films/<id>/events?x=1`.
   */
  async call<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body: Uint8Array | null,
    options: CallOptions = {},
  ): Promise<T> {
    const url = new URL(this.origin + path);
    const bodySha256 = sha256OfBytes(body);
    const contentLength = body?.byteLength ?? 0;
    let attempt = 0;
    let staleRetried = false;
    for (;;) {
      attempt += 1;
      if (options.signal?.aborted) throw new CallAborted();
      let retryReason: string;
      let retryAfterMs: number | undefined;
      try {
        const headers = await signRequest({
          keyHex: this.bootstrap.key,
          method,
          url,
          filmId: this.bootstrap.filmId,
          runId: this.bootstrap.runId,
          ts: this.serverSeconds(),
          bodySha256,
          contentLength,
        });
        if (body) headers['content-type'] = options.contentType ?? 'application/json';
        const timeout = AbortSignal.timeout(
          method === 'PUT' ? this.uploadTimeoutMs : this.requestTimeoutMs,
        );
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        const response = await this.doFetch(url, {
          method,
          headers,
          ...(body ? { body: body as Uint8Array<ArrayBuffer> } : {}),
          signal,
        });
        const text = await response.text();
        if (response.ok) {
          this.lastSuccessAt = this.now();
          this.consecutiveUnauthorized = 0;
          const parsed = (text ? JSON.parse(text) : {}) as T & { serverTime?: unknown };
          if (options.learnClock) {
            this.learn(
              parseServerTime(parsed.serverTime) ?? parseServerTime(response.headers.get('date')),
            );
          }
          return parsed;
        }
        const error = readErrorBody(text);
        const status = response.status;
        if (status === 401 && error.code === 'stale') {
          this.learn(error.serverTime ?? parseServerTime(response.headers.get('date')));
          if (!staleRetried) {
            staleRetried = true;
            attempt -= 1;
            continue;
          }
          retryReason = 'stale clock';
        } else if (status === 401) {
          this.consecutiveUnauthorized += 1;
          if (this.consecutiveUnauthorized >= 3) {
            throw new FatalCallError(
              RUNNER_EXIT.unauthorized,
              'unauthorized',
              'The website rejected the signature three times in a row.',
              401,
            );
          }
          retryReason = 'unauthorized';
        } else if (status === 409 && error.code === 'replay') {
          retryReason = 'replay';
        } else if (status === 408 || status === 425 || status === 429 || status >= 500) {
          retryReason = `HTTP ${status}`;
          const after = Number(response.headers.get('retry-after'));
          if (Number.isFinite(after) && after > 0) retryAfterMs = Math.min(after * 1000, 60_000);
        } else {
          throw new FatalCallError(
            RUNNER_EXIT.refused,
            error.code ?? `http_${status}`,
            `The website refused ${method} ${url.pathname} with ${status} ${error.code ?? ''}`.trim(),
            status,
          );
        }
      } catch (error) {
        if (error instanceof FatalCallError) throw error;
        if (options.signal?.aborted) throw new CallAborted();
        retryReason = error instanceof Error ? error.message : String(error);
      }
      if (this.now() - this.lastSuccessAt > this.unreachableMs) {
        throw new FatalCallError(
          RUNNER_EXIT.unreachable,
          'unreachable',
          `No call to the website succeeded for ${Math.round(this.unreachableMs / 60_000)} minutes.`,
        );
      }
      if (options.attempts !== undefined && attempt >= options.attempts) {
        throw new Error(`${method} ${url.pathname} failed ${attempt} times: ${retryReason}`);
      }
      const backoff =
        retryAfterMs ??
        Math.min(this.baseBackoffMs * 2 ** Math.min(attempt - 1, 10), this.maxBackoffMs);
      this.log(`retry: ${method} ${url.pathname} (${retryReason}); next try in ${backoff} ms`);
      await this.sleep(backoff, options.signal);
    }
  }

  /** A JSON call. */
  json<T>(method: 'GET' | 'POST', path: string, value?: unknown, options: CallOptions = {}) {
    const body = value === undefined ? null : new TextEncoder().encode(JSON.stringify(value));
    return this.call<T>(method, path, body, options);
  }
}
