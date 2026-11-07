/**
 * `renderCampaign()`: a validated campaign in, one MP4 out, with a manifest and the quality
 * artifacts beside it. The frames are split into chunks, each rendered on its own Naive computer,
 * and stitched with Remotion's `combineChunks`. Every computer is destroyed when the run ends, by
 * success, failure or abort, and the run refuses to start when its estimate is over the cost limit.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FORMAT_SIZES, type Format } from '@boiler-room/motion';
import { sceneFrames } from '@boiler-room/schema';
import { combineChunks, ensureBrowser, selectComposition } from '@remotion/renderer';
import { packBundle } from './bundle.ts';
import { type ChunkPlan, splitFrames } from './chunks.ts';
import {
  type ComputerSize,
  type CostEstimate,
  CostLimitExceeded,
  DEFAULT_TIME_MODEL,
  estimateCost,
  type TimeModel,
  WORKER_SIZE,
} from './cost.ts';
import { gateCampaign } from './gate.ts';
import { chunkJob, type JobSpec, JPEG_QUALITY, runWorkerHere } from './jobs.ts';
import { type ChunkRecord, canonicalJson, type Manifest, sha256 } from './manifest.ts';
import { type BaseRecord, findBase, fitsBase, RECIPE_HASH } from './naive/base.ts';
import { type Naive, naiveClient, scrub } from './naive/client.ts';
import { Aborted, withRetry } from './naive/exec.ts';
import { ComputerPool } from './naive/pool.ts';
import { FS_WRITE_LIMIT, uploadBytes } from './naive/transfer.ts';
import { type RenderedChunk, renderChunkOnNaive, type WorkerContext } from './naive/workers.ts';
import { planQuality, writeQualityArtifacts } from './quality.ts';
import { checkFilm, compareSeams } from './verify.ts';
import { REMOTION_VERSION, templateVersion } from './versions.ts';

export interface RenderCampaignOptions {
  /** Path to `campaign.json`. Its assets are read relative to it. */
  campaignFile: string;
  format?: Format;
  hookId?: string;
  ctaId?: string;
  /** Computers to split the frames across. Default 4. */
  workers?: number;
  /** The MP4 to write. The manifest and quality folder go beside it. */
  output?: string;
  /** The run refuses to start when its estimate is over this, and stops before it would spend more. */
  maxCostUsd?: number;
  /** `naive` renders each chunk on its own computer. `local` renders the chunks here, for development. */
  runner?: 'naive' | 'local';
  /** `auto` forks the recorded base snapshot, or builds one. `off` sets every computer up from clean. */
  snapshot?: 'auto' | 'off' | 'rebuild';
  /** Also render the whole film here and compare the frames at every seam with it. */
  verifySeams?: boolean;
  /** Write the contact sheet, transition stills and phone sheet. Default true. */
  quality?: boolean;
  /** Remotion's concurrency on each computer. `null` is its default. */
  concurrency?: number | null;
  workerSize?: ComputerSize;
  timeModel?: TimeModel;
  /** Stops the run. Every computer is destroyed before `renderCampaign` settles. */
  signal?: AbortSignal;
  log?: (line: string) => void;
  /** Destroys this chunk's first computer mid-render, to show that it is rendered again. */
  simulateFailure?: { chunk: number };
  /** Validate, bundle, select the film and estimate, without creating a computer. */
  dryRun?: boolean;
  /** Keep the working folder of chunks and frames, for debugging. */
  keepWork?: boolean;
}

export interface RenderCampaignResult {
  output: string;
  manifestFile: string;
  manifest: Manifest;
}

export interface DryRunResult {
  dryRun: true;
  estimate: CostEstimate | null;
  plan: ChunkPlan;
  durationInFrames: number;
  base: 'snapshot' | 'cold' | null;
}

export const DEFAULT_MAX_COST_USD = 2;
export const DEFAULT_WORKERS = 4;

const formatSlug = (format: Format) => format.replace(':', 'x');

function defaultOutput(campaignId: string, format: Format, hookId?: string, ctaId?: string) {
  const name = [campaignId, formatSlug(format), hookId, ctaId].filter(Boolean).join('-');
  const base = process.env.INIT_CWD ?? process.cwd();
  return path.resolve(base, 'out', 'renders', name, `${name}.mp4`);
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').toLowerCase();

async function ledgerUsd(client: Naive, ids: string[], since: string): Promise<number | null> {
  if (ids.length === 0) return 0;
  try {
    const wanted = new Set(ids);
    let total = 0;
    let after: string | undefined;
    // The org's other work books entries too, so this reads every entry since the run began. A
    // ledger too long to read in full gives no figure rather than a short one.
    for (let page = 0; page < 200; page += 1) {
      const result = await withRetry(() =>
        client.credits.ledger({ from: since, limit: 100, ...(after ? { after } : {}) }),
      );
      for (const entry of result.data) {
        if (!entry.resource_id || !wanted.has(entry.resource_id)) continue;
        for (const item of entry.line_items) {
          if (item.tier === 'computer') total += -item.amount_micro_usd;
        }
      }
      if (!result.has_more || !result.next_cursor) return total / 1e6;
      after = result.next_cursor;
    }
    return null;
  } catch {
    return null;
  }
}

export async function renderCampaign(
  options: RenderCampaignOptions & { dryRun: true },
): Promise<DryRunResult>;
export async function renderCampaign(options: RenderCampaignOptions): Promise<RenderCampaignResult>;
export async function renderCampaign(
  options: RenderCampaignOptions,
): Promise<RenderCampaignResult | DryRunResult> {
  const startedAt = new Date();
  const clock = performance.now();
  const timings: Record<string, number> = {};
  const lap = (name: string, from: number) => {
    timings[name] = Number(((performance.now() - from) / 1000).toFixed(3));
  };
  const log = options.log ?? ((line: string) => console.error(line));
  const format = options.format ?? '16:9';
  const runner = options.runner ?? 'naive';
  const limitUsd = options.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  const workerSize = options.workerSize ?? WORKER_SIZE;
  const controller = new AbortController();
  const outer = options.signal;
  const stop = (reason: Error) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  if (outer?.aborted) throw new Aborted();
  outer?.addEventListener('abort', () => stop(new Aborted()), { once: true });
  const signal = controller.signal;
  const warnings: string[] = [];

  // 1. The gate, before anything else happens.
  let step = performance.now();
  const campaignFile = path.resolve(process.env.INIT_CWD ?? process.cwd(), options.campaignFile);
  const fileBytes = await readFile(campaignFile);
  let input: unknown;
  try {
    input = JSON.parse(fileBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${campaignFile} is not JSON: ${(error as Error).message}`);
  }
  const selection = {
    ...(options.hookId ? { hookId: options.hookId } : {}),
    ...(options.ctaId ? { ctaId: options.ctaId } : {}),
  };
  const gated = await gateCampaign(input, { format, ...selection });
  for (const issue of gated.warnings)
    warnings.push(`${issue.code} at ${issue.path}: ${issue.message}`);
  const frames = sceneFrames(gated.cut);
  const size = FORMAT_SIZES[format];
  const plan = splitFrames(frames.durationInFrames, options.workers ?? DEFAULT_WORKERS);
  lap('validate', step);
  log(
    `${gated.campaign.id}: ${frames.durationInFrames} frames at ${frames.fps} fps, ${size.width}×${size.height}, ` +
      `${plan.chunks.length} chunk(s) of ${plan.framesPerChunk}`,
  );

  // 2. What the run would cost, and whether it may start.
  let client: Naive | undefined;
  let base: BaseRecord | undefined;
  let estimate: CostEstimate | null = null;
  const snapshotMode = options.snapshot ?? 'auto';
  if (runner === 'naive') {
    client = naiveClient();
    if (snapshotMode === 'auto') {
      try {
        base = await findBase(client, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        warnings.push(
          `Could not look up the base snapshot (${scrub(String(error))}); setting up from clean.`,
        );
      }
      if (base && !fitsBase(workerSize, base)) {
        warnings.push(
          `The base snapshot was taken on a larger computer than ${workerSize.vcpu} vCPU; setting up from clean.`,
        );
        base = undefined;
      }
    }
    estimate = estimateCost({
      durationInFrames: frames.durationInFrames,
      width: size.width,
      height: size.height,
      chunks: plan.chunks.length,
      framesPerChunk: plan.framesPerChunk,
      base: base ? 'snapshot' : 'cold',
      worker: workerSize,
      timeModel: options.timeModel ?? DEFAULT_TIME_MODEL,
    });
    log(
      `estimate: $${estimate.expectedUsd.toFixed(4)} expected, at most $${estimate.maxUsd.toFixed(4)} ` +
        `(limit $${limitUsd.toFixed(2)}), ${base ? `forking ${base.snapshotId}` : 'setting up from clean'}`,
    );
    if (estimate.maxUsd > limitUsd) {
      throw new CostLimitExceeded(limitUsd, estimate.maxUsd, 'The estimate');
    }
  }

  const output = path.resolve(
    process.env.INIT_CWD ?? process.cwd(),
    options.output ?? defaultOutput(gated.campaign.id, format, options.hookId, options.ctaId),
  );
  const outputBase = output.replace(/\.mp4$/i, '');
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'boiler-room-render-'));
  const runId = `${stamp()}-${randomUUID().slice(0, 6)}`;
  const pool = client
    ? new ComputerPool(client, { runId, limitUsd, log, onStop: stop })
    : undefined;
  const naiveFiles: string[] = [];
  let computersLeft: string[] = [];
  let filesDeleted = 0;

  try {
    // 3. Bundle locally, and select the film, which runs calculateMetadata's gate in a browser.
    step = performance.now();
    const packed = await packBundle(gated.campaign, path.dirname(campaignFile), workDir);
    timings.bundle = Number(packed.bundleSeconds.toFixed(3));
    timings.compress = Number(packed.compressSeconds.toFixed(3));
    for (const file of packed.assets.missing) {
      warnings.push(
        `${file} is named by an asset but is not there. A silent film does not use it.`,
      );
    }
    log(
      `bundled in ${packed.bundleSeconds.toFixed(1)} s with ${packed.assets.staged.length} asset file(s), ` +
        `packed to ${(packed.tarballBytes / 2 ** 20).toFixed(2)} MiB`,
    );
    step = performance.now();
    await ensureBrowser({
      onBrowserDownload: () => {
        log('downloading the headless browser this machine needs to select the film');
        return { version: null, onProgress: () => undefined };
      },
    });
    const inputProps: Record<string, unknown> = { campaign: input, format, ...selection };
    const composition = await selectComposition({
      serveUrl: packed.serveUrl,
      id: 'CampaignFilm',
      inputProps,
      chromiumOptions: { gl: 'swangle' },
      logLevel: 'error',
    });
    lap('select', step);
    if (
      composition.durationInFrames !== frames.durationInFrames ||
      composition.fps !== frames.fps ||
      composition.width !== size.width ||
      composition.height !== size.height
    ) {
      throw new Error(
        `The film was planned as ${composition.durationInFrames} frames at ${composition.fps} fps, ` +
          `${composition.width}×${composition.height}, not the ${frames.durationInFrames} frames that sceneFrames gives.`,
      );
    }
    if (options.dryRun) {
      return {
        dryRun: true,
        estimate,
        plan,
        durationInFrames: frames.durationInFrames,
        base: runner === 'naive' ? (base ? 'snapshot' : 'cold') : null,
      };
    }
    const spec: JobSpec = {
      composition,
      inputProps,
      concurrency: options.concurrency ?? null,
    };
    // The job file reaches each computer through one `fs write`, so it is checked before any exists.
    const jobBytes = Buffer.byteLength(JSON.stringify(chunkJob(spec, workDir, [0, 0], workDir)));
    if (runner === 'naive' && jobBytes > FS_WRITE_LIMIT - 64 * 1024) {
      throw new Error(
        `The render job is ${(jobBytes / 2 ** 20).toFixed(1)} MiB, over the 4 MiB a computer's file write takes. ` +
          'Move large data, such as inline data: URLs, out of the campaign into asset files.',
      );
    }

    // 4. Render the chunks.
    step = performance.now();
    let rendered: RenderedChunk[];
    let context: WorkerContext | undefined;
    if (client && pool) {
      const uploading = performance.now();
      const payloadFileId = await uploadBytes(
        client,
        `boiler-room-${runId}-payload.tgz`,
        'application/gzip',
        await readFile(packed.tarball),
        signal,
      );
      naiveFiles.push(payloadFileId);
      lap('upload', uploading);
      context = {
        client,
        pool,
        size: workerSize,
        base,
        buildBase: snapshotMode !== 'off' && !base,
        payloadFileId,
        spec,
        workDir,
        files: naiveFiles,
        log,
        signal,
        simulateFailure: options.simulateFailure,
      };
      const workerContext = context;
      const tasks = plan.chunks.map((chunk) =>
        renderChunkOnNaive(workerContext, chunk).catch((error: unknown) => {
          stop(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }),
      );
      const settled = await Promise.allSettled(tasks);
      const failure = settled.find((result) => result.status === 'rejected');
      if (failure) throw signal.reason instanceof Error ? signal.reason : failure.reason;
      rendered = settled.map((result) => (result as PromiseFulfilledResult<RenderedChunk>).value);
    } else {
      rendered = [];
      for (const chunk of plan.chunks) {
        const file = path.join(workDir, `chunk-${String(chunk.index).padStart(3, '0')}.ts`);
        const began = performance.now();
        const renderSeconds = await runWorkerHere(
          chunkJob(spec, packed.serveUrl, chunk.frameRange, file),
          path.join(workDir, `job-${chunk.index}.json`),
          undefined,
          signal,
        );
        const bytes = await readFile(file);
        const total = (performance.now() - began) / 1000;
        log(`chunk ${chunk.index + 1}: rendered here in ${total.toFixed(1)} s`);
        rendered.push({
          index: chunk.index,
          frameRange: chunk.frameRange,
          frames: chunk.frames,
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
          file,
          attempts: [
            {
              attempt: 1,
              computerId: null,
              fromSnapshot: false,
              startedAt: new Date().toISOString(),
              provisionSeconds: 0,
              readySeconds: 0,
              fetchSeconds: 0,
              renderSeconds,
              renderWallSeconds: total,
              returnSeconds: 0,
              totalSeconds: total,
              ok: true,
              error: null,
            },
          ],
        });
      }
    }
    lap('render', step);

    // Everything below runs here, so stop paying for computers now.
    if (pool) computersLeft = await pool.close();

    // 5. Stitch.
    step = performance.now();
    await mkdir(path.dirname(output), { recursive: true });
    await combineChunks({
      videoFiles: rendered.map(({ file }) => file),
      audioFiles: [],
      outputLocation: output,
      codec: 'h264',
      fps: composition.fps,
      framesPerChunk: plan.framesPerChunk,
      compositionDurationInFrames: composition.durationInFrames,
      preferLossless: false,
      logLevel: 'error',
    });
    lap('stitch', step);

    // 6. Check it.
    step = performance.now();
    const expected = {
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      durationInFrames: composition.durationInFrames,
    };
    const film = await checkFilm(output, expected);
    if (!film.ok) {
      throw new Error(`The stitched film failed its checks: ${JSON.stringify(film, null, 2)}`);
    }
    let seams = null;
    if (options.verifySeams && plan.chunks.length > 1) {
      const reference = path.join(workDir, 'reference.mp4');
      log('rendering the whole film here, to compare the seams with');
      await runWorkerHere(
        chunkJob(spec, packed.serveUrl, null, reference),
        path.join(workDir, 'job-reference.json'),
        undefined,
        signal,
      );
      seams = await compareSeams(output, reference, plan, workDir);
      for (const seam of seams.seams) {
        log(
          `seam ${seam.seam.index + 1} (${seam.seam.before}|${seam.seam.after}): ` +
            `${seam.before.psnr.toFixed(1)} / ${seam.after.psnr.toFixed(1)} dB against the full render, ` +
            `bar ${seams.barPsnr.toFixed(1)} dB, ${seam.aligned ? 'aligned' : 'MISALIGNED'}`,
        );
      }
      if (!seams.ok)
        throw new Error(`A seam differs from the full render: ${JSON.stringify(seams.seams)}`);
    }
    lap('verify', step);

    // 7. What the Quality Check agent looks at.
    step = performance.now();
    const quality =
      options.quality === false
        ? null
        : await writeQualityArtifacts(
            output,
            planQuality(gated.cut),
            size,
            `${outputBase}.quality`,
          );
    lap('quality', step);

    // 8. Clean up Naive, then write the manifest.
    if (client && naiveFiles.length > 0) {
      const deleted = await withRetry(() =>
        (client as Naive).files.deleteMany({ ids: naiveFiles }),
      );
      filesDeleted = deleted.file_ids.length;
      naiveFiles.length = 0;
    }
    const outputBytes = await readFile(output);
    const computers = pool?.records ?? [];
    const computedUsd = pool?.chargedUsd() ?? 0;
    const booked = client
      ? await ledgerUsd(
          client,
          computers.map(({ id }) => id),
          new Date(startedAt.getTime() - 60_000).toISOString(),
        )
      : 0;
    timings.total = Number(((performance.now() - clock) / 1000).toFixed(3));
    const template = templateVersion();
    const built = (await context?.baseBuild) ?? null;
    const manifest: Manifest = {
      manifestVersion: 1,
      runId,
      createdAt: startedAt.toISOString(),
      output: { file: output, bytes: outputBytes.byteLength, sha256: sha256(outputBytes) },
      campaign: {
        id: gated.campaign.id,
        file: campaignFile,
        fileSha256: sha256(fileBytes),
        sha256: sha256(canonicalJson(gated.campaign)),
        cutSha256: sha256(canonicalJson(gated.cut)),
      },
      template: { ...template, bundleSha256: packed.templateSha256, remotion: REMOTION_VERSION },
      settings: {
        format,
        hookId: options.hookId ?? null,
        ctaId: options.ctaId ?? null,
        width: composition.width,
        height: composition.height,
        fps: composition.fps,
        durationInFrames: composition.durationInFrames,
        codec: 'h264',
        chunkCodec: 'h264-ts',
        imageFormat: 'jpeg',
        jpegQuality: JPEG_QUALITY,
        muted: true,
        concurrency: spec.concurrency,
        runner,
        workersRequested: options.workers ?? DEFAULT_WORKERS,
        chunks: plan.chunks.length,
        framesPerChunk: plan.framesPerChunk,
        workerSize: runner === 'naive' ? workerSize : null,
      },
      base:
        runner === 'naive'
          ? {
              mode: rendered.every(({ attempts }) => attempts.at(-1)?.fromSnapshot)
                ? 'snapshot'
                : 'cold',
              snapshotId: base?.snapshotId ?? built?.snapshotId ?? null,
              recipeHash: RECIPE_HASH,
              built,
              coldSetupSeconds: base?.setupSeconds ?? built?.setupSeconds ?? null,
            }
          : null,
      chunks: rendered.map(({ file: _file, ...record }): ChunkRecord => record),
      computers: computers.map(
        ({ createdMs: _created, destroyedMs: _destroyed, ...record }) => record,
      ),
      timings,
      cost: { limitUsd, estimate, computedUsd, ledgerUsd: booked },
      verification: { film, seams },
      quality,
      cleanup: { computersLeft, filesDeleted },
      warnings,
    };
    const manifestFile = `${outputBase}.manifest.json`;
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    if (computersLeft.length > 0) {
      throw new Error(
        `Computers of this run are still live after cleanup: ${computersLeft.join(', ')}`,
      );
    }
    log(
      `wrote ${output} (${(outputBytes.byteLength / 2 ** 20).toFixed(2)} MiB) and ${manifestFile}`,
    );
    return { output, manifestFile, manifest };
  } catch (error) {
    if (error instanceof Error) error.message = scrub(error.message);
    throw error;
  } finally {
    if (pool) {
      try {
        computersLeft = await pool.close();
        if (computersLeft.length > 0) log(`STILL LIVE after cleanup: ${computersLeft.join(', ')}`);
        else log('no computers of this run remain');
      } catch (error) {
        log(`could not confirm the computers were destroyed: ${scrub(String(error))}`);
      }
    }
    if (client && naiveFiles.length > 0) {
      await (client as Naive).files.deleteMany({ ids: naiveFiles }).catch(() => undefined);
    }
    if (!options.keepWork) await rm(workDir, { recursive: true, force: true });
    else log(`kept the working folder ${workDir}`);
  }
}
