import { sceneFrames } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { stageFor } from '../src/layout/stage.ts';
import { pushAxis, pushProgress, pushStyle } from '../src/transitions/push.ts';
import { buildTimeline, windowProgress } from '../src/transitions/timeline.ts';
import { at, examples, novaCopy } from './fixtures.ts';

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

  it('overlays each transition on its boundary, half on either side', () => {
    const { windows, spans } = buildTimeline(novaCopy());
    expect(windows.map(({ name }) => name)).toEqual(['push', 'carry', 'carry']);
    for (const window of windows) {
      expect(window.boundary - window.from).toBe(window.to - window.boundary);
      expect(spans.some(({ from }) => from === window.boundary)).toBe(true);
    }
  });

  it('mounts a scene for its own frames plus the frames it shares', () => {
    const { spans } = buildTimeline(novaCopy());
    for (const span of spans) {
      expect(span.mountFrom).toBe(span.from - span.preRoll);
      expect(span.mountFrames).toBe(span.preRoll + span.durationInFrames + span.postRoll);
    }
    expect(at(spans, 0).preRoll).toBe(0);
    expect(at(spans, 3).postRoll).toBe(0);
  });

  it('cuts where a scene has no transition out', () => {
    const campaign = novaCopy();
    for (const scene of campaign.scenes) delete scene.transitionOut;
    expect(buildTimeline(campaign).windows).toEqual([]);
  });

  it('gives no scene more than half of itself to a transition', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 0).end = 0.2;
    at(campaign.scenes, 1).start = 0.2;
    const [first] = buildTimeline(campaign).windows;
    expect(first?.to).toBeDefined();
    expect((first?.boundary ?? 0) - (first?.from ?? 0)).toBeLessThanOrEqual(3);
  });

  it('refuses a transition that does not exist', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 0).transitionOut = 'star-wipe';
    expect(() => buildTimeline(campaign)).toThrow('star-wipe');
  });
});

describe('windowProgress', () => {
  const window = { name: 'push', boundary: 20, from: 10, to: 30 } as const;

  it('is 0 before, 1 after, and strictly between inside the window', () => {
    expect(windowProgress(9, window)).toBe(0);
    expect(windowProgress(30, window)).toBe(1);
    for (let frame = 10; frame < 30; frame += 1) {
      expect(windowProgress(frame, window)).toBeGreaterThan(0);
      expect(windowProgress(frame, window)).toBeLessThan(1);
    }
  });
});

describe('push', () => {
  const window = { name: 'push', boundary: 20, from: 10, to: 30 } as const;

  it('moves sideways in wide frames and up in tall ones', () => {
    expect(pushAxis(stageFor(1920, 1080))).toBe('x');
    expect(pushAxis(stageFor(1080, 1080))).toBe('x');
    expect(pushAxis(stageFor(1080, 1920))).toBe('y');
  });

  it('moves the two scenes as one sheet, with no gap', () => {
    const stage = stageFor(1920, 1080);
    for (const frame of [10, 15, 20, 29]) {
      const progress = pushProgress(frame, window);
      const out = Number(/-?[\d.]+/.exec(pushStyle(progress, 'out', stage).transform ?? '')?.[0]);
      const incoming = Number(
        /-?[\d.]+/.exec(pushStyle(progress, 'in', stage).transform ?? '')?.[0],
      );
      expect(incoming - out).toBeCloseTo(stage.width, 6);
    }
  });
});
