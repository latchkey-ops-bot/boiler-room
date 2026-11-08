import type { Campaign, Scene } from '@boiler-room/schema';
import type { ResolvedLogo } from '../brand/logo.ts';
import type { CarryElement } from '../components/scene-runtime.tsx';
import { type SceneExit, type SceneTiming, sceneTiming } from '../core/presence.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../layout/stage.ts';
import type { ImageAnchor } from '../scenes/definition.ts';
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
  /** The images the scene shows, in the order of its `assetIds`. A carry moves the first. */
  images: PlannedImage[];
  carriedIn: CarryElement | undefined;
  carriedOut: CarryElement | undefined;
}

export interface CarryPlan {
  window: TransitionWindow;
  element: CarryElement;
  outgoing: number;
  incoming: number;
  /** Where a carried image starts and ends. A mark is placed when it is drawn. */
  image: { from: ImageAnchor; to: ImageAnchor } | undefined;
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
  scenes: ScenePlan[];
  carries: CarryPlan[];
}

export interface PlanInputs {
  /** A campaign with its variants resolved, which has passed `validateCampaign` and `validateFilm`. */
  campaign: Campaign;
  format: Format;
  logo: ResolvedLogo;
  /** The size of each scene image, as loaded. */
  imageSizes: Record<string, ImageSize>;
}

/**
 * A push moves the scene, a carry clears the words for the element it moves, and a cut or the end
 * of the film keeps everything to the last frame, as a dead-stop cut does.
 */
function exitOf(span: SceneSpan): SceneExit {
  return span.out?.name === 'carry' ? 'text' : 'hold';
}

function imagesOf(scene: Scene, campaign: Campaign, sizes: Record<string, ImageSize>) {
  return screenImageIds(scene, campaign).map((assetId): PlannedImage => {
    const size = sizes[assetId];
    if (!size) throw new Error(`The size of image "${assetId}" was not measured.`);
    return { assetId, width: size.width, height: size.height };
  });
}

function imageAnchor(
  plan: ScenePlan,
  scene: Scene,
  stage: ReturnType<typeof stageFor>,
  fps: number,
  frame: number,
): ImageAnchor | undefined {
  const definition = definitionOf(scene.type);
  const [first] = plan.images;
  if (!definition?.imageAnchor || !first) return undefined;
  return definition.imageAnchor({
    props: definition.props.parse(scene.props),
    stage,
    image: { width: first.width, height: first.height, aspect: first.width / first.height },
    durationInFrames: plan.span.durationInFrames,
    fps,
    timing: plan.timing,
    frame,
    text: scene.text,
  });
}

export function planFilm({ campaign, format, logo, imageSizes }: PlanInputs): FilmPlan {
  const timeline = buildTimeline(campaign);
  const { width, height } = FORMAT_SIZES[format];
  const stage = stageFor(width, height);

  const scenes = timeline.spans.map((span, index): ScenePlan => {
    const scene = campaign.scenes[index] as Scene;
    return {
      index,
      span,
      timing: sceneTiming({
        durationInFrames: span.durationInFrames,
        fps: timeline.fps,
        exit: exitOf(span),
        enterAfter: span.in ? span.in.to - span.in.boundary : 0,
        clearBefore: span.out ? span.out.boundary - span.out.from : 0,
        arrivesWhole: span.in?.name === 'push',
      }),
      images: imagesOf(scene, campaign, imageSizes),
      carriedIn: undefined,
      carriedOut: undefined,
    };
  });

  const carries: CarryPlan[] = [];
  for (const [index, before] of scenes.entries()) {
    const after = scenes[index + 1];
    const window = before.span.out;
    if (!after || window?.name !== 'carry') continue;
    const from = imageAnchor(
      before,
      campaign.scenes[index] as Scene,
      stage,
      timeline.fps,
      window.from - before.span.from,
    );
    const to = imageAnchor(
      after,
      campaign.scenes[index + 1] as Scene,
      stage,
      timeline.fps,
      window.to - after.span.from,
    );
    // The product moves when both scenes hold the same image where a carry can meet it, and the
    // brand mark moves otherwise.
    const shared = before.images[0]?.assetId;
    const element: CarryElement =
      shared && shared === after.images[0]?.assetId && from && to
        ? { kind: 'image', assetId: shared }
        : { kind: 'mark' };
    before.carriedOut = element;
    after.carriedIn = element;
    carries.push({
      window,
      element,
      outgoing: index,
      incoming: index + 1,
      image: element.kind === 'image' && from && to ? { from, to } : undefined,
    });
  }

  return {
    campaign,
    format,
    width,
    height,
    fps: timeline.fps,
    durationInFrames: timeline.durationInFrames,
    logo,
    scenes,
    carries,
  };
}
