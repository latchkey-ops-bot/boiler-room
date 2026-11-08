import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Asset, type Campaign, fromOklch, toOklch } from '@boiler-room/schema';
import type { Naive } from '../naive/client.ts';
import { naiveFileSrc } from '../researcher/output.ts';
import { allScenes } from './assets.ts';
import type { StyleDecision } from './style.ts';

/**
 * Tier 5: the few images the skill allows to be generated (`skills/art-director/SKILL.md`
 * section 5). Code decides what is needed, writes the prompt and enforces the cap, so no model can
 * spend on images. The agent only inspects what comes back.
 */

export type GenerationPurpose = 'event-field' | 'hero-texture';

export interface GenerationNeed {
  assetId: string;
  purpose: GenerationPurpose;
  sceneIds: string[];
  aspectRatio: '16:9' | '1:1';
  prompt: string;
}

/** The cheapest image model that did the job in testing: $0.015 for one 1824x1024 JPEG. */
export const DEFAULT_IMAGE_MODEL = 'black-forest-labs/flux.2-klein-4b';

export interface GenerationCap {
  /** At most this many images per film. A film has one colour event and one set piece. */
  maxImages: number;
  /** At most this much spent on images per film, in micro-USD. */
  maxMicroUsd: number;
  /** The expected price of one image, so a call that would cross the cap is not started. */
  estimateMicroUsd: number;
}

export const DEFAULT_CAP: GenerationCap = {
  maxImages: 2,
  maxMicroUsd: 100_000,
  estimateMicroUsd: 15_000,
};

export const GENERATED_LICENSE = 'Generated for this campaign. Not a capture.';

const NEVER =
  'No text, no letters, no words, no digits, no numbers, no logos, no symbols, no icons, no user interface, no screens, no people, no faces, no hands. Do not draw any colour code.';

/** The three stops of the Kinetic Plate ramp: L 0.12, the primary at L 0.45 or less, the accent. */
export function plateRamp(colors: Campaign['brand']['colors']): [string, string, string] {
  const primary = toOklch(colors.primary);
  return [
    fromOklch({ ...primary, l: 0.12 }),
    fromOklch({ ...primary, l: Math.min(primary.l, 0.45) }),
    colors.accent ?? fromOklch({ ...primary, l: 0.3 }),
  ];
}

function uniqueId(base: string, assets: Campaign['assets']): string {
  if (!Object.hasOwn(assets, base)) return base;
  for (let index = 2; ; index++) {
    const id = `${base}-${String.fromCharCode(96 + index)}`;
    if (!Object.hasOwn(assets, id)) return id;
  }
}

/** What may already fill each generated slot, so a second run does not generate again. */
export const KEEPS: Record<GenerationPurpose, readonly Asset['provenance'][]> = {
  'event-field': ['generated'],
  'hero-texture': ['generated', 'captured', 'uploaded'],
};

/** True when `id` is a declared image whose provenance is one of `provenances`. */
export function isImage(
  campaign: Campaign,
  id: string | undefined,
  provenances: readonly Asset['provenance'][],
): boolean {
  const asset = id && Object.hasOwn(campaign.assets, id) ? campaign.assets[id] : undefined;
  return asset?.kind === 'image' && provenances.includes(asset.provenance);
}

/**
 * What must be generated for this campaign, after the style decision:
 * - a field for `colour-event` when the primary reads as nothing at full bleed;
 * - one texture for the `iso-chain` hero object when it has no image.
 * A slot that already holds a fitting image keeps it.
 * Nothing else is generated: never a logo, a screen, a product, a person, text or a number.
 */
export function generationNeeds(campaign: Campaign, style: StyleDecision): GenerationNeed[] {
  const needs: GenerationNeed[] = [];
  const scenes = allScenes(campaign).map(({ scene }) => scene);
  const { colors } = style;

  const events = scenes.filter(
    (scene) =>
      scene.type === 'colour-event' && !isImage(campaign, scene.assetIds[0], KEEPS['event-field']),
  );
  if (style.primaryReadsAsNothing && events.length > 0) {
    const [deep, mid, far] = plateRamp(colors);
    needs.push({
      assetId: uniqueId('event-field', campaign.assets),
      purpose: 'event-field',
      sceneIds: events.map((scene) => scene.id),
      aspectRatio: '16:9',
      prompt: `Full-frame abstract colour field for a video background. A smooth radial gradient from ${deep} at the edges through ${mid} to a soft glow of ${far} off centre. Flat and minimal: no objects, no texture noise, no grain, no hard edges. ${NEVER}`,
    });
  }

  const chain = scenes.find((scene) => scene.type === 'iso-chain');
  if (chain && !isImage(campaign, chain.assetIds[0], KEEPS['hero-texture'])) {
    needs.push({
      assetId: uniqueId('hero-texture', campaign.assets),
      purpose: 'hero-texture',
      sceneIds: [chain.id],
      aspectRatio: '1:1',
      prompt: `Flat, full-bleed, seamless abstract surface texture, seen straight on: a fine regular geometric pattern in ${colors.primary} on ${colors.background}, matte, low contrast. The pattern runs off all four edges of the square. No border, no frame, no tile, no slab, no object, no shadow, no perspective. ${NEVER}`,
    });
  }
  return needs;
}

export interface GeneratedImage {
  need: GenerationNeed;
  fileId: string;
  asset: Asset;
  costMicroUsd: number;
  model: string;
  localPath: string | undefined;
}

export interface SkippedImage {
  need: GenerationNeed;
  reason: string;
}

export interface GenerationResult {
  generated: GeneratedImage[];
  skipped: SkippedImage[];
  spentMicroUsd: number;
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Generates each need in order until the cap is reached. Before a call it checks that the image
 * count and the spend so far, plus the dearer of the estimate and the dearest image seen, stay
 * within the cap. A copy of each image is saved under `<outDir>/assets/generated/`.
 */
export async function generateImages(
  client: Pick<Naive, 'media' | 'files'>,
  needs: readonly GenerationNeed[],
  options: { cap?: GenerationCap; model?: string; outDir?: string } = {},
): Promise<GenerationResult> {
  const cap = options.cap ?? DEFAULT_CAP;
  const model = options.model ?? DEFAULT_IMAGE_MODEL;
  const generated: GeneratedImage[] = [];
  const skipped: SkippedImage[] = [];
  let spent = 0;
  let dearest = cap.estimateMicroUsd;
  for (const need of needs) {
    if (generated.length >= cap.maxImages) {
      skipped.push({ need, reason: `image cap of ${cap.maxImages} per film reached` });
      continue;
    }
    if (spent + dearest > cap.maxMicroUsd) {
      skipped.push({
        need,
        reason: `spend cap of $${(cap.maxMicroUsd / 1e6).toFixed(2)} per film would be crossed`,
      });
      continue;
    }
    try {
      const result = await client.media.images.generate({
        model,
        prompt: need.prompt,
        aspect_ratio: need.aspectRatio,
        n: 1,
      });
      spent += result.cost_micro_usd;
      dearest = Math.max(dearest, result.cost_micro_usd);
      const file = result.files[0];
      if (!file) {
        skipped.push({ need, reason: 'the generator returned no file' });
        continue;
      }
      let localPath: string | undefined;
      if (options.outDir) {
        const dir = join(options.outDir, 'assets', 'generated');
        mkdirSync(dir, { recursive: true });
        localPath = join(dir, `${need.assetId}.${EXTENSIONS[file.content_type] ?? 'bin'}`);
        writeFileSync(localPath, Buffer.from(await client.files.downloadBytes(file.id)));
      }
      generated.push({
        need,
        fileId: file.id,
        model: result.model,
        costMicroUsd: result.cost_micro_usd,
        localPath,
        asset: {
          kind: 'image',
          src: naiveFileSrc(file.id),
          provenance: 'generated',
          license: GENERATED_LICENSE,
          ...(file.width ? { width: file.width } : {}),
          ...(file.height ? { height: file.height } : {}),
        },
      });
    } catch (cause) {
      skipped.push({
        need,
        reason: `generation failed: ${cause instanceof Error ? cause.message.slice(0, 200) : String(cause)}`,
      });
    }
  }
  return { generated, skipped, spentMicroUsd: spent };
}
