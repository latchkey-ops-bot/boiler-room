/**
 * Proves that a frame is a pure function of its number. Renders sampled frames once in order, then
 * again in a shuffled order in the same browser, and compares the two PNGs byte for byte. A frame
 * that depends on what was rendered before it, on the clock, or on randomness fails.
 *
 *   node scripts/determinism.ts [--campaign nova.campaign.json] [--format 16:9] [--samples 24]
 */
import { renderStill } from '@remotion/renderer';
import {
  argValue,
  bundleFilm,
  FORMATS,
  type Format,
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
      const render = async (frame: number) => {
        const { buffer } = await renderStill({
          serveUrl,
          composition,
          inputProps,
          frame,
          imageFormat: 'png',
          puppeteerInstance: browser,
        });
        if (!buffer) throw new Error(`Frame ${frame} returned no image.`);
        return buffer;
      };
      const first = new Map<number, Buffer>();
      for (const frame of frames) first.set(frame, await render(frame));
      for (const frame of shuffled(frames, seed)) {
        const again = await render(frame);
        compared += 1;
        if (!again.equals(first.get(frame) as Buffer)) {
          failures += 1;
          console.error(`DIFFERENT: ${file} ${format} frame ${frame}`);
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
