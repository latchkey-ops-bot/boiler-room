/**
 * Proves that a frame is a pure function of its number. The first pass renders the sampled frames
 * in order in one page, so each frame follows the ones before it. The second pass renders them
 * again in a shuffled order, each in a fresh page and at a later time. The two PNGs of each frame
 * are compared byte for byte, so a frame that depends on what was rendered before it, on the
 * clock, or on randomness fails.
 *
 *   node scripts/determinism.ts [--campaign nova.campaign.json] [--format 16:9] [--samples 24]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderFrames, renderStill } from '@remotion/renderer';
import {
  argValue,
  bundleFilm,
  FORMATS,
  type Format,
  formatSlug,
  OUT,
  openRenderBrowser,
  readCampaign,
  selectFilm,
} from './bundle.ts';
import { sampleFrames, shuffled } from './sampling.ts';

const campaigns = argValue('campaign')
  ? [argValue('campaign') as string]
  : ['nova.campaign.json', 'quillhaven.campaign.json'];
const formats = argValue('format') ? [argValue('format') as Format] : FORMATS;
const samples = Number(argValue('samples') ?? 12);
const seed = Number(argValue('seed') ?? 20261107);

const serveUrl = await bundleFilm();
const browser = await openRenderBrowser();
let failures = 0;
let compared = 0;
try {
  for (const file of campaigns) {
    for (const format of formats) {
      const { composition, inputProps } = await selectFilm(
        serveUrl,
        { campaign: readCampaign(file), format },
        browser,
      );
      const frames = sampleFrames(composition.durationInFrames, samples);
      const first = new Map<number, Buffer>();
      await renderFrames({
        serveUrl,
        composition,
        inputProps,
        frames,
        concurrency: 1,
        imageFormat: 'png',
        outputDir: null,
        puppeteerInstance: browser,
        onStart: () => undefined,
        onFrameUpdate: () => undefined,
        onFrameBuffer: (buffer, frame) => {
          first.set(frame, Buffer.from(buffer));
        },
      });
      for (const frame of shuffled(frames, seed)) {
        const { buffer } = await renderStill({
          serveUrl,
          composition,
          inputProps,
          frame,
          imageFormat: 'png',
          puppeteerInstance: browser,
        });
        if (!buffer) throw new Error(`Frame ${frame} returned no image.`);
        const before = first.get(frame);
        if (!before) throw new Error(`The first pass did not render frame ${frame}.`);
        compared += 1;
        if (!buffer.equals(before)) {
          failures += 1;
          const dir = path.join(OUT, 'determinism');
          mkdirSync(dir, { recursive: true });
          const name = `${path.basename(file, '.campaign.json')}-${formatSlug(format)}-${frame}`;
          writeFileSync(path.join(dir, `${name}-in-order.png`), before);
          writeFileSync(path.join(dir, `${name}-shuffled.png`), buffer);
          console.error(`DIFFERENT: ${file} ${format} frame ${frame}, both saved in ${dir}`);
        }
      }
      console.log(`${file} ${format}: ${frames.length} frames compared`);
    }
  }
} finally {
  await browser.close({ silent: true });
}
if (failures > 0) {
  console.error(`${failures} of ${compared} frames differed between passes.`);
  process.exit(1);
}
console.log(`All ${compared} frames were byte-identical across both passes.`);
