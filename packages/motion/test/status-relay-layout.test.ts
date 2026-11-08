import { describe, expect, it } from 'vitest';
import { type SpecFit, type SpecTypeStyle, specPx } from '../src/components/type.tsx';
import { fitBlock } from '../src/layout/fit.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../src/layout/stage.ts';
import type { Fitter } from '../src/scenes/proof-bars-layout.ts';
import {
  actorBox,
  actorRotation,
  chipArrival,
  chipScale,
  chipStart,
  chipTravel,
  lineDoneAt,
  type RelayCard,
  type RelayLayout,
  type RelayText,
  relayErrorMessage,
  relayFrame,
  relayLayout,
  relayState,
  shimmer,
  statusBox,
  wordDevelop,
} from '../src/scenes/status-relay-layout.ts';

const FORMATS: Format[] = ['16:9', '9:16', '1:1'];
const stageOf = (format: Format) => {
  const { width, height } = FORMAT_SIZES[format];
  return stageFor(width, height);
};

/** A face whose every character is 0.5 em wide, with a cap height of 0.7 em, fitted as `specFit` fits. */
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
      { widthOf: (line, size) => [...line].length * size * 0.5 },
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

const HEADLINE = 'We do it as one';
const card = (headline = HEADLINE, labels: string[] = []): RelayText[] => [
  { id: 'h', role: 'headline', value: headline },
  ...labels.map((value, index) => ({ id: `l${index}`, role: 'label' as const, value })),
];

function laid(format: Format, text = card()): RelayLayout {
  const result = relayLayout(text, stageOf(format), fakeFitter(format));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.layout;
}

const issuesOf = (format: Format, text: RelayText[]) => {
  const result = relayLayout(text, stageOf(format), fakeFitter(format));
  return result.ok ? [] : result.issues;
};

const FIRST: RelayCard = { first: true };
const LATER: RelayCard = { first: false };
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('status-relay layout', () => {
  it('puts the actor, rail and line where the Layout table says at 16:9', () => {
    const stage = stageOf('16:9');
    const { frame } = laid('16:9');
    expect(frame.actor).toEqual({ x: 576 - 75.5, y: 540 - 75.5, width: 151, height: 151 });
    expect(frame.centre).toEqual({ x: 576, y: 540 });
    expect(frame.slot.x).toBeCloseTo(0.38 * 1920);
    expect(frame.slot.width).toBeCloseTo(0.57 * 1920);
    // vertically centred on the actor
    expect(frame.slot.y + frame.slot.height / 2).toBeCloseTo(540);
    // the rail: 2 px, from the left edge to the actor's left side, on the centre line
    expect(frame.rail).toEqual({ x: 0, y: 539, width: frame.actor.x, height: 2 });
    expect(stage.width).toBe(1920);
  });

  it('centres the actor at 0.50 W, 0.38 H at 9:16, with a vertical rail from the top edge', () => {
    const { frame } = laid('9:16');
    expect(frame.centre).toEqual({ x: 540, y: 0.38 * 1920 });
    expect(frame.slot.width).toBeCloseTo(929, 0);
    expect(frame.rail.x + frame.rail.width / 2).toBe(540);
    expect(frame.rail.y).toBe(0);
    expect(frame.rail.y + frame.rail.height).toBeCloseTo(frame.actor.y);
    expect(frame.rail.width).toBe(2);
  });

  it('centres the actor at 0.50 W, 0.36 H at 1:1, with a horizontal rail as 16:9', () => {
    const { frame } = laid('1:1');
    expect(frame.centre).toEqual({ x: 540, y: 0.36 * 1080 });
    expect(frame.slot.width).toBeCloseTo(864);
    expect(frame.rail.x).toBe(0);
    expect(frame.rail.height).toBe(2);
    expect(frame.rail.y + 1).toBeCloseTo(frame.centre.y);
  });

  it.each(FORMATS)('sets the line at capS on its baseline, never below capS, at %s', (format) => {
    const stage = stageOf(format);
    const { line, frame } = laid(format);
    // `fitBlock` sets whole font sizes, so the cap is within one size step of capS.
    const cap = line.fit.fontSize * line.fit.metrics.cap;
    expect(cap).toBeLessThanOrEqual(specPx(stage, 78) + 1e-9);
    expect(cap).toBeGreaterThan(specPx(stage, 78) - line.fit.metrics.cap);
    expect(line.fit.lines).toHaveLength(1);
    if (format === '16:9') {
      expect(line.left).toBeCloseTo(0.38 * 1920);
      expect(line.baseline - (line.fit.fontSize * line.fit.metrics.cap) / 2).toBeCloseTo(
        frame.centre.y,
      );
    } else {
      expect(line.left + line.width / 2).toBeCloseTo(stage.width / 2);
      expect(line.baseline).toBeCloseTo(stage.height * (format === '9:16' ? 0.52 : 0.6));
    }
  });

  it('draws the chips as 120 x 40 pills and the labels at 22 px', () => {
    const { chips } = laid('16:9', card(HEADLINE, ['Read docs', 'Run checks']));
    expect(chips).toHaveLength(2);
    expect(chips[0]?.size).toEqual({ width: 120, height: 40 });
    expect(chips.map(({ label }) => label)).toEqual(['Read docs', 'Run checks']);
    expect(chips[0]?.labelFit?.fontSize).toBeCloseTo(22);
  });

  it('greeks the chips when no label is given: three pills, with no copy to hold a numeral', () => {
    const { chips } = laid('16:9');
    expect(chips).toHaveLength(3);
    for (const chip of chips) {
      expect(chip.label).toBeUndefined();
      expect(chip.textId).toBeUndefined();
      expect(chip.greek).toBeGreaterThan(0);
    }
  });

  it.each(FORMATS)(
    'refuses a line that does not fit, naming the scene and the text, at %s',
    (format) => {
      const issues = issuesOf(format, card('Everything you need to know today'));
      expect(issues).toEqual([expect.objectContaining({ textId: 'h' })]);
      const message = relayErrorMessage('scene "s1"', stageOf(format), issues);
      expect(message).toContain('status-relay');
      expect(message).toContain('text "h"');
    },
  );

  it('refuses a line of one word, a label that does not fit, and a fourth label', () => {
    expect(issuesOf('16:9', card('Hi'))).toEqual([expect.objectContaining({ textId: 'h' })]);
    expect(issuesOf('16:9', card(HEADLINE, ['An extremely long label']))).toEqual([
      expect.objectContaining({ textId: 'l0' }),
    ]);
    expect(issuesOf('16:9', card(HEADLINE, ['A b', 'C d', 'E f', 'G h']))).toEqual([
      expect.objectContaining({ textId: 'l3' }),
    ]);
    expect(issuesOf('16:9', [{ id: 'x', role: 'label', value: 'A b' }])).toEqual([
      expect.objectContaining({ textId: 'headline' }),
    ]);
  });

  it('keeps the anchors: the actor box is the same on every card, the status box is the slot', () => {
    const layout = laid('16:9');
    expect(actorBox(layout)).toEqual(layout.frame.actor);
    expect(statusBox(layout)).toEqual(layout.frame.slot);
    expect(relayFrame(stageOf('16:9')).actor).toEqual(
      laid('16:9', card('Read. Check. Ship.')).frame.actor,
    );
  });
});

describe('status-relay timing', () => {
  it('develops word j on clamp((f - start - 2 j) / 6, 0, 1), from 0 or 6', () => {
    expect(wordDevelop(0, 0, true)).toBe(0);
    expect(wordDevelop(3, 0, true)).toBe(0.5);
    expect(wordDevelop(6, 0, true)).toBe(1);
    expect(wordDevelop(6, 0, false)).toBe(0);
    expect(wordDevelop(9, 1, false)).toBeCloseTo(1 / 6);
    expect(lineDoneAt(6, true)).toBe(16);
    expect(lineDoneAt(6, false)).toBe(22);
  });

  it('times chip c from 16 + 4 c, arriving at 46 + 4 c, on the step curve', () => {
    for (const c of [0, 1, 2]) {
      expect(chipStart(c)).toBe(16 + 4 * c);
      expect(chipArrival(c)).toBe(46 + 4 * c);
      expect(chipTravel(chipStart(c), c)).toBe(0);
      expect(chipTravel(chipArrival(c), c)).toBe(1);
    }
    expect(chipTravel(31, 0)).toBeCloseTo(0.5, 5);
    expect(chipTravel(23, 0)).toBeLessThan(0.25);
  });

  it('absorbs a chip from arrival to arrival + 5, and the third by f = 59', () => {
    expect(chipScale(chipArrival(0) - 1, 0)).toBe(1);
    expect(chipScale(chipArrival(0), 0)).toBeLessThan(1);
    expect(chipScale(chipArrival(0) + 5, 0)).toBe(0);
    expect(chipScale(chipArrival(2) + 5, 2)).toBe(0);
    expect(chipArrival(2) + 5).toBe(59);
  });

  it('shimmers as 0.85 + 0.15 cos(2 PI (x / 313 - f / 19)), bands scaled with the width', () => {
    const wide = stageOf('16:9');
    const narrow = stageOf('1:1');
    expect(shimmer(0, 0, wide)).toBeCloseTo(1);
    expect(shimmer(19, 0, wide)).toBeCloseTo(1);
    expect(shimmer(0, 313, wide)).toBeCloseTo(1);
    expect(shimmer(0, 313 / 2, wide)).toBeCloseTo(0.7);
    expect(shimmer(0, (313 * 1080) / 1920, narrow)).toBeCloseTo(1);
    for (const f of range(0, 80)) {
      expect(shimmer(f, 200, wide)).toBeGreaterThanOrEqual(0.7 - 1e-9);
      expect(shimmer(f, 200, wide)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('turns the actor 0.04 degrees a frame', () => {
    expect(actorRotation(0)).toBe(0);
    expect(actorRotation(50)).toBeCloseTo(2);
  });
});

describe.each(FORMATS)('status-relay acceptance stills at %s', (format) => {
  const stage = stageOf(format);
  const layout = laid(format);
  const at = (f: number, c: RelayCard = LATER) => relayState(layout, stage, f, c);

  it('f = 0, first card: the actor moves in on x, off its rest', () => {
    const state = at(0, FIRST);
    expect(state.blank).toBe(false);
    if (format === '9:16') {
      // the seam is on x in every format
      expect(state.actor.box.x).toBeLessThan(layout.frame.actor.x);
    } else {
      expect(state.actor.box.x).toBeLessThan(layout.frame.actor.x);
    }
    expect(at(13, FIRST).actor.box.x).not.toBe(layout.frame.actor.x);
    expect(at(14, FIRST).actor.box.x).toBe(layout.frame.actor.x);
  });

  it('f = 0 and 1, later card: uniform ground only; from f = 2 the card is drawn', () => {
    expect(at(0).blank).toBe(true);
    expect(at(1).blank).toBe(true);
    expect(at(2).blank).toBe(false);
  });

  it('f = 6, later card: the actor is at rest at its own pixel position, with no earlier words', () => {
    const state = at(6);
    expect(state.blank).toBe(false);
    expect(state.entry).toMatchObject({ blur: 0, dx: 0, dy: 0 });
    expect(state.actor.box).toEqual(layout.frame.actor);
    expect(state.words.every(({ develop }) => develop === 0)).toBe(true);
  });

  it('f = 12: the line is part-developed, with words at different opacities', () => {
    const opacities = at(12).words.map(({ opacity }) => opacity);
    expect(new Set(opacities).size).toBeGreaterThan(2);
    expect(opacities[0]).toBe(1);
    expect(opacities.at(-1)).toBe(0);
    expect(at(12).lineComplete).toBe(false);
  });

  it('f = 22 (16 on the first card): the full line, at cap height of at least 78 spec px', () => {
    const state = at(22);
    expect(state.words.map(({ text }) => text).join(' ')).toBe(HEADLINE);
    expect(state.words.every(({ develop }) => develop === 1)).toBe(true);
    expect(state.lineComplete).toBe(true);
    const done = lineDoneAt(5, true);
    expect(at(done - 1, FIRST).words.every(({ develop }) => develop === 1)).toBe(false);
    expect(at(done, FIRST).words.every(({ develop }) => develop === 1)).toBe(true);
    const cap = layout.line.fit.fontSize * layout.line.fit.metrics.cap;
    expect(cap).toBeGreaterThan(specPx(stage, 78) - layout.line.fit.metrics.cap);
  });

  it('f = 50: chips on the rail, the first absorbing, greeked chips with no numerals', () => {
    const state = at(50);
    const [a, b, c] = state.chips;
    expect(a?.absorbing).toBe(true);
    expect(a?.scale).toBeGreaterThan(0);
    expect(a?.scale).toBeLessThan(1);
    expect(b?.absorbing).toBe(true);
    expect(c?.visible).toBe(true);
    expect(c?.absorbing).toBe(false);
    for (const chip of state.chips) {
      expect(chip.label).toBeUndefined();
      // every chip sits on the rail's line
      const centre =
        format === '9:16' ? chip.rect.x + chip.rect.width / 2 : chip.rect.y + chip.rect.height / 2;
      expect(centre).toBeCloseTo(format === '9:16' ? layout.frame.centre.x : layout.frame.centre.y);
    }
  });

  it('f = 59: every chip is absorbed', () => {
    expect(at(58).chips.some(({ absorbed }) => !absorbed)).toBe(true);
    const state = at(59);
    expect(state.chips.every(({ absorbed, visible }) => absorbed && !visible)).toBe(true);
  });

  it('f = dur - 1: content present, the line shimmering and the actor drifting', () => {
    const dur = 96;
    const last = at(dur - 1);
    const before = at(dur - 2);
    expect(last.holding).toBe(true);
    expect(last.blank).toBe(false);
    expect(last.words.every(({ develop }) => develop === 1)).toBe(true);
    expect(last.words.map(({ shimmer: s }) => s)).not.toEqual(
      before.words.map(({ shimmer: s }) => s),
    );
    expect(last.actor.rotation).toBeGreaterThan(before.actor.rotation);
    expect(at(59).holding).toBe(false);
    expect(at(60).holding).toBe(true);
  });

  it('is identical on repeat calls and in any order over f 0..59', () => {
    for (const c of [FIRST, LATER]) {
      const inOrder = range(0, 59).map((f) => JSON.stringify(at(f, c)));
      const backwards = range(0, 59)
        .reverse()
        .map((f) => JSON.stringify(at(f, c)))
        .reverse();
      expect(backwards).toEqual(inOrder);
      expect(range(0, 59).map((f) => JSON.stringify(at(f, c)))).toEqual(inOrder);
    }
  });
});
