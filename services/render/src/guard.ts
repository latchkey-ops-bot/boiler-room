/**
 * Keeps `pnpm render` cleaning up however it is stopped. A run's computers are destroyed only by
 * renderCampaign's `finally`, so anything that ends the process before that runs leaves them
 * billing. The guard turns every way a run can be stopped into an abort, which reaches that
 * `finally`:
 *
 * - Ctrl-C, SIGTERM and Ctrl-\. A second says it is still cleaning up, and only a third leaves.
 * - SIGHUP, from a closed terminal or a dropped SSH session. Node's default is to exit at once.
 * - A closed stdout or stderr, as when output is piped to `head` or a reader goes away. Node's
 *   default is an uncaught EPIPE, which exits at once.
 * - Its parent going away, as when a supervisor that spawned it exits.
 * - An uncaught exception or unhandled rejection anywhere else.
 *
 * Only the presses count towards leaving without cleanup: nobody presses a hangup three times.
 */
import { Aborted } from './naive/exec.ts';

interface Stream {
  on(event: 'error', listener: (error: Error) => void): unknown;
  write(chunk: string): boolean;
}

export interface GuardedProcess {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
  readonly ppid: number;
  readonly stdout: Stream;
  readonly stderr: Stream;
  exitCode?: number | string | null | undefined;
  exit(code?: number): void;
}

export interface GuardOptions {
  proc?: GuardedProcess;
  now?: () => number;
  /** How often to check that the parent is still there. */
  parentPollMs?: number;
  /** What to tell someone who leaves on the third press, about what may be left. */
  leaving?: string;
}

export interface Guard {
  /** Writes a line to stderr, or nothing once stderr is gone. It never throws. */
  log(line: string): void;
  /** Writes to stdout, or nothing once stdout is gone. It never throws. */
  print(text: string): void;
  dispose(): void;
}

/** Copies of one Ctrl-C reach the process from the terminal and from each parent, close together. */
const SAME_PRESS_MS = 1500;
const PRESSES = ['SIGINT', 'SIGTERM', 'SIGQUIT'] as const;

export function guardRun(controller: AbortController, options: GuardOptions = {}): Guard {
  const proc = options.proc ?? (process as unknown as GuardedProcess);
  const now = options.now ?? Date.now;
  const closed = { stdout: false, stderr: false };

  const write = (stream: 'stdout' | 'stderr', text: string) => {
    if (closed[stream]) return;
    try {
      proc[stream].write(text);
    } catch {
      closed[stream] = true;
      stop(`${stream} closed`);
    }
  };
  const log = (line: string) => write('stderr', `${line}\n`);

  function stop(reason: string) {
    if (controller.signal.aborted) return;
    log(`\n${reason}: stopping, and destroying every computer of this run. Wait for it.`);
    controller.abort(new Aborted(`Stopped: ${reason}.`));
  }

  let presses = 0;
  let lastPress = Number.NEGATIVE_INFINITY;
  const press = (signal: string) => {
    const at = now();
    if (at - lastPress < SAME_PRESS_MS) return;
    lastPress = at;
    presses += 1;
    if (presses === 1) stop(signal);
    else if (presses === 2) {
      log('Still destroying computers. Press Ctrl-C again to leave without waiting.');
    } else {
      log(
        `Leaving without confirming. ${options.leaving ?? 'Run `pnpm render --reap --run <run id>`, with the run id logged at the start, to destroy what is left.'}`,
      );
      proc.exit(130);
    }
  };

  const listeners: [string, (...args: unknown[]) => void][] = [
    ...PRESSES.map((signal): [string, () => void] => [signal, () => press(signal)]),
    ['SIGHUP', () => stop('SIGHUP, the terminal closed')],
    [
      'uncaughtException',
      (error: unknown) => {
        proc.exitCode = 1;
        log(error instanceof Error ? (error.stack ?? error.message) : String(error));
        stop('an uncaught error');
      },
    ],
    [
      'unhandledRejection',
      (reason: unknown) => {
        proc.exitCode = 1;
        log(reason instanceof Error ? (reason.stack ?? reason.message) : String(reason));
        stop('an unhandled rejection');
      },
    ],
  ];
  for (const [event, listener] of listeners) proc.on(event, listener);
  for (const stream of ['stdout', 'stderr'] as const) {
    proc[stream].on('error', () => {
      closed[stream] = true;
      stop(`${stream} closed`);
    });
  }

  const parent = proc.ppid;
  const watch = setInterval(() => {
    if (proc.ppid === parent) return;
    clearInterval(watch);
    stop('its parent process exited');
  }, options.parentPollMs ?? 1000);
  watch.unref?.();

  return {
    log,
    print: (text) => write('stdout', text),
    dispose: () => {
      clearInterval(watch);
      for (const [event, listener] of listeners) proc.removeListener(event, listener);
    },
  };
}
