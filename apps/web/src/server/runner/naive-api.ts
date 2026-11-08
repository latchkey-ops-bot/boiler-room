/**
 * The handful of Naive API routes the website calls, over plain `fetch`. The SDK would bring far
 * more into the Worker bundle than these ten routes need. Paths and bodies follow
 * `@usenaive-sdk/managed-agents` 0.12.3, which `services/render` uses.
 *
 * The key is the website's own scoped key (`NAIVE_WEB_KEY`). It never appears in an error, a log
 * line or a command.
 */

export const NAIVE_API_VERSION = '2026-09-30';

export type ComputerStatus = 'creating' | 'running' | 'paused' | 'failed' | 'destroyed';

export interface NaiveComputer {
  id: string;
  name: string;
  status: ComputerStatus;
  snapshot_id: string | null;
  created_at: string;
}

export interface CreateComputer {
  name: string;
  vcpu: number;
  memory_mb: number;
  disk_gb: number;
  snapshot_id: string;
}

export interface ExecResult {
  exit_code: number;
  timed_out?: boolean;
}

export interface NaiveApi {
  createComputer(body: CreateComputer, idempotencyKey: string): Promise<NaiveComputer>;
  getComputer(id: string): Promise<NaiveComputer>;
  listComputers(query: { limit: number; after?: string }): Promise<{
    data: NaiveComputer[];
    has_more: boolean;
    next_cursor: string | null;
  }>;
  /** Where the computer's file API is rooted: `fs/*` paths are under it. */
  home(id: string): Promise<string>;
  writeFile(id: string, path: string, content: string): Promise<void>;
  exec(id: string, command: string, timeoutMs: number): Promise<ExecResult>;
  pause(id: string): Promise<NaiveComputer>;
  resume(id: string): Promise<NaiveComputer>;
  snapshot(id: string): Promise<{ snapshot_id: string }>;
  deleteComputer(id: string): Promise<void>;
  deleteSnapshot(id: string): Promise<void>;
  balanceMicroUsd(): Promise<number>;
}

export class NaiveApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'NaiveApiError';
    this.status = status;
    this.code = code;
  }
}

/** A 404 from Naive: the computer or snapshot is gone. */
export const isGone = (error: unknown) => error instanceof NaiveApiError && error.status === 404;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export class HttpNaiveApi implements NaiveApi {
  readonly #key: string;
  readonly #baseUrl: string;
  readonly #fetch: Fetch;

  constructor(options: { key: string; baseUrl: string; fetch?: Fetch }) {
    this.#key = options.key;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async #call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers = new Headers({
      authorization: `Bearer ${this.#key}`,
      'vetta-version': NAIVE_API_VERSION,
      accept: 'application/json',
    });
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (method !== 'GET') headers.set('idempotency-key', idempotencyKey ?? crypto.randomUUID());
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new NaiveApiError(0, 'network', `${method} ${path} did not reach Naive.`);
    }
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const error = (parsed as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      const code = typeof error?.code === 'string' ? error.code : `http_${response.status}`;
      const message = typeof error?.message === 'string' ? error.message.slice(0, 300) : '';
      throw new NaiveApiError(
        response.status,
        code,
        `${method} ${path} answered ${response.status} ${code}${message ? `: ${message}` : ''}`,
      );
    }
    return parsed as T;
  }

  createComputer(body: CreateComputer, idempotencyKey: string) {
    return this.#call<NaiveComputer>('POST', '/v1/computers', body, idempotencyKey);
  }

  getComputer(id: string) {
    return this.#call<NaiveComputer>('GET', `/v1/computers/${encodeURIComponent(id)}`);
  }

  listComputers(query: { limit: number; after?: string }) {
    const params = new URLSearchParams({ limit: String(query.limit) });
    if (query.after) params.set('after', query.after);
    return this.#call<{ data: NaiveComputer[]; has_more: boolean; next_cursor: string | null }>(
      'GET',
      `/v1/computers?${params}`,
    );
  }

  async home(id: string) {
    const inspected = await this.#call<{ home: string | null }>(
      'GET',
      `/v1/computers/${encodeURIComponent(id)}/inspect`,
    );
    if (!inspected.home) {
      throw new NaiveApiError(502, 'no_home', `Naive did not say where ${id}'s files live.`);
    }
    return inspected.home.replace(/\/+$/, '');
  }

  async writeFile(id: string, path: string, content: string) {
    await this.#call('POST', `/v1/computers/${encodeURIComponent(id)}/fs/write`, {
      path,
      content,
    });
  }

  exec(id: string, command: string, timeoutMs: number) {
    return this.#call<ExecResult>('POST', `/v1/computers/${encodeURIComponent(id)}/exec`, {
      command,
      timeout_ms: timeoutMs,
    });
  }

  pause(id: string) {
    return this.#call<NaiveComputer>('POST', `/v1/computers/${encodeURIComponent(id)}/pause`, {});
  }

  resume(id: string) {
    return this.#call<NaiveComputer>('POST', `/v1/computers/${encodeURIComponent(id)}/resume`, {});
  }

  snapshot(id: string) {
    return this.#call<{ snapshot_id: string }>(
      'POST',
      `/v1/computers/${encodeURIComponent(id)}/snapshot`,
      {},
    );
  }

  async deleteComputer(id: string) {
    await this.#call('DELETE', `/v1/computers/${encodeURIComponent(id)}`);
  }

  async deleteSnapshot(id: string) {
    await this.#call('DELETE', `/v1/snapshots/${encodeURIComponent(id)}`);
  }

  async balanceMicroUsd() {
    const balance = await this.#call<{ balance_micro_usd: number }>('GET', '/v1/credits/balance');
    return balance.balance_micro_usd;
  }
}
