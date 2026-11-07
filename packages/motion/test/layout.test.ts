import { FORMATS } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { contains, fitContain, overlaps, type Rect, split } from '../src/layout/rect.ts';
import {
  chromeHeight,
  ctaLayout,
  featureLayout,
  interfaceLayout,
  markBox,
  titleLayout,
} from '../src/layout/scenes.ts';
import { FORMAT_SIZES, stageFor } from '../src/layout/stage.ts';

const stages = FORMATS.map((format) => {
  const { width, height } = FORMAT_SIZES[format];
  return [format, stageFor(width, height)] as const;
});

/** Screenshots come in every shape: laptop, desktop, ultrawide, phone, square. */
const ASPECTS = [16 / 10, 16 / 9, 4 / 3, 21 / 9, 9 / 19.5, 1];

/** The image area of a browser frame, below its chrome. */
const viewportOf = (frame: Rect) => {
  const chrome = chromeHeight(frame.width);
  return { width: frame.width, height: frame.height - chrome };
};

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
  it('keeps the title and the mark inside the safe area', () => {
    expect(contains(stage.safe, titleLayout(stage).text)).toBe(true);
    expect(contains(stage.safe, markBox(stage))).toBe(true);
  });

  it.each(ASPECTS)('fits an interface of aspect %f without cropping or overlap', (aspect) => {
    const { text, media } = interfaceLayout(stage, aspect);
    expect(contains(stage.safe, text)).toBe(true);
    expect(contains(stage.safe, media)).toBe(true);
    expect(overlaps(text, media)).toBe(false);
    const viewport = viewportOf(media);
    expect(viewport.width / viewport.height).toBeCloseTo(aspect, 6);
    expect(overlaps(markBox(stage), media)).toBe(false);
  });

  it.each(ASPECTS)('fits a feature sequence of aspect %f', (aspect) => {
    const { text, media } = featureLayout(stage, aspect);
    expect(media).toBeDefined();
    const frame = media as Rect;
    expect(contains(stage.safe, text)).toBe(true);
    expect(contains(stage.safe, frame)).toBe(true);
    expect(overlaps(text, frame)).toBe(false);
    const viewport = viewportOf(frame);
    expect(viewport.width / viewport.height).toBeCloseTo(aspect, 6);
  });

  it('gives a feature sequence with no image the whole content area', () => {
    const { text, media } = featureLayout(stage, undefined);
    expect(media).toBeUndefined();
    expect(contains(stage.safe, text)).toBe(true);
  });

  it('stacks the end card without overlap', () => {
    const { mark, text, button } = ctaLayout(stage);
    for (const rect of [mark, text, button]) expect(contains(stage.safe, rect)).toBe(true);
    expect(overlaps(mark, text)).toBe(false);
    expect(overlaps(text, button)).toBe(false);
  });
});
