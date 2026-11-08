import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FORMATS } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { lineBox, type SpecFit } from '../src/components/type.tsx';
import { typeDrift } from '../src/core/curves.ts';
import { FORMAT_SIZES, stageFor } from '../src/layout/stage.ts';
import {
  cardLayout,
  connectorEnds,
  cropRect,
  headlineBox,
  headlineWidth,
} from '../src/scenes/feature-card.tsx';
import { sceneImplementations } from '../src/scenes/registry.ts';

const stages = FORMATS.map((format) => {
  const { width, height } = FORMAT_SIZES[format];
  return [format, stageFor(width, height)] as const;
});

/** A headline set as wide as it may be: one line that fills the width it is given. */
const widest = (width: number): SpecFit =>
  ({
    fontSize: 100,
    lines: ['headline'],
    height: 110,
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
    for (const f of [0, dur / 2, dur]) {
      const box = headlineBox(widest(width), stage, top, f);
      expect(box.x).toBeGreaterThanOrEqual(stage.safe.x - 1e-9);
      expect(box.x + box.width).toBeLessThanOrEqual(stage.safe.x + stage.safe.width + 1e-9);
    }
  });

  it('is set in the line box, and smaller only where its drift would leave the safe area', () => {
    const shrunk = LENGTHS.filter((dur) => headlineWidth(stage, dur) < lineBox(stage));
    for (const dur of LENGTHS) {
      const drifted = lineBox(stage) * typeDrift(dur);
      if (shrunk.includes(dur)) {
        expect(drifted).toBeGreaterThan(stage.safe.width);
        expect(headlineWidth(stage, dur)).toBeCloseTo(stage.safe.width / typeDrift(dur), 9);
      } else {
        expect(drifted).toBeLessThanOrEqual(stage.safe.width);
      }
    }
    // 16:9 is set as before. In 9:16 every card would drift off both edges, and in 1:1 Nova's
    // 150-frame card would.
    expect(shrunk).toEqual({ '16:9': [], '9:16': LENGTHS, '1:1': [150] }[format]);
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
