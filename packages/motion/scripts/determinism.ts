/**
 * Proves that a frame is a pure function of its number. Each film is rendered three times:
 *
 * 1. the sampled frames in order in one tab, so each frame follows the ones before it;
 * 2. the same frames shuffled, each in a fresh page and at a later time;
 * 3. the same frames across several tabs at once, as `renderMedia` and every chunk worker render
 *    them, so tabs that load fonts and images at the same time race each other.
 *
 * Passes 2 and 3 are compared with pass 1 byte for byte, so a frame that depends on what was
 * rendered before it, on the clock, on which tab loaded first, or on randomness fails. One
 * difference is tolerated and reported: Chrome's known raster variance, where a tab draws a
 * rounded corner a level apart. A frame that differs by at most 1 level on at most 32 pixels
 * passes with a note; anything more fails.
 *
 * Beside the examples it runs fixtures that once broke this: a display and body font that share a
 * family name, an animated GIF as the product image, and an animated SVG as the logo. Each must be
 * rejected before a frame renders, or render identically in every pass.
 *
 *   node scripts/determinism.ts [--campaign nova.campaign.json] [--format 16:9] [--samples 12]
 *     [--concurrency 8] [--fixtures-only] [--no-fixtures]
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderFrames, renderStill } from '@remotion/renderer';
import { PNG } from 'pngjs';
import {
  argValue,
  bundleFilm,
  EXAMPLES,
  FORMATS,
  type Format,
  OUT,
  openRenderBrowser,
  type RenderBrowser,
  readCampaign,
  selectFilm,
} from './bundle.ts';
import { animatedSvg, twoFrameGif } from './fixture-files.ts';
import {
  type PlanShape,
  pixelDifference,
  RASTER_VARIANCE,
  sampleFrames,
  shuffled,
  withinRasterVariance,
} from './sampling.ts';

const samples = Number(argValue('samples') ?? 12);
const seed = Number(argValue('seed') ?? 20261107);
/** At least 4 tabs, and as many as `scripts/render.ts` uses, so tabs race as they do in a render. */
const concurrency = Number(
  argValue('concurrency') ?? Math.max(4, Math.floor(os.availableParallelism() / 2)),
);

// biome-ignore lint/suspicious/noExplicitAny: fixtures edit the example JSON freely.
type Json = any;

interface Case {
  name: string;
  campaign: Json;
  format: Format;
  /** `identical`: renders, and every pass matches. Otherwise the gate must refuse with this code. */
  expect: 'identical' | { rejectedWith: string };
  /** A further check of the plan `calculateMetadata` made. Returns what is wrong, if anything. */
  checkPlan?: (plan: Json) => string | undefined;
  /** A campaign that must render to the same pixels, frame for frame. */
  sameAs?: Json;
}

const examples = (): Case[] => {
  const files = argValue('campaign')
    ? [argValue('campaign') as string]
    : ['nova.campaign.json', 'quillhaven.campaign.json'];
  const formats = argValue('format') ? [argValue('format') as Format] : FORMATS;
  return files.flatMap((file) =>
    formats.map((format) => ({
      name: `${path.basename(file, '.campaign.json')} ${format}`,
      campaign: readCampaign(file),
      format,
      expect: 'identical' as const,
    })),
  );
};

/** Copies the examples into a public folder of its own and adds the files the fixtures name. */
function fixturePublicDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'boiler-room-determinism-'));
  cpSync(EXAMPLES, dir, { recursive: true });
  mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  writeFileSync(path.join(dir, 'fixtures/two-frames.gif'), twoFrameGif());
  const logo = readFileSync(path.join(EXAMPLES, 'assets/nova/logo.svg'), 'utf8');
  writeFileSync(path.join(dir, 'fixtures/animated-logo.svg'), animatedSvg(logo));
  return dir;
}

function fixtures(): Case[] {
  const sameFamily = readCampaign('nova.campaign.json') as Json;
  sameFamily.brand.fonts.display.family = 'Nova Sans';
  sameFamily.brand.fonts.body.family = 'Nova Sans';

  const animatedImage = readCampaign('nova.campaign.json') as Json;
  animatedImage.assets['dashboard-shot'].src = 'fixtures/two-frames.gif';

  const animatedLogo = readCampaign('nova.campaign.json') as Json;
  animatedLogo.assets.logo.src = 'fixtures/animated-logo.svg';

  return [
    {
      name: 'fixture: one family name, two font files',
      campaign: sameFamily,
      format: '16:9',
      expect: 'identical',
      // The family name is only a label: the same files under two names must look the same.
      sameAs: readCampaign('nova.campaign.json'),
    },
    {
      name: 'fixture: animated GIF as the product image',
      campaign: animatedImage,
      format: '16:9',
      expect: { rejectedWith: 'IMAGE_ANIMATED' },
    },
    {
      name: 'fixture: animated SVG logo',
      campaign: animatedLogo,
      format: '16:9',
      expect: 'identical',
      checkPlan: (plan) =>
        plan.logo.kind === 'image'
          ? `the animated logo was used: ${JSON.stringify(plan.logo)}`
          : undefined,
    },
  ];
}

const cases = [
  ...(process.argv.includes('--fixtures-only') ? [] : examples()),
  ...(process.argv.includes('--no-fixtures') ? [] : fixtures()),
];

const quiet = { onStart: () => undefined, onFrameUpdate: () => undefined };

async function framesInTabs(
  serveUrl: string,
  selected: Awaited<ReturnType<typeof selectFilm>>,
  frames: number[],
  tabs: number,
  browser: RenderBrowser,
): Promise<Map<number, Buffer>> {
  const buffers = new Map<number, Buffer>();
  await renderFrames({
    serveUrl,
    ...selected,
    frames,
    concurrency: tabs,
    imageFormat: 'png',
    outputDir: null,
    puppeteerInstance: browser,
    ...quiet,
    onFrameBuffer: (buffer, frame) => {
      buffers.set(frame, Buffer.from(buffer));
    },
  });
  return buffers;
}

const publicDir = fixturePublicDir();
const serveUrl = await bundleFilm(publicDir);
const browser = await openRenderBrowser();
let failures = 0;
let compared = 0;
let tolerated = 0;

/**
 * Two renders of one frame that are not byte-identical. Within Chrome's raster variance it is
 * reported and tolerated; beyond it, both images are saved and the run fails.
 */
function differs(name: string, frame: number, pass: string, before: Buffer, after: Buffer) {
  const difference = pixelDifference(PNG.sync.read(before).data, PNG.sync.read(after).data);
  const { pixels, maxDelta } = difference;
  if (withinRasterVariance(difference)) {
    tolerated += 1;
    console.log(
      `TOLERATED: ${name} frame ${frame}, ${pass}: ${pixels} pixels differ by ${maxDelta} level, within Chrome's raster variance (at most ${RASTER_VARIANCE.maxDelta} level on at most ${RASTER_VARIANCE.pixels} pixels).`,
    );
    return;
  }
  failures += 1;
  const dir = path.join(OUT, 'determinism');
  mkdirSync(dir, { recursive: true });
  const file = `${name.replace(/[^a-z0-9]+/gi, '-')}-${frame}`;
  writeFileSync(path.join(dir, `${file}-in-order.png`), before);
  writeFileSync(path.join(dir, `${file}-${pass}.png`), after);
  console.error(
    `DIFFERENT: ${name} frame ${frame}, ${pass}: ${pixels} pixels differ, by at most ${maxDelta} of 255. Both saved in ${dir}`,
  );
}

try {
  for (const { name, campaign, format, expect, checkPlan, sameAs } of cases) {
    let selected: Awaited<ReturnType<typeof selectFilm>>;
    try {
      selected = await selectFilm(serveUrl, { campaign, format }, browser);
    } catch (error) {
      // Remotion keeps only the first line of an error from the page in `message`; the issues
      // FilmRejected lists follow it in `stack`.
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      if (expect !== 'identical' && message.includes(expect.rejectedWith)) {
        console.log(`${name}: refused with ${expect.rejectedWith}, as it must be`);
        continue;
      }
      failures += 1;
      console.error(
        `FAILED: ${name} could not be selected: ${message.split('\n').slice(0, 12).join('\n')}`,
      );
      continue;
    }
    if (expect !== 'identical') {
      failures += 1;
      console.error(
        `FAILED: ${name} was accepted, but must be refused with ${expect.rejectedWith}.`,
      );
      continue;
    }
    const planProblem = checkPlan?.(selected.composition.props.plan);
    if (planProblem) {
      failures += 1;
      console.error(`FAILED: ${name}: ${planProblem}`);
    }

    // Frames spread over the film, and every QC frame of every transition, where a frame most
    // easily comes to depend on the scene drawn before it.
    const { plan } = selected.composition.props as { plan?: PlanShape };
    const seamFrames = (plan?.transitions ?? []).flatMap(({ qc }) => qc);
    const frames = [
      ...new Set([...sampleFrames(selected.composition.durationInFrames, samples), ...seamFrames]),
    ].sort((a, b) => a - b);
    const first = await framesInTabs(serveUrl, selected, frames, 1, browser);
    const firstOf = (frame: number) => {
      const before = first.get(frame);
      if (!before) throw new Error(`The first pass did not render frame ${frame}.`);
      return before;
    };

    if (sameAs) {
      const control = await selectFilm(serveUrl, { campaign: sameAs, format }, browser);
      const expected = await framesInTabs(serveUrl, control, frames, 1, browser);
      for (const frame of frames) {
        compared += 1;
        const want = expected.get(frame);
        if (want && !want.equals(firstOf(frame))) {
          differs(name, frame, 'against-its-control', want, firstOf(frame));
        }
      }
    }

    for (const frame of shuffled(frames, seed)) {
      const { buffer } = await renderStill({
        serveUrl,
        ...selected,
        frame,
        imageFormat: 'png',
        puppeteerInstance: browser,
      });
      if (!buffer) throw new Error(`Frame ${frame} returned no image.`);
      compared += 1;
      if (!buffer.equals(firstOf(frame)))
        differs(name, frame, 'fresh-page', firstOf(frame), buffer);
    }

    const parallel = await framesInTabs(serveUrl, selected, frames, concurrency, browser);
    for (const frame of frames) {
      const buffer = parallel.get(frame);
      if (!buffer) throw new Error(`The concurrent pass did not render frame ${frame}.`);
      compared += 1;
      if (!buffer.equals(firstOf(frame))) {
        differs(name, frame, `${concurrency}-tabs`, firstOf(frame), buffer);
      }
    }
    console.log(
      `${name}: ${frames.length} frames compared in 3 passes (${concurrency} tabs in the last)`,
    );
  }
} finally {
  await browser.close({ silent: true });
  rmSync(publicDir, { recursive: true, force: true });
}
if (failures > 0) {
  console.error(`${failures} problem(s): ${compared} frame comparisons were made.`);
  process.exit(1);
}
console.log(
  tolerated === 0
    ? `All ${compared} frame comparisons were byte-identical, and every fixture behaved.`
    : `All ${compared} frame comparisons passed: ${compared - tolerated} byte-identical, ${tolerated} within Chrome's raster variance. Every fixture behaved.`,
);
