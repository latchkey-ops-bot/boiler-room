/**
 * The copy check of a film on its own, before anything is rendered or anyone has approved the
 * script. motion never sets type smaller to make copy fit, and only a browser with the brand fonts
 * loaded can measure it, so a script can pass every check that reads it and still have a line its
 * template refuses to set. The crew runs this on the Director's script with the fonts the render
 * will use, while the Director may still change the copy.
 *
 * It bundles motion with the campaign's files, as a render does, and selects the `CopyFit`
 * composition once per format: its `calculateMetadata` validates the cut, loads both brand fonts
 * and measures every type card, feature card and stat counter, then throws one `FilmRejected`
 * naming every scene to shorten. No picture is loaded and no computer is created, so it costs
 * nothing, and a missing picture beside the campaign is not a refusal.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Format } from '@boiler-room/motion';
import type { Campaign } from '@boiler-room/schema';
import { ensureBrowser, selectComposition } from '@remotion/renderer';
import { packBundle } from './bundle.ts';
import { withPageMessage } from './render-campaign.ts';

export interface CopyFitOptions {
  /** A campaign whose font files, if any are local, are beside it at their `src`. */
  campaignFile: string;
  formats: readonly Format[];
  log?: (line: string) => void;
}

export interface CopyFitResult {
  format: Format;
  /** The page's refusal, one line that names every scene, or null when all the copy fits. */
  refusal: string | null;
}

export async function checkCopyFit(options: CopyFitOptions): Promise<CopyFitResult[]> {
  const campaignFile = path.resolve(options.campaignFile);
  const campaign = JSON.parse(await readFile(campaignFile, 'utf8')) as Campaign;
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'boiler-room-copy-fit-'));
  try {
    const packed = await packBundle(campaign, path.dirname(campaignFile), workDir);
    await ensureBrowser({
      onBrowserDownload: () => {
        options.log?.('downloading the headless browser this machine needs to measure the copy');
        return { version: null, onProgress: () => undefined };
      },
    });
    const results: CopyFitResult[] = [];
    for (const format of options.formats) {
      try {
        await selectComposition({
          serveUrl: packed.serveUrl,
          id: 'CopyFit',
          inputProps: { campaign, format },
          chromiumOptions: { gl: 'swangle' },
          logLevel: 'error',
        });
        results.push({ format, refusal: null });
      } catch (error) {
        const shown = withPageMessage(error);
        results.push({ format, refusal: shown instanceof Error ? shown.message : String(shown) });
      }
    }
    return results;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
