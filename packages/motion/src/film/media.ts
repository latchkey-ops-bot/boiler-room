import type { Asset, Campaign, Scene } from '@boiler-room/schema';
import { definitionOf } from '../scenes/registry.ts';

/** Images a scene may show as the product. A logo or an illustration is not the product. */
export const SCREEN_PROVENANCES: ReadonlySet<Asset['provenance']> = new Set([
  'captured',
  'uploaded',
]);

const isScreen = (asset: Asset | undefined): boolean =>
  asset?.kind === 'image' && SCREEN_PROVENANCES.has(asset.provenance);

/**
 * The images a scene shows, in the order of its `assetIds`: its captured or uploaded images, as
 * many as its template draws with these props.
 */
export function screenImageIds(scene: Scene, { assets }: Pick<Campaign, 'assets'>): string[] {
  const definition = definitionOf(scene.type);
  if (!definition) return [];
  const parsed = definition.props.safeParse(scene.props);
  const shown =
    parsed.success && definition.imagesShown
      ? Math.min(definition.maxImages, definition.imagesShown(parsed.data))
      : definition.maxImages;
  return scene.assetIds
    .filter((id) => isScreen(Object.hasOwn(assets, id) ? assets[id] : undefined))
    .slice(0, shown);
}

/** The first image a scene shows, which is the one a carry moves. */
export const screenImageId = (scene: Scene, campaign: Pick<Campaign, 'assets'>) =>
  screenImageIds(scene, campaign)[0];

export interface ImageSize {
  width: number;
  height: number;
}
