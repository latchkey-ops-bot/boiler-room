import { sceneRegistry, validateCampaign } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { applyArt, gateDecision } from '../src/art/apply.ts';
import { classifyAssets, distinctAssets, proposeAssets } from '../src/art/assets.ts';
import { checkBrand } from '../src/art/brand.ts';
import { type ArtDecision, artDecisionSchema } from '../src/art/decision.ts';
import { GENERATED_LICENSE, type GeneratedImage, generationNeeds } from '../src/art/generate.ts';
import { decideStyle } from '../src/art/style.ts';
import { artCampaign, DIGESTS } from './art-fixtures.ts';

function setup(primary = '#5850EC') {
  const campaign = artCampaign({ primary });
  const style = decideStyle(campaign.brand.colors);
  const infos = distinctAssets(classifyAssets(campaign, { digests: DIGESTS }));
  const proposals = proposeAssets(campaign, infos);
  const generated: GeneratedImage[] = generationNeeds(
    { ...campaign, brand: { ...campaign.brand, colors: style.colors } },
    style,
  ).map((need, index) => ({
    need,
    fileId: `fil_gen${index}`,
    model: 'test/model',
    costMicroUsd: 15_000,
    localPath: undefined,
    asset: {
      kind: 'image',
      src: `naive://files/fil_gen${index}`,
      provenance: 'generated',
      license: GENERATED_LICENSE,
      width: 1024,
      height: 1024,
    },
  }));
  return { campaign, style, infos, proposals, generated };
}

const keepAll = (proposals: ReturnType<typeof setup>['proposals']): ArtDecision['scenes'] =>
  proposals.map((proposal) => ({
    scene_id: proposal.sceneId,
    seen: true,
    asset_ids: proposal.assetIds,
    reason: 'The default fits.',
  }));

describe('gateDecision', () => {
  it("takes the agent's valid picks and its verdict on each generated image", () => {
    const { proposals, infos, generated } = setup();
    const scenes = keepAll(proposals).map((entry) =>
      entry.scene_id === 'team' ? { ...entry, asset_ids: ['about-screen'] } : entry,
    );
    const gate = gateDecision(
      {
        scenes,
        generated: [
          { asset_id: 'hero-texture', seen: true, accept: true, reason: 'Abstract, no glyphs.' },
        ],
        flags: [],
      },
      proposals,
      infos,
      generated,
    );
    expect(gate.problems).toEqual([]);
    expect(gate.picks.get('team')).toMatchObject({ assetIds: ['about-screen'], source: 'agent' });
    expect(gate.accepted.get('hero-texture')).toBe('Abstract, no glyphs.');
  });

  it('keeps the default for a refused pick and reports every problem', () => {
    const { proposals, infos, generated } = setup();
    const scenes = keepAll(proposals)
      .filter((entry) => entry.scene_id !== 'queue')
      .map((entry) => (entry.scene_id === 'hero' ? { ...entry, asset_ids: ['logo'] } : entry));
    scenes.push({ scene_id: 'event', seen: true, asset_ids: [], reason: 'x' });
    const gate = gateDecision({ scenes, generated: [], flags: [] }, proposals, infos, generated);
    const messages = gate.problems.map((problem) => `${problem.sceneId}: ${problem.message}`);
    expect(messages).toEqual([
      expect.stringMatching(/^hero: logo is not among/),
      expect.stringMatching(/^queue: .*not in your result/),
      expect.stringMatching(/^event: .*not in the review list/),
      expect.stringMatching(/^hero-texture: .*no verdict/),
    ]);
    expect(gate.picks.get('hero')).toMatchObject({ assetIds: ['home-screen'], source: 'default' });
    expect(gate.rejected.get('hero-texture')).toMatch(/Not inspected/);
  });

  it('keeps the ranking for a scene and declares no image that the agent did not see', () => {
    const { proposals, infos, generated } = setup();
    const scenes = keepAll(proposals).map((entry) =>
      entry.scene_id === 'team' ? { ...entry, seen: false, asset_ids: ['about-screen'] } : entry,
    );
    const gate = gateDecision(
      {
        scenes,
        generated: [{ asset_id: 'hero-texture', seen: false, accept: true, reason: 'Looks fine.' }],
        flags: [],
      },
      proposals,
      infos,
      generated,
    );
    expect(gate.problems).toEqual([]);
    expect(gate.picks.get('team')).toMatchObject({ source: 'default' });
    expect(gate.picks.get('team')?.reason).toMatch(/could not see every candidate/);
    expect(gate.accepted.size).toBe(0);
    expect(gate.rejected.get('hero-texture')).toMatch(/^Not seen/);
  });

  it('declares nothing generated without a decision', () => {
    const { proposals, infos, generated } = setup();
    const gate = gateDecision(undefined, proposals, infos, generated);
    expect(gate.problems).toEqual([]);
    expect(gate.accepted.size).toBe(0);
  });
});

describe('applyArt', () => {
  it('writes colours, picks and accepted images into a campaign that still validates', async () => {
    const { campaign, style, infos, proposals, generated } = setup('#222222');
    const decision = artDecisionSchema.parse({
      scenes: keepAll(proposals),
      generated: [
        { asset_id: 'event-field', seen: true, accept: true, reason: 'A clean gradient.' },
        { asset_id: 'hero-texture', seen: true, accept: false, reason: 'Letters in the corner.' },
      ],
      flags: [],
    });
    const gate = gateDecision(decision, proposals, infos, generated);
    const brand = checkBrand(campaign);
    const result = applyArt(campaign, {
      colors: style.colors,
      brand: brand.brand,
      extraAssets: brand.assets,
      picks: gate.picks,
      generated: generated.filter((image) => gate.accepted.has(image.need.assetId)),
    });

    const scene = (id: string) => result.scenes.find((each) => each.id === id);
    expect(scene('hero')?.assetIds).toEqual(['home-screen']);
    expect(scene('calendar')?.assetIds).toEqual(['features-ui-1']);
    expect(scene('logo')?.assetIds).toEqual([]);
    expect(scene('event')?.assetIds).toEqual(['event-field']);
    expect(scene('chain')?.assetIds).toEqual([]);
    expect(result.assets['event-field']).toMatchObject({ provenance: 'generated' });
    expect(result.assets).not.toHaveProperty('hero-texture');
    expect(result.brand.colors).toEqual(style.colors);
    expect(campaign.scenes.find((each) => each.id === 'hero')?.assetIds).toEqual(['home-ui-1']);

    const { ok, issues } = await validateCampaign(result, { sceneRegistry });
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(ok).toBe(true);
  });
});

describe('checkBrand', () => {
  it('keeps open-licensed fonts', () => {
    const check = checkBrand(artCampaign());
    expect(check.fonts.map((font) => font.licence)).toEqual(['open', 'open']);
    expect(check.changes).toEqual([]);
  });

  it('falls back to Inter from the library for a font of unknown licence, and declares it', async () => {
    const campaign = artCampaign();
    campaign.brand.fonts.display = {
      family: 'Acme Grotesk',
      source: 'https://cdn.example.org/acme.woff2',
    };
    const check = checkBrand(campaign);
    expect(check.brand.fonts.display).toEqual({ family: 'Inter', source: 'inter-library' });
    expect(check.assets['inter-library']).toMatchObject({
      kind: 'font',
      provenance: 'library',
      license: 'OFL-1.1',
    });
    const result = applyArt(campaign, {
      colors: campaign.brand.colors,
      brand: check.brand,
      extraAssets: check.assets,
      picks: new Map(),
      generated: [],
    });
    expect((await validateCampaign(result, { sceneRegistry })).ok).toBe(true);
  });

  it('flags a generated wordmark logo, and never replaces it', () => {
    const campaign = artCampaign();
    campaign.assets.logo = { kind: 'svg', src: 'naive://files/fil_logo', provenance: 'generated' };
    const check = checkBrand(campaign);
    expect(check.flags.join(' ')).toMatch(/generated wordmark/);
    expect(check.brand.logoAssetId).toBe('logo');
  });
});
