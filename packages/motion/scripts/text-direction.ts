/**
 * Proves that right-to-left copy reads in its own order. A word-slam headline in Hebrew and one in
 * Arabic, each a short word followed by two longer ones, is rendered once its words have landed,
 * and the headline's ink is split into words by the gaps between them. The first word written must
 * be the rightmost one on screen, and the longest the leftmost.
 *
 * The brand fonts have no Hebrew or Arabic, so the machine's fallback fonts draw them: run it where
 * those are installed, as they are on the render computers.
 *
 *   node scripts/text-direction.ts
 */
import { renderStill } from '@remotion/renderer';
import { PNG } from 'pngjs';
import { bundleFilm, openRenderBrowser, readCampaign, selectFilm } from './bundle.ts';

const PROBES = {
  hebrew: 'אב גגגג דדדדדדדד',
  arabic: 'لا مممم سسسسسسسس',
};

/** The frame of the opening scene once its words have landed, as `framesWorthSeeing` picks it. */
const SETTLED_FRAME = 74;

interface Segment {
  from: number;
  to: number;
}

/** Columns with ink below the corner mark, grouped into words by gaps of at least `gap` pixels. */
function inkSegments(png: PNG, background: [number, number, number], top: number, gap: number) {
  const columns: boolean[] = [];
  for (let x = 0; x < png.width; x += 1) {
    let ink = false;
    for (let y = top; y < png.height && !ink; y += 1) {
      const at = (y * png.width + x) * 4;
      const delta = Math.max(
        ...background.map((channel, index) => Math.abs((png.data[at + index] ?? 0) - channel)),
      );
      ink = delta > 60;
    }
    columns.push(ink);
  }
  const segments: Segment[] = [];
  let open: Segment | undefined;
  for (const [x, ink] of columns.entries()) {
    if (ink) {
      if (open && x - open.to <= gap) open.to = x;
      else {
        open = { from: x, to: x };
        segments.push(open);
      }
    }
  }
  return segments;
}

const serveUrl = await bundleFilm();
const browser = await openRenderBrowser();
let failures = 0;
try {
  for (const [script, headline] of Object.entries(PROBES)) {
    // biome-ignore lint/suspicious/noExplicitAny: the probe edits the example JSON freely.
    const campaign = readCampaign('nova.campaign.json') as any;
    const open = campaign.scenes[0];
    open.text = [{ id: 'probe', role: 'headline', value: headline, claimIds: [] }];
    const selected = await selectFilm(serveUrl, { campaign, format: '16:9' }, browser);
    const { buffer } = await renderStill({
      serveUrl,
      ...selected,
      frame: SETTLED_FRAME,
      imageFormat: 'png',
      puppeteerInstance: browser,
    });
    if (!buffer) throw new Error('The still returned no image.');
    const png = PNG.sync.read(buffer);
    // Below the corner mark: a 5% safe inset, a mark of 5 units and a gap of 3, at 10.8 px a unit.
    const top = Math.round(1080 * 0.05 + 10.8 * 8);
    const words = inkSegments(png, [0x0b, 0x10, 0x20], top, 24);
    const widths = words.map(({ from, to }) => to - from);
    const shown = words.map(({ from, to }) => `${from}-${to}`).join(', ');
    const rightmostIsFirst =
      words.length === 3 &&
      (widths[2] ?? 0) < (widths[1] ?? 0) &&
      (widths[1] ?? 0) < (widths[0] ?? 0);
    if (rightmostIsFirst) {
      console.log(`${script}: "${headline}" reads right to left (words at x ${shown})`);
    } else {
      failures += 1;
      console.error(
        `WRONG ORDER: ${script}: "${headline}" should show its short first word rightmost and its long last word leftmost, but its words are at x ${shown} (widths ${widths.join(', ')}).`,
      );
    }
  }
} finally {
  await browser.close({ silent: true });
}
if (failures > 0) process.exit(1);
