import type { Campaign } from '@boiler-room/schema';
import novaMark from '@boiler-room/schema/examples/nova-mark.campaign.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { seamBetween, wordRise } from '../src/core/curves.ts';
import { prepareFilm } from '../src/film/prepare.ts';
import { filmSeams } from '../src/film/seams.ts';
import { validateFilm } from '../src/film/validate-film.ts';
import { validateForRender } from '../src/film/validate-render.ts';
import { stageFor } from '../src/layout/stage.ts';
import { anchorsOf } from '../src/scenes/definition.ts';
import {
  blurAt,
  irisAt,
  LATEST_LEGIBLE_AT,
  legibleAt,
  logoReveal,
  markDrift,
  maskEdge,
  REVEAL_MODES,
  type RevealMode,
  restingLogoRect,
  revealLayout,
  revealStyle,
  taglineBaselines,
  taglineProblem,
  tileCells,
  tileCoverage,
  tilesPath,
  tilesShown,
} from '../src/scenes/logo-reveal.tsx';
import { definitionOf } from '../src/scenes/registry.ts';
import { seamTransform } from '../src/transitions/seam-layer.tsx';
import { at, exampleProbe } from './fixtures.ts';

const novaMarkCopy = () => structuredClone(novaMark) as Campaign;

const landscape = stageFor(1920, 1080);
const portrait = stageFor(1080, 1920);
const square = stageFor(1080, 1080);
const novaLogo = { kind: 'image', src: 'assets/nova/logo.svg', aspect: 373 / 112 } as const;
const placementOf = (stage: typeof landscape) => ({
  box: revealLayout(stage).box,
  align: 'center' as const,
});
const ink = restingLogoRect(novaLogo, placementOf(landscape), 1);

const frames = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

describe('logo-reveal registry entry', () => {
  it('is registered under its schema name', () => {
    expect(definitionOf('logo-reveal')).toBe(logoReveal);
  });

  it('declares the mark kind, the base and plate grounds, and the logo exit up at 36 px/f', () => {
    expect(logoReveal.kind).toBe('mark');
    expect(logoReveal.ground).toEqual({ 'neutral-cut': 'base', 'kinetic-plate': 'plate' });
    expect(logoReveal.anchors.map(({ id, entry, exit }) => ({ id, entry, exit }))).toEqual([
      { id: 'logo', entry: undefined, exit: { axis: 'y', sign: -1, v: 36 } },
    ]);
    expect(logoReveal.roles).toEqual({ subhead: { min: 0, max: 1 } });
    expect(logoReveal.image).toBe('none');
    expect(logoReveal.holdFrom).toBeUndefined();
  });

  it('takes only a mode, mask by default', () => {
    for (const mode of REVEAL_MODES)
      expect(logoReveal.props.safeParse({ mode }).success).toBe(true);
    expect(logoReveal.props.safeParse({}).success).toBe(true);
    expect(logoReveal.props.safeParse({ mode: 'fade' }).success).toBe(false);
    expect(logoReveal.props.safeParse({ tagline: 'Hello' }).success).toBe(false);
  });

  it('is legible by mode at mask 13, blur 8, tiles 7, iris 10, all inside the mark deadline', () => {
    expect(Object.fromEntries(REVEAL_MODES.map((mode) => [mode, legibleAt(mode)]))).toEqual({
      mask: 13,
      blur: 8,
      tiles: 7,
      iris: 10,
    });
    expect(legibleAt()).toBe(13);
    expect(LATEST_LEGIBLE_AT).toBe(13);
    expect(logoReveal.markLegibleAt).toBe(13);
    for (const mode of REVEAL_MODES) expect(90 + legibleAt(mode)).toBeLessThanOrEqual(105);
  });
});

describe('logo-reveal layout', () => {
  it('fits the logo in 0.36 W x 0.22 H at the centre of 16:9', () => {
    const { box, taglineBaseline } = revealLayout(landscape);
    expect(box.x).toBeCloseTo(614.4);
    expect(box.y).toBeCloseTo(421.2);
    expect(box.width).toBeCloseTo(691.2);
    expect(box.height).toBeCloseTo(237.6);
    expect(taglineBaseline).toBeCloseTo(756);
  });

  it('fits it in 0.70 W x 0.14 H at 0.45 H in 9:16, with the tagline on 0.58 H', () => {
    const { box, taglineBaseline } = revealLayout(portrait);
    expect(box.width).toBeCloseTo(756);
    expect(box.height).toBeCloseTo(268.8);
    expect(box.y + box.height / 2).toBeCloseTo(864);
    expect(taglineBaseline).toBeCloseTo(1113.6);
  });

  it('fits it in 0.60 W x 0.24 H at the centre of 1:1, with the tagline on 0.72 H', () => {
    const { box, taglineBaseline } = revealLayout(square);
    expect(box.width).toBeCloseTo(648);
    expect(box.height).toBeCloseTo(259.2);
    expect(box.y + box.height / 2).toBeCloseTo(540);
    expect(taglineBaseline).toBeCloseTo(777.6);
  });

  it('keeps a raster logo at or below its own pixels on its largest drifted frame', () => {
    const raster = { kind: 'image', src: 'logo.png', aspect: 4, naturalWidth: 600 } as const;
    const largest = markDrift(90, legibleAt('mask'));
    const rest = restingLogoRect(raster, placementOf(landscape), largest);
    expect(rest.width * largest).toBeLessThanOrEqual(600 + 1e-9);
    expect(rest.width / rest.height).toBeCloseTo(4);
    // Centred where the fitted logo is centred.
    expect(rest.x + rest.width / 2).toBeCloseTo(960);
    expect(rest.y + rest.height / 2).toBeCloseTo(540);
  });

  it('lets an SVG fill its box, and sets a wordmark in the whole box', () => {
    const rest = restingLogoRect(novaLogo, placementOf(landscape), 1.2);
    expect(rest.width).toBeCloseTo(691.2);
    const box = revealLayout(landscape).box;
    expect(
      restingLogoRect({ kind: 'wordmark', reason: 'too-small' }, placementOf(landscape), 1.2),
    ).toEqual(box);
  });

  it('leaves the tagline clear of the logo box and inside the safe area, on two lines', () => {
    // Sora's cap height is about 0.7 of its size, so capS 78 sets it near 111 px.
    const fit = { fontSize: 111, lineHeight: 1.1, lines: ['Builds that', 'keep up'] };
    for (const stage of [landscape, portrait, square]) {
      const { box, taglineBaseline } = revealLayout(stage);
      const settled = taglineBaselines(200, fit, taglineBaseline, 19);
      const entering = taglineBaselines(19, fit, taglineBaseline, 19);
      expect(settled.first).toBeCloseTo(taglineBaseline, 6);
      expect(Math.min(settled.first, entering.first) - 78).toBeGreaterThan(box.y + box.height);
      expect((settled.second ?? 0) + 0.25 * 111).toBeLessThan(stage.safe.y + stage.safe.height);
    }
  });
});

describe('logo-reveal tagline', () => {
  const fit = { fontSize: 111, lineHeight: 1.1, lines: ['Builds that keep up'] };

  it('sits a single line on its baseline', () => {
    expect(taglineBaselines(30, fit, 756, 19)).toEqual({
      first: 756,
      second: undefined,
      secondStart: 23,
    });
  });

  it('pushes line 1 up half a line onto the baseline as line 2 arrives, 60% on its first frame', () => {
    const two = { ...fit, lines: ['Builds that', 'keep up'] };
    const travel = (111 * 1.1) / 2;
    const at19 = taglineBaselines(19, two, 756, 19);
    expect(at19.secondStart).toBe(21);
    expect(at19.first).toBeCloseTo(756 + travel);
    expect(at19.second).toBeCloseTo(756 + 111 * 1.1);
    expect(taglineBaselines(20, two, 756, 19).first).toBeCloseTo(756 + travel);
    expect(taglineBaselines(21, two, 756, 19).first).toBeCloseTo(756 + travel * 0.4);
    expect(taglineBaselines(60, two, 756, 19).first).toBeCloseTo(756, 6);
  });

  it('starts six frames after the logo is legible and has every word in by ML + 12', () => {
    for (const mode of REVEAL_MODES) {
      const start = legibleAt(mode) + 6;
      const still = legibleAt(mode) + 12;
      for (const j of frames(0, 5))
        expect(wordRise(still - start, j, 1, 26, 0.5).visible).toBe(true);
      // Up to four words, as in the example, the last is within 3.3 px of rest.
      expect(wordRise(still - start, 3, 1, 26, 0.5).y).toBeLessThan(3.3);
      expect(wordRise(start - 1 - start, 0, 1, 26, 0.5).visible).toBe(false);
    }
  });

  it('fits or fails: a tagline that would be set below its cap height names the scene and text', () => {
    const fits = { fontSize: 111, targetSize: 111.4, lines: ['Builds that keep up'] };
    expect(taglineProblem('mark', 'mark-tagline', fits, landscape)).toBeUndefined();
    const shrunk = { ...fits, fontSize: 96 };
    const problem = taglineProblem('mark', 'mark-tagline', shrunk, portrait);
    expect(problem).toMatch(/scene "mark"/);
    expect(problem).toMatch(/subhead "mark-tagline"/);
    expect(problem).toMatch(/96 px instead of 111 px/);
    expect(problem).toMatch(/1080x1920/);
    expect(taglineProblem('mark', 't', { ...fits, lines: [] }, landscape)).toMatch(/Layout error/);
  });
});

describe('logo-reveal modes', () => {
  it('mask: part of the logo shows on frame 0, the edge moves right, and it is clear at 13', () => {
    const first = maskEdge(0);
    expect(first?.p).toBeCloseTo(-8 + 116 * (0.28 / (1 - 0.72 ** 14)), 10);
    expect((first?.p ?? 0) - (first?.s ?? 0)).toBeGreaterThan(10);
    const edges = frames(0, 12).map((f) => maskEdge(f)?.p ?? 0);
    for (const [index, p] of edges.entries()) {
      if (index > 0) expect(p).toBeGreaterThan(edges[index - 1] as number);
    }
    // The last masked frame still holds back the right edge; frame 13 holds back nothing.
    expect((maskEdge(12)?.p ?? 0) - 8).toBeLessThan(100);
    expect(maskEdge(13)).toBeUndefined();
    expect(maskEdge(40)).toBeUndefined();
  });

  it('blur: 12 px on frame 0 at full opacity, sharp from frame 8', () => {
    expect(blurAt(0)).toBe(12);
    const radii = frames(0, 8).map(blurAt);
    for (const [index, radius] of radii.entries()) {
      if (index > 0) expect(radius).toBeLessThan(radii[index - 1] as number);
    }
    expect(blurAt(7)).toBeGreaterThan(0);
    expect(blurAt(8)).toBe(0);
    const style = revealStyle('blur', 0, ink, landscape);
    expect(style).toEqual({ filter: 'blur(12px)' });
    expect(style).not.toHaveProperty('opacity');
  });

  it('tiles: coverage 2.4, 5.5, 11, 19, 35, 54, 78, 100% on frames 0 to 7, from the centre', () => {
    expect(frames(0, 8).map(tileCoverage)).toEqual([
      0.024, 0.055, 0.11, 0.19, 0.35, 0.54, 0.78, 1, 1,
    ]);
    const cells = tileCells(ink);
    expect(cells.length % 12).toBe(0);
    expect(cells[0]?.width).toBeCloseTo(ink.width / 12);
    const distance = ({ x, y, width }: (typeof cells)[number]) =>
      Math.hypot(x + width / 2 - 960, y + width / 2 - 540);
    for (const [index, cell] of cells.entries()) {
      if (index > 0)
        expect(distance(cell)).toBeGreaterThanOrEqual(distance(cells[index - 1] as typeof cell));
    }
    expect(tilesShown(0, cells.length)).toBeGreaterThanOrEqual(1);
    expect(tilesShown(0, 12)).toBe(1);
    expect(tilesShown(4, 100)).toBe(35);
    expect(tilesShown(7, cells.length)).toBe(cells.length);
    expect(tilesPath([{ x: 1, y: 2, width: 3, height: 4 }])).toBe('M1 2h3v4h-3Z');
  });

  it('iris: blooms from a dot of 23 W / 540 to the farthest corner, its edge soft at the end', () => {
    const centre = { x: 960, y: 540 };
    const radii = frames(0, 9).map((f) => irisAt(f, landscape, centre)?.radius ?? 0);
    expect(radii[0]).toBeCloseTo((23 * 1920) / 540);
    for (const [index, radius] of radii.entries()) {
      if (index > 0) expect(radius).toBeGreaterThan(radii[index - 1] as number);
    }
    expect(radii[9]).toBeLessThan(Math.hypot(960, 540));
    expect(irisAt(9, landscape, centre)?.softness).toBeCloseTo((8 * 1920) / 540);
    expect(irisAt(8, landscape, centre)?.softness).toBeCloseTo((3 * 1920) / 540);
    expect(irisAt(0, landscape, centre)?.softness).toBeCloseTo(1920 / 540);
    expect(irisAt(10, landscape, centre)).toBeUndefined();
  });

  it.each(REVEAL_MODES)(
    '%s: shows something on frame 0 and nothing holds it back at ML',
    (mode) => {
      const ml = legibleAt(mode);
      expect(revealStyle(mode, 0, ink, landscape)).toBeDefined();
      expect(revealStyle(mode, ml - 1, ink, landscape)).toBeDefined();
      expect(revealStyle(mode, ml, ink, landscape)).toBeUndefined();
      expect(revealStyle(mode, 89, ink, landscape)).toBeUndefined();
    },
  );

  it.each(REVEAL_MODES)('%s: is a pure function of the frame', (mode: RevealMode) => {
    const all = frames(-2, 20);
    const inOrder = all.map((f) => JSON.stringify(revealStyle(mode, f, ink, landscape)));
    const backwards = [...all]
      .reverse()
      .map((f) => JSON.stringify(revealStyle(mode, f, ink, landscape)))
      .reverse();
    expect(backwards).toEqual(inOrder);
  });
});

describe('logo-reveal motion', () => {
  const request = {
    props: {},
    stage: landscape,
    theme: { logo: novaLogo } as never,
    images: [],
    dur: 90,
    text: [],
  };
  const [anchor] = anchorsOf(logoReveal, request);

  it('holds still to ML, then drifts larger about the frame centre', () => {
    if (!anchor) throw new Error('logo-reveal has no anchor');
    const atMl = anchor.box(13);
    expect(anchor.box(0)).toEqual(atMl);
    const later = anchor.box(25);
    expect(later.width / atMl.width).toBeCloseTo(1 + 0.0013 * 12, 10);
    expect(later.x + later.width / 2).toBeCloseTo(960);
    expect(later.y + later.height / 2).toBeCloseTo(540);
  });

  it('leaves upward on T1, above its rest and moving up on its last frame', () => {
    const seam = seamBetween({ axis: 'y', sign: -1, v: 36 }, { v: 36 });
    const out = { name: 't1', seam } as never;
    const offset = (f: number) => {
      const transform = seamTransform({
        f,
        dur: 90,
        in: undefined,
        out,
        anchors: [],
        carryFrom: undefined,
        stage: landscape,
        anchor: 'logo',
      });
      return Number(/translateY\((-?[\d.]+)px\)/.exec(transform ?? '')?.[1] ?? 0);
    };
    expect(offset(78)).toBe(0);
    expect(offset(89)).toBeLessThan(0);
    expect(offset(89) - offset(88)).toBeCloseTo(-36, 6);
  });
});

describe('the nova-mark example', () => {
  it('passes the render gate and validateFilm in every format', async () => {
    const campaign = novaMarkCopy();
    expect(await validateForRender(campaign)).toEqual({ ok: true, issues: [], campaign });
    for (const format of campaign.variants.formats) {
      expect(validateFilm(campaign, format)).toEqual([]);
    }
  });

  it('cuts in on T3 from the word-slam and leaves on T1 into the site-hero', () => {
    const seams = filmSeams(novaMarkCopy());
    expect(seams.map(({ used, reason }) => [used, reason])).toEqual([
      ['t3', 'written'],
      ['t1', 'written'],
      ['t3', 'written'],
    ]);
    expect(at(seams, 1).seam).toEqual(
      expect.objectContaining({ axis: 'y', sign: -1, vPeak: 36, n: 11, D: 14 }),
    );
  });

  it('starts the reveal at frame 90, so the mark is legible by 105 in every format', async () => {
    const campaign = novaMarkCopy();
    for (const format of campaign.variants.formats) {
      const plan = await prepareFilm({ campaign, format }, exampleProbe());
      const mark = at(plan.scenes, 1);
      expect(mark.span.from).toBe(90);
      expect(mark.span.durationInFrames).toBe(90);
      expect(mark.span.from + (logoReveal.markLegibleAt ?? 99)).toBeLessThanOrEqual(105);
    }
  });
});
