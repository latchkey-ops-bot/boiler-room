import { sceneFrames } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../src/transitions/timeline.ts';
import { at, examples, novaCopy, quillhavenCopy } from './fixtures.ts';

describe('buildTimeline', () => {
  it.each(Object.entries(examples))('keeps %s exactly as long as its scenes', (_name, copy) => {
    const campaign = copy();
    const frames = sceneFrames(campaign);
    const timeline = buildTimeline(campaign);
    expect(timeline.durationInFrames).toBe(frames.durationInFrames);
    expect(
      timeline.spans.map(({ id, from, durationInFrames }) => ({ id, from, durationInFrames })),
    ).toEqual(frames.scenes);
  });

  it('puts the resolved transition on every boundary of the examples', () => {
    expect(buildTimeline(novaCopy()).windows.map(({ name }) => name)).toEqual(['t3', 't3', 't3']);
    const quillhaven = buildTimeline(quillhavenCopy()).windows;
    expect(quillhaven.map(({ name }) => name)).toEqual(['t3', 't3', 't5', 't1', 't3']);
    expect(quillhaven.every(({ reason }) => reason === 'written')).toBe(true);
  });

  it('mounts every scene for exactly its own frames: built transitions reach past no seam', () => {
    for (const copy of Object.values(examples)) {
      for (const span of buildTimeline(copy()).spans) {
        expect(span.mountFrom).toBe(span.from);
        expect(span.mountFrames).toBe(span.durationInFrames);
        expect(span.preRoll + span.postRoll).toBe(0);
      }
    }
  });

  it("spans each transition's moving frames, from its first QC frame to its last", () => {
    // Quillhaven runs at 24 fps: 11 spec frames are 9 film frames, 14 are 11, and 13 are 10.
    const [hook, hero, blink, seam] = buildTimeline(quillhavenCopy()).windows;
    expect(seam).toMatchObject({ name: 't1', from: seam?.boundary ? seam.boundary - 9 : 0 });
    expect((seam?.to ?? 0) - (seam?.boundary ?? 0)).toBe(11);
    expect(seam?.qc[0]).toBe((seam?.boundary ?? 0) - 10);
    expect((hook?.to ?? 0) - (hook?.boundary ?? 0)).toBe(10);
    expect(hero?.from).toBe(hero?.boundary);
    expect(blink).toMatchObject({ name: 't5', blank: 2, from: blink?.boundary });
    for (const window of buildTimeline(quillhavenCopy()).windows) {
      expect(window.qc).toEqual([...window.qc].sort((a, b) => a - b));
      expect(window.qc).toContain(window.boundary);
    }
  });

  it('carries the T1 seam: x between two feature cards, at sqrt(46 * 46) with k 0.70', () => {
    const t1 = at(buildTimeline(quillhavenCopy()).windows, 3);
    expect(t1.seam).toEqual({ axis: 'x', sign: 1, vPeak: 46, n: 11, r: 1.4, k: 0.7, D: 14 });
    expect(t1.carry).toBe('headline');
  });

  it('pins a boundary into a pivot type-card to the 5-frame chapter blink', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 2).type = 'type-card';
    at(campaign.scenes, 2).props = { variant: 'pivot' };
    const window = at(buildTimeline(campaign).windows, 1);
    expect(window).toMatchObject({ name: 't5', reason: 'pinned', blank: 5 });
    expect(window.qc.map((frame) => frame - window.boundary)).toEqual([-1, 0, 4, 5, 8, 9]);
  });

  it('fills a boundary with no transitionOut from the resolver', () => {
    const campaign = novaCopy();
    for (const scene of campaign.scenes) delete scene.transitionOut;
    expect(buildTimeline(campaign).windows.map(({ name, reason }) => [name, reason])).toEqual([
      ['t3', 'fallback'],
      ['t3', 'fallback'],
      ['t3', 'fallback'],
    ]);
  });

  it('refuses a transition outside the catalog', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 0).transitionOut = 'star-wipe';
    expect(() => buildTimeline(campaign)).toThrow('star-wipe');
  });
});
