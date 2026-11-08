import type { Campaign } from '@boiler-room/schema';
import tour from '@boiler-room/schema/examples/nova-tour.campaign.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { prepareFilm } from '../src/film/prepare.ts';
import { filmSeams } from '../src/film/seams.ts';
import { validateFilm } from '../src/film/validate-film.ts';
import { validateForRender } from '../src/film/validate-render.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../src/layout/stage.ts';
import type { SceneImage } from '../src/scenes/definition.ts';
import { heroLayout } from '../src/scenes/site-hero.tsx';
import {
  blurAt,
  decayOffset,
  fling,
  framePlacement,
  LAND_AT,
  pageAt,
  pushAt,
  rampTravel,
  type ScrollPlan,
  type SiteScrollProps,
  scrollAt,
  scrollLayout,
  scrollPlan,
  siteScroll,
  speedAt,
  sweepAt,
} from '../src/scenes/site-scroll.tsx';
import { at, exampleProbe } from './fixtures.ts';

const FORMATS: Format[] = ['16:9', '9:16', '1:1'];
const tourCopy = () => structuredClone(tour) as Campaign;
const stageOf = (format: Format) =>
  stageFor(FORMAT_SIZES[format].width, FORMAT_SIZES[format].height);
const image = (width: number, height: number): SceneImage => ({
  width,
  height,
  aspect: width / height,
});
const PAGES = [image(2880, 7400), image(2880, 8300)] as const;
const TOUR_PROPS = at(tour.scenes, 1).props as SiteScrollProps;
const planFor = (format: Format, props: SiteScrollProps = TOUR_PROPS): ScrollPlan =>
  scrollPlan(stageOf(format), PAGES, props);
const frames = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** A probe that answers for the tour's two captures, at these sizes. */
const tourProbe = (docs = [2880, 7400], integrations = [2880, 8300]) =>
  exampleProbe({
    'docs.png': { loaded: true, width: docs[0], height: docs[1], animated: false },
    'integrations.png': {
      loaded: true,
      width: integrations[0],
      height: integrations[1],
      animated: false,
    },
  });

describe('site-scroll motion', () => {
  it('ramps page 1 over 545 px and decays page 2 over 1392 px at a peak of 167 px a frame', () => {
    expect(rampTravel(fling.jumpAt, 167)).toBeCloseTo(545, 0);
    expect(decayOffset(fling.jumpAt, 167)).toBeCloseTo(167 / 0.12, 6);
    expect(Math.round(decayOffset(fling.jumpAt, 167))).toBe(1392);
  });

  it('is moving on frame 0 and speeds up by 1.4 a frame to vPeak on frame 7', () => {
    const plan = planFor('16:9');
    expect(plan.vPeak).toBe(167);
    expect(speedAt(0, plan)).toBeGreaterThan(0);
    expect(scrollAt(1, plan).y).toBeGreaterThan(scrollAt(0, plan).y);
    for (const f of frames(1, 7)) expect(speedAt(f, plan) / speedAt(f - 1, plan)).toBeCloseTo(1.4);
    expect(speedAt(7, plan)).toBeCloseTo(167, 9);
  });

  it('jumps to page 2 on frame 8, at a speed within 1.5x of frame 7 to 8', () => {
    const plan = planFor('16:9');
    expect(frames(0, 7).map((f) => scrollAt(f, plan).page)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(scrollAt(7.99, plan).page).toBe(0);
    expect(scrollAt(8, plan).page).toBe(1);
    const into = speedAt(7, plan);
    const after = scrollAt(9, plan).y - scrollAt(8, plan).y;
    expect(after / into).toBeGreaterThan(1 / 1.5);
    expect(after / into).toBeLessThan(1.5);
    expect(after).toBeCloseTo(speedAt(8, plan), 9);
  });

  it('lands page 2 exactly on its target on frame 43, and holds it there', () => {
    for (const format of FORMATS) {
      const plan = planFor(format);
      expect(decayOffset(LAND_AT, plan.vPeak)).toBe(0);
      expect(decayOffset(LAND_AT - 1, plan.vPeak)).toBeGreaterThan(0);
      expect(scrollAt(43, plan).y).toBe(plan.target);
      expect(scrollAt(71, plan).y).toBe(plan.target);
    }
  });

  it("lands with the CTA's top 0.35 H below the bar, inside the frame", () => {
    for (const format of FORMATS) {
      const stage = stageOf(format);
      const plan = planFor(format);
      const cta = TOUR_PROPS.pages[1]?.ctaBox;
      if (!cta) throw new Error('The tour lands on a CTA box.');
      const scale = at(plan.scales, 1);
      const top = plan.layout.viewportTop + cta.y * scale - scrollAt(43, plan).y;
      expect(top).toBeCloseTo(plan.layout.viewportTop + 0.35 * stage.height, 9);
      expect(top + cta.h * scale).toBeLessThan(stage.height);
      expect(plan.layout.frame.x + cta.x * scale).toBeGreaterThan(0);
      expect(plan.layout.frame.x + (cta.x + cta.w) * scale).toBeLessThan(stage.width);
    }
  });

  it('caps the peak so page 2 never jumps past its own top', () => {
    const near = { pages: [{}, { ctaBox: { x: 100, y: 1200, w: 300, h: 100 } }] };
    const plan = planFor('16:9', near);
    expect(plan.target).toBeCloseTo(1200 * at(plan.scales, 1) - 378, 9);
    expect(plan.vPeak).toBeCloseTo(plan.target * 0.12, 9);
    expect(plan.vPeak).toBeLessThan(167);
    expect(scrollAt(8, plan).y).toBeCloseTo(0, 9);
    for (const f of frames(8, 43)) expect(scrollAt(f, plan).y).toBeGreaterThanOrEqual(-1e-9);
    // The 9:16 tour is capped a little: its CTA is nearer the top of the frame's narrow page.
    expect(planFor('9:16').vPeak).toBeLessThan(167);
    expect(planFor('1:1').vPeak).toBe(167);
  });

  it('takes an explicit targetY over the CTA, and page 1 starts at its own targetY', () => {
    const props = {
      pages: [{ targetY: 400 }, { targetY: 4000, ctaBox: TOUR_PROPS.pages[1]?.ctaBox }],
    };
    const plan = planFor('16:9', props as SiteScrollProps);
    expect(plan.start).toBeCloseTo(400 * at(plan.scales, 0), 9);
    expect(plan.target).toBeCloseTo(4000 * at(plan.scales, 1), 9);
    expect(scrollAt(0, plan).y).toBe(plan.start);
  });

  it('blurs the page only while it moves faster than 60 px a frame, at most 8 px', () => {
    const plan = planFor('16:9');
    const stage = stageOf('16:9');
    const blurred = frames(0, 71).filter((f) => blurAt(f, plan, stage) > 0);
    for (const f of blurred) expect(speedAt(f, plan)).toBeGreaterThan(60);
    for (const f of frames(0, 71).filter((f) => !blurred.includes(f)))
      expect(speedAt(f, plan)).toBeLessThanOrEqual(60);
    // 4 is the first ramp frame over 60 px a frame, and 16 the last of the decay, at 60.7.
    expect(blurred).toEqual(frames(4, 16));
    expect(Math.max(...blurred.map((f) => blurAt(f, plan, stage)))).toBe(8);
    expect(blurAt(7, plan, stage)).toBe(8);
    expect(blurAt(8, plan, stage)).toBe(8);
  });

  it('sweeps the light across the CTA on frames 50 to 64, through its middle on 57', () => {
    expect(sweepAt(49)).toBeUndefined();
    expect(frames(50, 64).every((f) => sweepAt(f) !== undefined)).toBe(true);
    expect(sweepAt(65)).toBeUndefined();
    expect(sweepAt(57)).toBe(0.5);
  });

  it('pushes in by 0.15% a frame from the landing, about the CTA, which stays put', () => {
    const plan = planFor('16:9');
    expect(pushAt(0)).toBe(1);
    expect(pushAt(43)).toBe(1);
    expect(pushAt(71)).toBeCloseTo(1 + 0.0015 * 28, 12);
    const rest = framePlacement(0, plan).rect;
    expect(framePlacement(43, plan).rect).toEqual(rest);
    const late = framePlacement(71, plan).rect;
    expect(late.width).toBeGreaterThan(rest.width);
    const { x, y } = plan.origin;
    const fixed = (rect: typeof rest) => ({
      u: (x - rect.x) / rect.width,
      v: (y - rect.y) / rect.height,
    });
    expect(fixed(late).u).toBeCloseTo(fixed(rest).u, 12);
    expect(fixed(late).v).toBeCloseTo(fixed(rest).v, 12);
  });

  it('draws the page somewhere new on every frame, though the frame snaps to whole pixels', () => {
    for (const format of FORMATS) {
      const stage = stageOf(format);
      const plan = planFor(format);
      for (const f of frames(1, 71)) {
        const now = pageAt(f, plan, stage);
        const before = pageAt(f - 1, plan, stage);
        const moved = Math.max(
          Math.abs(now.top - before.top),
          Math.abs(now.left - before.left),
          Math.abs(now.width - before.width),
        );
        expect(moved > 0.5 || now.page !== before.page, `${format} frame ${f}`).toBe(true);
      }
    }
  });

  it('lays the page on whole pixels while it is blurred, and fills the window at rest', () => {
    const stage = stageOf('16:9');
    const plan = planFor('16:9');
    for (const f of frames(0, 43)) {
      const drawn = pageAt(f, plan, stage);
      expect(drawn.left).toBe(0);
      expect(drawn.width).toBe(plan.layout.frame.width);
      if (drawn.blur > 0) expect(Number.isInteger(drawn.top)).toBe(true);
    }
  });

  it("puts the browser frame where site-hero draws it, its foot past the stage's", () => {
    for (const format of FORMATS) {
      const stage = stageOf(format);
      const ours = scrollLayout(stage, at(PAGES, 0));
      const hero = heroLayout(stage, image(2880, 1800));
      expect(Math.abs(ours.frame.x - hero.frame.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(ours.frame.y - hero.frame.y)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(ours.frame.width - hero.frame.width)).toBeLessThanOrEqual(1);
      expect(ours.frame.y + ours.frame.height).toBeGreaterThan(stage.height);
      expect(Number.isInteger(ours.frame.x) && Number.isInteger(ours.frame.width)).toBe(true);
    }
  });

  it("gives the anchor's box as the frame drawn on each frame", () => {
    const stage = stageOf('16:9');
    const [anchor] = siteScroll.anchors;
    const request = {
      props: TOUR_PROPS,
      stage,
      theme: undefined as never,
      images: PAGES,
      dur: 72,
      text: [],
    };
    const plan = planFor('16:9');
    for (const f of [0, 8, 43, 60, 71]) {
      expect(anchor?.box(f, request)).toEqual(framePlacement(f, plan).rect);
    }
  });
});

describe('site-scroll props', () => {
  const parse = (props: unknown) => siteScroll.props.safeParse(props);

  it("accepts the tour's pages", () => {
    expect(parse(TOUR_PROPS).success).toBe(true);
  });

  it('needs one entry per page, page 1 then page 2', () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ pages: [{}] }).success).toBe(false);
    expect(parse({ pages: [{}, { targetY: 10 }, {}] }).success).toBe(false);
  });

  it('needs something for page 2 to land on', () => {
    const result = parse({ pages: [{}, {}] });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['pages', 1], message: expect.stringMatching(/ctaBox/) }),
    ]);
  });

  it('refuses copy or unknown keys in a page', () => {
    expect(parse({ pages: [{}, { targetY: 10, label: 'Start' }] }).success).toBe(false);
  });
});

describe('the nova-tour example', () => {
  it('passes validateCampaign and validateFilm with no issue', async () => {
    const campaign = tourCopy();
    expect(await validateForRender(campaign)).toEqual({ ok: true, issues: [], campaign });
    for (const format of FORMATS) expect(validateFilm(campaign, format)).toEqual([]);
  });

  it('seams out of site-scroll by T1 on x into the feature card, as written', () => {
    const seams = filmSeams(tourCopy());
    expect(seams.map(({ used, reason }) => `${used} ${reason}`)).toEqual([
      't3 written',
      't1 written',
      't3 written',
    ]);
    expect(at(seams, 1).seam).toMatchObject({ axis: 'x', sign: 1, vPeak: 46, k: 0.7 });
  });

  it('plans in every format', async () => {
    for (const format of FORMATS) {
      const plan = await prepareFilm({ campaign: tourCopy(), format }, tourProbe());
      expect(at(plan.scenes, 1).images.map(({ assetId }) => assetId)).toEqual([
        'docs-page',
        'integrations-page',
      ]);
    }
  });

  it('refuses a page 1 too short for the frame and the ramp, naming it', async () => {
    const rejection = prepareFilm(
      { campaign: tourCopy(), format: '9:16' },
      tourProbe([2880, 6000]),
    );
    await expect(rejection).rejects.toThrow(/site-scroll page 1 \(assetIds\[0\], 2880×6000\)/);
    await expect(rejection).rejects.toThrow(/Capture at least 7142 px/);
  });

  it('refuses a page 2 that would end inside the frame once it lands', async () => {
    const rejection = prepareFilm(
      { campaign: tourCopy(), format: '9:16' },
      tourProbe(undefined, [2880, 7000]),
    );
    await expect(rejection).rejects.toThrow(/site-scroll page 2 \(assetIds\[1\], 2880×7000\)/);
  });

  it('refuses a CTA too near the top of page 2 to scroll onto', async () => {
    const campaign = tourCopy();
    at(campaign.scenes, 1).props = { pages: [{}, { ctaBox: { x: 900, y: 300, w: 400, h: 120 } }] };
    await expect(prepareFilm({ campaign, format: '16:9' }, tourProbe())).rejects.toThrow(
      /too near the top of the page/,
    );
  });

  it('refuses a full-page capture past 1:3, as the image gate does for any scene', async () => {
    const rejection = prepareFilm(
      { campaign: tourCopy(), format: '16:9' },
      tourProbe(undefined, [2880, 9000]),
    );
    await expect(rejection).rejects.toThrow(/IMAGE_WRONG_SHAPE at assets\.integrations-page\.src/);
  });

  it('refuses a page with no landing data before anything renders', () => {
    const campaign = tourCopy();
    at(campaign.scenes, 1).props = { pages: [{}, {}] };
    const errors = validateFilm(campaign, '16:9').filter(({ severity }) => severity === 'error');
    expect(errors).toEqual([
      expect.objectContaining({ code: 'PROPS_INVALID', path: 'scenes[1].props.pages.1' }),
    ]);
  });
});
