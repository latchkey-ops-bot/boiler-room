import type { Campaign, Scene } from '@boiler-room/schema';
import { skinOf } from '../brand/skin.ts';
import { anchorVelocities, groundOf } from '../scenes/definition.ts';
import { definitionOf } from '../scenes/registry.ts';
import { type ResolvedSeam, resolveSeams, type SeamScene } from '../transitions/resolve.ts';

const isPivot = (scene: Scene) =>
  scene.type === 'type-card' && (scene.props as { variant?: unknown }).variant === 'pivot';

/**
 * A scene as the resolver sees it: its ground in this film's skin, and the velocities its
 * template's anchors declare for its props. A type with no template has no anchors, so every seam
 * into or out of it is a dead stop, and the render gate refuses it before this matters.
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
    ground:
      definition && parsed?.success
        ? groundOf(definition, props, skinOf(campaign.brand.colors.background))
        : 'base',
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
