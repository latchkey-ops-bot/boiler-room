import type { Campaign } from './campaign.ts';

export interface SceneFrames {
  id: string;
  /** The first frame of the scene. */
  from: number;
  durationInFrames: number;
}

export interface CampaignFrames {
  fps: number;
  durationInFrames: number;
  /** In timeline order. A hook replaces the first scene and takes its frames. */
  scenes: SceneFrames[];
}

/** The frame a time lands on. `validateCampaign` checks boundaries with this same rounding. */
export function toFrame(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/**
 * The whole frame numbers of a validated campaign. Templates and the render step must use these,
 * because `seconds * fps` is rarely a whole number, Remotion refuses a fractional
 * `durationInFrames`, and rounding `(end - start) * fps` opens a one frame seam between scenes.
 */
export function sceneFrames({
  scenes,
  fps,
  durationSeconds,
}: Pick<Campaign, 'scenes' | 'fps' | 'durationSeconds'>): CampaignFrames {
  return {
    fps,
    durationInFrames: toFrame(durationSeconds, fps),
    scenes: scenes.map(({ id, start, end }) => ({
      id,
      from: toFrame(start, fps),
      durationInFrames: toFrame(end, fps) - toFrame(start, fps),
    })),
  };
}
