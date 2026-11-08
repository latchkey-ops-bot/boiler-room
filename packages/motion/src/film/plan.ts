import type { Campaign, Scene } from '@boiler-room/schema';
import type { ResolvedLogo } from '../brand/logo.ts';
import { skinOf } from '../brand/skin.ts';
import { framesBefore } from '../core/curves.ts';
import { type SceneTiming, sceneTiming } from '../core/presence.ts';
import { FORMAT_SIZES, type Format } from '../layout/stage.ts';
import { type Ground, groundOf, type Skin } from '../scenes/definition.ts';
import { definitionOf } from '../scenes/registry.ts';
import { buildTimeline, type SceneSpan, type TransitionWindow } from '../transitions/timeline.ts';
import { type ImageSize, screenImageIds } from './media.ts';

export interface PlannedImage {
  assetId: string;
  width: number;
  height: number;
}

export interface ScenePlan {
  index: number;
  span: SceneSpan;
  timing: SceneTiming;
  /** The ground the `Stage` draws under this scene. */
  ground: Ground;
  /** The images the scene shows, in the order of its `assetIds`. */
  images: PlannedImage[];
}

/**
 * Everything a render needs that is not a frame number, worked out once before the first frame.
 * It is plain data, because Remotion hands it from `calculateMetadata` to each render tab.
 */
export interface FilmPlan {
  campaign: Campaign;
  format: Format;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  logo: ResolvedLogo;
  skin: Skin;
  scenes: ScenePlan[];
  /** The transition on each boundary, as the resolver chose it, in order. */
  transitions: TransitionWindow[];
  /** The film frame from which nothing moves, the ground included, or the film's length. */
  stillFrom: number;
}

export interface PlanInputs {
  /** A campaign with its variants resolved, which has passed `validateCampaign` and `validateFilm`. */
  campaign: Campaign;
  format: Format;
  logo: ResolvedLogo;
  /** The size of each scene image, as loaded. */
  imageSizes: Record<string, ImageSize>;
}

function imagesOf(scene: Scene, campaign: Campaign, sizes: Record<string, ImageSize>) {
  return screenImageIds(scene, campaign).map((assetId): PlannedImage => {
    const size = sizes[assetId];
    if (!size) throw new Error(`The size of image "${assetId}" was not measured.`);
    return { assetId, width: size.width, height: size.height };
  });
}

export function planFilm({ campaign, format, logo, imageSizes }: PlanInputs): FilmPlan {
  const timeline = buildTimeline(campaign);
  const { width, height } = FORMAT_SIZES[format];
  const skin = skinOf(campaign.brand.colors.background);
  let stillFrom = timeline.durationInFrames;

  const scenes = timeline.spans.map((span, index): ScenePlan => {
    const scene = campaign.scenes[index] as Scene;
    const definition = definitionOf(scene.type);
    if (!definition) throw new Error(`Scene type "${scene.type}" is not registered.`);
    const holdFrom = definition.holdFrom?.(span.durationInFrames, timeline.fps);
    if (holdFrom !== undefined) stillFrom = Math.min(stillFrom, span.from + holdFrom);
    return {
      index,
      span,
      // Scenes keep everything to their last frame: T1 moves it, and T3 and T5 cut. A T5 entry
      // starts after its blank frames.
      timing: sceneTiming({
        durationInFrames: span.durationInFrames,
        fps: timeline.fps,
        exit: 'hold',
        enterAfter: framesBefore(span.in?.blank ?? 0, timeline.fps),
      }),
      ground: groundOf(definition, definition.props.parse(scene.props), skin),
      images: imagesOf(scene, campaign, imageSizes),
    };
  });

  return {
    campaign,
    format,
    width,
    height,
    fps: timeline.fps,
    durationInFrames: timeline.durationInFrames,
    logo,
    skin,
    scenes,
    transitions: timeline.windows,
    stillFrom,
  };
}
