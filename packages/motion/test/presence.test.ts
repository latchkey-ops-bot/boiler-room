import { describe, expect, it } from 'vitest';
import { presence, type SceneExit, sceneTiming, springAt } from '../src/core/presence.ts';

const window = { enterAt: 10, enterFrames: 10, exitAt: 50, exitFrames: 10 };

describe('presence', () => {
  it('moves through each phase as a function of frame alone', () => {
    expect(presence(0, window)).toMatchObject({ phase: 'before', enter: 0, exit: 0, visible: 0 });
    expect(presence(15, window).phase).toBe('enter');
    expect(presence(30, window)).toMatchObject({ phase: 'hold', enter: 1, exit: 0, visible: 1 });
    expect(presence(55, window).phase).toBe('exit');
    expect(presence(70, window)).toMatchObject({ phase: 'after', enter: 1, exit: 1, visible: 0 });
  });

  it('gives the same answer for a frame however it is reached', () => {
    const forward = [0, 12, 15, 52, 58].map((frame) => presence(frame, window));
    const backward = [58, 52, 15, 12, 0].map((frame) => presence(frame, window)).reverse();
    expect(backward).toEqual(forward);
  });

  it('eases in without overshooting', () => {
    const values = Array.from({ length: 12 }, (_, index) => presence(9 + index, window).enter);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(Math.max(...values)).toBe(1);
  });

  it('never leaves when it has no exit', () => {
    const held = { ...window, exitFrames: 0 };
    expect(presence(10_000, held)).toMatchObject({ phase: 'hold', visible: 1 });
  });
});

describe('springAt', () => {
  it('is 0 until its start, and comes to rest at 1', () => {
    expect(springAt(5, 30, 10)).toBe(0);
    expect(springAt(10 + 120, 30, 10)).toBeCloseTo(1, 3);
  });
});

describe('sceneTiming', () => {
  const exits: SceneExit[] = ['hold', 'text', 'all'];

  it.each(exits)('brings the text in after its container and out before the end (%s)', (exit) => {
    const { container, text } = sceneTiming({ durationInFrames: 150, fps: 30, exit });
    expect(text.enterAt).toBeGreaterThan(container.enterAt);
    expect(text.enterAt + text.enterFrames).toBeLessThanOrEqual(text.exitAt);
    expect(text.exitAt + text.exitFrames).toBeLessThanOrEqual(150);
    for (const value of [...Object.values(container), ...Object.values(text)]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('holds everything to the last frame when the scene ends the film', () => {
    const { container, text } = sceneTiming({ durationInFrames: 150, fps: 30, exit: 'hold' });
    expect(container.exitFrames).toBe(0);
    expect(text.exitFrames).toBe(0);
  });

  it('clears the words before an outgoing transition takes the stage', () => {
    const { text } = sceneTiming({ durationInFrames: 150, fps: 30, exit: 'text', clearBefore: 12 });
    expect(text.exitAt + text.exitFrames).toBeLessThanOrEqual(150 - 12);
  });

  it('holds the words back until an incoming transition is over', () => {
    const { container, text } = sceneTiming({
      durationInFrames: 150,
      fps: 30,
      exit: 'hold',
      enterAfter: 12,
    });
    expect(container.enterAt).toBe(12);
    expect(text.enterAt).toBeGreaterThan(12);
  });

  it('has a pushed scene arrive with its containers already at rest', () => {
    const { container } = sceneTiming({
      durationInFrames: 150,
      fps: 30,
      exit: 'hold',
      enterAfter: 9,
      arrivesWhole: true,
    });
    expect(presence(-9, container).enter).toBe(1);
    expect(springAt(-9, 30, container.enterAt)).toBeCloseTo(1, 3);
  });

  it('still finishes both moves in a very short scene', () => {
    const { container, text } = sceneTiming({ durationInFrames: 12, fps: 30, exit: 'all' });
    expect(container.enterAt + container.enterFrames).toBeLessThanOrEqual(12);
    expect(text.enterAt + text.enterFrames).toBeLessThanOrEqual(text.exitAt);
    expect(text.exitAt).toBeGreaterThanOrEqual(0);
  });
});
