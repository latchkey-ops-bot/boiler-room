import { describe, expect, it, vi } from 'vitest';
import nova from '../examples/nova.campaign.json' with { type: 'json' };
import type { Campaign } from '../src/campaign.ts';
import { contrastRatio } from '../src/contrast.ts';
import { DEFAULT_TEXT_LIMITS, ISSUE_CODES, validateCampaign } from '../src/validate.ts';
import { negativeFixtures, novaCopy } from './negative-fixtures.ts';

const at = <T>(list: T[], index: number): T => list[index] as T;
const codes = async (campaign: Campaign) =>
  (await validateCampaign(campaign)).issues.map((issue) => issue.code);

describe('validateCampaign', () => {
  it('passes the Nova example with no issues', async () => {
    const result = await validateCampaign(nova);
    expect(result).toEqual({ ok: true, issues: [], campaign: nova });
  });

  it('passes Nova with every option supplied', async () => {
    const assetExists = vi.fn(async () => true);
    const sceneRegistry = { hero: {}, stat: {}, outro: {} };
    const result = await validateCampaign(nova, { assetExists, sceneRegistry });
    expect(result.issues).toEqual([]);
    expect(assetExists).toHaveBeenCalledTimes(Object.keys(nova.assets).length);
    expect(assetExists).toHaveBeenCalledWith('assets/nova/logo.svg');
  });

  it('accepts an existing asset check that returns synchronously', async () => {
    expect((await validateCampaign(nova, { assetExists: () => true })).ok).toBe(true);
  });

  describe('negative fixtures', () => {
    it('cover every issue code', () => {
      expect(new Set(negativeFixtures.map((fixture) => fixture.code))).toEqual(
        new Set(ISSUE_CODES),
      );
    });

    it.each(negativeFixtures.map((fixture) => [fixture.code, fixture.name, fixture] as const))(
      '%s: %s',
      async (_code, _name, fixture) => {
        const copy = novaCopy();
        const replacement = fixture.build(copy);
        const input = replacement === undefined ? copy : replacement;
        const result = await validateCampaign(input, fixture.options);

        expect(new Set(result.issues.map((issue) => issue.code))).toEqual(
          new Set([fixture.code, ...(fixture.also ?? [])]),
        );
        const issue = result.issues.find((candidate) => candidate.code === fixture.code);
        expect(issue?.path).toBe(fixture.path);
        for (const each of result.issues) {
          expect(each.message.length).toBeGreaterThan(0);
          expect(each.fix.length).toBeGreaterThan(0);
          expect(each.path.length).toBeGreaterThan(0);
        }
      },
    );
  });

  describe('the gate', () => {
    it('withholds the campaign when any error exists', async () => {
      const campaign = novaCopy();
      at(at(campaign.scenes, 0).text, 0).value = 'Builds 73% faster';
      const result = await validateCampaign(campaign);
      expect(result.ok).toBe(false);
      expect(result.campaign).toBeUndefined();
    });

    it('withholds the campaign when the schema fails', async () => {
      const result = await validateCampaign({ id: 'nova' });
      expect(result.ok).toBe(false);
      expect(result.campaign).toBeUndefined();
      expect(result.issues.every((issue) => issue.code === 'SCHEMA_INVALID')).toBe(true);
      expect(result.issues.length).toBeGreaterThan(1);
    });

    it('lets warnings through', async () => {
      const campaign = novaCopy();
      at(at(campaign.scenes, 0).text, 0).value = 'The best way to ship';
      const result = await validateCampaign(campaign);
      expect(result.ok).toBe(true);
      expect(result.campaign).toEqual(campaign);
      expect(result.issues).toMatchObject([{ code: 'CLAIM_SUPERLATIVE', severity: 'warning' }]);
    });

    it('marks every other fixture as an error', async () => {
      for (const fixture of negativeFixtures) {
        if (fixture.code === 'CLAIM_SUPERLATIVE' || fixture.severity === 'warning') continue;
        const copy = novaCopy();
        const replacement = fixture.build(copy);
        const input = replacement === undefined ? copy : replacement;
        const result = await validateCampaign(input, fixture.options);
        expect(result.ok, fixture.name).toBe(false);
        expect(
          result.issues.find((issue) => issue.code === fixture.code)?.severity,
          fixture.name,
        ).toBe('error');
      }
    });
  });

  describe('issues an agent can act on', () => {
    it('names the required field that is missing', async () => {
      const { brand: _, ...withoutBrand } = novaCopy();
      const { issues } = await validateCampaign(withoutBrand);
      expect(issues[0]?.fix).toMatch(/Add brand/);
    });

    it('names the unknown field to remove', async () => {
      const { issues } = await validateCampaign({ ...nova, extra: true });
      expect(issues[0]?.fix).toMatch(/Remove extra/);
    });

    it('lists the allowed enum values', async () => {
      const campaign = novaCopy();
      Object.assign(at(campaign.claims, 0), { status: 'invented' });
      const { issues } = await validateCampaign(campaign);
      expect(issues[0]?.fix).toContain('"extracted", "approved"');
    });

    it('states the number that has no backing and how to resolve it', async () => {
      const campaign = novaCopy();
      at(at(campaign.scenes, 0).text, 0).value = 'Saves $2M a year';
      const { issues } = await validateCampaign(campaign);
      expect(issues[0]?.message).toContain('"$2M"');
      expect(issues[0]?.fix).toContain('scenes[0].text[0].claimIds');
    });

    it('tells a variant CTA to drop the number, since it cannot cite', async () => {
      const campaign = novaCopy();
      at(campaign.variants.ctas, 0).label = 'Save 50% today';
      const { issues } = await validateCampaign(campaign);
      expect(issues[0]?.fix).toMatch(/Remove "50%"/);
      expect(issues[0]?.fix).toContain('role "cta"');
    });

    it('gives the start a scene should have', async () => {
      const campaign = novaCopy();
      at(campaign.scenes, 1).start = 4.5;
      const { issues } = await validateCampaign(campaign);
      expect(issues[0]?.fix).toContain('Set scenes[1].start to 4');
    });

    it('states the measured contrast, the threshold and a colour that passes', async () => {
      const campaign = novaCopy();
      campaign.brand.colors.foreground = '#1A2138';
      const { issues } = await validateCampaign(campaign);
      expect(issues[0]?.message).toMatch(/\d\.\d\d:1/);
      expect(issues[0]?.message).toContain('4.5:1');
      expect(issues[0]?.fix).toContain('#FFFFFF');
    });

    it('lists the known scene types', async () => {
      const campaign = novaCopy();
      at(campaign.scenes, 0).type = 'carousel';
      const { issues } = await validateCampaign(campaign, {
        sceneRegistry: { hero: {}, stat: {}, outro: {} },
      });
      expect(issues[0]?.fix).toContain('hero, stat, outro');
    });

    it('reports why an asset check failed', async () => {
      const { issues } = await validateCampaign(nova, {
        assetExists: async () => {
          throw new Error('storage timed out');
        },
      });
      expect(issues).toHaveLength(Object.keys(nova.assets).length);
      expect(issues[0]?.message).toContain('storage timed out');
    });
  });

  describe('SCENE_TIMING', () => {
    it('tolerates floating point noise at a boundary', async () => {
      const campaign = novaCopy();
      at(campaign.scenes, 0).end = 0.1 + 0.2;
      at(campaign.scenes, 1).start = 0.3;
      at(campaign.variants.hooks, 0).end = 0.3;
      expect(await codes(campaign)).toEqual([]);
    });

    it('accepts a sound effect at the very end', async () => {
      const campaign = novaCopy();
      at(campaign.audio?.sfx ?? [], 0).at = 20;
      expect(await codes(campaign)).toEqual([]);
    });
  });

  describe('ASSET_UNDECLARED', () => {
    it('names the kind it found and the kinds it needs', async () => {
      const campaign = novaCopy();
      campaign.brand.logoAssetId = 'music-bed';
      const { issues } = await validateCampaign(campaign);
      expect(issues[0]?.message).toContain('audio');
      expect(issues[0]?.fix).toContain('image or svg');
    });

    it('accepts a logo of either kind', async () => {
      const campaign = novaCopy();
      campaign.brand.logoAssetId = 'dashboard-shot';
      expect(await codes(campaign)).toEqual([]);
    });

    it('accepts a font URL with an upper case scheme', async () => {
      const campaign = novaCopy();
      campaign.brand.fonts.body.source = 'HTTPS://nova.example.com/fonts/inter.woff2';
      expect(await codes(campaign)).toEqual([]);
    });

    it('accepts a font URL over plain http', async () => {
      const campaign = novaCopy();
      campaign.brand.fonts.body.source = 'http://nova.example.com/fonts/inter.woff2';
      expect(await codes(campaign)).toEqual([]);
    });

    it('lets a scene use an asset of any kind', async () => {
      const campaign = novaCopy();
      at(campaign.scenes, 0).assetIds = ['logo', 'dashboard-shot', 'music-bed', 'font-display'];
      expect(await codes(campaign)).toEqual([]);
    });
  });

  describe('CLAIM_UNBACKED', () => {
    it('accepts a number from any claim the text item cites', async () => {
      const campaign = novaCopy();
      const headline = at(at(campaign.scenes, 2).text, 0);
      headline.value = '1,200 teams deploy 3x more often';
      headline.claimIds = ['team-count', 'deploy-rate'];
      expect(await codes(campaign)).toEqual([]);
    });

    it('checks the cited quote and ignores the other claims in the campaign', async () => {
      const campaign = novaCopy();
      at(at(campaign.scenes, 2).text, 0).claimIds = ['deploy-rate'];
      expect(await codes(campaign)).toEqual(['CLAIM_UNBACKED']);
    });

    it.each([
      ['a phantom multiplier', 'Just double-click to deploy', 'Just double-click to deploy.'],
      ['a different case', 'just double-click to deploy', 'Just double-click to deploy.'],
      ['part of the quote', 'Launched in the first half', 'Launched in the first half of 2019.'],
    ])('lets copy repeat a cited quote word for word: %s', async (_name, value, quote) => {
      const campaign = novaCopy();
      campaign.claims.push({
        id: 'cited-quote',
        text: quote,
        sourceUrl: 'https://nova.example.com/customers',
        quote,
        status: 'approved',
      });
      const headline = at(at(campaign.scenes, 1).text, 0);
      headline.value = value;
      headline.claimIds = ['cited-quote'];
      expect(await codes(campaign)).toEqual([]);
    });

    describe('text items read together', () => {
      const stat = (quote: string, first: string, second: string, secondClaims: string[]) => {
        const campaign = novaCopy();
        campaign.claims.push({
          id: 'split-stat',
          text: quote,
          sourceUrl: 'https://nova.example.com/customers',
          quote,
          status: 'approved',
        });
        const [headline, label] = at(campaign.scenes, 1).text;
        Object.assign(headline as object, { value: first, claimIds: ['split-stat'] });
        Object.assign(label as object, { value: second, claimIds: secondClaims });
        return campaign;
      };

      it('accepts a number and label that say what the quote says', async () => {
        const campaign = stat('Deploys take 40 minutes.', '40', 'minutes to deploy', []);
        expect(await codes(campaign)).toEqual([]);
      });

      it('accepts a label that adds no new reading of the number', async () => {
        const campaign = stat('More than 40 teams ship.', '40', 'teams', []);
        expect(await codes(campaign)).toEqual([]);
      });

      it('reads the items in order, so a label before the number says nothing', async () => {
        const campaign = stat('More than 40 teams ship.', 'percent faster builds', '40', []);
        Object.assign(at(at(campaign.scenes, 1).text, 0), { claimIds: [] });
        Object.assign(at(at(campaign.scenes, 1).text, 1), { claimIds: ['split-stat'] });
        expect(await codes(campaign)).toEqual([]);
      });

      it('checks the joined reading against the claims of every item', async () => {
        const campaign = stat('More than 40 teams ship.', '40', 'percent faster', ['build-times']);
        expect(await codes(campaign)).toEqual([]);
      });

      it('reports an item that fails alone once, and not again for the scene', async () => {
        const campaign = stat('More than 40 teams ship.', '90', 'percent faster', []);
        expect((await validateCampaign(campaign)).issues).toMatchObject([
          { code: 'CLAIM_UNBACKED', path: 'scenes[1].text[0].value' },
        ]);
      });

      it('names the reading and both ways to fix it', async () => {
        const campaign = stat('More than 40 teams ship.', '40', 'percent faster', []);
        const { issues } = await validateCampaign(campaign);
        expect(issues).toHaveLength(1);
        expect(issues[0]?.message).toContain('40 percent');
        expect(issues[0]?.fix).toContain('scenes[1].text');
      });

      it('does not join a voiceover to the text', async () => {
        const campaign = novaCopy();
        at(at(campaign.scenes, 0).text, 1).value = 'Ship it';
        Object.assign(at(campaign.scenes, 0).voiceover as object, { text: 'percent faster' });
        expect(await codes(campaign)).toEqual([]);
      });
    });

    it('does not read digits in the product name as a statistic', async () => {
      const campaign = novaCopy();
      campaign.brand.name = 'Nova 2';
      at(at(campaign.scenes, 0).text, 0).value = 'Meet Nova 2.';
      expect(await codes(campaign)).toEqual([]);
    });

    it('reads the product name literally, even with regex characters in it', async () => {
      const campaign = novaCopy();
      campaign.brand.name = 'Nova (Mk.2)';
      at(at(campaign.scenes, 0).text, 0).value = 'Meet Nova (Mk.2).';
      expect(await codes(campaign)).toEqual([]);
      at(at(campaign.scenes, 0).text, 0).value = 'Nova (Mk.2) is 9x faster';
      expect(await codes(campaign)).toEqual(['CLAIM_UNBACKED']);
    });

    describe('brand.name', () => {
      it.each([
        ['Ten', 'ten times faster'],
        ['Ten', 'Ten times faster'],
        ['Half', 'Half the cost'],
        ['Zero', 'Zero downtime'],
        ['10x', '10x faster builds'],
        ['Nova 10x', 'Nova 10x faster builds'],
        ['Nova, 73% faster', 'Nova, 73% faster'],
      ])('does not hide a statistic behind the name %s', async (name, value) => {
        const campaign = novaCopy();
        campaign.brand.name = name;
        at(at(campaign.scenes, 0).text, 0).value = value;
        const { ok, issues } = await validateCampaign(campaign);
        expect(ok).toBe(false);
        expect(issues.map((issue) => issue.path)).toEqual([
          'brand.name',
          'scenes[0].text[0].value',
        ]);
      });

      it('makes copy cite the claim that quotes a name that reads as a statistic', async () => {
        const campaign = novaCopy();
        campaign.brand.name = '10x Genomics';
        campaign.claims.push({
          id: 'brand-name',
          text: '10x Genomics makes sequencing tools',
          sourceUrl: 'https://nova.example.com/about',
          quote: '10x Genomics makes sequencing tools.',
          status: 'approved',
        });
        const headline = at(at(campaign.scenes, 0).text, 0);
        headline.value = 'Meet 10x Genomics';
        expect((await validateCampaign(campaign)).ok).toBe(false);

        headline.claimIds = ['brand-name'];
        const result = await validateCampaign(campaign);
        expect(result.ok).toBe(true);
        expect(result.issues).toMatchObject([
          { code: 'CLAIM_UNBACKED', severity: 'warning', path: 'brand.name' },
        ]);
      });

      it('tells an agent how to resolve the name', async () => {
        const campaign = novaCopy();
        campaign.brand.name = 'Nova: 40% faster CI';
        const { issues } = await validateCampaign(campaign);
        expect(issues[0]?.message).toContain('Nova: 40% faster CI');
        expect(issues[0]?.fix).toContain('add a claim that quotes it');
      });

      it.each(['Nova', 'Nova 2', 'Nova (Mk.2)', '3M', 'Web3 Labs', 'Zero Downtime'])(
        'accepts %s as a name',
        async (name) => {
          const campaign = novaCopy();
          campaign.brand.name = name;
          at(at(campaign.scenes, 0).text, 0).value = `Meet ${name}.`;
          expect(await codes(campaign)).toEqual([]);
        },
      );

      it('does not read a name with digits in a quote', async () => {
        const campaign = novaCopy();
        campaign.brand.name = 'Nova 2';
        at(campaign.claims, 0).quote = 'Nova 2 cuts build times by 40%.';
        expect(await codes(campaign)).toEqual([]);
        at(at(campaign.scenes, 1).text, 0).value = '2 faster builds';
        expect(await codes(campaign)).toEqual(['CLAIM_UNBACKED']);
      });
    });

    it.each([
      ['a hex colour', { tint: '#0F172A' }],
      ['an identifier', { layout: 'split-2' }],
      ['a JSON number', { columns: 3 }],
      ['a URL', { poster: 'https://nova.example.com/2x/poster.png' }],
      ['a path', { poster: 'assets/2x/poster.png' }],
      ['a relative path', { poster: './assets/2x/poster.png' }],
      ['a rooted path', { poster: '/assets/2x/poster.png' }],
      ['a file name', { poster: 'logo@2x.png' }],
      ['a storage URL', { poster: 's3://nova/2x/poster.png' }],
      ['a hex colour of digits', { tint: '#123456' }],
      ['a ratio', { aspect: '16:9' }],
      ['a duration', { delay: '500ms' }],
      ['a dimension word', { mode: '3d' }],
      ['an identifier in a key', { 'split-2': true }],
      ['ordinary keys', { easing: 'spring', stiffness: 100 }],
    ])('leaves motion props alone: %s', async (_name, props) => {
      const campaign = novaCopy();
      at(campaign.scenes, 0).props = props;
      expect(await codes(campaign)).toEqual([]);
    });
  });

  describe('CLAIM_SUPERLATIVE', () => {
    it('stays silent once the text cites a claim', async () => {
      const campaign = novaCopy();
      const headline = at(at(campaign.scenes, 1).text, 0);
      headline.value = 'The fastest builds, 40% faster';
      expect(await codes(campaign)).toEqual([]);
    });

    it('ignores words that merely contain a superlative', async () => {
      const campaign = novaCopy();
      at(at(campaign.scenes, 0).text, 0).value = 'A bestseller, misleading no one';
      expect(await codes(campaign)).toEqual([]);
    });

    it('does not count an unknown claim as a citation', async () => {
      const campaign = novaCopy();
      const headline = at(at(campaign.scenes, 0).text, 0);
      headline.value = 'The fastest way to ship';
      headline.claimIds = ['no-such-claim'];
      expect(new Set(await codes(campaign))).toEqual(
        new Set(['CLAIM_UNKNOWN', 'CLAIM_SUPERLATIVE']),
      );
    });
  });

  describe('TEXT_TOO_LONG', () => {
    it('allows text at exactly the limit', async () => {
      const campaign = novaCopy();
      at(at(campaign.scenes, 0).text, 0).value = 'x'.repeat(DEFAULT_TEXT_LIMITS.headline);
      expect(await codes(campaign)).toEqual([]);
    });

    it('lets the registry raise a limit', async () => {
      const campaign = novaCopy();
      at(at(campaign.scenes, 0).text, 0).value = 'x'.repeat(DEFAULT_TEXT_LIMITS.headline + 1);
      const { issues } = await validateCampaign(campaign, {
        sceneRegistry: { hero: { text: { headline: 200 } }, stat: {}, outro: {} },
      });
      expect(issues).toEqual([]);
    });

    it('counts characters, not UTF-16 units', async () => {
      const campaign = novaCopy();
      at(at(campaign.scenes, 0).text, 0).value = '🚀'.repeat(DEFAULT_TEXT_LIMITS.headline);
      expect(await codes(campaign)).toEqual([]);
    });
  });

  describe('CONTRAST_LOW', () => {
    it('computes the WCAG ratio', () => {
      expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
      expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
      expect(contrastRatio('#123456', '#123456')).toBe(1);
      expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.478, 2);
      expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
    });

    it('does not round a near miss up to a pass', async () => {
      const campaign = novaCopy();
      campaign.brand.colors.background = '#FFFFFF';
      campaign.brand.colors.primary = '#000000';
      campaign.brand.colors.foreground = '#777777';
      expect(await codes(campaign)).toEqual(['CONTRAST_LOW']);
      campaign.brand.colors.foreground = '#767676';
      expect(await codes(campaign)).toEqual([]);
    });

    it('holds primary to the large text threshold of 3:1', async () => {
      const campaign = novaCopy();
      campaign.brand.colors.background = '#FFFFFF';
      campaign.brand.colors.foreground = '#000000';
      campaign.brand.colors.primary = '#888888';
      expect(contrastRatio('#888888', '#FFFFFF')).toBeLessThan(4.5);
      expect(await codes(campaign)).toEqual([]);
    });
  });
});
