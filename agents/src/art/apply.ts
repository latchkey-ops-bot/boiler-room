import type { Asset, Campaign, Scene } from '@boiler-room/schema';
import { type AssetInfo, checkPick, type PickProblem, type Proposal, slotOf } from './assets.ts';
import type { ArtDecision } from './decision.ts';
import { type GeneratedImage, isImage, KEEPS } from './generate.ts';

/**
 * Turns the code's proposals and the agent's decision into the final picks, and writes them into
 * a copy of the campaign. Every agent pick is checked first; a scene whose pick fails keeps the
 * code's default, and a generated image is declared only when the agent accepted it.
 */

export interface Gate {
  problems: PickProblem[];
  /** Final asset ids per reviewed scene, and where each came from. */
  picks: Map<string, { assetIds: string[]; source: 'agent' | 'default'; reason: string }>;
  /** Generated images the agent accepted, by asset id, with its reason. */
  accepted: Map<string, string>;
  rejected: Map<string, string>;
}

export function gateDecision(
  decision: ArtDecision | undefined,
  proposals: readonly Proposal[],
  infos: readonly AssetInfo[],
  generated: readonly GeneratedImage[],
): Gate {
  const problems: PickProblem[] = [];
  const picks: Gate['picks'] = new Map();
  const accepted = new Map<string, string>();
  const rejected = new Map<string, string>();
  const entries = new Map((decision?.scenes ?? []).map((entry) => [entry.scene_id, entry]));
  const reviewed = new Set(proposals.map((proposal) => proposal.sceneId));

  for (const proposal of proposals) {
    const entry = entries.get(proposal.sceneId);
    const fallback = {
      assetIds: proposal.assetIds,
      source: 'default' as const,
      reason: proposal.note ?? 'The code ranking.',
    };
    if (!entry) {
      if (decision) {
        problems.push({
          sceneId: proposal.sceneId,
          message: 'This scene is in the review list but not in your result.',
          fix: `Add an entry for ${proposal.sceneId}, keeping the default if it is right.`,
        });
      }
      picks.set(proposal.sceneId, fallback);
      continue;
    }
    const found = checkPick(proposal, entry.asset_ids, infos);
    problems.push(...found);
    picks.set(
      proposal.sceneId,
      found.length === 0
        ? { assetIds: entry.asset_ids, source: 'agent', reason: entry.reason }
        : fallback,
    );
  }
  for (const id of entries.keys()) {
    if (!reviewed.has(id)) {
      problems.push({
        sceneId: id,
        message: 'This scene is not in the review list.',
        fix: `Remove ${id} from scenes.`,
      });
    }
  }

  const verdicts = new Map((decision?.generated ?? []).map((entry) => [entry.asset_id, entry]));
  for (const image of generated) {
    const verdict = verdicts.get(image.need.assetId);
    if (!verdict) {
      if (decision) {
        problems.push({
          sceneId: image.need.assetId,
          message: 'This generated image has no verdict.',
          fix: `View file ${image.fileId} and add an entry for ${image.need.assetId} to generated.`,
        });
      }
      rejected.set(image.need.assetId, 'Not inspected, so not declared.');
    } else if (verdict.accept) accepted.set(image.need.assetId, verdict.reason);
    else rejected.set(image.need.assetId, verdict.reason);
  }
  return { problems, picks, accepted, rejected };
}

export interface ArtPlan {
  colors: Campaign['brand']['colors'];
  brand: Campaign['brand'];
  extraAssets: Record<string, Asset>;
  picks: ReadonlyMap<string, { assetIds: string[] }>;
  /** Accepted generated images. */
  generated: readonly GeneratedImage[];
}

function sceneAssets(scene: Scene, campaign: Campaign, plan: ArtPlan): string[] {
  const slot = slotOf(scene.type);
  switch (slot.source) {
    case 'none':
      return [];
    case 'captured':
      return [...(plan.picks.get(scene.id)?.assetIds ?? scene.assetIds)];
    default: {
      const made = plan.generated.find((image) => image.need.sceneIds.includes(scene.id));
      if (made) return [made.need.assetId];
      const current = scene.assetIds[0];
      return isImage(campaign, current, KEEPS[slot.source]) && current ? [current] : [];
    }
  }
}

/** A copy of the campaign with the colours, fonts, generated assets and picks applied. */
export function applyArt(campaign: Campaign, plan: ArtPlan): Campaign {
  const assets: Campaign['assets'] = { ...campaign.assets, ...plan.extraAssets };
  for (const image of plan.generated) assets[image.need.assetId] = image.asset;
  const withScene = (scene: Scene): Scene => ({
    ...scene,
    assetIds: sceneAssets(scene, campaign, plan),
  });
  return {
    ...campaign,
    brand: { ...plan.brand, colors: plan.colors },
    assets,
    scenes: campaign.scenes.map(withScene),
    variants: { ...campaign.variants, hooks: campaign.variants.hooks.map(withScene) },
  };
}
