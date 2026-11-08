/**
 * Stages assets and renders the whole pitch to an mp4.
 *
 *   pnpm --filter @boiler-room/pitch render /absolute/path/out.mp4
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { renderMedia } from '@remotion/renderer';
import { concurrency, preparePitch } from './bundle.mjs';

const target = process.argv[2];
if (!target) {
  console.error('usage: pnpm --filter @boiler-room/pitch render <out.mp4>');
  process.exit(1);
}
const outputLocation = path.resolve(target);
mkdirSync(path.dirname(outputLocation), { recursive: true });

const { serveUrl, browser, composition } = await preparePitch();
try {
  const started = performance.now();
  await renderMedia({
    serveUrl,
    composition,
    inputProps: composition.props,
    codec: 'h264',
    outputLocation,
    puppeteerInstance: browser,
    concurrency,
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(0);
  console.log(`${outputLocation} (${composition.durationInFrames} frames in ${seconds}s)`);
} finally {
  await browser.close({ silent: true });
}
