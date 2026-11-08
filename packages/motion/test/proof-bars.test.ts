import { FORMATS } from '@boiler-room/schema';
import proofExample from '@boiler-room/schema/examples/proof-bars.campaign.json' with {
  type: 'json',
};
import { describe, expect, it } from 'vitest';
import { type SpecFit, type SpecTypeStyle, specPx } from '../src/components/type.tsx';
import { liftAt, typeDrift } from '../src/core/curves.ts';
import { validateFilm } from '../src/film/validate-film.ts';
import { validateForRender } from '../src/film/validate-render.ts';
import { fitBlock } from '../src/layout/fit.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../src/layout/stage.ts';
import {
  barBox,
  barStart,
  type Fitter,
  fillShare,
  headlineBox,
  headlinePose,
  layoutErrorMessage,
  numberShown,
  type ProofLayout,
  type ProofText,
  proofFrame,
  proofLayout,
  readBars,
  verdictAt,
  verdictScale,
} from '../src/scenes/proof-bars-layout.ts';
import { definitionOf } from '../src/scenes/registry.ts';

const stageOf = (format: Format) => {
  const { width, height } = FORMAT_SIZES[format];
  return stageFor(width, height);
};

const label = (id: string, value: string): ProofText => ({ id, role: 'label', value });

/** A face whose every character is 0.6 em wide, with a cap height of 0.7 em, fitted as `specFit` fits. */
const METRICS = { cap: 0.7, ascent: 0.95, descent: 0.25 };
const fakeFitter =
  (format: Format): Fitter =>
  (text: string, style: SpecTypeStyle, box: { width: number; maxLines: number }): SpecFit => {
    const targetSize = specPx(stageOf(format), style.cap) / METRICS.cap;
    const fit = fitBlock(
      {
        text,
        maxWidth: box.width,
        maxHeight: Number.POSITIVE_INFINITY,
        maxSize: targetSize,
        maxLines: box.maxLines,
        lineHeight: 1.1,
      },
      { widthOf: (line, size) => [...line].length * size * 0.6 },
    );
    return {
      ...fit,
      fontFamily: 'Test',
      weight: style.weight,
      lineHeight: 1.1,
      letterSpacing: '0',
      metrics: METRICS,
      targetSize,
    };
  };

const card = (headline: string, labels: string[], subhead?: string): ProofText[] => [
  { id: 'h', role: 'headline', value: headline },
  ...labels.map((value, index) => label(`l${index}`, value)),
  ...(subhead ? [{ id: 's', role: 'subhead' as const, value: subhead }] : []),
];

function laid(format: Format, text: ProofText[], radius = 12): ProofLayout {
  const result = proofLayout(text, stageOf(format), radius, fakeFitter(format));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.layout;
}

const issuesOf = (format: Format, text: ProofText[]) => {
  const result = proofLayout(text, stageOf(format), 12, fakeFitter(format));
  return result.ok ? [] : result.issues;
};

const frames = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** A function of the frame gives the same values whatever order the frames are asked in. */
function expectPure(value: (f: number) => unknown, from = -10, to = 110) {
  const inOrder = frames(from, to).map(value);
  const backwards = frames(from, to).reverse().map(value).reverse();
  const scattered = frames(from, to)
    .map((f, index) => ({ f, key: (index * 7919) % 127 }))
    .sort((a, b) => a.key - b.key)
    .map(({ f }) => ({ f, v: value(f) }))
    .sort((a, b) => a.f - b.f)
    .map(({ v }) => v);
  expect(backwards).toEqual(inOrder);
  expect(scattered).toEqual(inOrder);
}

describe('proof-bars reads its bars from the labels', () => {
  it('takes the one number of each label, and the rest as its name', () => {
    const { bars, issues } = readBars([label('a', 'With review: 35%'), label('b', 'Without: 12%')]);
    expect(issues).toEqual([]);
    expect(bars.map(({ name, number, share }) => ({ name, number, share }))).toEqual([
      { name: 'With review', number: '35%', share: 0.35 },
      { name: 'Without', number: '12%', share: 0.12 },
    ]);
  });

  it('keeps a unit word with its number, as the validator reads it', () => {
    const { bars } = readBars([label('a', 'Before: 41 min'), label('b', 'Nova: 9 min')]);
    expect(bars.map(({ name, number }) => [name, number])).toEqual([
      ['Before', '41 min'],
      ['Nova', '9 min'],
    ]);
    expect(bars.map(({ share }) => share)).toEqual([1, 9 / 41]);
  });

  it('keeps a noun that is not a unit in the name', () => {
    const { bars } = readBars([label('a', '1,200 teams'), label('b', '300 teams')]);
    expect(bars.map(({ name, number }) => [name, number])).toEqual([
      ['teams', '1,200'],
      ['teams', '300'],
    ]);
  });

  it('says which words are the name and which the number, for an accent', () => {
    const [bar] = readBars([label('a', 'With review: 35%')]).bars;
    expect(bar?.nameWords).toEqual([0, 1]);
    expect(bar?.numberWords).toEqual([2]);
  });

  it.each([
    ['no number', ['Faster reviews'], 'states no number'],
    ['two numbers', ['3x in 2 weeks: 40%'], 'states 3 numbers'],
    ['a number in words', ['Twelve teams'], 'in words'],
    ['no name', ['35%'], 'no name'],
  ])('refuses a label with %s', (_case, labels, message) => {
    const { bars, issues } = readBars(labels.map((value, index) => label(`l${index}`, value)));
    expect(bars).toEqual([]);
    expect(issues).toEqual([expect.objectContaining({ textId: 'l0' })]);
    expect(issues[0]?.message).toContain(message);
  });

  it('refuses bars of different kinds or units', () => {
    expect(readBars([label('a', 'Nova: 35%'), label('b', 'Old: 3x')]).issues).toEqual([
      expect.objectContaining({ textId: 'b', message: expect.stringContaining('mix kinds') }),
    ]);
    expect(readBars([label('a', 'Nova: 9 min'), label('b', 'Old: 2 h')]).issues).toEqual([
      expect.objectContaining({ textId: 'b' }),
    ]);
  });

  it('lets a percent stand alone on its 100% track, and nothing else', () => {
    expect(readBars([label('a', 'Retried: 78%')]).bars.map(({ share }) => share)).toEqual([0.78]);
    expect(readBars([label('a', 'Nova: 3x')]).issues).toEqual([
      expect.objectContaining({ textId: 'a', message: expect.stringContaining('only a percent') }),
    ]);
  });

  it('refuses a percent over 100, and bars that are all zero', () => {
    expect(readBars([label('a', 'Growth: 250%')]).issues).toEqual([
      expect.objectContaining({ textId: 'a' }),
    ]);
    expect(readBars([label('a', 'A: 0 min'), label('b', 'B: 0 min')]).issues).toEqual([
      expect.objectContaining({ textId: 'a' }),
    ]);
  });

  it('scales any other kind to the largest value', () => {
    const { bars } = readBars([
      label('a', 'Nova: 9 min'),
      label('b', 'Hosted CI: 26 min'),
      label('c', 'Laptop: 40 min'),
    ]);
    expect(bars.map(({ share }) => share)).toEqual([9 / 40, 26 / 40, 1]);
  });
});

describe('proof-bars clock', () => {
  it('starts the bars on 30, 34 and 36, the first at frame 7 of the lift', () => {
    expect([0, 1, 2].map(barStart)).toEqual([30, 34, 36]);
    expect(barStart(0) - 23).toBe(7);
  });

  it('stamps the verdict when the last bar is full, at most on 60', () => {
    expect([1, 2, 3].map(verdictAt)).toEqual([54, 58, 60]);
  });

  it('fills each bar over 24 frames on poly-4 out, and pops its number when full', () => {
    expect(fillShare(30, 0)).toBe(0);
    expect(fillShare(42, 0)).toBeCloseTo(1 - 0.5 ** 4, 10);
    expect(fillShare(54, 0)).toBe(1);
    expect(fillShare(80, 0)).toBe(1);
    expect(fillShare(29, 0)).toBe(0);
    expect(numberShown(53, 0)).toBe(false);
    expect(numberShown(54, 0)).toBe(true);
    expect(numberShown(59, 2)).toBe(false);
    expect(numberShown(60, 2)).toBe(true);
  });

  it('pops the verdict at 1.26 and settles it to drift only', () => {
    expect(verdictScale(59, 60)).toBe(0);
    expect(verdictScale(60, 60)).toBeCloseTo(1.26, 10);
    expect(verdictScale(61, 60)).toBeCloseTo((1 + 0.26 * 0.3) * typeDrift(1), 10);
    expect(verdictScale(84, 60)).toBeCloseTo(typeDrift(24), 6);
  });

  it('holds the hero drifting to 22, lifts it on 23 to 33, and sets it at the slot on 34', () => {
    const lift = 402;
    expect(headlinePose(0, lift)).toEqual({ dy: 0, scale: 1 });
    expect(headlinePose(22, lift)).toEqual({ dy: 0, scale: typeDrift(22) });
    // The lift starts from where the drift had reached, so nothing jumps on 23.
    expect(headlinePose(23, lift)).toEqual({ dy: -0, scale: typeDrift(23) });
    const middle = headlinePose(28, lift);
    expect(middle.dy).toBeCloseTo(-lift * liftAt(5), 10);
    expect(headlinePose(34, lift)).toEqual({ dy: -lift, scale: 0.77 });
    expect(headlinePose(95, lift)).toEqual({ dy: -lift, scale: 0.77 * typeDrift(61) });
  });

  it('is a pure function of the frame', () => {
    expectPure((f) => headlinePose(f, 402));
    expectPure((f) => [0, 1, 2].map((j) => fillShare(f, j)));
    expectPure((f) => verdictScale(f, 60));
  });
});

describe('proof-bars layout in each format', () => {
  it('puts the hero, the slot, the track, the rows and the verdict where the scene file says', () => {
    const at = (format: Format) => {
      const frame = proofFrame(stageOf(format), 12);
      return {
        heroY: frame.heroY,
        slotY: frame.slotY,
        trackX: frame.track.x,
        trackWidth: frame.track.width,
        rows: frame.rows,
        verdict: frame.verdictBaseline,
      };
    };
    const close = (value: number) => expect.closeTo(value, 6);
    expect(at('16:9')).toEqual({
      heroY: 540,
      slotY: 138,
      trackX: close(0.19 * 1920),
      trackWidth: close(1190.4),
      rows: [close(388.8), 540, close(691.2)],
      verdict: close(928.8),
    });
    expect(at('9:16')).toEqual({
      heroY: close(806.4),
      slotY: close(307.2),
      trackX: close(0.07 * 1080),
      trackWidth: close(928.8),
      rows: [close(614.4), close(806.4), close(998.4)],
      verdict: close(1267.2),
    });
    expect(at('1:1')).toEqual({
      heroY: 540,
      slotY: close(140.4),
      trackX: close(108),
      trackWidth: close(864),
      rows: [close(410.4), close(561.6), close(712.8)],
      verdict: close(928.8),
    });
  });

  it('lifts 402 px at 16:9, 499 at 9:16 and 400 at 1:1', () => {
    const lift = (format: Format) => {
      const { heroY, slotY } = proofFrame(stageOf(format), 12);
      return Math.round(heroY - slotY);
    };
    expect(FORMATS.map(lift)).toEqual([402, 499, 400]);
  });

  it('draws the track 54 px tall, its corners the brand radius up to 27', () => {
    expect(proofFrame(stageOf('16:9'), 12).track).toMatchObject({ height: 54, radius: 12 });
    expect(proofFrame(stageOf('16:9'), 40).track.radius).toBe(27);
  });

  it('keeps the hero no wider than a slot line of lineBox, and inside the safe area', () => {
    expect(proofFrame(stageOf('16:9'), 12).heroWidth).toBeCloseTo(1248 / 0.77, 6);
    expect(proofFrame(stageOf('9:16'), 12).heroWidth).toBe(stageOf('9:16').safe.width);
    expect(proofFrame(stageOf('1:1'), 12).heroWidth).toBe(stageOf('1:1').safe.width);
  });
});

describe('proof-bars layout of a card', () => {
  const cache = card('92% cached', ['Nova: 92%', 'Self-hosted: 41%'], 'Less waiting');

  it.each(FORMATS)('centres the hero and sets it at the slot at cap height 78 in %s', (format) => {
    const stage = stageOf(format);
    const layout = laid(format, cache);
    const { headline, frame } = layout;
    const cap = headline.fit.metrics.cap * headline.fit.fontSize;
    expect(headline.centreY).toBeCloseTo(frame.heroY, 6);
    // The type is set at the hero cap height, never shrunk, up to the font's whole pixel size.
    expect(headline.fit.fontSize).toBe(Math.floor(headline.fit.targetSize));
    expect(cap * 0.77).toBeGreaterThan(77);
    expect(cap * 0.77).toBeLessThanOrEqual(78);

    // At rest on 22 the box is centred on the frame; on 34 it is at the slot, scaled 0.77.
    const hero = headlineBox(layout, stage, 22);
    expect(hero.x + hero.width / 2).toBeCloseTo(stage.width / 2, 6);
    const slot = headlineBox(layout, stage, 34);
    expect(slot.height).toBeCloseTo(headline.height * 0.77, 6);
    const capCentre = slot.y + (headline.centreY - headline.top) * 0.77;
    expect(capCentre).toBeCloseTo(frame.slotY, 6);
  });

  it('holds the slot at one y on every card of a group, whatever its copy', () => {
    const other = card('9 min CI', ['Nova: 9 min', 'Laptop: 40 min'], 'Ship sooner');
    for (const format of FORMATS) {
      const stage = stageOf(format);
      const centre = (layout: ProofLayout) => {
        const box = headlineBox(layout, stage, 40);
        return box.y + box.height / 2;
      };
      expect(centre(laid(format, other))).toBeCloseTo(centre(laid(format, cache)), 6);
    }
  });

  it.each(FORMATS)('fills each bar to its share of the track by v0 in %s', (format) => {
    const layout = laid(format, cache);
    const v0 = layout.verdictAt;
    expect(v0).toBe(58);
    const track = layout.frame.track.width;
    expect(barBox(layout, 0, v0).width).toBeCloseTo(0.92 * track, 6);
    expect(barBox(layout, 1, v0).width).toBeCloseTo(0.41 * track, 6);
    expect(barBox(layout, 0, 29).width).toBe(0);
    expect(barBox(layout, 1, 33).width).toBe(0);
    // A bar the card does not have is an empty box on its row.
    expect(barBox(layout, 2, v0)).toMatchObject({ width: 0, x: layout.frame.track.x });
  });

  it('right-aligns each number to its fill, and never over its name', () => {
    const layout = laid('16:9', cache);
    const [nova, self] = layout.bars;
    if (!nova || !self) throw new Error('two bars expected');
    const end = (bar: typeof nova) => bar.numberX + bar.numberFit.width;
    expect(end(nova)).toBeCloseTo(nova.track.x + nova.length, 6);
    expect(self.numberX).toBeGreaterThanOrEqual(self.track.x + self.nameFit.width + 24);
    // Every character on screen is a piece of a label.
    for (const bar of layout.bars) {
      const value = cache.find(({ id }) => id === bar.textId)?.value ?? '';
      expect(value).toContain(bar.number);
      for (const word of bar.name.split(' ')) expect(value).toContain(word);
    }
  });

  it('keeps every number clear of the bar above it', () => {
    const layout = laid('16:9', card('9 min CI', ['A: 9 min', 'B: 26 min', 'C: 40 min']));
    for (const [index, bar] of layout.bars.entries()) {
      if (index === 0) continue;
      const above = layout.bars[index - 1];
      if (!above) continue;
      const capTop = bar.baseline - bar.numberFit.metrics.cap * bar.numberFit.fontSize;
      expect(capTop).toBeGreaterThanOrEqual(above.track.y + above.track.height + 8);
    }
  });

  it('is the same layout however often it is asked for', () => {
    const boxes = (layout: ProofLayout) =>
      frames(0, 95).map((f) => [
        headlineBox(layout, stageOf('16:9'), f),
        barBox(layout, 0, f),
        barBox(layout, 1, f),
      ]);
    expect(boxes(laid('16:9', cache))).toEqual(boxes(laid('16:9', cache)));
    const layout = laid('16:9', cache);
    expectPure((f) => [headlineBox(layout, stageOf('16:9'), f), barBox(layout, 1, f)]);
  });
});

describe('proof-bars fits or fails', () => {
  it('refuses a headline that would need more than two lines at hero size', () => {
    const issues = issuesOf('16:9', card('Reviews land faster than ever before today', ['A: 35%']));
    expect(issues).toEqual([
      expect.objectContaining({ textId: 'h', message: expect.stringContaining('does not fit') }),
    ]);
  });

  it('refuses a two-line headline where the slot would rise out of the safe area', () => {
    const twoLines = card('Reviews land faster', ['With review: 35%']);
    expect(issuesOf('16:9', twoLines)).toEqual([
      expect.objectContaining({
        textId: 'h',
        message: expect.stringContaining('above the safe area'),
      }),
    ]);
    expect(issuesOf('1:1', twoLines)).toEqual([expect.objectContaining({ textId: 'h' })]);
    // A tall frame has the room.
    expect(issuesOf('9:16', twoLines)).toEqual([]);
    expect(laid('9:16', twoLines).headline.fit.lines).toHaveLength(2);
  });

  it('refuses a bar name and number that cannot share a line across the track', () => {
    const issues = issuesOf(
      '1:1',
      card('9 min CI', ['Self-hosted runners: 40 min', 'Nova: 9 min']),
    );
    expect(issues).toEqual([
      expect.objectContaining({ textId: 'l0', message: expect.stringContaining('one line') }),
    ]);
  });

  it('refuses a verdict that would leave the safe area, where a tall frame takes it', () => {
    const long = card('92% cached', ['Nova: 92%'], 'Builds skip the queue');
    expect(issuesOf('1:1', long)).toEqual([
      expect.objectContaining({ textId: 's', message: expect.stringContaining('safe area') }),
    ]);
    expect(issuesOf('9:16', long)).toEqual([]);
  });

  it('passes on the bar rules, naming the label', () => {
    expect(issuesOf('16:9', card('92% cached', ['Nova: 92%', 'Old: 3x']))).toEqual([
      expect.objectContaining({ textId: 'l1' }),
    ]);
  });

  it('stops the render with an error naming the scene, the frame size and each text id', () => {
    const message = layoutErrorMessage('scene "proof"', stageOf('1:1'), [
      { textId: 'proof-headline', message: 'Too long.', fix: 'Shorten it.' },
    ]);
    expect(message).toContain('Layout error in proof-bars scene "proof" at 1080x1080');
    expect(message).toContain('text "proof-headline": Too long. Shorten it.');
  });
});

describe('the proof-bars template', () => {
  const definition = definitionOf('proof-bars');

  it('is registered with the roles, props and anchors its scene file gives', () => {
    expect(definition?.roles).toEqual({
      headline: { min: 1, max: 1 },
      label: { min: 1, max: 3 },
      subhead: { min: 0, max: 1 },
    });
    expect(definition?.image).toBe('none');
    expect(definition?.anchors.map(({ id, colour }) => [id, colour])).toEqual([
      ['headline', undefined],
      ['bar-0', 'accent'],
      ['bar-1', 'accent'],
      ['bar-2', 'accent'],
    ]);
    expect(definition?.props.safeParse({ accent: { textId: 'h', from: 0, to: 1 } }).success).toBe(
      true,
    );
    expect(definition?.props.safeParse({ value: 35 }).success).toBe(false);
  });

  it.each(FORMATS)('renders the example campaign in %s, as validated', async (format) => {
    const validation = await validateForRender(structuredClone(proofExample));
    expect(validation.issues).toEqual([]);
    if (!validation.ok) throw new Error('the example must validate');
    expect(validateFilm(validation.campaign, format)).toEqual([]);
  });
});
