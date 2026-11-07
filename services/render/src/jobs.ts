/**
 * The one place a worker job is built, so every chunk, and the full render a seam check compares
 * against, are rendered with the same options. Also runs the worker on this machine.
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import type { VideoConfig } from 'remotion';
import type { WorkerJob } from '../worker/render-chunk.ts';
import { WORKER_SOURCE } from './bundle.ts';
import type { FrameRange } from './chunks.ts';

/** Matches `packages/motion/remotion.config.ts`, so a film looks as it does from `pnpm render` there. */
export const JPEG_QUALITY = 90;

export interface JobSpec {
  composition: VideoConfig;
  inputProps: Record<string, unknown>;
  concurrency: number | null;
}

export function chunkJob(
  spec: JobSpec,
  serveUrl: string,
  frameRange: FrameRange | null,
  output: string,
): WorkerJob {
  return {
    serveUrl,
    composition: spec.composition,
    inputProps: spec.inputProps,
    codec: frameRange ? 'h264-ts' : 'h264',
    frameRange,
    output,
    jpegQuality: JPEG_QUALITY,
    concurrency: spec.concurrency,
  };
}

/** A line the worker prints. Anything that is not one of its JSON lines is passed through as text. */
export type WorkerMessage =
  | { type: 'alive' }
  | { type: 'progress'; renderedFrames: number; encodedFrames: number; progress: number }
  | { type: 'done'; seconds: number; bytes: number };

export function parseWorkerLine(line: string): WorkerMessage | undefined {
  if (!line.startsWith('{')) return undefined;
  try {
    const message = JSON.parse(line) as { type?: unknown };
    if (message.type === 'alive' || message.type === 'progress' || message.type === 'done') {
      return message as WorkerMessage;
    }
  } catch {
    // Not one of the worker's lines.
  }
  return undefined;
}

/** Runs the worker here, as a child process. Returns the seconds the worker measured. */
export async function runWorkerHere(
  job: WorkerJob,
  jobFile: string,
  onMessage: (message: WorkerMessage) => void = () => undefined,
  signal?: AbortSignal,
): Promise<number> {
  await writeFile(jobFile, JSON.stringify(job));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER_SOURCE, jobFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(signal ? { signal } : {}),
    });
    let seconds: number | undefined;
    let pending = '';
    let errors = '';
    child.stdout.on('data', (data: Buffer) => {
      pending += data.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const message = parseWorkerLine(line);
        if (!message) continue;
        if (message.type === 'done') seconds = message.seconds;
        onMessage(message);
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      errors = (errors + data.toString('utf8')).slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && seconds !== undefined) resolve(seconds);
      else reject(new Error(`The worker exited with ${code}: ${errors}`));
    });
  });
}
