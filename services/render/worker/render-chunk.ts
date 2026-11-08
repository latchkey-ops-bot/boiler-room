/**
 * Renders one chunk of a film, or the whole film, on whichever machine runs it. It is shipped in the
 * payload beside the bundle and run with plain `node`, so it uses only erasable TypeScript.
 *
 *   node worker.ts job.json
 *
 * Progress goes to stdout as one JSON object per line, at least every few seconds, which keeps a
 * streamed `exec` from going quiet. Every chunk of one film is rendered with the same options, as
 * Remotion's distributed rendering requires, because they all come from the one job builder.
 */
import { readFileSync, statSync } from 'node:fs';
import type { Codec } from '@remotion/renderer';
import type { VideoConfig } from 'remotion';

export interface WorkerJob {
  serveUrl: string;
  /** As `selectComposition` returned it on the machine that planned the film. */
  composition: VideoConfig;
  inputProps: Record<string, unknown>;
  /** `h264-ts` for a chunk, `h264` for a whole film. */
  codec: Extract<Codec, 'h264' | 'h264-ts'>;
  /** Inclusive. `null` renders the whole film. */
  frameRange: [number, number] | null;
  output: string;
  jpegQuality: number;
  /** `null` is Remotion's default for the machine. */
  concurrency: number | null;
}

const job = JSON.parse(readFileSync(process.argv[2] as string, 'utf8')) as WorkerJob;
const say = (message: Record<string, unknown>) => console.log(JSON.stringify(message));

// A heartbeat from the first moment, through loading the renderer, the browser and the first
// frames, before progress is reported. On a fresh fork of the base snapshot that took about 45 s
// with nothing printed, and Naive then ended the stream with exit code -1 even when the chunk was
// done, so the renderer is imported only once the heartbeat runs.
const heartbeat = setInterval(() => say({ type: 'alive' }), 5000);
say({ type: 'alive' });
let started = performance.now();
let lastReport = 0;
try {
  const { ensureBrowser, renderMedia } = await import('@remotion/renderer');
  await ensureBrowser();
  // `seconds` stays the render's own time, from once the browser is there.
  started = performance.now();
  await renderMedia({
    serveUrl: job.serveUrl,
    composition: job.composition,
    inputProps: job.inputProps,
    codec: job.codec,
    outputLocation: job.output,
    ...(job.frameRange ? { frameRange: job.frameRange } : {}),
    // Remotion's distributed rendering: the whole film is the range, so every chunk starts at 0.
    compositionStart: 0,
    // Routine renders are silent. `muted` wins over `enforceAudioTrack`, which chunks still set.
    muted: true,
    enforceAudioTrack: job.codec === 'h264-ts',
    numberOfGifLoops: null,
    imageFormat: 'jpeg',
    jpegQuality: job.jpegQuality,
    chromiumOptions: { gl: 'swangle' },
    concurrency: job.concurrency,
    logLevel: 'warn',
    onProgress: ({ renderedFrames, encodedFrames, progress }) => {
      const now = performance.now();
      if (now - lastReport < 2000 && progress < 1) return;
      lastReport = now;
      say({ type: 'progress', renderedFrames, encodedFrames, progress });
    },
  });
} finally {
  clearInterval(heartbeat);
}
say({
  type: 'done',
  seconds: (performance.now() - started) / 1000,
  bytes: statSync(job.output).size,
});
