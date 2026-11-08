import type { TextRole } from '@boiler-room/schema';
import type { ComponentType } from 'react';
import type { z } from 'zod';
import type { BrandTheme } from '../brand/theme.ts';
import type { MarkPlacement } from '../components/brand-mark.tsx';
import type { SceneProps } from '../components/scene-runtime.tsx';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';

/** The size of an image a scene shows, as it was loaded. */
export interface SceneImage {
  aspect: number;
  width: number;
  height: number;
}

/** A scene kind, for the rhythm rule. */
export type SceneKind = 'type' | 'proof' | 'product' | 'mark' | 'setpiece';

/** What the `Stage` draws under a scene. The ground timeline is derived from this. */
export type Ground = 'base' | 'plate' | 'event' | 'black';

/** The two whole-film skins. The renderer derives the skin from the brand's background. */
export type Skin = 'neutral-cut' | 'kinetic-plate';

/** How an anchor moves across a T1 seam: px per frame, or log scale per frame for `scale`. */
export interface Velocity {
  axis: 'x' | 'y' | 'scale';
  sign: 1 | -1;
  v: number;
}

/**
 * The anchor contract of `docs/motion/reference-spec.md`, section 5. `box` is a pure function of
 * the scene's spec frame, computed only from props, text and font measurements, never from the
 * DOM. `entry` and `exit` are the velocities the resolver matches for a T1 seam. `colour` is the
 * role the anchor fills, such as `'accent'`, for a transition that grows it into the ground.
 */
export interface Anchor {
  id: string;
  box: (f: number) => Rect;
  entry?: Velocity;
  exit?: Velocity;
  colour?: string;
}

/**
 * How a scene type declares an anchor. Velocities are plain data or a function of props, so the
 * resolver reads them before anything is measured, and `box` is only called while rendering, once
 * the brand fonts are loaded. `anchorsOf` turns the declarations into `Anchor`s.
 */
export interface AnchorDeclaration<Props> {
  id: string;
  entry?: Velocity | ((props: Props) => Velocity | undefined);
  exit?: Velocity | ((props: Props) => Velocity | undefined);
  colour?: string;
  box: (f: number, request: AnchorRequest<Props>) => Rect;
}

/** What a scene's anchors are computed from. Nothing in it changes from frame to frame. */
export interface AnchorRequest<Props> {
  props: Props;
  stage: Stage;
  /** The brand's colours, fonts, radius and logo, for anchors placed by measuring copy. */
  theme: BrandTheme;
  /** The images the scene shows, in the order of `scene.assetIds`. */
  images: readonly SceneImage[];
  /** The scene's length in spec frames. */
  dur: number;
  text: readonly { id: string; role: TextRole; value: string }[];
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

/**
 * Thrown by `imageView` when an image cannot be shown in this format, such as a page too short for
 * a scroll. `message` says why and `fix` what to supply instead, and the render gate lists it with
 * every other image's issue, so one pass names all the captures a film needs. `PROPS_INVALID` is
 * for a problem in the scene's props, at `propsPath` inside them, rather than in the image.
 */
export class ImageUnfit extends Error {
  readonly code: 'IMAGE_TOO_SMALL' | 'PROPS_INVALID';
  readonly fix: string;
  readonly propsPath: string | undefined;

  constructor(code: ImageUnfit['code'], message: string, fix: string, propsPath?: string) {
    super(message);
    this.name = 'ImageUnfit';
    this.code = code;
    this.fix = fix;
    this.propsPath = propsPath;
  }
}

export interface RoleCount {
  min: number;
  max: number;
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
  imageView?: (request: ImageViewRequest<Props>) => ImageView;
  /**
   * True when the template scrolls each image through a window rather than showing it whole, as
   * `site-scroll` does. Such an image is a page captured long, cropped from its top to the gate's
   * aspect limit, and never to one screen, which the gate's advice says.
   */
  scrollsImages?: boolean;
  markAnchor: (stage: Stage) => MarkPlacement;
  kind: SceneKind;
  /** The ground the `Stage` draws under the scene, in each skin. */
  ground: Record<Skin, Ground> | ((props: Props) => Record<Skin, Ground>);
  /** The anchors the scene exposes, in order: the first with an `entry` or `exit` seams. */
  anchors: readonly AnchorDeclaration<Props>[];
  /** The scene frame from which nothing moves, such as the end card's hold. The ground stops too. */
  holdFrom?: (durationInFrames: number, fps: number) => number;
  /** `logo-reveal` only: the spec frame where the logo is legible. */
  markLegibleAt?: number;
}

export type AnySceneDefinition = SceneDefinition<unknown>;

const velocityOf = <Props>(
  value: Velocity | ((props: Props) => Velocity | undefined) | undefined,
  props: Props,
): Velocity | undefined => (typeof value === 'function' ? value(props) : value);

/** The velocities a scene's anchors declare for these props, for the resolver. */
export const anchorVelocities = <Props>(
  definition: Pick<SceneDefinition<Props>, 'anchors'>,
  props: Props,
): { id: string; entry: Velocity | undefined; exit: Velocity | undefined }[] =>
  definition.anchors.map(({ id, entry, exit }) => ({
    id,
    entry: velocityOf(entry, props),
    exit: velocityOf(exit, props),
  }));

/** A scene's anchors as the spec's `Anchor` objects, each box closing over the request. */
export const anchorsOf = <Props>(
  definition: Pick<SceneDefinition<Props>, 'anchors'>,
  request: AnchorRequest<Props>,
): Anchor[] =>
  definition.anchors.map((declaration) => {
    const entry = velocityOf(declaration.entry, request.props);
    const exit = velocityOf(declaration.exit, request.props);
    return {
      id: declaration.id,
      box: (f: number) => declaration.box(f, request),
      ...(entry ? { entry } : {}),
      ...(exit ? { exit } : {}),
      ...(declaration.colour ? { colour: declaration.colour } : {}),
    };
  });

/** The ground a scene type draws on in a skin, for these props. */
export const groundOf = <Props>(
  definition: Pick<SceneDefinition<Props>, 'ground'>,
  props: Props,
  skin: Skin,
): Ground =>
  (typeof definition.ground === 'function' ? definition.ground(props) : definition.ground)[skin];

/** Erases the props type, which each scene parses for itself before it renders. */
export const defineScene = <Props>(definition: SceneDefinition<Props>): AnySceneDefinition =>
  definition as unknown as AnySceneDefinition;
