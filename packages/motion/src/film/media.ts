import type { Asset, Campaign, Scene } from '@boiler-room/schema';
import { definitionOf } from '../scenes/registry.ts';

/** Images a scene may show as the product. A logo or an illustration is not the product. */
export const SCREEN_PROVENANCES: ReadonlySet<Asset['provenance']> = new Set([
  'captured',
  'uploaded',
]);

/** The image a scene shows: the first of its assets that is a captured or uploaded image. */
export function screenImageId(
  scene: Scene,
  { assets }: Pick<Campaign, 'assets'>,
): string | undefined {
  if (definitionOf(scene.type)?.image === 'none') return undefined;
  return scene.assetIds.find((id) => {
    const asset = Object.hasOwn(assets, id) ? assets[id] : undefined;
    return asset?.kind === 'image' && SCREEN_PROVENANCES.has(asset.provenance);
  });
}

export interface ImageSize {
  width: number;
  height: number;
}
