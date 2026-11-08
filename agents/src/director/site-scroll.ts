/**
 * When a film may hold a `site-scroll`, and what the Director writes instead when it may not.
 *
 * A `site-scroll` flings page 1 and lands page 2 on its call to action, so motion refuses it unless
 * both pages are long captures and page 2 has a landing point (`docs/motion/scenes/site-scroll.md`,
 * fit or fail). The Director writes one only when the research provides that; otherwise the row
 * becomes a `site-hero` on the best captured screen, which keeps the template's frames.
 */
import { checkImageFit, type FilmIssue, type Format } from '@boiler-room/motion';
import type { Campaign, Scene } from '@boiler-room/schema';
import type { ResearchOutput } from '../researcher/output.ts';

/** A DOM box on a captured page, in the capture's own pixels. */
export interface CaptureBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A captured page as a `site-scroll` would scroll it. */
export interface ScrollCapture {
  assetId: string;
  sourceUrl: string | undefined;
  width: number;
  height: number;
  /** Where page 2 lands: the DOM box of its CTA or heading. */
  ctaBox?: CaptureBox;
  /** Or the landing point itself, in source pixels from the top. */
  targetY?: number;
}

/** One entry of `site-scroll` `props.pages`. */
export type ScrollPage = { targetY?: number; ctaBox?: CaptureBox };

export type SiteScrollSupport =
  | { ok: true; assetIds: [string, string]; pages: [ScrollPage, ScrollPage] }
  | { ok: false; reasons: string[] };

/** The frames a `site-scroll` row runs in every template, at 30 fps. */
const ROW_FRAMES = 72;
const FPS = 30;

const isScreen = (asset: ResearchOutput['assets'][string] | undefined) =>
  asset?.kind === 'image' && (asset.provenance === 'captured' || asset.provenance === 'uploaded');

/**
 * The captured pages research offers to a `site-scroll`: each page's screenshot, with its size.
 * `research.json` records no DOM boxes, so none of them has a landing point, and `site-scroll`
 * stays out of every film until the Researcher captures long pages with their CTA boxes. This is
 * the one place to read them from when it does.
 */
export function scrollCaptures(research: ResearchOutput): ScrollCapture[] {
  const seen = new Set<string>();
  return research.brief.pages.flatMap((page) => {
    const id = page.screenshot_asset_id;
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const asset = Object.hasOwn(research.assets, id) ? research.assets[id] : undefined;
    if (!isScreen(asset) || !asset?.width || !asset.height) return [];
    return [{ assetId: id, sourceUrl: asset.sourceUrl, width: asset.width, height: asset.height }];
  });
}

const landingOf = (capture: ScrollCapture): ScrollPage | undefined =>
  capture.ctaBox
    ? { ctaBox: capture.ctaBox }
    : capture.targetY !== undefined
      ? { targetY: capture.targetY }
      : undefined;

/** Motion's own fit check on a one-scene film that shows `scene` with these images. */
function fitIssues(
  scene: Pick<Scene, 'type' | 'props' | 'assetIds'>,
  sizes: ScrollCapture[],
  format: Format,
): FilmIssue[] {
  const campaign = {
    fps: FPS,
    durationSeconds: ROW_FRAMES / FPS,
    assets: Object.fromEntries(
      sizes.map((each) => [
        each.assetId,
        { kind: 'image', src: each.assetId, provenance: 'captured' },
      ]),
    ),
    scenes: [{ id: 'probe', start: 0, end: ROW_FRAMES / FPS, text: [], ...scene }],
  } as unknown as Campaign;
  const imageSizes = Object.fromEntries(
    sizes.map((each) => [each.assetId, { width: each.width, height: each.height }]),
  );
  return checkImageFit(campaign, format, imageSizes);
}

/** Why `capture` cannot be page 1 in `format`, from motion's check, or undefined when it can. */
function page1Problem(capture: ScrollCapture, format: Format): string | undefined {
  // A stand-in page 2, three times as tall as wide and landing one width down, which always fits.
  const stand: ScrollCapture = {
    assetId: `${capture.assetId}-page-two`,
    sourceUrl: undefined,
    width: capture.width,
    height: capture.width * 3,
  };
  const issues = fitIssues(
    {
      type: 'site-scroll',
      props: { pages: [{}, { targetY: capture.width }] },
      assetIds: [capture.assetId, stand.assetId],
    },
    [capture, stand],
    format,
  ).filter((issue) => issue.path === `assets.${capture.assetId}.src`);
  return issues[0] ? `${issues[0].message} ${issues[0].fix}` : undefined;
}

/**
 * Whether the research supports a `site-scroll` in every format the brief asks for: two different
 * captured pages that pass motion's fit check, page 2 with a CTA box or a `targetY` to land on.
 * When it does, the pages to write; when it does not, every reason.
 */
export function siteScrollSupport(
  captures: readonly ScrollCapture[],
  formats: readonly Format[],
): SiteScrollSupport {
  const landing = captures.filter((capture) => landingOf(capture));
  for (const second of landing) {
    for (const first of captures) {
      if (first.assetId === second.assetId) continue;
      if (first.sourceUrl && first.sourceUrl === second.sourceUrl) continue;
      const pages: [ScrollPage, ScrollPage] = [
        first.targetY !== undefined ? { targetY: first.targetY } : {},
        landingOf(second) ?? {},
      ];
      const scene = {
        type: 'site-scroll',
        props: { pages },
        assetIds: [first.assetId, second.assetId],
      };
      if (formats.every((format) => fitIssues(scene, [first, second], format).length === 0)) {
        return { ok: true, assetIds: [first.assetId, second.assetId], pages };
      }
    }
  }
  const reasons: string[] = [];
  if (captures.length < 2) {
    reasons.push(
      `the research has ${captures.length} captured page(s) with a size, and a site-scroll shows two`,
    );
  }
  if (landing.length === 0) {
    reasons.push(
      'the research records no CTA box or targetY for any captured page, so page 2 has nothing to land on',
    );
  }
  const problems = captures.map((capture) =>
    formats.flatMap((format) => {
      const problem = page1Problem(capture, format);
      return problem ? [`in ${format}, ${problem}`] : [];
    }),
  );
  if (captures.length > 0 && problems.every((each) => each.length > 0)) {
    const sizes = [...new Set(captures.map((capture) => `${capture.width}×${capture.height}`))];
    reasons.push(
      `no captured page is long enough to scroll: they are ${sizes.join(' or ')}. For example ${problems[0]?.[0]}`,
    );
  }
  if (reasons.length === 0) {
    reasons.push(
      'no pair of captured pages passes motion’s fit check for site-scroll in every format',
    );
  }
  return { ok: false, reasons };
}

/** Page kinds in the order a second product surface is chosen from. */
const HERO_ORDER = [
  'product',
  'pricing',
  'docs',
  'customers',
  'demo',
  'about',
  'blog',
  'other',
  'home',
];

/**
 * The captured screens a `site-hero` standing in for a `site-scroll` can show, best first: each
 * page's screenshot that motion's fit check accepts for a `site-hero` in every format, product
 * pages first, and any screen another `site-hero` shows last.
 */
export function heroScreens(
  research: ResearchOutput,
  formats: readonly Format[],
  shownElsewhere: ReadonlySet<string> = new Set(),
): string[] {
  const kindOf = new Map(
    research.brief.pages.flatMap((page) =>
      page.screenshot_asset_id ? [[page.screenshot_asset_id, page.kind] as const] : [],
    ),
  );
  const rank = (id: string) =>
    (shownElsewhere.has(id) ? 100 : 0) + Math.max(0, HERO_ORDER.indexOf(kindOf.get(id) ?? 'other'));
  return scrollCaptures(research)
    .filter((capture) =>
      formats.every(
        (format) =>
          fitIssues(
            { type: 'site-hero', props: {}, assetIds: [capture.assetId] },
            [capture],
            format,
          ).length === 0,
      ),
    )
    .map((capture, index) => ({ id: capture.assetId, score: rank(capture.assetId) * 1000 + index }))
    .sort((a, b) => a.score - b.score)
    .map((each) => each.id);
}
