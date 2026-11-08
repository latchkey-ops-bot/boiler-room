import type { Campaign, Scene } from '@boiler-room/schema';

export interface CutSelection {
  /** Swaps this hook in for the first scene. */
  hookId?: string | undefined;
  /** Swaps this CTA's label in for the `cta` text of every scene that has one. */
  ctaId?: string | undefined;
}

function withHook(scenes: Scene[], hook: Scene): Scene[] {
  const [first, ...rest] = scenes;
  // A hook is written without knowing what follows it, so it keeps the opening's way out.
  const transitionOut = hook.transitionOut ?? first?.transitionOut;
  return [{ ...hook, ...(transitionOut ? { transitionOut } : {}) }, ...rest];
}

const withCtaLabel = (scene: Scene, label: string): Scene => ({
  ...scene,
  text: scene.text.map((item) =>
    item.role === 'cta' ? { ...item, value: label, claimIds: [] } : item,
  ),
});

/**
 * The one film a selection describes, written as an ordinary campaign. Variants are resolved here,
 * so a template sees only `scene.text`, and a CTA's label reaches the screen through the same
 * path as all other copy. Its hooks are removed, so that it can be validated again as it stands.
 * Call this with a campaign that has passed `validateCampaign`.
 */
export function resolveCut(campaign: Campaign, { hookId, ctaId }: CutSelection): Campaign {
  const hook = campaign.variants.hooks.find(({ id }) => id === hookId);
  const cta = campaign.variants.ctas.find(({ id }) => id === ctaId);
  const opened = hook ? withHook(campaign.scenes, hook) : campaign.scenes;
  return {
    ...campaign,
    scenes: cta ? opened.map((scene) => withCtaLabel(scene, cta.label)) : opened,
    variants: { ...campaign.variants, hooks: [] },
  };
}
