/**
 * Renders the frames worth looking at, for every example in every format: each scene once its copy
 * has landed, each transition halfway through, and the last frame.
 *
 *   node scripts/stills.ts [--campaign nova.campaign.json] [--format 9:16] [--hook id] [--cta id]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { renderStill } from '@remotion/renderer';
import {
  argValue,
  bundleFilm,
  type FilmInput,
  FORMATS,
  type Format,
  formatSlug,
  OUT,
  openRenderBrowser,
  readCampaign,
  selectFilm,
} from './bundle.ts';
import { framesWorthSeeing, type PlanShape } from './sampling.ts';

const campaigns = argValue('campaign')
  ? [argValue('campaign') as string]
  : ['nova.campaign.json', 'quillhaven.campaign.json'];
const formats = argValue('format') ? [argValue('format') as Format] : FORMATS;
const hookId = argValue('hook');
const ctaId = argValue('cta');
const only = argValue('frames')?.split(',').map(Number);

const serveUrl = await bundleFilm();
const browser = await openRenderBrowser();
try {
  for (const file of campaigns) {
    for (const format of formats) {
      const input: FilmInput = {
        campaign: readCampaign(file),
        format,
        ...(hookId ? { hookId } : {}),
        ...(ctaId ? { ctaId } : {}),
      };
      const { composition, inputProps } = await selectFilm(serveUrl, input, browser);
      const plan = composition.props.plan as PlanShape;
      const variant = [hookId, ctaId].filter(Boolean).join('-');
      const dir = path.join(
        OUT,
        'stills',
        `${path.basename(file, '.campaign.json')}${variant ? `-${variant}` : ''}`,
        formatSlug(format),
      );
      mkdirSync(dir, { recursive: true });
      const frames = only
        ? only.map((frame) => ({ label: 'frame', frame }))
        : framesWorthSeeing(plan);
      for (const { label, frame } of frames) {
        const output = path.join(dir, `${String(frame).padStart(4, '0')}-${label}.png`);
        await renderStill({
          serveUrl,
          composition,
          inputProps,
          frame,
          output,
          puppeteerInstance: browser,
        });
        console.log(output);
      }
    }
  }
} finally {
  await browser.close({ silent: true });
}
