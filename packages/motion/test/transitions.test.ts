import { describe, expect, it } from 'vitest';
import { seamBetween, seamIn, seamOut } from '../src/core/curves.ts';
import { filmSeams } from '../src/film/seams.ts';
import {
  isCatalogId,
  isTransition,
  qcFrames,
  reach,
  TRANSITION_IDS,
  TRANSITIONS,
} from '../src/transitions/catalog.ts';
import { resolveSeam, type SeamScene, velocitiesMatch } from '../src/transitions/resolve.ts';
import { boxTransform, seamTransform } from '../src/transitions/seam-layer.tsx';
import type { TransitionWindow } from '../src/transitions/timeline.ts';
import { at, novaCopy, quillhavenCopy } from './fixtures.ts';

const x = { axis: 'x', sign: 1, v: 46 } as const;
const y = { axis: 'y', sign: -1, v: 36 } as const;

const scene = (overrides: Partial<SeamScene> = {}): SeamScene => ({
  id: 'a',
  type: 'feature-card',
  ground: 'base',
  pivot: false,
  entry: { anchor: 'headline', velocity: x },
  exit: { anchor: 'headline', velocity: x },
  anchors: ['headline'],
  written: undefined,
  ...overrides,
});

describe('the catalog', () => {
  it('holds t1 to t17, and draws the ids the Short and Standard plans and the fallback use', () => {
    expect(TRANSITION_IDS).toHaveLength(17);
    expect(TRANSITIONS).toEqual(['t1', 't3', 't5']);
    for (const id of ['push', 'carry', 'fade', 'slide', 'T1', 't18']) {
      expect(isCatalogId(id)).toBe(false);
    }
    expect(isTransition('t6')).toBe(false);
    expect(isCatalogId('t6')).toBe(true);
  });

  it("lists each transition's QC frames as transitions.md gives them", () => {
    expect(qcFrames('t1', 0)).toEqual([-12, -1, 0, 1, 14]);
    expect(qcFrames('t3', 0)).toEqual([-1, 0, 13]);
    expect(qcFrames('t5', 2)).toEqual([-1, 0, 1, 2, 5, 6]);
    expect(qcFrames('t5', 5)).toEqual([-1, 0, 4, 5, 8, 9]);
  });

  it('reaches from the first QC frame to the last, so before, during and after are spec frames', () => {
    expect(reach('t1', 0)).toEqual({ before: 11, after: 14 });
    expect(reach('t3', 0)).toEqual({ before: 0, after: 13 });
    expect(reach('t5', 2)).toEqual({ before: 0, after: 6 });
    expect(reach('t5', 5)).toEqual({ before: 0, after: 9 });
  });
});

describe('the resolver', () => {
  it('matches velocities on one axis and sign, within 1.5x either way', () => {
    expect(velocitiesMatch(x, x)).toBe(true);
    expect(velocitiesMatch(x, { ...x, v: 46 / 1.5 })).toBe(true);
    expect(velocitiesMatch(x, { ...x, v: 46 / 1.51 })).toBe(false);
    expect(velocitiesMatch({ ...x, v: 30 }, { ...x, v: 45 })).toBe(true);
    expect(velocitiesMatch({ ...x, v: 30 }, { ...x, v: 46 })).toBe(false);
    expect(velocitiesMatch(x, { ...x, sign: -1 })).toBe(false);
    expect(velocitiesMatch(x, y)).toBe(false);
    expect(velocitiesMatch(undefined, x)).toBe(false);
  });

  it('honours a written id that is legal and built', () => {
    for (const written of ['t1', 't3', 't5']) {
      const seam = resolveSeam(0, scene({ written }), scene({ id: 'b' }));
      expect(seam).toMatchObject({ used: written, reason: 'written', note: undefined });
    }
  });

  it('gives T1 its seam and carries the anchor both scenes declare', () => {
    const seam = resolveSeam(0, scene({ written: 't1' }), scene({ id: 'b', type: 'type-card' }));
    expect(seam.seam).toEqual(seamBetween(x, x));
    expect(seam.carry).toBe('headline');
    const none = resolveSeam(
      0,
      scene({ written: 't1', anchors: ['number'] }),
      scene({ id: 'b', anchors: ['headline'] }),
    );
    expect(none.carry).toBeUndefined();
    expect(resolveSeam(0, scene({ written: 't3' }), scene()).seam).toBeUndefined();
  });

  it('refuses T1 across mismatched velocities and falls back to T3', () => {
    const seam = resolveSeam(
      0,
      scene({ written: 't1' }),
      scene({ id: 'b', type: 'site-hero', entry: { anchor: 'browser', velocity: y } }),
    );
    expect(seam).toMatchObject({ used: 't3', reason: 'fallback' });
    expect(seam.note).toContain('one axis with one sign');
  });

  it('allows T5 only between scenes of one type, or into a pivot', () => {
    expect(resolveSeam(0, scene({ written: 't5' }), scene()).used).toBe('t5');
    const across = resolveSeam(0, scene({ written: 't5' }), scene({ type: 'type-card' }));
    // A feature card into a type card on x still matches, so the fallback is T1.
    expect(across).toMatchObject({ used: 't1', reason: 'fallback' });
    expect(across.note).toContain('two scenes of one type');
  });

  it('pins a boundary into a pivot type-card to the chapter blink, whatever was written', () => {
    const pivot = scene({ id: 'p', type: 'type-card', pivot: true });
    expect(resolveSeam(0, scene({ written: 't1' }), pivot)).toMatchObject({
      used: 't5',
      reason: 'pinned',
      blank: 5,
    });
    expect(resolveSeam(0, scene({ written: 't5' }), pivot).note).toBeUndefined();
    expect(resolveSeam(0, scene({ written: 't5' }), scene()).blank).toBe(2);
  });

  it('keeps every same-ground id off a change of ground, falling back to T3', () => {
    const event = scene({ id: 'e', type: 'colour-event', ground: 'event' });
    for (const written of ['t1', 't5']) {
      expect(resolveSeam(0, scene({ written }), event)).toMatchObject({
        used: 't3',
        reason: 'fallback',
      });
    }
    // T6 is legal there, but not built yet.
    expect(resolveSeam(0, scene({ written: 't6' }), event).note).toBe('t6 is not built yet');
    expect(resolveSeam(0, scene({ written: 't3' }), event).used).toBe('t3');
  });

  it('keeps template-pinned and in-scene ids off every boundary', () => {
    expect(resolveSeam(0, scene({ written: 't9' }), scene()).note).toContain('template pins');
    expect(resolveSeam(0, scene({ written: 't2' }), scene()).note).toContain('inside a scene');
    expect(resolveSeam(0, scene({ written: 't4' }), scene()).note).toBe('t4 is not built yet');
  });

  it('fills a missing id with T1 where the velocities match, else T3', () => {
    expect(resolveSeam(0, scene(), scene()).used).toBe('t1');
    expect(resolveSeam(0, scene({ exit: undefined }), scene()).used).toBe('t3');
  });

  it('plays the examples as written', () => {
    expect(filmSeams(novaCopy()).map(({ used, reason }) => `${used} ${reason}`)).toEqual([
      't3 written',
      't3 written',
      't3 written',
    ]);
    expect(filmSeams(quillhavenCopy()).map(({ used }) => used)).toEqual([
      't3',
      't3',
      't5',
      't1',
      't3',
    ]);
  });

  it('reads anchors from the templates: no T1 out of the hook, none from a card into a page', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 0).transitionOut = 't1';
    at(campaign.scenes, 1).transitionOut = 't1';
    at(campaign.scenes, 2).transitionOut = 't1';
    expect(filmSeams(campaign).map(({ used }) => used)).toEqual(['t3', 't3', 't3']);
  });
});

const window = (overrides: Partial<TransitionWindow>): TransitionWindow => ({
  index: 0,
  name: 't1',
  boundary: 100,
  from: 89,
  to: 114,
  written: 't1',
  reason: 'written',
  note: undefined,
  seam: seamBetween(x, x),
  carry: undefined,
  blank: 0,
  qc: [],
  ...overrides,
});

const stage = { width: 1920, height: 1080 };
const translate = (transform: string | undefined) =>
  Number(/translateX\((-?[\d.e-]+)px\)/.exec(transform ?? '')?.[1] ?? 0);

describe('the seam wrapper', () => {
  const seam = seamBetween(x, x);
  const base = {
    f: 0,
    dur: 72,
    in: undefined,
    out: undefined,
    anchors: [],
    carryFrom: undefined,
    stage,
  };

  it('moves nothing on T3 and T5, nor outside the seam frames', () => {
    expect(seamTransform({ ...base, in: window({ name: 't3', seam: undefined }) })).toBeUndefined();
    expect(seamTransform({ ...base, in: window({ name: 't5', seam: undefined }) })).toBeUndefined();
    expect(seamTransform({ ...base, f: 20, in: window({}) })).toBeUndefined();
    expect(seamTransform({ ...base, f: 30, out: window({}) })).toBeUndefined();
  });

  it('applies seamOut over the outgoing scene’s last frames and seamIn over the incoming first', () => {
    for (const f of [61, 65, 70, 71]) {
      expect(translate(seamTransform({ ...base, f, out: window({}) }))).toBeCloseTo(
        seamOut(f - 72, seam),
        6,
      );
    }
    for (const f of [0, 1, 7, 13]) {
      expect(translate(seamTransform({ ...base, f, in: window({}) }))).toBeCloseTo(
        seamIn(f, seam),
        6,
      );
    }
  });

  it('scales spec pixels to the frame, and scales about the frame centre on a scale seam', () => {
    const big = { width: 3840, height: 2160 };
    expect(translate(seamTransform({ ...base, stage: big, in: window({}) }))).toBeCloseTo(
      seamIn(0, seam) * 2,
      6,
    );
    const scale = seamBetween({ axis: 'scale', sign: 1, v: 0.03 }, { v: 0.03 });
    const transform = seamTransform({ ...base, f: 71, out: window({ seam: scale }) });
    expect(transform).toBe(
      `translate(960px, 540px) scale(${Math.exp(seamOut(-1, scale))}) translate(-960px, -540px)`,
    );
  });

  it('carries a shared anchor from where the outgoing scene left it to its own box on frame 11', () => {
    const from = { x: 100, y: 500, width: 400, height: 80 };
    const rest = { x: 700, y: 160, width: 520, height: 104 };
    const anchors = [{ id: 'headline', box: () => rest }];
    const carry = {
      ...base,
      in: window({ carry: 'headline' }),
      anchors,
      carryFrom: from,
      anchor: 'headline',
    };
    expect(seamTransform({ ...carry, f: 0 })).toBe(boxTransform(rest, from));
    expect(seamTransform({ ...carry, f: 11 })).toBeUndefined();
    // Layers that are not the carried anchor still seam in.
    expect(translate(seamTransform({ ...carry, anchor: undefined }))).toBeCloseTo(
      seamIn(0, seam),
      6,
    );
  });

  it('maps a box onto another, scaled evenly by height and centred on its width', () => {
    const natural = { x: 100, y: 100, width: 200, height: 50 };
    const target = { x: 400, y: 300, width: 400, height: 100 };
    expect(boxTransform(natural, target)).toBe('translate(200px, 100px) scale(2)');
    expect(boxTransform(natural, natural)).toBe('translate(0px, 0px) scale(1)');
  });

  it('is a pure function of the frame', () => {
    const run = (order: number[]) =>
      order.map(
        (f) => [f, seamTransform({ ...base, f, in: window({}), out: window({}) })] as const,
      );
    const frames = Array.from({ length: 90 }, (_, index) => index - 5);
    const forwards = new Map(run(frames));
    const backwards = new Map(run([...frames].reverse()));
    expect(backwards).toEqual(forwards);
  });
});
