/**
 * The Naive calls the website makes for a film's computer: create it from the base snapshot, write
 * `bootstrap.json`, start the runner in the background, stop it, pause, resume, checkpoint and
 * destroy. Plain `fetch`, no SDK and no Node built-ins, so the Worker bundle stays small
 * (`@boiler-room/film-runner/launcher`). The snapshot build uses the same client.
 *
 * Rules every function here keeps:
 *
 * - No `exec` asks for more than Naive's 600 s ceiling (`MAX_EXEC_MS`). The website's own execs are
 *   seconds long: the runner is started detached with `setsid`, and everything after that arrives
 *   as signed callbacks.
 * - No secret, link or key ever goes in a command line. Command history keeps every command and its
 *   output for 30 days, unredacted. Secrets reach the computer only through `fs/write`.
 * - A paused computer is resumed by any `exec`, `fs` or `snapshot` call, so nothing here touches a
 *   paused computer except `resume` and `destroy`.
 */
import {
  BOOTSTRAP_PATH,
  type Bootstrap,
  LAUNCH_COMMAND,
  RUN_DIR_NAME,
  SCRUB_COMMAND,
  STOP_COMMAND,
} from './contract.ts';

export { LAUNCH_COMMAND, RUN_DIR_NAME, SCRUB_COMMAND, STOP_COMMAND };

export const NAIVE_API_URL = 'https://api.vetta.sh';
/** The API version the SDK 0.12.3 sends. */
export const NAIVE_API_VERSION = '2026-09-30';
/** Naive's ceiling for one `exec`. */
export const MAX_EXEC_MS = 600_000;

/** The film computer: the base snapshot was built at this size, and a fork may not be smaller. */
export const FILM_COMPUTER_SIZE = { vcpu: 4, memory_mb: 8192, disk_gb: 20 } as const;

export type ComputerStatus = 'creating' | 'running' | 'paused' | 'failed' | 'destroyed';

export interface Computer {
  id: string;
  name: string;
  status: ComputerStatus;
  vcpu: number;
  memory_mb: number;
  disk_gb: number;
  snapshot_id: string | null;
  agent_id?: string | null;
  created_at: string;
}

export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out?: boolean;
  duration_ms?: number;
}

export class NaiveApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;

  constructor(status: number, code: string, message: string, requestId: string) {
    super(`Naive ${status} ${code}: ${message}`);
    this.name = 'NaiveApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export interface NaiveApiOptions {
  /** The website's scoped key (`computers:write`), or the admin key in the snapshot build. */
  key: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface NaiveApi {
  request<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    path: string,
    body?: unknown,
    options?: { idempotencyKey?: string },
  ): Promise<T>;
}

export function naiveApi(options: NaiveApiOptions): NaiveApi {
  const base = (options.baseUrl ?? NAIVE_API_URL).replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;
  if (!options.key) throw new Error('A Naive key is needed.');
  return {
    async request<T>(
      method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
      path: string,
      body?: unknown,
      { idempotencyKey }: { idempotencyKey?: string } = {},
    ): Promise<T> {
      const headers: Record<string, string> = {
        authorization: `Bearer ${options.key}`,
        'vetta-version': NAIVE_API_VERSION,
        accept: 'application/json',
      };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (method !== 'GET') headers['idempotency-key'] = idempotencyKey ?? crypto.randomUUID();
      const response = await doFetch(`${base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = undefined;
      }
      if (!response.ok) {
        const error =
          typeof parsed === 'object' && parsed !== null && 'error' in parsed
            ? (parsed as { error: { code?: string; message?: string; request_id?: string } }).error
            : {};
        throw new NaiveApiError(
          response.status,
          error.code ?? 'http_error',
          error.message ?? `HTTP ${response.status}`,
          error.request_id ?? response.headers.get('x-request-id') ?? '',
        );
      }
      if (parsed === undefined) {
        throw new NaiveApiError(response.status, 'unreadable', 'The answer was not JSON.', '');
      }
      return parsed as T;
    },
  };
}

const id = (value: string) => encodeURIComponent(value);

/** `br-film-<env>-<filmId>`. The watchdog matches computers to films by this name. */
export function filmComputerName(env: string, filmId: string): string {
  if (!/^[a-z0-9-]{1,32}$/.test(env)) throw new Error(`Bad environment name: ${env}`);
  return `br-film-${env}-${filmId}`;
}

export interface CreateFilmComputerInput {
  env: string;
  filmId: string;
  runId: string;
  /** 1 for the first create of a run. A retried create with the same attempt is the same computer. */
  attempt: number;
  /** The base snapshot, or the film's checkpoint when a late approval forks it. */
  snapshotId: string;
  size?: { vcpu: number; memory_mb: number; disk_gb: number };
}

/** Creates the film's computer from a snapshot. Naive answers at once, with status `creating`. */
export function createFilmComputer(
  api: NaiveApi,
  input: CreateFilmComputerInput,
): Promise<Computer> {
  if (!/^snp_[A-Za-z0-9]+$/.test(input.snapshotId)) throw new Error('Bad snapshot id.');
  const size = input.size ?? FILM_COMPUTER_SIZE;
  return api.request<Computer>(
    'POST',
    '/v1/computers',
    {
      name: filmComputerName(input.env, input.filmId),
      vcpu: size.vcpu,
      memory_mb: size.memory_mb,
      disk_gb: size.disk_gb,
      snapshot_id: input.snapshotId,
    },
    { idempotencyKey: `${input.runId}:${input.attempt}` },
  );
}

/** A plain read; never touches the machine and never wakes a paused one. */
export function getComputer(api: NaiveApi, computerId: string): Promise<Computer> {
  return api.request<Computer>('GET', `/v1/computers/${id(computerId)}`);
}

export async function listComputers(api: NaiveApi, max = 1000): Promise<Computer[]> {
  const out: Computer[] = [];
  let after: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ limit: '100', ...(after ? { after } : {}) });
    const page = await api.request<{
      data: Computer[];
      has_more: boolean;
      next_cursor: string | null;
    }>('GET', `/v1/computers?${query}`);
    out.push(...page.data);
    if (!page.has_more || !page.next_cursor || out.length >= max) return out;
    after = page.next_cursor;
  }
}

/** Every film computer of one environment, live or not. */
export async function listFilmComputers(api: NaiveApi, env: string): Promise<Computer[]> {
  const prefix = `br-film-${env}-`;
  return (await listComputers(api)).filter((computer) => computer.name.startsWith(prefix));
}

/**
 * Waits until a new computer is running, for scripts. The website does not wait: its step function
 * reads `getComputer` once per tick.
 */
export async function waitRunning(
  api: NaiveApi,
  computerId: string,
  { timeoutMs = 240_000, intervalMs = 1500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<Computer> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const computer = await getComputer(api, computerId);
    if (computer.status === 'running') return computer;
    if (computer.status === 'failed' || computer.status === 'destroyed') {
      throw new Error(`Computer ${computerId} is ${computer.status}.`);
    }
    if (Date.now() > deadline) throw new Error(`Computer ${computerId} was not running in time.`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** The directory `fs/*` is rooted in. Read it per computer; never hardcode it. */
export async function computerHome(api: NaiveApi, computerId: string): Promise<string> {
  const inspect = await api.request<{ home: string | null }>(
    'GET',
    `/v1/computers/${id(computerId)}/inspect`,
  );
  if (!inspect.home?.startsWith('/')) {
    throw new Error(`Computer ${computerId} reports no home directory.`);
  }
  return inspect.home;
}

/** Runs one command and waits for it. The timeout is clamped to Naive's 600 s ceiling. */
export function exec(
  api: NaiveApi,
  computerId: string,
  command: string,
  timeoutMs = 30_000,
): Promise<ExecResult> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Bad exec timeout.');
  return api.request<ExecResult>('POST', `/v1/computers/${id(computerId)}/exec`, {
    command,
    timeout_ms: Math.min(timeoutMs, MAX_EXEC_MS),
  });
}

export async function writeFile(
  api: NaiveApi,
  computerId: string,
  path: string,
  content: string,
): Promise<void> {
  await api.request('POST', `/v1/computers/${id(computerId)}/fs/write`, { path, content });
}

export async function readFile(api: NaiveApi, computerId: string, path: string): Promise<string> {
  const answer = await api.request<{ content: string }>(
    'POST',
    `/v1/computers/${id(computerId)}/fs/read`,
    { path },
  );
  return answer.content;
}

export async function makeDir(api: NaiveApi, computerId: string, path: string): Promise<void> {
  await api.request('POST', `/v1/computers/${id(computerId)}/fs/mkdir`, { path });
}

/**
 * Writes `<home>/br-run/bootstrap.json` with `fs/write`, so the per-run key never goes through a
 * command. The runner reads it and deletes it before it does anything else.
 */
export async function writeBootstrap(
  api: NaiveApi,
  computerId: string,
  home: string,
  bootstrap: Bootstrap,
): Promise<void> {
  await makeDir(api, computerId, `${home}/${RUN_DIR_NAME}`);
  await writeFile(api, computerId, `${home}/${BOOTSTRAP_PATH}`, `${JSON.stringify(bootstrap)}\n`);
}

/** Starts the runner detached with `LAUNCH_COMMAND`, which answers in about a second. */
export const LAUNCH_TIMEOUT_MS = 30_000;

export async function launchRunner(api: NaiveApi, computerId: string): Promise<ExecResult> {
  const result = await exec(api, computerId, LAUNCH_COMMAND, LAUNCH_TIMEOUT_MS);
  if (result.exit_code !== 0 || !result.stdout.includes('launched')) {
    throw new Error(
      `The runner did not launch on ${computerId} (exit ${result.exit_code}): ${(result.stderr || result.stdout).slice(-300)}`,
    );
  }
  return result;
}

/** Asks the runner to stop with `STOP_COMMAND`. Returns at once. */
export const STOP_TIMEOUT_MS = 20_000;

export function stopRunner(api: NaiveApi, computerId: string): Promise<ExecResult> {
  return exec(api, computerId, STOP_COMMAND, STOP_TIMEOUT_MS);
}

/** Deletes the bootstrap and the run's key file from the disk, before a checkpoint. */
export async function scrubSecrets(api: NaiveApi, computerId: string): Promise<void> {
  const result = await exec(api, computerId, SCRUB_COMMAND, 20_000);
  if (!result.stdout.includes('scrubbed')) {
    throw new Error(`Could not delete the run's secrets on ${computerId}.`);
  }
}

/**
 * Starts a long script detached and returns at once: it is written to `<home>/<dir>/<name>.sh` with
 * `fs/write`, run with `setsid -f`, logs to `<name>.log`, and writes its exit code to `<name>.done`
 * when it ends. Poll it with `pollDetached`. For steps that can outlast one exec, such as an
 * install.
 */
export async function execDetached(
  api: NaiveApi,
  computerId: string,
  home: string,
  dir: string,
  name: string,
  script: string,
): Promise<void> {
  if (!/^[a-z0-9-]{1,40}$/.test(name) || !/^[a-z0-9-]{1,40}$/.test(dir)) {
    throw new Error('Bad detached script name.');
  }
  await makeDir(api, computerId, `${home}/${dir}`);
  await writeFile(api, computerId, `${home}/${dir}/${name}.sh`, script);
  const base = `"$HOME/${dir}/${name}`;
  const command = `rm -f ${base}.done" && setsid -f bash -c 'bash ${base}.sh"; echo $? > ${base}.done"' </dev/null >>${base}.log" 2>&1 && echo started`;
  const result = await exec(api, computerId, command, 30_000);
  if (result.exit_code !== 0 || !result.stdout.includes('started')) {
    throw new Error(`Could not start ${name} on ${computerId}: ${result.stderr.slice(-300)}`);
  }
}

export interface DetachedState {
  done: boolean;
  exitCode: number | null;
  tail: string;
}

/** One short look at a detached script: whether it ended, its exit code, and its last log lines. */
export async function pollDetached(
  api: NaiveApi,
  computerId: string,
  dir: string,
  name: string,
  lines = 8,
): Promise<DetachedState> {
  const base = `"$HOME/${dir}/${name}`;
  const result = await exec(
    api,
    computerId,
    `if [ -f ${base}.done" ]; then echo "DONE $(cat ${base}.done")"; else echo RUNNING; fi; tail -n ${lines} ${base}.log" 2>/dev/null || true`,
    60_000,
  );
  const [first = '', ...rest] = result.stdout.split('\n');
  const match = /^DONE (\d+)/.exec(first);
  return {
    done: match !== null,
    exitCode: match ? Number(match[1]) : null,
    tail: rest.join('\n').trim(),
  };
}

/** Polls a detached script until it ends or `timeoutMs` passes. Each look is one short exec. */
export async function waitDetached(
  api: NaiveApi,
  computerId: string,
  dir: string,
  name: string,
  {
    timeoutMs,
    intervalMs = 15_000,
    onTail,
  }: { timeoutMs: number; intervalMs?: number; onTail?: (tail: string) => void },
): Promise<DetachedState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await pollDetached(api, computerId, dir, name);
    onTail?.(state.tail);
    if (state.done) return state;
    if (Date.now() > deadline) throw new Error(`${name} on ${computerId} did not finish in time.`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export function pauseComputer(api: NaiveApi, computerId: string): Promise<Computer> {
  return api.request<Computer>('POST', `/v1/computers/${id(computerId)}/pause`, {});
}

/** Needs a balance that covers one 10-minute block, or Naive answers 402 insufficient_credits. */
export function resumeComputer(api: NaiveApi, computerId: string): Promise<Computer> {
  return api.request<Computer>('POST', `/v1/computers/${id(computerId)}/resume`, {});
}

/** A snapshot of the disk, not memory. It outlives the computer. */
export function checkpointComputer(
  api: NaiveApi,
  computerId: string,
): Promise<{ snapshot_id: string; computer_id: string; created_at: string }> {
  return api.request('POST', `/v1/computers/${id(computerId)}/snapshot`, {});
}

/** Destroys a computer. One that is already gone counts as destroyed. */
export async function destroyComputer(api: NaiveApi, computerId: string): Promise<void> {
  try {
    await api.request('DELETE', `/v1/computers/${id(computerId)}`);
  } catch (error) {
    if (error instanceof NaiveApiError && error.status === 404) return;
    throw error;
  }
}

/**
 * Deletes a snapshot. One that is already gone counts as deleted. Naive answers 409 state_conflict
 * while a live computer was restored from it: destroy that computer first, and retry later.
 */
export async function deleteSnapshot(api: NaiveApi, snapshotId: string): Promise<void> {
  try {
    await api.request('DELETE', `/v1/snapshots/${id(snapshotId)}`);
  } catch (error) {
    if (error instanceof NaiveApiError && error.status === 404) return;
    throw error;
  }
}
