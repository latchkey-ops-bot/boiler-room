import type { SceneRegistry } from './validate.ts';

/**
 * The 15 scene types of the motion library, one per file in `docs/motion/scenes/`, with the
 * character limit per text role that each file's `text` row gives. Pass it to `validateCampaign`
 * as `sceneRegistry`: an unknown scene type then fails with `SCENE_TYPE_UNKNOWN`, and each type's
 * limits replace `DEFAULT_TEXT_LIMITS`. A role a type does not list still gets the default limit.
 * Word counts, lines, `card.min` and per-template limits are the Director's to check.
 */
export const sceneRegistry: SceneRegistry = {
  'word-slam': { text: { headline: 40 } },
  'logo-reveal': { text: { subhead: 32 } },
  'site-hero': { text: { label: 32 } },
  'type-card': { text: { headline: 40, subhead: 40 } },
  'site-scroll': { text: { label: 32 } },
  'proof-bars': { text: { headline: 40, label: 24, subhead: 24 } },
  'stat-counter': { text: { headline: 10, label: 40 } },
  'feature-card': { text: { headline: 40, label: 16 } },
  'tile-wall': { text: {} },
  'status-relay': { text: { headline: 40, label: 12 } },
  'rail-words': { text: { headline: 14, subhead: 14 } },
  'colour-event': { text: { headline: 20 } },
  'cell-type': { text: { headline: 16 } },
  'iso-chain': { text: { headline: 32, label: 16 } },
  'end-card': { text: { cta: 24, label: 38 } },
};
