import { describe, expect, it } from 'vitest';
import type { Campaign } from '../src/campaign.ts';
import { sceneFrames, toFrame } from '../src/frames.ts';
import { sceneFrames as exportedSceneFrames, toFrame as exportedToFrame } from '../src/index.ts';
import { validateCampaign } from '../src/validate.ts';
import { novaCopy } from './negative-fixtures.ts';

const at = <T>(list: T[], index: number): T => list[index] as T;

/** Moves the boundary between the first two scenes, and the hook that shares it. */
const withBoundary = (campaign: Campaign, seconds: number) => {
  at(campaign.scenes, 0).end = seconds;
  at(campaign.scenes, 1).start = seconds;
  at(campaign.variants.hooks, 0).end = seconds;
  return campaign;
};

const expectContiguous = ({ durationInFrames, scenes }: ReturnType<typeof sceneFrames>) => {
  let next = 0;
  for (const scene of scenes) {
    expect(scene.from).toBe(next);
    expect(Number.isInteger(scene.durationInFrames)).toBe(true);
    expect(scene.durationInFrames).toBeGreaterThan(0);
    next += scene.durationInFrames;
  }
  expect(next).toBe(durationInFrames);
};

describe('toFrame', () => {
  it('rounds to the nearest frame', () => {
    expect(toFrame(1.4, 1)).toBe(1);
    expect(toFrame(1.5, 1)).toBe(2);
    expect(toFrame(4, 30)).toBe(120);
  });

  it('absorbs float noise, which an unrounded product does not', () => {
    expect(4.1 * 30).not.toBe(123);
    expect(toFrame(4.1, 30)).toBe(123);
  });

  it('is exported from the package', () => {
    expect(exportedToFrame).toBe(toFrame);
    expect(exportedSceneFrames).toBe(sceneFrames);
  });
});

describe('sceneFrames', () => {
  it('gives the frames of every scene in Nova', () => {
    expect(sceneFrames(novaCopy())).toEqual({
      fps: 30,
      durationInFrames: 600,
      scenes: [
        { id: 'open', from: 0, durationInFrames: 120 },
        { id: 'speed', from: 120, durationInFrames: 150 },
        { id: 'adoption', from: 270, durationInFrames: 150 },
        { id: 'close', from: 420, durationInFrames: 180 },
      ],
    });
  });

  it('gives whole frames for a duration that is off the frame grid', async () => {
    const campaign = novaCopy();
    campaign.durationSeconds = 20.01;
    at(campaign.scenes, 3).end = 20.01;
    expect((await validateCampaign(campaign)).ok).toBe(true);
    expect(campaign.durationSeconds * campaign.fps).not.toBe(600);
    expect(sceneFrames(campaign).durationInFrames).toBe(600);
    expectContiguous(sceneFrames(campaign));
  });

  it('gives whole frames for a boundary with float noise', () => {
    const campaign = withBoundary(novaCopy(), 4.1);
    expect(sceneFrames(campaign).scenes[1]?.from).toBe(123);
    expectContiguous(sceneFrames(campaign));
  });

  it('keeps a shared boundary whole where duration times fps does not', () => {
    const campaign = withBoundary(novaCopy(), 2.35);
    at(campaign.scenes, 1).end = 9;
    const [first, second] = campaign.scenes as [Campaign['scenes'][0], Campaign['scenes'][0]];
    const naiveSeam =
      Math.round(first.start * 30) +
      Math.round((first.end - first.start) * 30) +
      Math.round((second.end - second.start) * 30);
    expect(naiveSeam).not.toBe(toFrame(second.end, 30));
    expectContiguous(sceneFrames(campaign));
  });

  it('tiles every campaign the validator passes, at any frame rate', async () => {
    for (const fps of [12, 15, 24, 25, 30, 48, 50, 60]) {
      for (let tenths = 1; tenths < 40; tenths += 1) {
        const campaign = withBoundary(novaCopy(), tenths / 10 + 0.05);
        campaign.fps = fps;
        if ((await validateCampaign(campaign)).ok) expectContiguous(sceneFrames(campaign));
      }
    }
  });

  it('gives transitions no frames, so scene.start stays true', () => {
    const campaign = novaCopy();
    const frames = sceneFrames(campaign);
    for (const scene of campaign.scenes) delete scene.transitionOut;
    expect(sceneFrames(campaign)).toEqual(frames);
    expect(at(frames.scenes, 1).from).toBe(toFrame(at(campaign.scenes, 1).start, campaign.fps));
  });
});
