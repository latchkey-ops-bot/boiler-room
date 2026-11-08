import { FORMATS } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { contains, fitContain, overlaps, split } from '../src/layout/rect.ts';
import { markBox } from '../src/layout/scenes.ts';
import { FORMAT_SIZES, stageFor } from '../src/layout/stage.ts';
import { endCardLayout } from '../src/scenes/end-card.tsx';
import { cardLayout, cropRect } from '../src/scenes/feature-card.tsx';
import { heroFocus, heroLayout, heroPlacement } from '../src/scenes/site-hero.tsx';

const stages = FORMATS.map((format) => {
  const { width, height } = FORMAT_SIZES[format];
  return [format, stageFor(width, height)] as const;
});

/** Screenshots come in every shape: laptop, desktop, ultrawide, phone, square. */
const ASPECTS = [16 / 10, 16 / 9, 4 / 3, 21 / 9, 9 / 19.5, 1];

describe('stage', () => {
  it('reads each format by its shape', () => {
    expect(stages.map(([, stage]) => stage.orientation)).toEqual([
      'landscape',
      'portrait',
      'square',
    ]);
  });

  it('scales by the short side, so every format shares one scale', () => {
    for (const [, stage] of stages) expect(stage.unit).toBe(10.8);
  });

  it('keeps tall video clear of the captions apps draw at the bottom', () => {
    const portrait = stageFor(1080, 1920);
    expect(portrait.height - (portrait.safe.y + portrait.safe.height)).toBeGreaterThan(
      portrait.safe.y,
    );
  });

  it('lays out a size it has never seen', () => {
    const odd = stageFor(1440, 1800);
    expect(odd.orientation).toBe('square');
    expect(contains({ x: 0, y: 0, width: 1440, height: 1800 }, odd.safe)).toBe(true);
  });
});

describe('rect helpers', () => {
  it('fits a shape inside a box without cropping it', () => {
    const box = { x: 10, y: 20, width: 400, height: 300 };
    const fitted = fitContain(box, 2);
    expect(fitted).toEqual({ x: 10, y: 70, width: 400, height: 200 });
    expect(contains(box, fitContain(box, 0.25, 'start'))).toBe(true);
  });

  it('splits a rect with a gap, using all of it', () => {
    const [left, right] = split({ x: 0, y: 0, width: 110, height: 10 }, 'x', 0.5, 10);
    expect(left.width + right.width + 10).toBe(110);
    expect(overlaps(left, right)).toBe(false);
  });
});

describe.each(stages)('layout in %s', (_format, stage) => {
  const frame = { x: 0, y: 0, width: stage.width, height: stage.height };

  it('keeps the mark inside the safe area', () => {
    expect(contains(stage.safe, markBox(stage))).toBe(true);
  });

  it.each(ASPECTS)('frames a site capture of aspect %f under the mark', (aspect) => {
    const layout = heroLayout(stage, { aspect });
    expect(layout.frame.x + layout.frame.width / 2).toBeCloseTo(stage.width / 2, 6);
    expect(overlaps(markBox(stage), layout.frame)).toBe(false);
    // The capture fills the viewport below the bar, cropped and never stretched.
    const viewport = {
      ...layout.frame,
      y: layout.frame.y + layout.chrome,
      height: layout.frame.height - layout.chrome,
    };
    expect(contains(layout.image, viewport)).toBe(true);
    expect(layout.image.width / layout.image.height).toBeCloseTo(aspect, 6);
    if (stage.orientation === 'portrait') {
      expect(layout.frame.y + layout.frame.height).toBeGreaterThanOrEqual(stage.height);
    } else {
      expect(layout.image.width).toBeCloseTo(layout.frame.width, 6);
    }
  });

  it('pushes a site capture in about its focus, which stays where it is', () => {
    const image = { aspect: 1.6, width: 2880, height: 1800 };
    const layout = heroLayout(stage, image);
    const focus = { x: 1800, y: 300, w: 600, h: 400 };
    const origin = heroFocus(stage, layout, image, focus);
    const later = heroPlacement(60, stage, layout, origin, false);
    const share = (rect: typeof layout.frame) => ({
      x: (origin.x - rect.x) / rect.width,
      y: (origin.y - rect.y) / rect.height,
    });
    expect(later.scale).toBeCloseTo(1.09, 10);
    expect(share(later.rect).x).toBeCloseTo(share(layout.frame).x, 10);
    expect(share(later.rect).y).toBeCloseTo(share(layout.frame).y, 10);
  });

  it('sets a feature card out as a headline over a panel of two nodes', () => {
    const layout = cardLayout(stage);
    expect(contains(frame, layout.panel)).toBe(true);
    expect(layout.headlineTop).toBeLessThan(layout.panel.y);
    expect(layout.headlineTop).toBeGreaterThan(markBox(stage).y + markBox(stage).height);
    for (const node of [layout.cause, layout.effect]) {
      expect(contains(layout.panel, node.visual)).toBe(true);
      expect(contains(layout.panel, node.label)).toBe(true);
      expect(overlaps(node.visual, node.label)).toBe(false);
    }
    expect(overlaps(layout.cause.visual, layout.effect.visual)).toBe(false);
    for (const aspect of ASPECTS) {
      expect(contains(layout.cause.visual, cropRect(layout.cause, { aspect }))).toBe(true);
    }
  });

  it('stacks the end card as logo, CTA and URL, down the middle', () => {
    const { logo, ctaBaseline, urlBaseline } = endCardLayout(stage);
    expect(contains(stage.safe, logo)).toBe(true);
    expect(logo.x + logo.width / 2).toBeCloseTo(stage.width / 2, 6);
    expect(logo.y + logo.height).toBeLessThan(ctaBaseline);
    expect(ctaBaseline).toBeLessThan(urlBaseline);
    expect(urlBaseline).toBeLessThan(stage.safe.y + stage.safe.height);
  });
});
