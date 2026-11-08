import type { Asset, Campaign, Scene } from '@boiler-room/schema';
import { fileIdOf } from '../researcher/output.ts';
import { type AssetInfo, checkPick, type PickProblem, type Proposal, slotOf } from './assets.ts';
import type { Review } from './decision.ts';
import { type GeneratedImage, isImage, KEEPS } from './generate.ts';

/**
 * The agent reviews in small batches, one session each, because the harness shows a session's
 * pictures reliably only when it views them in one call of at most 4. Each batch is gated alone:
 * a batch that fails, times out or did not see its pictures leaves the code's ranking for exactly
 * its scenes and declares none of its images.
 */

/** The most pictures one `view_image` call takes. */
export const VIEW_LIMIT = 4;

export type Batch =
  | { kind: 'scene'; id: string; proposal: Proposal; assetIds: string[] }
  | { kind: 'tiles'; id: string; proposal: Proposal; assetIds: string[] }
  | { kind: 'generated'; id: string; images: GeneratedImage[] };

/** The Naive file id of each picture a batch shows, in order. */
export function batchFiles(batch: Batch, infos: readonly AssetInfo[]): string[] {
  if (batch.kind === 'generated') return batch.images.map((image) => image.fileId);
  const info = new Map(infos.map((item) => [item.id, item]));
  return batch.assetIds.flatMap((id) => {
    const src = info.get(id)?.asset.src;
    const fileId = src ? fileIdOf(src) : undefined;
    return fileId ? [fileId] : [];
  });
}

/**
 * One batch for the generated images, one per scene that has a real choice, and the tile-wall's
 * candidates in groups of 4. A scene whose candidates are exactly what it must take has
 * nothing to choose and is not reviewed.
 */
export function planBatches(
  proposals: readonly Proposal[],
  generated: readonly GeneratedImage[],
): Batch[] {
  const batches: Batch[] = [];
  // Generated images first: nothing generated is declared without a look.
  for (let start = 0; start < generated.length; start += VIEW_LIMIT) {
    batches.push({
      kind: 'generated',
      id: `generated-${start / VIEW_LIMIT + 1}`,
      images: generated.slice(start, start + VIEW_LIMIT),
    });
  }
  for (const proposal of proposals) {
    const ids = proposal.candidates.map((candidate) => candidate.id);
    if (proposal.type === 'tile-wall') {
      for (let start = 0; start < ids.length; start += VIEW_LIMIT) {
        batches.push({
          kind: 'tiles',
          id: `${proposal.sceneId}-${start / VIEW_LIMIT + 1}`,
          proposal,
          assetIds: ids.slice(start, start + VIEW_LIMIT),
        });
      }
    } else if (!proposal.locked && ids.length > proposal.slot.min) {
      batches.push({
        kind: 'scene',
        id: proposal.sceneId,
        proposal,
        assetIds: ids.slice(0, VIEW_LIMIT),
      });
    }
  }
  return batches;
}

const halves = <T>(items: readonly T[]): T[][] => {
  const cut = Math.ceil(items.length / 2);
  return [items.slice(0, cut), items.slice(cut)].filter((half) => half.length > 0);
};

/**
 * The batches a batch is retried as after its session was paused on its budget: each shows fewer
 * pictures, so each session reads less. Tiles and generated images are judged one by one, so they
 * split in two. A scene picks among what it is shown, so its retry shows the code's default and
 * the fewest others that still leave a choice. Empty when the batch cannot get smaller.
 */
export function smallerBatches(batch: Batch): Batch[] {
  if (batch.kind === 'generated') {
    if (batch.images.length < 2) return [];
    return halves(batch.images).map((images, index) => ({
      ...batch,
      id: `${batch.id}-${'ab'[index]}`,
      images,
    }));
  }
  if (batch.kind === 'tiles') {
    if (batch.assetIds.length < 2) return [];
    return halves(batch.assetIds).map((assetIds, index) => ({
      ...batch,
      id: `${batch.id}-${'ab'[index]}`,
      assetIds,
    }));
  }
  const defaults = batch.proposal.assetIds.filter((id) => batch.assetIds.includes(id));
  const need = Math.max(batch.proposal.slot.min, defaults.length) + 1;
  const others = batch.assetIds.filter((id) => !defaults.includes(id));
  const shown = new Set([...defaults, ...others.slice(0, Math.max(0, need - defaults.length))]);
  const assetIds = batch.assetIds.filter((id) => shown.has(id));
  return assetIds.length < batch.assetIds.length ? [{ ...batch, assetIds }] : [];
}

export interface Pick {
  assetIds: string[];
  source: 'agent' | 'default';
  reason: string;
}

export interface Gate {
  problems: PickProblem[];
  picks: Map<string, Pick>;
  /** Tiles the agent dropped, with its reason. */
  dropped: Map<string, string>;
  /** Generated images the agent accepted, by asset id, with its reason. */
  accepted: Map<string, string>;
  rejected: Map<string, string>;
  flags: string[];
}

/** The outcome of one batch: its review, or why there is none. */
export interface BatchResult {
  batch: Batch;
  review: Review | undefined;
  /** Why there is no usable review, when there is none. */
  failure: string | undefined;
}

const defaultPick = (proposal: Proposal, reason?: string): Pick => ({
  assetIds: proposal.assetIds,
  source: 'default',
  reason: reason ?? proposal.note ?? 'The code ranking.',
});

/**
 * Gates every batch and assembles the final picks. A scene with no usable review keeps the
 * code's default. A tile-wall takes its candidates in rank order, without the tiles the agent
 * dropped, up to what it fills. A generated image is accepted only when the agent saw it and said
 * so.
 */
export function gateReviews(
  results: readonly BatchResult[],
  proposals: readonly Proposal[],
  infos: readonly AssetInfo[],
  generated: readonly GeneratedImage[],
): Gate {
  const problems: PickProblem[] = [];
  const picks = new Map<string, Pick>();
  const dropped = new Map<string, string>();
  const accepted = new Map<string, string>();
  const rejected = new Map<string, string>();
  const flags: string[] = [];
  const wallsSeen = new Set<Proposal>();

  for (const { batch, review, failure } of results) {
    const usable = review?.seen ? review : undefined;
    const why = failure ?? (review && !review.seen ? 'the agent did not see every picture' : '');
    if (review) flags.push(...review.flags.map((flag) => `Agent (${batch.id}): ${flag}`));

    if (batch.kind === 'scene') {
      const { proposal } = batch;
      const entry = usable?.scene;
      if (!entry) {
        const reason = why ? `No review: ${why}.` : 'The review held no pick.';
        picks.set(proposal.sceneId, defaultPick(proposal, reason));
        continue;
      }
      const shown = new Set(batch.assetIds);
      const offered = {
        ...proposal,
        candidates: proposal.candidates.filter((candidate) => shown.has(candidate.id)),
      };
      const found =
        entry.scene_id === proposal.sceneId
          ? checkPick(offered, entry.asset_ids, infos)
          : [
              {
                sceneId: proposal.sceneId,
                message: `The review answered for ${entry.scene_id}.`,
                fix: `Answer for ${proposal.sceneId}.`,
              },
            ];
      problems.push(...found);
      picks.set(
        proposal.sceneId,
        found.length === 0
          ? { assetIds: entry.asset_ids, source: 'agent', reason: entry.reason }
          : defaultPick(proposal, `The pick was refused: ${found[0]?.message}`),
      );
    } else if (batch.kind === 'tiles') {
      if (!usable) continue;
      wallsSeen.add(batch.proposal);
      for (const tile of usable.tiles) {
        if (batch.assetIds.includes(tile.asset_id) && !tile.keep) {
          dropped.set(tile.asset_id, tile.reason);
        }
      }
    } else {
      const verdicts = new Map((usable?.generated ?? []).map((entry) => [entry.asset_id, entry]));
      for (const image of batch.images) {
        const verdict = verdicts.get(image.need.assetId);
        if (!verdict) {
          rejected.set(
            image.need.assetId,
            `Not inspected, so not declared${why ? `: ${why}` : ''}.`,
          );
        } else if (verdict.accept) accepted.set(image.need.assetId, verdict.reason);
        else rejected.set(image.need.assetId, verdict.reason);
      }
    }
  }

  for (const proposal of proposals) {
    if (proposal.type === 'tile-wall') {
      const ids = proposal.candidates.map((candidate) => candidate.id);
      const removed = ids.filter((id) => dropped.has(id));
      picks.set(
        proposal.sceneId,
        wallsSeen.has(proposal)
          ? {
              assetIds: ids.filter((id) => !dropped.has(id)).slice(0, proposal.slot.fill),
              source: 'agent',
              reason: `The ranked tiles, without the ${removed.length} the agent dropped.`,
            }
          : defaultPick(proposal),
      );
    } else if (!picks.has(proposal.sceneId)) {
      picks.set(proposal.sceneId, defaultPick(proposal));
    }
  }
  for (const image of generated) {
    if (!accepted.has(image.need.assetId) && !rejected.has(image.need.assetId)) {
      rejected.set(image.need.assetId, 'Not inspected, so not declared.');
    }
  }
  return { problems, picks, dropped, accepted, rejected, flags };
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
