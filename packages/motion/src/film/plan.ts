import type { Campaign, Scene } from '@boiler-room/schema';
import type { ResolvedLogo } from '../brand/logo.ts';
import type { CarryElement } from '../components/scene-runtime.tsx';
import { type SceneExit, type SceneTiming, sceneTiming } from '../core/presence.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../layout/stage.ts';
import type { ImageAnchor } from '../scenes/definition.ts';
import { definitionOf } from '../scenes/registry.ts';
import { buildTimeline, type SceneSpan, type TransitionWindow } from '../transitions/timeline.ts';
import { type ImageSize, screenImageId } from './media.ts';

export interface ScenePlan {
  index: number;
  span: SceneSpan;
  timing: SceneTiming;
  image: { assetId: string; aspect: number } | undefined;
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

function exitOf(span: SceneSpan, isLast: boolean): SceneExit {
  if (span.out?.name === 'push') return 'hold';
  if (span.out?.name === 'carry') return 'text';
  return isLast ? 'hold' : 'all';
}

function imageOf(scene: Scene, campaign: Campaign, sizes: Record<string, ImageSize>) {
  const assetId = screenImageId(scene, campaign);
  if (!assetId) return undefined;
  const size = sizes[assetId];
  if (!size) throw new Error(`The size of image "${assetId}" was not measured.`);
  return { assetId, aspect: size.width / size.height };
}

/** A carry moves the product when both scenes show the same image, and the brand mark otherwise. */
function carryElement(before: ScenePlan, after: ScenePlan): CarryElement {
  if (before.image && after.image && before.image.assetId === after.image.assetId) {
    return { kind: 'image', assetId: before.image.assetId };
  }
  return { kind: 'mark' };
}

const featureCount = (scene: Scene) => scene.text.filter(({ role }) => role !== 'headline').length;

function imageAnchor(
  plan: ScenePlan,
  scene: Scene,
  stage: ReturnType<typeof stageFor>,
  frame: number,
): ImageAnchor | undefined {
  const definition = definitionOf(scene.type);
  if (!definition?.imageAnchor || !plan.image) return undefined;
  return definition.imageAnchor({
    props: definition.props.parse(scene.props),
    stage,
    imageAspect: plan.image.aspect,
    durationInFrames: plan.span.durationInFrames,
    timing: plan.timing,
    frame,
    featureCount: featureCount(scene),
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
        exit: exitOf(span, index === timeline.spans.length - 1),
        enterAfter: span.in ? span.in.to - span.in.boundary : 0,
        clearBefore: span.out ? span.out.boundary - span.out.from : 0,
        arrivesWhole: span.in?.name === 'push',
      }),
      image: imageOf(scene, campaign, imageSizes),
      carriedIn: undefined,
      carriedOut: undefined,
    };
  });

  const carries: CarryPlan[] = [];
  for (const [index, before] of scenes.entries()) {
    const after = scenes[index + 1];
    const window = before.span.out;
    if (!after || window?.name !== 'carry') continue;
    const element = carryElement(before, after);
    before.carriedOut = element;
    after.carriedIn = element;
    const from = imageAnchor(
      before,
      campaign.scenes[index] as Scene,
      stage,
      window.from - before.span.from,
    );
    const to = imageAnchor(
      after,
      campaign.scenes[index + 1] as Scene,
      stage,
      window.to - after.span.from,
    );
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
