import { sceneRegistry } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { type SpecFit, type SpecTypeStyle, specPx } from '../src/components/type.tsx';
import { fitBlock } from '../src/layout/fit.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../src/layout/stage.ts';
import { anchorsOf, anchorVelocities, groundOf } from '../src/scenes/definition.ts';
import type { Fitter } from '../src/scenes/proof-bars-layout.ts';
import { definitionOf, IMPLEMENTED_SCENE_TYPES } from '../src/scenes/registry.ts';
import { actorPop, popFrom, rimFrames, rimOn } from '../src/scenes/status-relay.tsx';
import {
  chipArrival,
  type RelayCard,
  type RelayLayout,
  type RelayState,
  type RelayText,
  relayLayout,
  relayState,
} from '../src/scenes/status-relay-layout.ts';

const stageOf = (format: Format) => {
  const { width, height } = FORMAT_SIZES[format];
  return stageFor(width, height);
};

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

const card = (headline: string, labels: string[] = []): RelayText[] => [
  { id: 'h', role: 'headline', value: headline },
  ...labels.map((value, index) => ({ id: `l${index}`, role: 'label' as const, value })),
];

function laid(text: RelayText[], format: Format = '16:9'): RelayLayout {
  const result = relayLayout(text, stageOf(format), fakeFitter(format));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.layout;
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('status-relay registration', () => {
  it('is registered under its schema name, after tile-wall', () => {
    expect(IMPLEMENTED_SCENE_TYPES).toContain('status-relay');
    expect(Object.hasOwn(sceneRegistry, 'status-relay')).toBe(true);
    expect(definitionOf('status-relay')).toBeDefined();
  });

  it("declares the Registry entry of the scene file and the schema's limits", () => {
    const definition = definitionOf('status-relay');
    if (!definition) throw new Error('not registered');
    expect(definition.kind).toBe('product');
    expect(groundOf(definition, {}, 'neutral-cut')).toBe('base');
    expect(groundOf(definition, {}, 'kinetic-plate')).toBe('plate');
    expect(sceneRegistry['status-relay']?.text).toEqual({ headline: 40, label: 12 });
    expect(Object.keys(definition.roles).sort()).toEqual(['headline', 'label']);
    expect(anchorVelocities(definition, {})).toEqual([
      { id: 'actor', entry: { axis: 'x', sign: 1, v: 46 }, exit: undefined },
      { id: 'status', entry: { axis: 'x', sign: 1, v: 46 }, exit: undefined },
    ]);
    expect(definition.props.safeParse({}).success).toBe(true);
    expect(definition.props.safeParse({ copy: 'x' }).success).toBe(false);
    expect(definition.image).toBe('none');
  });

  it('builds the actor and status anchors from the text of the scene', () => {
    const definition = definitionOf('status-relay');
    if (!definition) throw new Error('not registered');
    const text = card('We do it as one');
    const stage = stageOf('16:9');
    const fonts = { display: 'Test', body: 'Test' };
    const anchors = anchorsOf(definition, {
      props: {},
      stage,
      theme: { fonts, radius: 12 } as never,
      images: [],
      dur: 60,
      text,
    });
    expect(anchors.map(({ id }) => id)).toEqual(['actor', 'status']);
  });
});

describe('status-relay copy', () => {
  it('shows only the words of scene.text: the headline words and the labels', () => {
    const layout = laid(card('We do it as one', ['Draft', 'Review']));
    expect(layout.line.words.map(({ text }) => text).join(' ')).toBe('We do it as one');
    expect(layout.chips.map(({ label }) => label)).toEqual(['Draft', 'Review']);
    for (const f of [0, 30, 59, 95]) {
      const state = relayState(layout, stageOf('16:9'), f, { first: true });
      expect(state.words.map(({ text }) => text).join(' ')).toBe('We do it as one');
      expect(state.chips.map(({ label }) => label)).toEqual(['Draft', 'Review']);
    }
  });

  it('greeks three chips with no label and no numerals when no label is given', () => {
    const layout = laid(card('We do it as one'));
    expect(layout.chips).toHaveLength(3);
    for (const chip of layout.chips) {
      expect(chip.label).toBeUndefined();
      expect(chip.textId).toBeUndefined();
      expect(typeof chip.greek).toBe('number');
    }
  });
});

describe('status-relay absorb', () => {
  const arrivals = [0, 1, 2].map(chipArrival);

  it('pops the actor from 0.92 on the first absorb in Neutral Cut, and rests at 1 before it', () => {
    expect(arrivals).toEqual([46, 50, 54]);
    expect(actorPop(45, arrivals)).toBe(1);
    expect(actorPop(46, arrivals)).toBeCloseTo(0.92 + (0.08 * (0.794 - 0.46)) / 0.54, 1);
    expect(popFrom).toBe(0.92);
    expect(actorPop(46, arrivals)).toBeGreaterThan(popFrom);
    expect(actorPop(46, arrivals)).toBeLessThan(1.1);
    // settles to 1
    expect(actorPop(90, arrivals)).toBeCloseTo(1, 3);
  });

  it('lights the actor with light.rim for 8 frames from each absorb in Kinetic Plate', () => {
    expect(rimFrames).toBe(8);
    expect(rimOn(45, arrivals)).toBe(false);
    for (const f of range(46, 53)) expect(rimOn(f, arrivals)).toBe(true);
    expect(rimOn(62, arrivals)).toBe(false);
    expect(rimOn(61, arrivals)).toBe(true);
  });
});

describe('status-relay is a pure function of f', () => {
  const layout = laid(card('We do it as one', ['Draft', 'Review', 'Ship it']));
  const stage = stageOf('16:9');
  it.each([true, false])('gives the same state for the same input (first: %s)', (first) => {
    const cardOf: RelayCard = { first };
    const once = range(0, 59).map((f) => relayState(layout, stage, f, cardOf));
    const again = range(0, 59)
      .reverse()
      .map((f) => relayState(layout, stage, f, cardOf))
      .reverse();
    expect(again).toEqual(once);
  });
});

// ---------------------------------------------------------------------------------------------
// The hold: a coarse raster of what the scene draws, and the 0.02 MAD static threshold.

const W = 192;
const H = 108;

/** Draws the state's actor, line and chips as a grey raster: ground 235, ink down to 20. */
function raster(state: RelayState, layout: RelayLayout, stageWidth: number): Uint8Array {
  const out = new Uint8Array(W * H).fill(235);
  const k = W / stageWidth;
  if (state.blank) return out;
  const paint = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    ink: number,
    test = () => true,
  ) => {
    for (let y = Math.max(0, Math.floor(y0 * k)); y < Math.min(H, Math.ceil(y1 * k)); y += 1) {
      for (let x = Math.max(0, Math.floor(x0 * k)); x < Math.min(W, Math.ceil(x1 * k)); x += 1) {
        if (!test()) continue;
        const at = y * W + x;
        out[at] = Math.round((out[at] as number) + (20 - (out[at] as number)) * ink);
      }
    }
  };
  // Chips, drawn light.
  for (const chip of state.chips) {
    if (!chip.visible) continue;
    const { x, y, width, height } = chip.rect;
    const cx = x + width / 2;
    const cy = y + height / 2;
    paint(
      cx - (width * chip.scale) / 2,
      cy - (height * chip.scale) / 2,
      cx + (width * chip.scale) / 2,
      cy + (height * chip.scale) / 2,
      0.25,
    );
  }
  // The actor, as the rotated square's pixels.
  const { box, rotation } = state.actor;
  const ax = box.x + box.width / 2;
  const ay = box.y + box.height / 2;
  const angle = (rotation * Math.PI) / 180;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = (x + 0.5) / k - ax;
      const dy = (y + 0.5) / k - ay;
      const u = dx * Math.cos(angle) + dy * Math.sin(angle);
      const v = -dx * Math.sin(angle) + dy * Math.cos(angle);
      if (Math.abs(u) <= box.width / 2 && Math.abs(v) <= box.height / 2) {
        const at = y * W + x;
        out[at] = 90;
      }
    }
  }
  // The line: each word a half-covered band at the word's opacity.
  const { line } = layout;
  let cursor = line.left;
  for (const [j, word] of state.words.entries()) {
    const width = (layout.line.words[j + 1]?.x ?? line.left + line.width) - cursor;
    const wordWidth = Math.max(1, Math.min(width, line.width / state.words.length) * 0.85);
    paint(
      cursor,
      line.baseline - line.fit.fontSize * 0.7,
      cursor + wordWidth,
      line.baseline,
      word.opacity * 0.5,
    );
    cursor += width;
  }
  return out;
}

const mad = (a: Uint8Array, b: Uint8Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs((a[i] as number) - (b[i] as number));
  return sum / a.length;
};

/** The longest run of frames, from 1, whose MAD against the frame before is below 0.02. */
function longestStatic(frames: Uint8Array[], skip: (f: number) => boolean): number {
  let run = 0;
  let longest = 0;
  for (let f = 1; f < frames.length; f += 1) {
    if (skip(f) || mad(frames[f - 1] as Uint8Array, frames[f] as Uint8Array) >= 0.02) run = 0;
    else run += 1;
    longest = Math.max(longest, run);
  }
  return longest;
}

describe('status-relay hold', () => {
  const dur = 96;
  const stage = stageOf('16:9');
  const layout = laid(card('We do it as one', ['Draft', 'Review', 'Ship it']));

  it.each([
    ['the first card', { first: true }],
    ['a later card', { first: false }],
  ])('has no run of more than 30 frames below 0.02 MAD over f 0..%#: %s', (_name, cardOf) => {
    const frames = range(0, dur - 1).map((f) =>
      raster(relayState(layout, stage, f, cardOf), layout, stage.width),
    );
    // T5 blank frames: the previous frame's words leave on one, so those are exempt.
    const blank = (f: number) => !cardOf.first && f < 2;
    expect(longestStatic(frames, blank)).toBeLessThanOrEqual(30);
  });

  it('holds the final state from f = 60 with the shimmer and the drift running', () => {
    const at = (f: number) => relayState(layout, stage, f, { first: true });
    expect(at(60).holding).toBe(true);
    expect(at(59).holding).toBe(false);
    expect(at(60).chips.every((chip) => chip.absorbed)).toBe(true);
    expect(at(95).chips.every((chip) => chip.absorbed)).toBe(true);
    expect(at(95).words.map((word) => word.develop)).toEqual([1, 1, 1, 1, 1]);
    for (const f of range(60, 94)) {
      const now = at(f);
      const next = at(f + 1);
      expect(next.actor.rotation).toBeGreaterThan(now.actor.rotation);
      expect(next.words.map((word) => word.opacity)).not.toEqual(
        now.words.map((word) => word.opacity),
      );
    }
  });
});
