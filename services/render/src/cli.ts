/**
 *   pnpm render <campaign.json> [--format 16:9] [--hook id] [--cta id] [--workers N]
 *
 * Renders a campaign on Naive computers and writes the MP4, its manifest and its quality artifacts.
 * Ctrl-C stops the render and destroys every computer before the process exits.
 */
import { parseArgs } from 'node:util';
import { FilmRejected, type Format } from '@boiler-room/motion';
import { FORMATS } from '@boiler-room/schema';
import { CostLimitExceeded } from './cost.ts';
import { Aborted } from './naive/exec.ts';
import {
  DEFAULT_MAX_COST_USD,
  DEFAULT_WORKERS,
  type RenderCampaignOptions,
  renderCampaign,
} from './render-campaign.ts';

const USAGE = `pnpm render <campaign.json> [options]

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
  --keep-work               keep the working folder of chunks and frames`;

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
let interrupts = 0;
let lastInterrupt = 0;
const interrupt = (signalName: string) => {
  // One Ctrl-C reaches this process more than once under pnpm and tsx: from the terminal to the
  // whole process group, and again as each parent passes it on. Copies that close together are
  // one press, so a single Ctrl-C never skips the cleanup.
  const now = Date.now();
  if (now - lastInterrupt < 1500) return;
  lastInterrupt = now;
  interrupts += 1;
  if (interrupts === 1) {
    console.error(
      `\n${signalName}: stopping, and destroying every computer of this run. Wait for it.`,
    );
    controller.abort(new Aborted(`Stopped by ${signalName}.`));
  } else if (interrupts === 2) {
    console.error('Still destroying computers. Press Ctrl-C again to leave without waiting.');
  } else {
    console.error(
      'Leaving without confirming. List computers named br-render-* and destroy any left.',
    );
    process.exit(130);
  }
};
process.on('SIGINT', () => interrupt('SIGINT'));
process.on('SIGTERM', () => interrupt('SIGTERM'));

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
  signal: controller.signal,
  log: (line) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${line}`),
};

try {
  const result = await renderCampaign(options);
  console.log(
    JSON.stringify(
      'dryRun' in result ? result : { output: result.output, manifest: result.manifestFile },
      null,
      2,
    ),
  );
  process.exitCode = 0;
} catch (error) {
  if (error instanceof FilmRejected) {
    console.error(error.message);
    process.exitCode = 1;
  } else if (error instanceof CostLimitExceeded) {
    console.error(error.message);
    process.exitCode = 3;
  } else if (error instanceof Aborted || controller.signal.aborted) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 130;
  } else {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
