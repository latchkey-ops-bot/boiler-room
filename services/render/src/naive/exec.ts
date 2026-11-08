/**
 * Runs commands on a Naive computer and retries API calls that are safe to repeat.
 *
 * Commands are streamed. A plain `exec` answers only when the command exits, and an ordinary fetch
 * is cut at 300 s, so anything that can take long runs through `execStream`, which receives output
 * as it is printed. Every long command here prints at least every 30 s for that reason.
 */
import type { Naive } from './client.ts';
import { scrub } from './client.ts';

/** The longest one command may run, which is Naive's own ceiling for `exec`. */
export const MAX_COMMAND_MS = 600_000;

export class CommandFailed extends Error {
  readonly computerId: string;
  readonly exitCode: number;
  readonly timedOut: boolean;

  constructor(computerId: string, exitCode: number, timedOut: boolean, output: string) {
    super(
      `A command on ${computerId} ${timedOut ? 'timed out' : `exited with ${exitCode}`}:\n${scrub(output)}`,
    );
    this.name = 'CommandFailed';
    this.computerId = computerId;
    this.exitCode = exitCode;
    this.timedOut = timedOut;
  }
}

export class Aborted extends Error {
  constructor(reason = 'The render was stopped.') {
    super(reason);
    this.name = 'Aborted';
  }
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  /** -1 when the command's status is not known: the stream had no exit frame, or a null code. */
  exitCode: number;
  /**
   * False when the command's status is not known. Naive ends some streams without an exit frame,
   * and ends others with an exit frame whose `exit_code` is null, seen on renders that had printed
   * `done` and on renders that had failed alike, so neither says how the command ended.
   */
  exited: boolean;
  timedOut: boolean;
  durationMs: number;
}

export interface CommandOptions {
  timeoutMs?: number;
  /** Each line of stdout as it arrives. */
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  /** Throw `CommandFailed` on a non-zero exit. Defaults to true. */
  check?: boolean;
}

const TAIL = 64 * 1024;
const keepTail = (text: string) => (text.length > TAIL ? text.slice(-TAIL) : text);

/** A promise that rejects once `signal` aborts, for racing against work that cannot be cancelled. */
export function whenAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) reject(new Aborted());
    signal.addEventListener('abort', () => reject(new Aborted()), { once: true });
  });
}

export async function runCommand(
  client: Naive,
  computerId: string,
  command: string,
  { timeoutMs = 120_000, onLine, signal, check = true }: CommandOptions = {},
): Promise<CommandResult> {
  signal?.throwIfAborted();
  const started = performance.now();
  let stdout = '';
  let stderr = '';
  let pending = '';
  let exit: { exit_code: number | null; timed_out?: boolean } | undefined;
  const frames = client.computers.execStream(computerId, command, {
    timeoutMs: Math.min(timeoutMs, MAX_COMMAND_MS),
  });
  const aborted = whenAborted(signal);
  aborted.catch(() => undefined);
  try {
    for (;;) {
      const next = await Promise.race([frames.next(), aborted]);
      if (next.done) break;
      const frame = next.value;
      if ('stdout' in frame) {
        stdout = keepTail(stdout + frame.stdout);
        if (onLine) {
          pending += frame.stdout;
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          for (const line of lines) onLine(line);
        }
      } else if ('stderr' in frame) {
        stderr = keepTail(stderr + frame.stderr);
      } else if ('exit' in frame) {
        exit = frame.exit;
      }
    }
  } catch (error) {
    // What the command printed before its stream broke can say why it failed.
    if (error instanceof Error && !(error instanceof Aborted)) {
      Object.assign(error, { output: { stdout, stderr } });
    }
    throw error;
  } finally {
    if (signal?.aborted) void frames.return(undefined).catch(() => undefined);
  }
  if (onLine && pending) onLine(pending);
  const result: CommandResult = {
    stdout,
    stderr,
    exitCode: exit?.exit_code ?? -1,
    exited: exit !== undefined && exit.exit_code !== null,
    timedOut: exit?.timed_out ?? false,
    durationMs: performance.now() - started,
  };
  if (check && (result.exitCode !== 0 || result.timedOut)) throw failure(computerId, result);
  return result;
}

/** What a command printed before its stream broke, as `runCommand` attaches it to the error. */
export function outputOf(error: unknown): { stdout: string; stderr: string } | undefined {
  const output = (error as { output?: { stdout?: unknown; stderr?: unknown } } | null)?.output;
  return typeof output?.stdout === 'string' && typeof output.stderr === 'string'
    ? { stdout: output.stdout, stderr: output.stderr }
    : undefined;
}

/** The error for a command that did not exit 0, with the tail of what it printed. */
export const failure = (computerId: string, result: CommandResult): CommandFailed =>
  new CommandFailed(
    computerId,
    result.exitCode,
    result.timedOut,
    `${result.stdout.slice(-4000)}\n${result.stderr.slice(-4000)}`.trim(),
  );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : undefined;

/** Whether an API error is worth another try: rate limits, server errors and a dropped connection. */
export function isTransient(error: unknown): boolean {
  const status = statusOf(error);
  if (status === undefined) return error instanceof TypeError; // fetch failed
  return status === 429 || status >= 500;
}

/** Retries a call that is safe to repeat, such as a read, or a write with an idempotency key. */
export async function withRetry<T>(
  call: () => Promise<T>,
  { attempts = 4, signal }: { attempts?: number; signal?: AbortSignal } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await call();
    } catch (error) {
      if (attempt >= attempts || !isTransient(error)) throw error;
      await sleep(500 * 2 ** attempt);
    }
  }
}
