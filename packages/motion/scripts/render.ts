/**
 * Renders a whole film. Routine renders are silent.
 *
 *   node scripts/render.ts --campaign nova.campaign.json --format 16:9 [--hook id] [--cta id]
 */
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderMedia } from '@remotion/renderer';
import {
  argValue,
  bundleFilm,
  type Format,
  formatSlug,
  OUT,
  openRenderBrowser,
  readCampaign,
  selectFilm,
} from './bundle.ts';

const file = argValue('campaign') ?? 'nova.campaign.json';
const format = (argValue('format') ?? '16:9') as Format;
const hookId = argValue('hook');
const ctaId = argValue('cta');

const serveUrl = await bundleFilm();
const browser = await openRenderBrowser();
try {
  const { composition, inputProps } = await selectFilm(
    serveUrl,
    {
      campaign: readCampaign(file),
      format,
      ...(hookId ? { hookId } : {}),
      ...(ctaId ? { ctaId } : {}),
    },
    browser,
  );
  mkdirSync(path.join(OUT, 'video'), { recursive: true });
  const name = [path.basename(file, '.campaign.json'), formatSlug(format), hookId, ctaId]
    .filter(Boolean)
    .join('-');
  const outputLocation = path.join(OUT, 'video', `${name}.mp4`);
  const started = performance.now();
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: 'h264',
    muted: true,
    outputLocation,
    puppeteerInstance: browser,
    concurrency: Math.max(1, Math.floor(os.availableParallelism() / 2)),
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`${outputLocation} (${composition.durationInFrames} frames in ${seconds}s)`);
} finally {
  await browser.close({ silent: true });
}
