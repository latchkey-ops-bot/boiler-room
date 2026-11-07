import type { z } from 'zod';
import { campaignSchema } from './campaign.ts';
import { type Issue, type ValidateOptions, validateCampaign } from './validate.ts';

/**
 * The parts of a campaign that research produces before any scene exists: the brand, the assets
 * it found and the claims it can quote. Picked from `campaignSchema`, so they cannot drift from it.
 */
export const researchPartsSchema = campaignSchema.pick({ brand: true, assets: true, claims: true });

export type ResearchParts = z.infer<typeof researchPartsSchema>;

export type ResearchPartsResult =
  | { ok: true; issues: Issue[]; parts: ResearchParts }
  | { ok: false; issues: Issue[]; parts: undefined };

const PART_PATH = /^(?:brand|assets|claims)(?:$|[.[])/;

/**
 * Runs `validateCampaign` on research parts, so they pass the same rules a campaign does: schema,
 * asset references and kinds, asset availability, unique claim ids, the brand name rule and
 * contrast. The parts are wrapped in the smallest campaign that is valid without them, one empty
 * one-second scene, and only issues about the parts are reported.
 */
export async function validateResearchParts(
  input: unknown,
  options: Pick<ValidateOptions, 'assetExists'> = {},
): Promise<ResearchPartsResult> {
  const parts = typeof input === 'object' && input !== null ? input : {};
  const { brand, assets, claims } = parts as Record<string, unknown>;
  const wrapper = {
    schemaVersion: 1,
    id: 'research-parts',
    sourceUrl: 'https://research.invalid/',
    fps: 30,
    durationSeconds: 1,
    brand,
    assets,
    claims,
    scenes: [{ id: 'parts', type: 'parts', start: 0, end: 1, props: {}, text: [], assetIds: [] }],
    variants: { hooks: [], formats: ['16:9'], ctas: [] },
  };
  const result = await validateCampaign(wrapper, options);
  const issues = result.issues.filter(({ path }) => PART_PATH.test(path));
  const outside = result.issues.filter(({ path }) => !PART_PATH.test(path));
  if (outside.length > 0) {
    throw new Error(
      `validateResearchParts wrapped the parts in a campaign that is not valid: ${outside[0]?.message}`,
    );
  }
  if (!result.ok) return { ok: false, issues, parts: undefined };
  return {
    ok: true,
    issues,
    parts: {
      brand: result.campaign.brand,
      assets: result.campaign.assets,
      claims: result.campaign.claims,
    },
  };
}
