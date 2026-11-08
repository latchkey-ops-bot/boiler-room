import type { Campaign, Scene } from '@boiler-room/schema';
import { skinOf } from '../brand/skin.ts';
import {
  type AnySceneDefinition,
  anchorVelocities,
  type Ground,
  groundOf,
  type Skin,
} from '../scenes/definition.ts';
import { definitionOf } from '../scenes/registry.ts';
import { type ResolvedSeam, resolveSeams, type SeamScene } from '../transitions/resolve.ts';

const isPivot = (scene: Scene) =>
  scene.type === 'type-card' && (scene.props as { variant?: unknown }).variant === 'pivot';

/** The skin's own ground, which every scene but a `colour-event` draws on. */
const SKIN_GROUND: Record<Skin, Ground> = { 'neutral-cut': 'base', 'kinetic-plate': 'plate' };

/**
 * The ground a scene draws on in this skin. A ground declared as data does not depend on props,
 * so it holds even while the props are invalid. One that is a function of props needs them to
 * parse, and until they do the scene is taken to be on the skin's own ground.
 */
function groundIn(
  definition: AnySceneDefinition | undefined,
  parsed: { success: true; data: unknown } | { success: false } | undefined,
  skin: Skin,
): Ground {
  if (definition && typeof definition.ground !== 'function') return definition.ground[skin];
  if (definition && parsed?.success) return groundOf(definition, parsed.data, skin);
  return SKIN_GROUND[skin];
}

/** True when the scene's template exists and refuses its props, so no seam beside it is known. */
export function propsRefused(scene: Scene): boolean {
  const definition = definitionOf(scene.type);
  return definition !== undefined && !definition.props.safeParse(scene.props).success;
}

/**
 * A scene as the resolver sees it: its ground in this film's skin, and the velocities its
 * template's anchors declare for its props. A type with no template has no anchors, so every seam
 * into or out of it is a dead stop, and the render gate refuses it before this matters. Neither
 * has a scene whose props its template refuses, which the gate refuses too.
 */
export function seamScene(scene: Scene, campaign: Pick<Campaign, 'brand'>): SeamScene {
  const definition = definitionOf(scene.type);
  const parsed = definition?.props.safeParse(scene.props);
  const props = parsed?.success ? parsed.data : undefined;
  const anchors = definition && parsed?.success ? anchorVelocities(definition, props) : [];
  const entry = anchors.find((anchor) => anchor.entry);
  const exit = anchors.find((anchor) => anchor.exit);
  return {
    id: scene.id,
    type: scene.type,
    ground: groundIn(definition, parsed, skinOf(campaign.brand.colors.background)),
    pivot: isPivot(scene),
    entry: entry?.entry ? { anchor: entry.id, velocity: entry.entry } : undefined,
    exit: exit?.exit ? { anchor: exit.id, velocity: exit.exit } : undefined,
    anchors: anchors.map(({ id }) => id),
    written: scene.transitionOut,
  };
}

/** The transition every boundary of a film plays, from the resolver. */
export const filmSeams = (campaign: Pick<Campaign, 'brand' | 'scenes'>): ResolvedSeam[] =>
  resolveSeams(campaign.scenes.map((scene) => seamScene(scene, campaign)));
