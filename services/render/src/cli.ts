/**
 *   pnpm render <campaign.json> [--format 16:9] [--hook id] [--cta id] [--workers N]
 *   pnpm render --reap [--run <run id>] [--older-than <minutes>]
 *
 * Renders a campaign on Naive computers and writes the MP4, its manifest and its quality artifacts.
 * Ctrl-C, SIGTERM, SIGHUP, a closed output pipe or a parent that goes away stops the render, and
 * every computer is destroyed before the process exits.
 */
import { parseArgs } from 'node:util';
import { FilmRejected, type Format } from '@boiler-room/motion';
import { FORMATS } from '@boiler-room/schema';
import { CostLimitExceeded } from './cost.ts';
import { guardRun } from './guard.ts';
import { naiveClient } from './naive/client.ts';
import { Aborted } from './naive/exec.ts';
import { newRunId, REAP_AFTER_MS, reapOrphans } from './naive/reap.ts';
import {
  DEFAULT_MAX_COST_USD,
  DEFAULT_WORKERS,
  type RenderCampaignOptions,
  renderCampaign,
} from './render-campaign.ts';

const USAGE = `pnpm render <campaign.json> [options]
pnpm render --reap [--run <run id>] [--older-than <minutes>]

  --format 16:9|9:16|1:1    the format to render (16:9)
  --hook <id>               swap this hook in for the first scene
  --cta <id>                use this CTA's label
  --workers <N>             computers to split the frames across (${DEFAULT_WORKERS})
  --out <file.mp4>          where to write the film (out/renders/<name>/<name>.mp4)
  --max-cost <usd>          refuse to start above this estimate, and stop before it (${DEFAULT_MAX_COST_USD})
  --snapshot auto|off|rebuild
                            fork the recorded base snapshot (auto), set every computer up from
                            clean (off), or make a new base (rebuild)
  --verify-seams            also render the whole film here and compare every seam with it
  --no-quality              skip the contact sheet, transition stills and phone sheet
  --local                   render the chunks on this machine instead of Naive
  --concurrency <N>         Remotion's concurrency on each computer
  --vcpu <N> --memory-mb <N>
                            the size of each computer (8 vCPU, 16384 MiB)
  --dry-run                 validate, bundle and estimate, without creating a computer
  --simulate-chunk-failure <n>
                            destroy chunk n's first computer mid-render, to exercise the retry
  --keep-work               keep the working folder of chunks and frames

  --reap                    destroy the computers and files of runs killed before they could clean
                            up: every run older than ${REAP_AFTER_MS / 60_000} min, which no live run can be
  --run <run id>            with --reap, that one run at any age, as logged at its start
  --older-than <minutes>    with --reap, runs older than this instead`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    format: { type: 'string' },
    hook: { type: 'string' },
    cta: { type: 'string' },
    workers: { type: 'string' },
    out: { type: 'string' },
    'max-cost': { type: 'string' },
    snapshot: { type: 'string' },
    'verify-seams': { type: 'boolean' },
    'no-quality': { type: 'boolean' },
    local: { type: 'boolean' },
    concurrency: { type: 'string' },
    vcpu: { type: 'string' },
    'memory-mb': { type: 'string' },
    'dry-run': { type: 'boolean' },
    'simulate-chunk-failure': { type: 'string' },
    'keep-work': { type: 'boolean' },
    reap: { type: 'boolean' },
    run: { type: 'string' },
    'older-than': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const whole = (name: string, text: string | undefined, min = 1): number | undefined => {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isInteger(value) || value < min)
    fail(`--${name} must be a whole number of at least ${min}.`);
  return value;
};

if (values.reap) {
  const olderThan = whole('older-than', values['older-than']);
  const reaped = await reapOrphans(naiveClient(), {
    ...(values.run ? { runId: values.run } : {}),
    ...(olderThan ? { olderThanMs: olderThan * 60_000 } : {}),
    log: (line) => console.error(line),
  });
  console.log(JSON.stringify(reaped, null, 2));
  process.exit(0);
}

if (values.help || positionals.length !== 1) {
  console.error(USAGE);
  process.exit(values.help ? 0 : 2);
}

const format = (values.format ?? '16:9') as Format;
if (!(FORMATS as readonly string[]).includes(format))
  fail(`--format must be one of ${FORMATS.join(', ')}.`);
const snapshot = values.snapshot ?? 'auto';
if (!['auto', 'off', 'rebuild'].includes(snapshot))
  fail('--snapshot must be auto, off or rebuild.');
const maxCost = values['max-cost'] === undefined ? undefined : Number(values['max-cost']);
if (maxCost !== undefined && !(maxCost > 0))
  fail('--max-cost must be a positive number of dollars.');
const vcpu = whole('vcpu', values.vcpu);
const memoryMb = whole('memory-mb', values['memory-mb'], 1024);
const failChunk = whole('simulate-chunk-failure', values['simulate-chunk-failure']);

const controller = new AbortController();
const runId = newRunId();
// From here on, every way the process can be stopped aborts the run, so its computers are destroyed:
// Ctrl-C, SIGTERM, SIGHUP, a closed stdout or stderr, a parent that goes away, or an uncaught error.
const guard = guardRun(controller, {
  leaving: `Destroy what is left with: pnpm render --reap --run ${runId}`,
});

const options: RenderCampaignOptions = {
  campaignFile: positionals[0] as string,
  format,
  ...(values.hook ? { hookId: values.hook } : {}),
  ...(values.cta ? { ctaId: values.cta } : {}),
  ...(values.workers ? { workers: whole('workers', values.workers) as number } : {}),
  ...(values.out ? { output: values.out } : {}),
  ...(maxCost !== undefined ? { maxCostUsd: maxCost } : {}),
  snapshot: snapshot as 'auto' | 'off' | 'rebuild',
  verifySeams: values['verify-seams'] ?? false,
  quality: !values['no-quality'],
  runner: values.local ? 'local' : 'naive',
  ...(values.concurrency
    ? { concurrency: whole('concurrency', values.concurrency) as number }
    : {}),
  ...(vcpu || memoryMb
    ? { workerSize: { vcpu: vcpu ?? 8, memoryMb: memoryMb ?? 16_384, diskGb: 10 } }
    : {}),
  ...(failChunk ? { simulateFailure: { chunk: failChunk - 1 } } : {}),
  dryRun: values['dry-run'] ?? false,
  keepWork: values['keep-work'] ?? false,
  runId,
  signal: controller.signal,
  log: (line) => guard.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`),
};

try {
  const result = await renderCampaign(options);
  guard.print(
    `${JSON.stringify(
      'dryRun' in result ? result : { output: result.output, manifest: result.manifestFile },
      null,
      2,
    )}\n`,
  );
  process.exitCode ??= 0;
} catch (error) {
  if (error instanceof FilmRejected) {
    guard.log(error.report);
    process.exitCode = 1;
  } else if (error instanceof CostLimitExceeded) {
    guard.log(error.message);
    process.exitCode = 3;
  } else if (error instanceof Aborted || controller.signal.aborted) {
    guard.log(error instanceof Error ? error.message : String(error));
    process.exitCode = 130;
  } else {
    guard.log(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
} finally {
  guard.dispose();
}
