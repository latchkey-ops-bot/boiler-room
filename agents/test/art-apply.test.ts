import { sceneRegistry, validateCampaign } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import {
  applyArt,
  type Batch,
  type BatchResult,
  batchFiles,
  gateReviews,
  planBatches,
  VIEW_LIMIT,
} from '../src/art/apply.ts';
import { classifyAssets, distinctAssets, proposeAssets } from '../src/art/assets.ts';
import { checkBrand } from '../src/art/brand.ts';
import { type Review, reviewSchema } from '../src/art/decision.ts';
import { GENERATED_LICENSE, type GeneratedImage, generationNeeds } from '../src/art/generate.ts';
import { decideStyle } from '../src/art/style.ts';
import { artCampaign, DIGESTS } from './art-fixtures.ts';

function setup(primary = '#5850EC', wall = false) {
  const campaign = artCampaign({ primary });
  if (wall) {
    const team = campaign.scenes.find((scene) => scene.id === 'team');
    if (!team) throw new Error('fixture changed');
    team.type = 'tile-wall';
    team.text = [];
  }
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
  const batches = planBatches(proposals, generated);
  return { campaign, style, infos, proposals, generated, batches };
}

const review = (parts: Partial<Review>): Review =>
  reviewSchema.parse({ seen: true, scene: null, tiles: [], generated: [], flags: [], ...parts });

const byId = (batches: Batch[], id: string) => {
  const batch = batches.find((each) => each.id === id);
  if (!batch) throw new Error(`no batch ${id}`);
  return batch;
};

describe('planBatches', () => {
  it('reviews generated images first, then each scene with a choice, in views of at most 4', () => {
    const { batches, infos } = setup();
    expect(batches.map((batch) => `${batch.kind}:${batch.id}`)).toEqual([
      'generated:generated-1',
      'scene:hero',
      'scene:scroll',
      'scene:calendar',
      'scene:queue',
      'scene:team',
    ]);
    for (const batch of batches) {
      expect(batchFiles(batch, infos).length).toBeGreaterThan(0);
      expect(batchFiles(batch, infos).length).toBeLessThanOrEqual(VIEW_LIMIT);
    }
  });

  it('splits a tile wall into groups of 4', () => {
    const { batches } = setup('#5850EC', true);
    const tiles = batches.filter((batch) => batch.kind === 'tiles');
    expect(tiles.map((batch) => batch.id)).toEqual(['team-1', 'team-2']);
    expect(tiles.flatMap((batch) => (batch.kind === 'tiles' ? batch.assetIds : []))).toHaveLength(
      7,
    );
  });

  it("does not review a site-hero whose props hold capture boxes for the Director's page", () => {
    const campaign = artCampaign();
    const hero = campaign.scenes.find((scene) => scene.id === 'hero');
    if (!hero) throw new Error('fixture changed');
    hero.props = { focus: { x: 0, y: 0, w: 960, h: 540 } };
    const infos = distinctAssets(classifyAssets(campaign, { digests: DIGESTS }));
    const proposals = proposeAssets(campaign, infos);
    expect(proposals.find((proposal) => proposal.sceneId === 'hero')).toMatchObject({
      assetIds: ['home-screen'],
      locked: true,
    });
    expect(planBatches(proposals, []).map((batch) => batch.id)).not.toContain('hero');
  });

  it('skips a scene with nothing to choose', () => {
    const { proposals } = setup();
    const hero = proposals.find((proposal) => proposal.sceneId === 'hero');
    if (!hero) throw new Error('fixture changed');
    const only = { ...hero, candidates: hero.candidates.slice(0, 1) };
    expect(planBatches([only], [])).toEqual([]);
  });
});

describe('gateReviews', () => {
  it("takes a valid pick and the agent's verdict on each generated image", () => {
    const { batches, proposals, infos, generated } = setup();
    const results: BatchResult[] = [
      {
        batch: byId(batches, 'team'),
        review: review({
          scene: { scene_id: 'team', asset_ids: ['about-screen'], reason: 'The team page.' },
        }),
        failure: undefined,
      },
      {
        batch: byId(batches, 'generated-1'),
        review: review({
          generated: [{ asset_id: 'hero-texture', accept: true, reason: 'Abstract, no glyphs.' }],
        }),
        failure: undefined,
      },
    ];
    const gate = gateReviews(results, proposals, infos, generated);
    expect(gate.problems).toEqual([]);
    expect(gate.picks.get('team')).toMatchObject({ assetIds: ['about-screen'], source: 'agent' });
    expect(gate.picks.get('hero')).toMatchObject({ source: 'default' });
    expect(gate.accepted.get('hero-texture')).toBe('Abstract, no glyphs.');
  });

  it('keeps the ranking for a refused pick, a failed batch or an unseen review', () => {
    const { batches, proposals, infos, generated } = setup();
    const results: BatchResult[] = [
      {
        batch: byId(batches, 'hero'),
        review: review({ scene: { scene_id: 'hero', asset_ids: ['logo'], reason: 'x' } }),
        failure: undefined,
      },
      {
        batch: byId(batches, 'calendar'),
        review: undefined,
        failure: 'interrupted: ran past 3 minutes',
      },
      {
        batch: byId(batches, 'queue'),
        review: review({
          seen: false,
          scene: { scene_id: 'queue', asset_ids: [], reason: 'Could not see.' },
        }),
        failure: undefined,
      },
      {
        batch: byId(batches, 'generated-1'),
        review: review({
          seen: false,
          generated: [{ asset_id: 'hero-texture', accept: true, reason: 'Looks fine.' }],
        }),
        failure: undefined,
      },
    ];
    const gate = gateReviews(results, proposals, infos, generated);
    expect(gate.problems.map((problem) => problem.message)).toEqual([
      expect.stringMatching(/^logo is not among/),
    ]);
    expect(gate.picks.get('hero')).toMatchObject({ assetIds: ['home-screen'], source: 'default' });
    expect(gate.picks.get('calendar')?.reason).toMatch(/ran past 3 minutes/);
    expect(gate.picks.get('queue')).toMatchObject({
      assetIds: ['features-ui-2'],
      source: 'default',
    });
    expect(gate.accepted.size).toBe(0);
    expect(gate.rejected.get('hero-texture')).toMatch(/did not see every picture/);
  });

  it('refuses a pick from outside what the batch showed', () => {
    const { proposals, infos, generated } = setup();
    const proposal = proposals.find((each) => each.sceneId === 'scroll');
    if (!proposal || proposal.candidates.length < 3) throw new Error('fixture changed');
    const [a, b, c] = proposal.candidates.map((candidate) => candidate.id);
    const shown: Batch = { kind: 'scene', id: 'scroll', proposal, assetIds: [a ?? '', b ?? ''] };
    const gate = gateReviews(
      [
        {
          batch: shown,
          review: review({
            scene: { scene_id: 'scroll', asset_ids: [a ?? '', c ?? ''], reason: 'x' },
          }),
          failure: undefined,
        },
      ],
      proposals,
      infos,
      generated,
    );
    expect(gate.picks.get('scroll')?.source).toBe('default');
    expect(gate.problems[0]?.message).toMatch(/not among/);
  });

  it('builds a tile wall from the ranked tiles without the dropped ones', () => {
    const { batches, proposals, infos } = setup('#5850EC', true);
    const [first, second] = batches.filter((batch) => batch.kind === 'tiles');
    if (!first || !second || first.kind !== 'tiles') throw new Error('no tile batches');
    const dropped = first.assetIds[0] ?? '';
    const gate = gateReviews(
      [
        {
          batch: first,
          review: review({
            tiles: first.assetIds.map((id) => ({
              asset_id: id,
              keep: id !== dropped,
              reason: id === dropped ? 'Mostly a cookie banner.' : 'A real page.',
            })),
          }),
          failure: undefined,
        },
        { batch: second, review: undefined, failure: 'no review submitted' },
      ],
      proposals,
      infos,
      [],
    );
    const wall = gate.picks.get('team');
    expect(wall?.source).toBe('agent');
    expect(wall?.assetIds).not.toContain(dropped);
    expect(wall?.assetIds).toHaveLength(6);
    expect(gate.dropped.get(dropped)).toBe('Mostly a cookie banner.');
  });
});

describe('applyArt', () => {
  it('writes colours, picks and accepted images into a campaign that still validates', async () => {
    const { campaign, style, infos, proposals, generated, batches } = setup('#222222');
    const gate = gateReviews(
      [
        {
          batch: byId(batches, 'generated-1'),
          review: review({
            generated: [
              { asset_id: 'event-field', accept: true, reason: 'A clean gradient.' },
              { asset_id: 'hero-texture', accept: false, reason: 'Letters in the corner.' },
            ],
          }),
          failure: undefined,
        },
      ],
      proposals,
      infos,
      generated,
    );
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
