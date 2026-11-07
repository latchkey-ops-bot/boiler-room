import { describe, expect, it, vi } from 'vitest';
import nova from '../examples/nova.campaign.json' with { type: 'json' };
import { researchPartsSchema, validateResearchParts } from '../src/research.ts';

const parts = () =>
  structuredClone({ brand: nova.brand, assets: nova.assets, claims: nova.claims });

describe('researchPartsSchema', () => {
  it('is the brand, assets and claims of the campaign schema', () => {
    expect(Object.keys(researchPartsSchema.shape).sort()).toEqual(['assets', 'brand', 'claims']);
    expect(researchPartsSchema.safeParse(parts()).success).toBe(true);
  });
});

describe('validateResearchParts', () => {
  it('passes the parts of a valid campaign', async () => {
    const result = await validateResearchParts(parts());
    expect(result).toEqual({ ok: true, issues: [], parts: parts() });
  });

  it('checks every asset through assetExists', async () => {
    const assetExists = vi.fn(async (src: string) => src !== 'assets/nova/logo.svg');
    const result = await validateResearchParts(parts(), { assetExists });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['ASSET_UNAVAILABLE', 'assets.logo.src'],
    ]);
  });

  it('reports a logo that is not declared', async () => {
    const input = parts();
    input.brand.logoAssetId = 'missing-logo';
    const result = await validateResearchParts(input);
    expect(result.issues.map((issue) => issue.code)).toEqual(['ASSET_UNDECLARED']);
    expect(result.issues[0]?.path).toBe('brand.logoAssetId');
  });

  it('reports a primary colour without enough contrast', async () => {
    const input = parts();
    input.brand.colors.primary = input.brand.colors.background;
    const result = await validateResearchParts(input);
    expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['CONTRAST_LOW', 'brand.colors.primary'],
    ]);
  });

  it('reports repeated claim ids and schema errors on the parts only', async () => {
    const input = parts();
    input.claims.push({ ...(input.claims[0] as (typeof input.claims)[number]) });
    expect((await validateResearchParts(input)).issues.map((issue) => issue.path)).toEqual([
      `claims[${input.claims.length - 1}].id`,
    ]);

    const broken = {
      ...parts(),
      claims: [{ id: 'x', text: 'x', quote: 'x', status: 'extracted' }],
    };
    const result = await validateResearchParts(broken);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['SCHEMA_INVALID', 'claims[0].sourceUrl'],
    ]);
  });

  it('fails a missing or non-object input on its parts', async () => {
    for (const input of [undefined, null, 'brand']) {
      const result = await validateResearchParts(input);
      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.path).sort()).toEqual([
        'assets',
        'brand',
        'claims',
      ]);
    }
  });
});
