import { type SceneRegistry, sceneRegistry } from '@boiler-room/schema';
import { cellType } from './cell-type.tsx';
import { colourEventScene } from './colour-event.tsx';
import type { AnySceneDefinition } from './definition.ts';
import { endCard } from './end-card.tsx';
import { featureCard } from './feature-card.tsx';
import { logoReveal } from './logo-reveal.tsx';
import { proofBars } from './proof-bars.tsx';
import { railWords } from './rail-words.tsx';
import { siteHero } from './site-hero.tsx';
import { siteScroll } from './site-scroll.tsx';
import { statCounter } from './stat-counter.tsx';
import { statusRelay } from './status-relay.tsx';
import { tileWall } from './tile-wall.tsx';
import { typeCard } from './type-card.tsx';
import { wordSlam } from './word-slam.tsx';

/**
 * The templates this package has built, each under the name of the scene type it draws in the
 * schema's `sceneRegistry`. That registry is the contract the Director writes to: it holds all 15
 * scene types of `docs/motion/scenes` and their text limits. This holds only components, props and
 * the copy each template sets, so there is one list of scene types and one set of limits.
 */
export const sceneImplementations: Readonly<Record<string, AnySceneDefinition>> = {
  'word-slam': wordSlam,
  'logo-reveal': logoReveal,
  'site-hero': siteHero,
  'type-card': typeCard,
  'site-scroll': siteScroll,
  'proof-bars': proofBars,
  'stat-counter': statCounter,
  'feature-card': featureCard,
  'tile-wall': tileWall,
  'status-relay': statusRelay,
  'rail-words': railWords,
  'cell-type': cellType,
  'colour-event': colourEventScene,
  'end-card': endCard,
};

/** The scene types a film can use today, in the order of the scene library. */
export const IMPLEMENTED_SCENE_TYPES: readonly string[] = Object.keys(sceneImplementations);

for (const type of IMPLEMENTED_SCENE_TYPES) {
  if (!Object.hasOwn(sceneRegistry, type)) {
    throw new Error(`Scene template "${type}" draws a type that is not in the schema's registry.`);
  }
}

/**
 * The schema's registry restricted to the types that render: the registry the render gate passes
 * to `validateCampaign`. Its limits are the schema's own.
 */
export const renderSceneRegistry: SceneRegistry = Object.fromEntries(
  IMPLEMENTED_SCENE_TYPES.map((type) => [type, sceneRegistry[type] ?? {}]),
);

export const definitionOf = (type: string): AnySceneDefinition | undefined =>
  Object.hasOwn(sceneImplementations, type) ? sceneImplementations[type] : undefined;
