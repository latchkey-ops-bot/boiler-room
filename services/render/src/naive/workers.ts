/**
 * Renders each chunk on its own Naive computer. A worker is a fork of the base snapshot when there
 * is one, or a clean computer that sets itself up. It fetches the payload, renders its frames,
 * sends the chunk back and is destroyed at once, so it bills no longer than its chunk takes. A chunk
 * that fails is rendered again, once, on a new computer, unless motion refused to draw it: copy that
 * does not fit is refused the same way on every computer, so it is never tried twice.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { layoutRefusals } from '@boiler-room/motion';
import type { Chunk } from '../chunks.ts';
import type { ComputerSize } from '../cost.ts';
import { CostLimitExceeded } from '../cost.ts';
import { chunkJob, type JobSpec, parseWorkerLine } from '../jobs.ts';
import type { ChunkAttempt, ChunkRecord } from '../manifest.ts';
import { type BaseRecord, checkReady, RENDER_DIR, setUp, snapshotBase } from './base.ts';
import type { Naive } from './client.ts';
import { scrub } from './client.ts';
import {
  Aborted,
  type CommandResult,
  failure,
  MAX_COMMAND_MS,
  outputOf,
  runCommand,
  withRetry,
} from './exec.ts';
import type { ComputerPool, ComputerRecord } from './pool.ts';
import { fetchOntoComputer, sendFromComputer } from './transfer.ts';

export interface WorkerContext {
  client: Naive;
  pool: ComputerPool;
  size: ComputerSize;
  /** The base to fork. `undefined` makes each worker set itself up. */
  base: BaseRecord | undefined;
  /** When set, the first worker to finish its setup is snapshotted and recorded as the base. */
  buildBase: boolean;
  /** The snapshot of the first set-up worker, once one has started it. */
  baseBuild?: Promise<BaseRecord | undefined>;
  payloadFileId: string;
  spec: JobSpec;
  workDir: string;
  /** Naive files this run made, deleted when it ends. */
  files: string[];
  log: (line: string) => void;
  signal: AbortSignal;
  /** Destroys this chunk's first computer once it starts rendering, to exercise the retry. */
  simulateFailure?: { chunk: number } | undefined;
}

const JOB_DIR = `${RENDER_DIR}/job`;
export const MAX_ATTEMPTS = 2;

const seconds = (from: number) => (performance.now() - from) / 1000;

function describe(error: unknown): string {
  return scrub(error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

/**
 * motion refused to draw a chunk: its copy does not fit at its cap height. Every computer refuses
 * it the same way, so it is not tried again, and the run does not stop the other chunks for it, so
 * one failure names every scene to shorten. `refusals` are the refusal lines, read from the whole
 * output of the render, not from its clipped tail.
 */
export class MotionRefused extends Error {
  readonly refusals: string[];

  constructor(refusals: readonly string[], context = '') {
    super(
      `motion refused to draw the film (${refusals.length} refusal(s))${context ? `; ${context}` : ''}:\n${refusals.join('\n')}`,
    );
    this.name = 'MotionRefused';
    this.refusals = [...refusals];
  }
}

/** The refusals in a failed render command's output, or a refusal it passed through. */
export function refusalsIn(error: unknown): string[] {
  if (error instanceof MotionRefused) return error.refusals;
  return layoutRefusals(error instanceof Error ? error.message : String(error));
}

async function attemptChunk(
  context: WorkerContext,
  chunk: Chunk,
  attempt: number,
): Promise<{
  attempt: ChunkAttempt;
  file?: string;
  bytes?: number;
  sha256?: string;
  refused?: MotionRefused;
}> {
  const { client, pool, log, signal } = context;
  const label = `chunk ${chunk.index + 1} (frames ${chunk.frameRange[0]}-${chunk.frameRange[1]})`;
  const started = performance.now();
  const record: ChunkAttempt = {
    attempt,
    computerId: null,
    fromSnapshot: false,
    startedAt: new Date().toISOString(),
    provisionSeconds: null,
    readySeconds: null,
    fetchSeconds: null,
    renderSeconds: null,
    renderWallSeconds: null,
    returnSeconds: null,
    totalSeconds: 0,
    ok: false,
    error: null,
  };
  const role = `chunk${chunk.index + 1}-try${attempt}`;
  let computerId: string | undefined;
  try {
    // A retry forks the base this run built, once it exists, rather than setting up again.
    const base = context.base ?? (context.baseBuild ? await context.baseBuild : undefined);
    let fromSnapshot = base !== undefined;
    let computer: ComputerRecord;
    try {
      computer = await pool.create(role, context.size, base?.snapshotId ?? null, signal);
    } catch (error) {
      if (!fromSnapshot || error instanceof Aborted || error instanceof CostLimitExceeded)
        throw error;
      log(
        `${label}: a fork of the base was refused (${describe(error)}); setting up a clean computer`,
      );
      fromSnapshot = false;
      computer = await pool.create(role, context.size, null, signal);
    }
    computerId = computer.id;
    record.computerId = computer.id;
    await pool.waitRunning(computer, signal);
    record.provisionSeconds = seconds(started);
    // The fs calls name the home as Naive reports it, and map it to the shell's own home, which
    // can be another directory. Paths a program on the computer opens use the shell's.
    const { home } = await withRetry(() => client.computers.inspect(computer.id), { signal });
    if (!home) throw new Error(`Computer ${computer.id} reports no home directory.`);
    const shellHome = (
      await runCommand(client, computer.id, 'printf %s "$HOME"', { timeoutMs: 30_000, signal })
    ).stdout.trim();
    if (!shellHome.startsWith('/')) throw new Error(`Computer ${computer.id} has no $HOME.`);

    if (fromSnapshot) {
      try {
        await checkReady(client, computer.id, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        log(`${label}: the fork was not ready (${describe(error)}); setting it up`);
        fromSnapshot = false;
      }
    }
    if (!fromSnapshot) {
      const setupSeconds = await setUp(client, computer.id, home, { signal });
      log(`${label}: set up in ${setupSeconds.toFixed(1)} s on ${computer.id}`);
      if (context.buildBase && !context.baseBuild) {
        // Taken before any campaign file reaches the computer, so the snapshot holds only the setup.
        context.baseBuild = snapshotBase(client, computer.id, context.size, setupSeconds).then(
          (built) => {
            log(`${label}: snapshotted the set-up computer as ${built.snapshotId} for later runs`);
            return built;
          },
          (error: unknown) => {
            log(
              `${label}: could not snapshot the base (${describe(error)}); later runs set up again`,
            );
            return undefined;
          },
        );
        await context.baseBuild;
      }
    }
    record.fromSnapshot = fromSnapshot;
    record.readySeconds = (performance.now() - started) / 1000;
    computer.readySeconds = record.readySeconds;

    const fetching = performance.now();
    await runCommand(
      client,
      computer.id,
      `rm -rf "$HOME/${JOB_DIR}" && mkdir -p "$HOME/${JOB_DIR}"`,
      {
        timeoutMs: 60_000,
        signal,
      },
    );
    await fetchOntoComputer(
      client,
      computer.id,
      home,
      context.payloadFileId,
      `${JOB_DIR}/payload.tgz`,
      signal,
    );
    await runCommand(
      client,
      computer.id,
      `cd "$HOME/${JOB_DIR}" && tar -xzf payload.tgz && rm payload.tgz`,
      { timeoutMs: 120_000, signal },
    );
    const job = chunkJob(
      context.spec,
      `${shellHome}/${JOB_DIR}/bundle`,
      chunk.frameRange,
      `${shellHome}/${JOB_DIR}/chunk.ts`,
    );
    await withRetry(
      () =>
        client.computers.fs(computer.id, 'write', {
          path: `${home}/${JOB_DIR}/job.json`,
          content: JSON.stringify(job),
        }),
      { signal },
    );
    record.fetchSeconds = seconds(fetching);

    const rendering = performance.now();
    let sabotaged = false;
    // The bytes of the finished chunk, which the worker reports once its file is written and closed.
    let finished: number | undefined;
    let outcome: CommandResult | undefined;
    try {
      outcome = await runCommand(
        client,
        computer.id,
        `cd "$HOME/${JOB_DIR}" && node worker.ts job.json`,
        {
          timeoutMs: MAX_COMMAND_MS,
          signal,
          check: false,
          onLine: (line) => {
            const message = parseWorkerLine(line);
            if (message?.type === 'done') {
              record.renderSeconds = message.seconds;
              finished = message.bytes;
            }
            if (message?.type !== 'progress') return;
            log(
              `${label}: ${message.renderedFrames}/${chunk.frames} frames rendered, ${message.encodedFrames} encoded`,
            );
            if (
              !sabotaged &&
              attempt === 1 &&
              context.simulateFailure?.chunk === chunk.index &&
              message.renderedFrames > 0
            ) {
              sabotaged = true;
              log(
                `${label}: destroying ${computer.id} mid-render, as asked, to exercise the retry`,
              );
              void pool.destroy(computer.id);
            }
          },
        },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      if (finished === undefined) {
        const printed = outputOf(error);
        const refusals = printed ? layoutRefusals(`${printed.stderr}\n${printed.stdout}`) : [];
        if (refusals.length > 0) throw new MotionRefused(refusals, `${label} on ${computer.id}`);
        throw error;
      }
      // A stream that drops after the worker reported its chunk lost only the exit status.
      log(`${label}: the command stream broke after the chunk was done (${describe(error)})`);
    }
    const failed = outcome?.exited
      ? outcome.exitCode !== 0 || outcome.timedOut
      : finished === undefined;
    if (failed && outcome) {
      // Read from all the output the stream kept, since the error's text is cut to its tail.
      const refusals = layoutRefusals(`${outcome.stderr}\n${outcome.stdout}`);
      if (refusals.length > 0) throw new MotionRefused(refusals, `${label} on ${computer.id}`);
      throw failure(computer.id, outcome);
    }
    if (!outcome?.exited) {
      if (finished === undefined) throw new Error('The render command was lost.');
      // Naive sometimes ends a stream without its exit frame. The worker reports `done` only once
      // the chunk is written and closed, and the chunk is checked against the size and SHA-256
      // measured on the computer as it comes back, so it is fetched rather than rendered again.
      log(
        `${label}: the stream ended without an exit status after the chunk was done; fetching it`,
      );
    }
    record.renderWallSeconds = seconds(rendering);

    const returning = performance.now();
    const sent = await sendFromComputer(
      client,
      computer.id,
      home,
      `${JOB_DIR}/chunk.ts`,
      `boiler-room-${pool.prefix}-chunk-${chunk.index + 1}.ts`,
      'video/mp2t',
      signal,
    );
    context.files.push(sent.fileId);
    if (finished !== undefined && sent.bytes !== finished) {
      throw new Error(
        `Chunk ${chunk.index + 1} came back as ${sent.bytes} bytes, but the worker wrote ${finished}.`,
      );
    }
    const file = path.join(context.workDir, `chunk-${String(chunk.index).padStart(3, '0')}.ts`);
    await writeFile(file, sent.content);
    record.returnSeconds = seconds(returning);
    record.ok = true;
    return { attempt: record, file, bytes: sent.bytes, sha256: sent.sha256 };
  } catch (error) {
    record.error = describe(error);
    if (error instanceof Aborted || error instanceof CostLimitExceeded || signal.aborted)
      throw error;
    return { attempt: record, ...(error instanceof MotionRefused ? { refused: error } : {}) };
  } finally {
    record.totalSeconds = seconds(started);
    if (computerId) await pool.destroy(computerId);
  }
}

export interface RenderedChunk extends ChunkRecord {
  file: string;
}

/**
 * The error for a chunk that failed on every computer it was given. It names what each try met,
 * since the first try's cause, such as a refusal, is often the one that matters, and a later try
 * can fail on something else, such as a dropped stream.
 */
export function chunkFailed(chunk: Pick<Chunk, 'index'>, attempts: readonly ChunkAttempt[]): Error {
  const errors = attempts.map(
    ({ attempt, error }) => `try ${attempt}: ${error ?? 'no error recorded'}`,
  );
  return new Error(
    `Chunk ${chunk.index + 1} failed on ${attempts.length} computer(s): ${errors.join('\n')}`,
  );
}

/**
 * Renders one chunk, and once more on a new computer if the first try fails for any reason but a
 * refusal. `attempt` is the one try, which a test replaces.
 */
export async function renderChunkOnNaive(
  context: WorkerContext,
  chunk: Chunk,
  attempt: typeof attemptChunk = attemptChunk,
): Promise<RenderedChunk> {
  const record: ChunkRecord = {
    index: chunk.index,
    frameRange: chunk.frameRange,
    frames: chunk.frames,
    bytes: null,
    sha256: null,
    attempts: [],
  };
  for (let tries = 1; tries <= MAX_ATTEMPTS; tries += 1) {
    const result = await attempt(context, chunk, tries);
    record.attempts.push(result.attempt);
    if (result.file) {
      context.log(
        `chunk ${chunk.index + 1}: done on try ${tries} in ${result.attempt.totalSeconds.toFixed(1)} s` +
          ` (render ${result.attempt.renderSeconds?.toFixed(1) ?? '?'} s)`,
      );
      return {
        ...record,
        bytes: result.bytes ?? null,
        sha256: result.sha256 ?? null,
        file: result.file,
      };
    }
    context.log(`chunk ${chunk.index + 1}: try ${tries} failed: ${result.attempt.error}`);
    if (result.refused) {
      context.log(`chunk ${chunk.index + 1}: not tried again: motion refuses this copy everywhere`);
      throw result.refused;
    }
  }
  throw chunkFailed(chunk, record.attempts);
}

/**
 * The one error for a set of chunks of which some failed. A refusal from any chunk wins over
 * every other failure but a stop and the cost limit: the refused copy must be shortened before any
 * render can pass, and the other failures are named in it. Every chunk's refusals are in it, so one
 * route-back to the Director can shorten every scene. `stopped` is why the run was stopped, if it
 * was. Returns undefined when every chunk was rendered.
 */
export function chunksFailure(
  settled: readonly PromiseSettledResult<unknown>[],
  stopped: unknown,
): Error | undefined {
  const reasons = settled.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (reasons.length === 0) return undefined;
  const asError = (reason: unknown) =>
    reason instanceof Error ? reason : new Error(String(reason));
  if (stopped instanceof Aborted || stopped instanceof CostLimitExceeded) return stopped;
  const refusals = [...new Set(reasons.flatMap(refusalsIn))];
  if (refusals.length === 0) return asError(stopped ?? reasons[0]);
  const others = [
    ...new Set(
      reasons
        .filter((reason) => !(reason instanceof MotionRefused) && !(reason instanceof Aborted))
        .map((reason) => describe(reason).split('\n')[0] ?? ''),
    ),
  ].filter(Boolean);
  return new MotionRefused(
    refusals,
    others.length > 0 ? `the run also failed on: ${others.join('; ')}` : '',
  );
}
