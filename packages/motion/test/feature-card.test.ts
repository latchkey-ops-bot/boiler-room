import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FORMATS } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { lineBox, type SpecFit, specPx } from '../src/components/type.tsx';
import { typeDrift } from '../src/core/curves.ts';
import { FORMAT_SIZES, stageFor } from '../src/layout/stage.ts';
import {
  cardLayout,
  connectorEnds,
  cropRect,
  FeatureCardLayoutError,
  headlineBox,
  headlineProblem,
  headlineWidth,
  slotBottom,
} from '../src/scenes/feature-card.tsx';
import { sceneImplementations } from '../src/scenes/registry.ts';
import { card, specType } from '../src/tokens.ts';
import { seamTransform } from '../src/transitions/seam-layer.tsx';

const stages = FORMATS.map((format) => {
  const { width, height } = FORMAT_SIZES[format];
  return [format, stageFor(width, height)] as const;
});

/** Inter's metrics, as the canvas measures them, and Sora-like ones, with smaller caps. */
const INTER = { cap: 0.727, ascent: 0.969, descent: 0.242 };
const SORA = { cap: 0.7, ascent: 0.95, descent: 0.25 };

/** A headline set as wide as it may be: lines that fill the width they are given. */
const widest = (width: number, lines = 1): SpecFit =>
  ({
    fontSize: 100,
    lines: Array.from({ length: lines }, (_, index) => `line ${index}`),
    height: 110 * lines,
    width,
    fontFamily: 'Sora',
    weight: 700,
    lineHeight: 1.1,
    letterSpacing: '0em',
    metrics: { cap: 0.7, ascent: 0.95, descent: 0.25 },
    targetSize: 100,
  }) as SpecFit;

/** Card lengths in spec frames: the template rows' 66, 72 and 96, Quillhaven's 75 and Nova's 150. */
const LENGTHS = [66, 72, 75, 96, 150];

describe.each(stages)('the feature card headline in %s', (format, stage) => {
  it.each(LENGTHS)('stays in the safe area to the last frame of a %i-frame card', (dur) => {
    const width = headlineWidth(stage, dur);
    expect(width).toBeLessThanOrEqual(lineBox(stage));
    const top = cardLayout(stage).headlineTop;
    for (const lines of [1, 2]) {
      for (const f of [0, dur / 2, dur]) {
        const box = headlineBox(widest(width, lines), stage, top, f);
        expect(box.x).toBeGreaterThanOrEqual(stage.safe.x - 1e-9);
        expect(box.x + box.width).toBeLessThanOrEqual(stage.safe.x + stage.safe.width + 1e-9);
      }
    }
  });

  it.each(LENGTHS)('is never wider than the line box on any frame of a %i-frame card', (dur) => {
    // Quality Check measured the first film's headlines at 68 to 69% of the width two thirds of
    // the way through the card: set in the line box, the drift carried them past it.
    const limit = Math.min(lineBox(stage), stage.safe.width);
    expect(headlineWidth(stage, dur) * typeDrift(dur)).toBeCloseTo(limit, 9);
    const top = cardLayout(stage).headlineTop;
    for (const f of [0, Math.round((dur * 2) / 3), dur - 1, dur]) {
      const box = headlineBox(widest(headlineWidth(stage, dur)), stage, top, f);
      expect(box.width).toBeLessThanOrEqual(limit + 1e-9);
    }
    if (format === '16:9') expect(limit / stage.width).toBeCloseTo(0.65, 9);
  });

  it('has a box as tall as its lines, so a seam carrying from it lands on all of them', () => {
    const top = cardLayout(stage).headlineTop;
    const one = headlineBox(widest(800, 1), stage, top, 0);
    const two = headlineBox(widest(800, 2), stage, top, 0);
    expect(two.height).toBeCloseTo(one.height * 2, 9);
    // Line 1's cap top stays on the slot, so the second line grows the box downwards.
    expect(two.y).toBeCloseTo(one.y, 9);
  });

  it.each(LENGTHS)(
    'keeps the panel below a two-line headline to the last frame of a %i-frame card',
    (dur) => {
      for (const metrics of [INTER, SORA]) {
        const slot = slotBottom(stage, metrics, dur);
        const layout = cardLayout(stage, slot);
        const fontSize = Math.ceil(specPx(stage, specType.capS) / metrics.cap - 1e-9);
        const fit = {
          ...widest(headlineWidth(stage, dur), 2),
          fontSize,
          metrics,
        };
        // The box of two lines set at capS, cap top on the slot, at the scene's last frame.
        const box = headlineBox(fit, stage, layout.headlineTop, dur);
        expect(box.y + box.height).toBeCloseTo(slot, 6);
        expect(layout.panel.y).toBeGreaterThanOrEqual(slot + specPx(stage, card.slotGap) - 1e-9);
        // The panel stays in the safe area, and keeps the size the scene file gives it.
        expect(layout.panel.y + layout.panel.height).toBeLessThanOrEqual(
          stage.safe.y + stage.safe.height + 1e-9,
        );
        const spec = cardLayout(stage);
        expect(layout.panel.height).toBeCloseTo(spec.panel.height, 9);
        expect(layout.cause.visual.width).toBeCloseTo(spec.cause.visual.width, 9);
        expect(layout.cause.visual.height).toBeCloseTo(spec.cause.visual.height, 9);
        expect(layout.panel.y).toBeGreaterThanOrEqual(spec.panel.y);
      }
    },
  );
});

describe('the feature card headline that does not fit', () => {
  it('stops the render naming the scene and the text id, never setting it smaller', () => {
    const landscape = stageFor(1920, 1080);
    const problem = headlineProblem(
      'feature-replay',
      { id: 'replay-line', value: 'Watch sessions back like video' },
      landscape,
      headlineWidth(landscape, 72),
    );
    expect(problem).toContain('Scene "feature-replay", text "replay-line"');
    expect(problem).toContain('2 lines of 1141 px at the sentence cap height (78 px) at 1920x1080');
    const error = new FeatureCardLayoutError(problem);
    expect(error.message.startsWith('LAYOUT_UNFIT: Scene "feature-replay"')).toBe(true);
  });
});

describe('the feature card on a seam', () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, '../src/scenes/feature-card.tsx'),
    'utf8',
  );

  it('enters on the T1 seam with its panel, never on the anchor carry', () => {
    // A layer with an anchor id is carried from the outgoing scene's anchor. The first film's pivot
    // card carried this headline from mid-frame, at its own size, under the panel.
    expect(source).not.toMatch(/<SeamLayer\s+anchor=/);
    const seam = {
      name: 't1',
      seam: { axis: 'x', sign: 1, vPeak: 46, n: 11, r: 1.4, k: 0.7, D: 14 },
      carry: 'headline',
    } as never;
    const box = { x: 0, y: 0, width: 100, height: 100 };
    const transform = seamTransform({
      f: 0,
      dur: 72,
      in: seam,
      out: undefined,
      anchors: [{ id: 'headline', box: () => box }],
      carryFrom: { x: 500, y: 400, width: 50, height: 50 },
      stage: stageFor(1920, 1080),
    });
    expect(transform).toMatch(/^translateX\(-\d/);
  });

  it('draws the headline after the panel, so nothing covers it', () => {
    const body = source.slice(source.indexOf('const FeatureCard = '));
    const panel = body.indexOf('layout.panel.height');
    const headline = body.indexOf('<Headline');
    expect(panel).toBeGreaterThan(0);
    expect(headline).toBeGreaterThan(panel);
  });
});

describe('the feature card connector', () => {
  const portrait = stageFor(1080, 1920);
  const layout = cardLayout(portrait);
  const cause = cropRect(layout.cause, { aspect: 16 / 10 });
  const effect = cropRect(layout.effect, { aspect: 16 / 10 });

  it('starts under the cause label when the nodes are stacked', () => {
    // A label of two lines takes all of the space under its node.
    const labelBottom = layout.cause.label.y + layout.cause.label.height;
    const { from, to } = connectorEnds(layout.axis, cause, effect, labelBottom);
    expect(layout.axis).toBe('y');
    expect(from).toEqual({ x: cause.x + cause.width / 2, y: labelBottom });
    expect(from.y).toBeGreaterThan(layout.cause.label.y);
    expect(to).toEqual({ x: effect.x + effect.width / 2, y: effect.y });
    expect(to.y).toBeGreaterThan(from.y);
  });

  it('starts at the cause visual when there is no label, or the nodes sit side by side', () => {
    expect(connectorEnds('y', cause, effect, undefined).from.y).toBe(cause.y + cause.height);
    const landscape = cardLayout(stageFor(1920, 1080));
    const left = cropRect(landscape.cause, { aspect: 16 / 10 });
    const right = cropRect(landscape.effect, { aspect: 16 / 10 });
    expect(connectorEnds('x', left, right, landscape.cause.label.y + 40)).toEqual({
      from: { x: left.x + left.width, y: left.y + left.height / 2 },
      to: { x: right.x, y: right.y + right.height / 2 },
    });
  });
});

describe('the brand mark', () => {
  const SCENES = path.resolve(import.meta.dirname, '../src/scenes');

  it.each(Object.entries(sceneImplementations))(
    '%s declares where it draws the mark exactly when it draws one',
    (type, definition) => {
      const source = readFileSync(path.join(SCENES, `${type}.tsx`), 'utf8');
      const draws = /<(SceneMark|BrandMark)\b/.test(source);
      expect(definition.markAnchor !== undefined).toBe(draws);
    },
  );

  it('is not drawn on a feature card, whose scene file has none', () => {
    expect(sceneImplementations['feature-card']?.markAnchor).toBeUndefined();
  });
});
