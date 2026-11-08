import type { TextRole } from '@boiler-room/schema';
import type { ComponentType } from 'react';
import type { z } from 'zod';
import type { MarkPlacement } from '../components/brand-mark.tsx';
import type { SceneProps } from '../components/scene-runtime.tsx';
import type { Pose } from '../core/camera.ts';
import type { SceneTiming } from '../core/presence.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';

/** The size of an image a scene shows, as it was loaded. */
export interface SceneImage {
  aspect: number;
  width: number;
  height: number;
}

/**
 * Where an image rests at one end of a scene, which is where a carry meets it. `chrome` is the
 * height of the browser bar drawn above it, 0 for an image shown on its own, and `address` the copy
 * in that bar, if any.
 */
export interface ImageAnchor {
  rect: Rect;
  pose: Pose;
  chrome: number;
  address?: string;
}

export interface AnchorRequest<Props> {
  props: Props;
  stage: Stage;
  image: SceneImage;
  durationInFrames: number;
  fps: number;
  timing: SceneTiming;
  /** The scene frame at which the scene takes the image back, or gives it up. */
  frame: number;
  /** The scene's text, for a scene that draws copy with the image, such as an address bar. */
  text: readonly { role: TextRole; value: string }[];
}

export interface ImageViewRequest<Props> {
  props: Props;
  stage: Stage;
  image: SceneImage;
  /** Which of the scene's images, in the order of `scene.assetIds`. */
  index: number;
  durationInFrames: number;
  fps: number;
}

/**
 * How an image is shown at its largest: the width the whole image is drawn at, and the most it is
 * scaled up beyond that, so a capture too small to be shown sharp can be refused.
 */
export interface ImageView {
  width: number;
  zoom: number;
}

export interface RoleCount {
  min: number;
  max: number;
}

export interface HoldRequest<Props> {
  props: Props;
  text: readonly { role: TextRole; value: string }[];
  durationInFrames: number;
  fps: number;
  timing: SceneTiming;
  /** True when a carry brings an element in, which then needs no entry of its own. */
  carriedIn: boolean;
  /** Where the scene is in the campaign, such as `scenes[3]`, for the issue to name. */
  path: string;
}

/** Something a hold would freeze before it is finished, and the change that gives it time. */
export interface HoldShortfall {
  message: string;
  fix: string;
}

/**
 * The template for one scene type of the schema's `sceneRegistry`. The text limits are not here:
 * the schema's registry holds them, and it is the contract the Director writes to. A template
 * says which roles it sets and how many of each, which `validateFilm` checks, and every role it
 * sets has a limit in the schema's entry for its type.
 */
export interface SceneDefinition<Props> {
  component: ComponentType<SceneProps<Props>>;
  props: z.ZodType<Props>;
  /** The copy this template sets. Copy in any other role would never reach the screen. */
  roles: Partial<Record<TextRole, RoleCount>>;
  /** `required` needs a captured or uploaded image, because a scene must show the real product. */
  image: 'none' | 'optional' | 'required';
  /** How many captured or uploaded images the template shows, from the start of `assetIds`. */
  maxImages: number;
  /** How many of them these props show, when props can turn images off. `maxImages` otherwise. */
  imagesShown?: (props: Props) => number;
  /** True when these props need an image that `image: 'optional'` would not, such as a crop. */
  imageNeeded?: (props: Props) => boolean;
  imageAnchor?: (request: AnchorRequest<Props>) => ImageAnchor | undefined;
  imageView?: (request: ImageViewRequest<Props>) => ImageView;
  /**
   * Where the scene draws the brand mark, which is where a carry of the mark meets it. A scene
   * whose file calls for no mark has none, and a carry with no image to move cannot leave or reach
   * it.
   */
  markAnchor?: (stage: Stage) => MarkPlacement;
  /**
   * For a scene that holds still to its end: whatever its hold would freeze before it is finished
   * at this length. `validateFilm` refuses each one, so a film never ends on a half-built frame.
   */
  unfinishedAtHold?: (request: HoldRequest<Props>) => HoldShortfall[];
}

export type AnySceneDefinition = SceneDefinition<unknown>;

/** Erases the props type, which each scene parses for itself before it renders. */
export const defineScene = <Props>(definition: SceneDefinition<Props>): AnySceneDefinition =>
  definition as unknown as AnySceneDefinition;
