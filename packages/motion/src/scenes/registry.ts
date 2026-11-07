import type { SceneRegistry } from '@boiler-room/schema';
import { cta } from './cta.tsx';
import type { AnySceneDefinition } from './definition.ts';
import { featureSequence } from './feature-sequence.tsx';
import { interfaceReveal } from './interface-reveal.tsx';
import { kineticTitle } from './kinetic-title.tsx';

/**
 * Every scene type, by the name campaigns use. Each entry holds its component, its props schema and
 * its text limits, and the whole object can be passed as `sceneRegistry` to `validateCampaign`.
 */
export const sceneRegistry = {
  'kinetic-title': kineticTitle,
  'interface-reveal': interfaceReveal,
  'feature-sequence': featureSequence,
  cta,
} satisfies SceneRegistry & Record<string, AnySceneDefinition>;

export type SceneType = keyof typeof sceneRegistry;

export const SCENE_TYPES = Object.keys(sceneRegistry) as SceneType[];

export const definitionOf = (type: string): AnySceneDefinition | undefined =>
  Object.hasOwn(sceneRegistry, type) ? sceneRegistry[type as SceneType] : undefined;
