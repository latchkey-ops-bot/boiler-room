import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { openBrowser, selectComposition } from '@remotion/renderer';
import { stageAssets } from './stage-assets.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const concurrency = Math.max(1, Math.floor(os.availableParallelism() / 2));

/** Stages assets, bundles the pitch and selects its composition, which reads the manifest. */
export async function preparePitch() {
  stageAssets();
  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, 'src/index.ts'),
    publicDir: path.join(ROOT, 'public'),
    onProgress: () => undefined,
  });
  const browser = await openBrowser('chrome', { chromiumOptions: { gl: 'swangle' } });
  const composition = await selectComposition({
    serveUrl,
    id: 'Pitch',
    inputProps: {},
    puppeteerInstance: browser,
  });
  return { serveUrl, browser, composition };
}
