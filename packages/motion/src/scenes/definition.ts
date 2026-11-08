import type { SceneLimits, TextRole } from '@boiler-room/schema';
import type { ComponentType } from 'react';
import type { z } from 'zod';
import type { MarkPlacement } from '../components/brand-mark.tsx';
import type { SceneProps } from '../components/scene-runtime.tsx';
import type { Pose } from '../core/camera.ts';
import type { SceneTiming } from '../core/presence.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';

/** Where a browser frame rests at one end of a scene, which is where a carry meets it. */
export interface ImageAnchor {
  rect: Rect;
  pose: Pose;
}

export interface AnchorRequest<Props> {
  props: Props;
  stage: Stage;
  imageAspect: number;
  durationInFrames: number;
  timing: SceneTiming;
  /** The scene frame at which the scene takes the image back, or gives it up. */
  frame: number;
  /** How many text items are not the headline. */
  featureCount: number;
}

export interface ImageViewRequest<Props> {
  props: Props;
  stage: Stage;
  imageAspect: number;
  /** How many text items are not the headline. */
  featureCount: number;
}

/** How an image is shown at its largest: its width on screen, and the most the camera zooms in. */
export interface ImageView {
  width: number;
  zoom: number;
}

export interface RoleCount {
  min: number;
  max: number;
}

/**
 * One scene type. `text` is the shape `validateCampaign` reads as its `sceneRegistry`, so a
 * registry of these can be handed to it as it stands. Everything the validator does not know about
 * is checked by `validateFilm`.
 */
export interface SceneDefinition<Props> extends SceneLimits {
  component: ComponentType<SceneProps<Props>>;
  props: z.ZodType<Props>;
  text: Partial<Record<TextRole, number>>;
  /** The copy this template sets. Copy in any other role would never reach the screen. */
  roles: Partial<Record<TextRole, RoleCount>>;
  /** `required` needs a captured or uploaded image, because a scene must show the real product. */
  image: 'none' | 'optional' | 'required';
  imageAnchor?: (request: AnchorRequest<Props>) => ImageAnchor;
  /** How large the image is shown, so a capture too small to be shown sharp can be refused. */
  imageView?: (request: ImageViewRequest<Props>) => ImageView;
  markAnchor: (stage: Stage) => MarkPlacement;
}

export type AnySceneDefinition = SceneDefinition<unknown>;

/** Erases the props type, which each scene parses for itself before it renders. */
export const defineScene = <Props>(definition: SceneDefinition<Props>): AnySceneDefinition =>
  definition as unknown as AnySceneDefinition;
