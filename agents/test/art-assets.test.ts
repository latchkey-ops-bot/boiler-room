import { describe, expect, it } from 'vitest';
import {
  canonicalIds,
  checkPick,
  classifyAssets,
  distinctAssets,
  pageKindOf,
  proposeAssets,
  SLOTS,
} from '../src/art/assets.ts';
import { artCampaign, DIGESTS, SITE } from './art-fixtures.ts';

const infosOf = (campaign = artCampaign()) =>
  distinctAssets(classifyAssets(campaign, { digests: DIGESTS }));

describe('SLOTS', () => {
  it('covers exactly the 15 scene types of the registry', async () => {
    const { sceneRegistry } = await import('@boiler-room/schema');
    expect(Object.keys(SLOTS).sort()).toEqual(Object.keys(sceneRegistry).sort());
  });
});

describe('pageKindOf', () => {
  it.each([
    [`${SITE}/`, 'home'],
    [`${SITE}/pricing`, 'pricing'],
    [`${SITE}/docs/start`, 'docs'],
    [`${SITE}/changelog`, 'changelog'],
    [`${SITE}/integrations`, 'integrations'],
    [`${SITE}/features`, 'product'],
    [`${SITE}/contact/demo`, 'contact'],
    [`${SITE}/now`, 'other'],
  ])('reads %s as %s', (url, kind) => {
    expect(pageKindOf(url)).toBe(kind);
  });

  it("takes the Researcher's kind for a page whose path says nothing", () => {
    expect(pageKindOf(`${SITE}/now`, new Map([[`${SITE}/now`, 'blog']]))).toBe('blog');
    expect(pageKindOf(`${SITE}/changelog`, new Map([[`${SITE}/changelog`, 'blog']]))).toBe(
      'changelog',
    );
  });
});

describe('classifyAssets', () => {
  it('ranks crops as tier 1, docs and pricing as tier 2, and site pages as tier 3', () => {
    const tiers = Object.fromEntries(
      classifyAssets(artCampaign()).map((info) => [info.id, info.tier]),
    );
    expect(tiers).toMatchObject({
      'features-ui-1': 1,
      'pricing-screen': 2,
      'docs-screen': 2,
      'home-screen': 3,
      'about-screen': 3,
    });
  });

  it('never offers the logo, a font or a generated image as scene imagery', () => {
    const campaign = artCampaign();
    campaign.assets.field = { kind: 'image', src: 'x.png', provenance: 'generated' };
    const ids = classifyAssets(campaign).map((info) => info.id);
    expect(ids).not.toContain('logo');
    expect(ids).not.toContain('field');
  });
});

describe('distinctAssets', () => {
  it('offers one asset per picture, keeping the page top over an identical "crop"', () => {
    const infos = infosOf();
    const home = infos.find((info) => info.id === 'home-screen');
    expect(infos.map((info) => info.id)).not.toContain('home-ui-1');
    expect(home).toMatchObject({ tier: 3, sameAs: ['home-ui-1'] });
    expect(canonicalIds(infos).get('home-ui-1')).toBe('home-screen');
  });
});

describe('proposeAssets', () => {
  const proposals = () => {
    const campaign = artCampaign();
    return new Map(
      proposeAssets(campaign, infosOf(campaign)).map((proposal) => [proposal.sceneId, proposal]),
    );
  };

  it('proposes only for scenes with a captured slot', () => {
    expect([...proposals().keys()]).toEqual(['hero', 'scroll', 'calendar', 'queue', 'team']);
  });

  it("keeps the Director's site-hero page, mapped through its duplicate", () => {
    expect(proposals().get('hero')).toMatchObject({ assetIds: ['home-screen'], tier: 3 });
  });

  it('scrolls a site page, then a pricing or docs page', () => {
    const scroll = proposals().get('scroll');
    expect(scroll?.assetIds).toEqual(['features-screen', 'pricing-screen']);
  });

  it('gives a feature card a crop from the page its copy cites, and the next card another', () => {
    const all = proposals();
    expect(all.get('calendar')?.assetIds).toEqual(['features-ui-1']);
    expect(all.get('queue')?.assetIds).toEqual(['features-ui-2']);
  });

  it('leaves a feature card greeked (tier 4) rather than show an unrelated picture', () => {
    const campaign = artCampaign();
    delete campaign.assets['about-screen'];
    const team = proposeAssets(campaign, infosOf(campaign)).find((p) => p.sceneId === 'team');
    expect(team).toMatchObject({ assetIds: [], tier: 4 });
    expect(team?.candidates.length).toBeGreaterThan(0);
  });

  it('notes a tile-wall that has too few pictures', () => {
    const campaign = artCampaign();
    const [wallFrom] = campaign.scenes.filter((scene) => scene.id === 'team');
    if (!wallFrom) throw new Error('fixture changed');
    wallFrom.type = 'tile-wall';
    wallFrom.text = [];
    const wall = proposeAssets(campaign, infosOf(campaign)).find((p) => p.sceneId === 'team');
    // Seven distinct pictures: the home page's "crop" is its page top.
    expect(wall?.assetIds.length).toBe(7);
    delete campaign.assets['about-screen'];
    delete campaign.assets['docs-screen'];
    const short = proposeAssets(campaign, infosOf(campaign)).find((p) => p.sceneId === 'team');
    expect(short?.assetIds.length).toBe(5);
    expect(short?.note).toMatch(/needs 6/);
  });
});

describe('checkPick', () => {
  const campaign = artCampaign();
  const infos = infosOf(campaign);
  const byId = new Map(proposeAssets(campaign, infos).map((p) => [p.sceneId, p]));
  const pick = (id: string, assetIds: string[]) => {
    const proposal = byId.get(id);
    if (!proposal) throw new Error(id);
    return checkPick(proposal, assetIds, infos);
  };

  it('accepts candidates within the slot', () => {
    expect(pick('calendar', ['features-ui-2', 'features-ui-1'])).toEqual([]);
    expect(pick('team', [])).toEqual([]);
  });

  it('refuses an asset that is not a candidate, such as a duplicate the code hid', () => {
    expect(pick('hero', ['home-ui-1'])[0]?.message).toMatch(/not among/);
    expect(pick('calendar', ['logo'])[0]?.message).toMatch(/not among/);
  });

  it('refuses too many or too few', () => {
    expect(pick('calendar', ['features-ui-1', 'features-ui-2', 'about-screen'])).toHaveLength(1);
    expect(pick('hero', [])[0]?.message).toMatch(/takes 1/);
  });

  it('refuses a site-scroll of one page twice', () => {
    expect(pick('scroll', ['features-screen', 'features-screen']).length).toBeGreaterThan(0);
  });
});
