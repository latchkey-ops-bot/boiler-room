/**
 * One PNG per scene of timeline.json, taken three quarters of the way into the scene.
 *
 *   pnpm --filter @boiler-room/pitch stills /absolute/path/stills
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderStill } from '@remotion/renderer';
import { preparePitch, ROOT } from './bundle.mjs';

const outDir = path.resolve(process.argv[2] ?? path.join(ROOT, 'out/stills'));
mkdirSync(outDir, { recursive: true });
const timeline = JSON.parse(readFileSync(path.join(ROOT, 'timeline.json'), 'utf8'));
const frameOf = (seconds) => Math.round(seconds * timeline.fps);

const { serveUrl, browser, composition } = await preparePitch();
try {
  const scenes = timeline.sections.flatMap((s) => s.scenes);
  for (const [i, scene] of scenes.entries()) {
    const from = frameOf(scene.start);
    const frame = from + Math.round((frameOf(scene.end) - from) * 0.75);
    const output = path.join(outDir, `${String(i + 1).padStart(2, '0')}-${scene.id}.png`);
    await renderStill({
      serveUrl,
      composition,
      inputProps: composition.props,
      frame,
      output,
      imageFormat: 'png',
      puppeteerInstance: browser,
    });
    console.log(output);
  }
} finally {
  await browser.close({ silent: true });
}
