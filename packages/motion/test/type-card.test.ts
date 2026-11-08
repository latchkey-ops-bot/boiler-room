import type { Campaign } from '@boiler-room/schema';
import typeCards from '@boiler-room/schema/examples/nova-type-cards.campaign.json' with {
  type: 'json',
};
import { describe, expect, it } from 'vitest';
import { type Seam, seamIn, wordGapGain } from '../src/core/curves.ts';
import { validateFilm } from '../src/film/validate-film.ts';
import { validateForRender } from '../src/film/validate-render.ts';
import { stageFor } from '../src/layout/stage.ts';
import { anchorVelocities, groundOf } from '../src/scenes/definition.ts';
import {
  type MeasuredLine,
  placeLines,
  slotCentre,
  type TypeCardEntry,
  TypeCardLayoutError,
  type TypeCardVariant,
  typeCard,
  typeCardBeats,
  typeCardBox,
  typeCardEntry,
  typeCardState,
} from '../src/scenes/type-card.tsx';
import { seamTransform } from '../src/transitions/seam-layer.tsx';
import { buildTimeline } from '../src/transitions/timeline.ts';

const landscape = stageFor(1920, 1080);
const portrait = stageFor(1080, 1920);
const square = stageFor(1080, 1080);

/** A line of Sora-like metrics at the size a 78 px cap needs: cap 0.7 em, 112 px. */
const line = (
  words: string[],
  role: MeasuredLine['role'] = 'headline',
  size = 112,
  first = 0,
): MeasuredLine => ({
  textId: role === 'headline' ? 'line' : 'more',
  role,
  words,
  first,
  fontSize: size,
  width: words.join(' ').length * size * 0.55,
  height: 1.1 * size,
  // CSS centres the font's 0.95 em ascent and 0.25 em descent in the 1.1 em line.
  baseline: ((1.1 - 0.95 - 0.25) / 2 + 0.95) * size,
  cap: 0.7 * size,
});

const layoutOf = (
  measured: MeasuredLine[],
  variant: TypeCardVariant = 'default',
  stage = landscape,
) => {
  const centre = slotCentre(stage);
  return {
    variant,
    centre,
    headlineWords: measured
      .filter(({ role }) => role === 'headline')
      .reduce((sum, { words }) => sum + words.length, 0),
    ...placeLines(measured, centre),
  };
};

const twoLines = () =>
  layoutOf([line(['Every', 'build', 'waits']), line(['in', 'one', 'line.'], 'headline', 112, 3)]);
const withSubhead = (variant: TypeCardVariant = 'default') =>
  layoutOf(
    [
      line(
        variant === 'name' ? ['Nova'] : ['Ship', 'sooner.'],
        'headline',
        variant === 'name' ? 168 : 112,
      ),
      line(['Every', 'push.'], 'subhead'),
    ],
    variant,
  );

const native: TypeCardEntry = { kind: 'native' };
const seamX: Seam = { axis: 'x', sign: 1, vPeak: 46, n: 11, r: 1.4, k: 0.7, D: 14 };

const frames = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

describe('type-card layout', () => {
  it('sets its slot at the middle of 16:9 and 1:1, and at 0.45 H in 9:16', () => {
    expect(slotCentre(landscape)).toEqual({ x: 960, y: 540 });
    expect(slotCentre(square)).toEqual({ x: 540, y: 540 });
    expect(slotCentre(portrait)).toEqual({ x: 540, y: 864 });
  });

  it('centres one line on the slot from its cap top to its baseline', () => {
    const { lines, aloneBaseline, travel } = layoutOf([line(['Ship', 'sooner.'])]);
    const [one] = lines;
    expect(travel).toBe(0);
    expect(one?.restBaseline).toBe(aloneBaseline);
    expect((one?.restBaseline ?? 0) - (one?.cap ?? 0) / 2).toBeCloseTo(540, 10);
  });

  it('centres two lines on the slot, line 1 resting half a line above where it stood alone', () => {
    const layout = twoLines();
    const [one, two] = layout.lines as [
      MeasuredLine & { restBaseline: number },
      (typeof layout.lines)[0],
    ];
    // One size: the push travel is `lineHeight * fontSize / 2`, as the scene file writes it.
    expect(layout.travel).toBeCloseTo((1.1 * 112) / 2, 10);
    expect(layout.aloneBaseline - one.restBaseline).toBeCloseTo(layout.travel, 10);
    expect((two?.restBaseline ?? 0) - one.restBaseline).toBeCloseTo(1.1 * 112, 10);
    const capTop = one.restBaseline - one.cap;
    expect((capTop + (two?.restBaseline ?? 0)) / 2).toBeCloseTo(540, 10);
  });

  it('gives the block box as the union of the line boxes, centred on x', () => {
    const layout = twoLines();
    const [one, two] = layout.lines;
    expect(layout.block.x + layout.block.width / 2).toBeCloseTo(960, 10);
    expect(layout.block.width).toBe(Math.max(one?.width ?? 0, two?.width ?? 0));
    expect(layout.block.height).toBeCloseTo(2 * 1.1 * 112, 10);
  });

  it('stacks a larger name over its subhead, centred from the name cap top to the subhead baseline', () => {
    const layout = withSubhead('name');
    const [name, more] = layout.lines;
    const capTop = (name?.restBaseline ?? 0) - (name?.cap ?? 0);
    expect((capTop + (more?.restBaseline ?? 0)) / 2).toBeCloseTo(540, 10);
    expect(name?.cap).toBeCloseTo(117.6, 10);
  });

  it('drifts the box larger about the slot, so the block stays centred on it', () => {
    for (const stage of [landscape, portrait, square]) {
      const layout = layoutOf([line(['Every', 'build', 'waits'])], 'default', stage);
      const atRest = typeCardBox(layout, 22);
      const later = typeCardBox(layout, 32);
      expect(later.width).toBeGreaterThan(atRest.width);
      expect(later.width / layout.block.width).toBeCloseTo(1 + 0.0013 * 32, 10);
      // The slot is the fixed point of the drift: every point of the block moves away from it.
      const middle = layout.block.y + layout.block.height / 2;
      for (const [f, box] of [
        [22, atRest],
        [32, later],
      ] as const) {
        expect(box.x + box.width / 2).toBeCloseTo(layout.centre.x, 10);
        const s = 1 + 0.0013 * f;
        expect(box.y + box.height / 2).toBeCloseTo(
          layout.centre.y + (middle - layout.centre.y) * s,
          10,
        );
      }
    }
  });

  it('names the scene and the text id when copy does not fit', () => {
    const error = new TypeCardLayoutError('value', 'value-line', 'too long.', 'Shorten it.');
    expect(error.message).toBe(
      'TYPE_CARD_LAYOUT at scene "value", text "value-line": too long. Shorten it.',
    );
    expect(error.textId).toBe('value-line');
  });
});

describe('type-card frames', () => {
  it('lands the last word on L and rests on L + 13', () => {
    expect(typeCardBeats(layoutOf([line(['Ship', 'sooner.', 'now.'])]))).toEqual({
      line2Start: undefined,
      lastWord: 2,
      rest: 15,
    });
    // Line 2 of the headline starts on n1 + 4.
    expect(typeCardBeats(twoLines())).toEqual({ line2Start: 7, lastWord: 9, rest: 22 });
    // The subhead starts on nH + 3.
    expect(typeCardBeats(withSubhead())).toEqual({ line2Start: 5, lastWord: 6, rest: 19 });
    // The name appears whole on frame 0, so only its subhead arrives later.
    expect(typeCardBeats(layoutOf([line(['Nova'])], 'name'))).toEqual({
      line2Start: undefined,
      lastWord: 0,
      rest: 13,
    });
    expect(typeCardBeats(withSubhead('name'))).toEqual({ line2Start: 4, lastWord: 5, rest: 18 });
  });

  it('pops each word in at full opacity 72 px low, one frame apart, and rises by 0.75 a frame', () => {
    const layout = twoLines();
    const at = (f: number) => typeCardState(f, layout, native).lines;
    // f = 0 after a T3: the first word visible and offset 72 px.
    expect(at(0)[0]?.words.map(({ visible }) => visible)).toEqual([true, false, false]);
    expect(at(0)[0]?.words[0]?.y).toBe(72);
    expect(at(1)[0]?.words[0]?.y).toBe(54);
    expect(at(1)[0]?.words[1]).toEqual({ visible: true, x: 0, y: 72 });
    // Line 2 waits until n1 + 4 = 7.
    expect(at(6)[1]?.words.some(({ visible }) => visible)).toBe(false);
    expect(at(7)[1]?.words[0]).toEqual({ visible: true, x: 0, y: 72 });
    // By rest = L + 13 every word is within 2 px of its place.
    for (const words of at(22).map((row) => row.words)) {
      for (const word of words) expect(word.visible && word.y < 2).toBe(true);
    }
  });

  it('pushes line 1 up 60% of the way on line 2s first frame, to its rest', () => {
    const layout = twoLines();
    const baseline = (f: number) => typeCardState(f, layout, native).lines[0]?.baseline ?? 0;
    expect(baseline(6)).toBe(layout.aloneBaseline);
    expect(layout.aloneBaseline - baseline(7)).toBeCloseTo(0.6 * layout.travel, 10);
    expect(baseline(22)).toBeCloseTo(layout.lines[0]?.restBaseline ?? 0, 4);
    // Line 2 sits at its place in the final block from its first frame.
    expect(typeCardState(7, layout, native).lines[1]?.baseline).toBe(layout.lines[1]?.restBaseline);
  });

  it('rises a subhead 26 px by 0.5 a frame from nH + 3', () => {
    const lines = (f: number) => typeCardState(f, withSubhead(), native).lines;
    expect(lines(4)[1]?.words[0]?.visible).toBe(false);
    expect(lines(5)[1]?.words[0]).toEqual({ visible: true, x: 0, y: 26 });
    expect(lines(6)[1]?.words[0]?.y).toBe(13);
    expect(lines(6)[1]?.words[1]).toEqual({ visible: true, x: 0, y: 26 });
  });

  it('enters the name as one unit on arriveN(f, 0.88, 35), from 72 px', () => {
    const layout = layoutOf([line(['Nova', 'Labs'], 'headline', 168)], 'name');
    const words = (f: number) => typeCardState(f, layout, native).lines[0]?.words ?? [];
    expect(words(0)).toEqual([
      { visible: true, x: 0, y: 72 },
      { visible: true, x: 0, y: 72 },
    ]);
    const mid = words(10)[0]?.y ?? 0;
    expect(mid).toBeCloseTo(72 * (1 - (1 - 0.88 ** 10) / (1 - 0.88 ** 35)), 10);
    expect(words(35)[0]?.y).toBe(0);
    // Smaller every frame: no overshoot.
    const ys = frames(0, 40).map((f) => words(f)[0]?.y ?? 0);
    for (const [index, y] of ys.entries())
      if (index > 0) expect(y).toBeLessThanOrEqual(ys[index - 1] ?? 0);
  });

  it('shows every word at rest from frame 0 on a T1, each moving seamIn times its word-gap gain', () => {
    const layout = twoLines();
    const entry: TypeCardEntry = { kind: 't1', seam: seamX };
    for (const f of [0, 1, 5, 13, 14]) {
      const state = typeCardState(f, layout, entry);
      for (const row of state.lines) {
        expect(row.words.every(({ visible, y }) => visible && y === 0)).toBe(true);
        for (const [index, word] of row.words.entries()) {
          // The seam moves right, so the trailing side is the left: the first word of the line.
          const d = (row.words.length - 1) / 2 - index;
          // The seam layer moves every word by seamIn; each word adds the rest of its gain.
          expect(seamIn(f, seamX) + word.x).toBeCloseTo(seamIn(f, seamX) * wordGapGain(d), 10);
        }
      }
      expect(state.lines.map(({ baseline }) => baseline)).toEqual(
        layout.lines.map(({ restBaseline }) => restBaseline),
      );
    }
    // At f = 0 every word is displaced against the seam, the trailing word, on the left, furthest:
    // the gaps start stretched and close up, as in ref A, so no two words ever touch.
    const first = typeCardState(0, layout, entry).lines[0]?.words ?? [];
    expect(seamIn(0, seamX)).toBeLessThan(0);
    expect(first[0]?.x).toBeLessThan(0);
    expect(first[1]?.x).toBe(0);
    expect(first[2]?.x).toBeGreaterThan(0);
    for (const f of frames(0, 14)) {
      const words = typeCardState(f, layout, entry).lines[0]?.words ?? [];
      const xs = words.map(({ x }) => x);
      // Each gap is at least as wide as at rest on every frame of the entry.
      for (const [index, x] of xs.entries())
        if (index > 0) expect(x).toBeGreaterThanOrEqual(xs[index - 1] ?? 0);
    }
  });

  it('stretches the gaps on a T1 moving left, and on a right-to-left line, from the trailing side', () => {
    const left: TypeCardEntry = { kind: 't1', seam: { ...seamX, sign: -1 } };
    const ltr = typeCardState(0, twoLines(), left).lines[0]?.words ?? [];
    // Moving left, the words start displaced to the right, the last word furthest.
    expect(seamIn(0, { ...seamX, sign: -1 })).toBeGreaterThan(0);
    expect(ltr[2]?.x).toBeGreaterThan(0);
    expect(ltr[0]?.x).toBeLessThan(0);
    // A Hebrew line runs its first word from the right, so on a seam moving right that word leads
    // and the last word, on the left, trails.
    const hebrew = layoutOf([line(['כל', 'בנייה', 'מחכה'])]);
    const right: TypeCardEntry = { kind: 't1', seam: seamX };
    const rtl = typeCardState(0, hebrew, right).lines[0]?.words ?? [];
    expect(rtl[2]?.x).toBeLessThan(0);
    expect(rtl[1]?.x).toBe(0);
    expect(rtl[0]?.x).toBeGreaterThan(0);
  });

  it('moves its block on the seam even where the resolver names a carry, at full size', () => {
    // The block's layer has no anchor id, so the carry the resolver names is not drawn: the layer
    // takes seamIn, displaced against the seam and moving with it, never a box-to-box scale.
    const into = { name: 't1', seam: seamX, carry: 'headline' } as never;
    const box = { x: 0, y: 0, width: 100, height: 100 };
    const transform = (f: number) =>
      seamTransform({
        f,
        dur: 48,
        in: into,
        out: undefined,
        anchors: [{ id: 'headline', box: () => box }],
        carryFrom: { x: 0, y: 0, width: 50, height: 50 },
        stage: landscape,
      });
    expect(transform(0)).toBe(`translateX(${seamIn(0, seamX)}px)`);
    expect(transform(0)).not.toContain('scale');
    expect(transform(14)).toBeUndefined();
  });

  it('racks every word in at full ink after a T5: blur 6, 3, 1.2, 0 and y 13, 7, 4, 1, 0', () => {
    const layout = twoLines();
    const at = (f: number) => typeCardState(f, layout, { kind: 't5', blank: 2 });
    expect(
      at(1)
        .lines.flatMap(({ words }) => words)
        .some(({ visible }) => visible),
    ).toBe(false);
    expect(frames(2, 6).map((f) => [at(f).blur, at(f).y])).toEqual([
      [6, 13],
      [3, 7],
      [1.2, 4],
      [0, 1],
      [0, 0],
    ]);
    expect(
      at(2)
        .lines.flatMap(({ words }) => words)
        .every(({ visible }) => visible),
    ).toBe(true);
    // The block holds its final place: nothing pushes after a blink.
    expect(at(2).lines.map(({ baseline }) => baseline)).toEqual(
      layout.lines.map(({ restBaseline }) => restBaseline),
    );
  });

  it('keeps a pivot blank for 5 frames and sharp on frame 8', () => {
    const layout = layoutOf([line(['No', 'waiting.'])], 'pivot');
    const at = (f: number) => typeCardState(f, layout, { kind: 't5', blank: 5 });
    for (const f of frames(0, 4)) {
      expect(at(f).lines[0]?.words.some(({ visible }) => visible)).toBe(false);
    }
    expect(at(5).blur).toBe(6);
    expect(at(8).blur).toBe(0);
  });

  it('drifts on the unclamped frame, whatever the entry', () => {
    for (const entry of [native, { kind: 't5', blank: 2 } as const]) {
      expect(typeCardState(60, twoLines(), entry).drift).toBeCloseTo(1 + 0.0013 * 60, 10);
    }
  });

  it('is a pure function of the frame', () => {
    const layout = withSubhead();
    for (const entry of [
      native,
      { kind: 't5', blank: 2 } as const,
      { kind: 't1', seam: seamX } as const,
    ]) {
      const inOrder = frames(0, 60).map((f) => typeCardState(f, layout, entry));
      const backwards = frames(0, 60)
        .reverse()
        .map((f) => typeCardState(f, layout, entry))
        .reverse();
      expect(backwards).toEqual(inOrder);
    }
  });

  it('chooses the entry from the transition the resolver chose', () => {
    const t1 = { name: 't1', seam: seamX, carry: 'headline' } as const;
    expect(typeCardEntry({ in: undefined, b: 0 })).toEqual(native);
    expect(typeCardEntry({ in: { name: 't3' } as never, b: 0 })).toEqual(native);
    expect(typeCardEntry({ in: { name: 't5' } as never, b: 5 })).toEqual({ kind: 't5', blank: 5 });
    expect(typeCardEntry({ in: t1 as never, b: 0 })).toEqual({ kind: 't1', seam: seamX });
  });
});

describe('type-card definition', () => {
  it('is a type scene on the base ground in Neutral Cut and the plate in Kinetic Plate', () => {
    expect(typeCard.kind).toBe('type');
    expect(groundOf(typeCard, {}, 'neutral-cut')).toBe('base');
    expect(groundOf(typeCard, {}, 'kinetic-plate')).toBe('plate');
  });

  it('enters on x at 46 px/f and leaves on x, or on y at 36 px/f for the name', () => {
    const x = { axis: 'x', sign: 1, v: 46 };
    expect(anchorVelocities(typeCard, {})).toEqual([{ id: 'headline', entry: x, exit: x }]);
    expect(anchorVelocities(typeCard, { variant: 'pivot' })).toEqual([
      { id: 'headline', entry: x, exit: x },
    ]);
    expect(anchorVelocities(typeCard, { variant: 'name' })).toEqual([
      { id: 'headline', entry: x, exit: { axis: 'y', sign: -1, v: 36 } },
    ]);
  });

  it('sets one headline and at most one subhead, and takes parameters only in props', () => {
    expect(typeCard.roles).toEqual({ headline: { min: 1, max: 1 }, subhead: { min: 0, max: 1 } });
    expect(typeCard.image).toBe('none');
    const parse = (props: unknown) => typeCard.props.safeParse(props).success;
    expect(parse({})).toBe(true);
    expect(parse({ variant: 'name' })).toBe(true);
    expect(parse({ variant: 'pivot', accent: { textId: 'line', from: 0, to: 1 } })).toBe(true);
    expect(parse({ variant: 'hero' })).toBe(false);
    // Copy never travels in props: the schema is strict.
    expect(parse({ headline: 'Ship sooner.' })).toBe(false);
  });
});

describe('the type-card example campaign', () => {
  const campaign = () => structuredClone(typeCards) as Campaign;

  it('passes the render gate and the film checks in every format', async () => {
    const gated = await validateForRender(campaign());
    expect(gated.issues).toEqual([]);
    for (const format of ['16:9', '9:16', '1:1'] as const) {
      expect(validateFilm(campaign(), format)).toEqual([]);
    }
  });

  it('enters its cards by T3, T5, the chapter T5, and T1, and leaves the name on y', () => {
    const { spans } = buildTimeline(campaign());
    expect(
      spans.map((span) => [span.id, span.in?.name, span.in?.blank, span.in?.seam?.axis]),
    ).toEqual([
      ['problem', undefined, undefined, undefined],
      ['value', 't3', 0, undefined],
      ['proof', 't5', 2, undefined],
      ['feature', 't1', 0, 'x'],
      ['pivot', 't5', 5, undefined],
      ['callback', 't1', 0, 'x'],
      ['name', 't1', 0, 'x'],
      ['close', 't1', 0, 'y'],
    ]);
  });

  it('gives every card at least card.min frames: max(43, ceil(6.5 * words))', () => {
    const { spans } = buildTimeline(campaign());
    for (const [index, scene] of campaign().scenes.entries()) {
      if (scene.type !== 'type-card') continue;
      const words = scene.text
        .map(({ value }) => value.trim().split(/\s+/).length)
        .reduce((sum, count) => sum + count, 0);
      expect(words).toBeLessThanOrEqual(8);
      expect(spans[index]?.durationInFrames).toBeGreaterThanOrEqual(
        Math.max(43, Math.ceil(6.5 * words)),
      );
    }
  });
});
