import nova from '../examples/nova.campaign.json' with { type: 'json' };
import type { Campaign } from '../src/campaign.ts';
import type { IssueCode, ValidateOptions } from '../src/validate.ts';

export interface NegativeFixture {
  name: string;
  /** The only code this fixture may produce, unless `also` lists more. */
  code: IssueCode;
  path: string;
  also?: IssueCode[];
  options?: ValidateOptions;
  /** Changes a copy of Nova. Return a value to replace the input outright. */
  build: (campaign: Campaign) => unknown;
}

const at = <T>(list: T[], index: number): T => list[index] as T;

const longText = 'x'.repeat(61);
const registry = { hero: {}, stat: {}, outro: {} };

export const novaCopy = () => structuredClone(nova) as Campaign;

/** Puts `value` in the stat headline of scene 1, citing a new claim that quotes `quote`. */
const citedHeadline = (c: Campaign, value: string, quote: string) => {
  c.claims.push({
    id: 'cited-quote',
    text: quote,
    sourceUrl: 'https://nova.example.com/customers',
    quote,
    status: 'approved',
  });
  const headline = at(at(c.scenes, 1).text, 0);
  headline.value = value;
  headline.claimIds = ['cited-quote'];
};

export const negativeFixtures: NegativeFixture[] = [
  {
    name: 'input that is not an object',
    code: 'SCHEMA_INVALID',
    path: '$',
    build: () => null,
  },
  {
    name: 'a missing required field',
    code: 'SCHEMA_INVALID',
    path: 'brand',
    build: (c) => {
      delete (c as Partial<Campaign>).brand;
    },
  },
  {
    name: 'an unknown field',
    code: 'SCHEMA_INVALID',
    path: 'scenes[0]',
    build: (c) => {
      Object.assign(at(c.scenes, 0), { voiceOver: { text: 'typo', claimIds: [] } });
    },
  },
  {
    name: 'a value outside an enum',
    code: 'SCHEMA_INVALID',
    path: 'claims[0].status',
    build: (c) => {
      Object.assign(at(c.claims, 0), { status: 'invented' });
    },
  },
  {
    name: 'a duplicate scene id',
    code: 'SCHEMA_INVALID',
    path: 'scenes[1].id',
    build: (c) => {
      at(c.scenes, 1).id = at(c.scenes, 0).id;
    },
  },
  {
    name: 'a duplicate claim id',
    code: 'SCHEMA_INVALID',
    path: 'claims[3].id',
    also: ['CLAIM_UNKNOWN', 'CLAIM_UNBACKED'],
    build: (c) => {
      at(c.claims, 3).id = at(c.claims, 0).id;
    },
  },
  {
    name: 'a duplicate text id within a scene',
    code: 'SCHEMA_INVALID',
    path: 'scenes[0].text[1].id',
    build: (c) => {
      at(at(c.scenes, 0).text, 1).id = at(at(c.scenes, 0).text, 0).id;
    },
  },

  {
    name: 'a gap between scenes',
    code: 'SCENE_TIMING',
    path: 'scenes[1].start',
    build: (c) => {
      at(c.scenes, 1).start = 4.5;
    },
  },
  {
    name: 'overlapping scenes',
    code: 'SCENE_TIMING',
    path: 'scenes[1].start',
    build: (c) => {
      at(c.scenes, 1).start = 3.5;
    },
  },
  {
    name: 'a zero length scene',
    code: 'SCENE_TIMING',
    path: 'scenes[1].end',
    build: (c) => {
      at(c.scenes, 1).end = at(c.scenes, 1).start;
      at(c.scenes, 2).start = at(c.scenes, 1).end;
    },
  },
  {
    name: 'a scene shorter than one frame',
    code: 'SCENE_TIMING',
    path: 'scenes[1].end',
    build: (c) => {
      at(c.scenes, 1).end = 4.001;
      at(c.scenes, 2).start = 4.001;
    },
  },
  {
    name: 'a first scene that does not start at 0',
    code: 'SCENE_TIMING',
    path: 'scenes[0].start',
    build: (c) => {
      at(c.scenes, 0).start = 1;
      at(c.variants.hooks, 0).start = 1;
    },
  },
  {
    name: 'a last scene that stops before durationSeconds',
    code: 'SCENE_TIMING',
    path: 'scenes[3].end',
    build: (c) => {
      at(c.scenes, 3).end = 19;
    },
  },
  {
    name: 'scenes listed out of order',
    code: 'SCENE_TIMING',
    path: 'scenes[0].start',
    build: (c) => {
      c.scenes.reverse();
      at(c.variants.hooks, 0).start = at(c.scenes, 0).start;
      at(c.variants.hooks, 0).end = at(c.scenes, 0).end;
    },
  },
  {
    name: 'a hook that does not fill the slot of the first scene',
    code: 'SCENE_TIMING',
    path: 'variants.hooks[0].end',
    build: (c) => {
      at(c.variants.hooks, 0).end = 3;
    },
  },
  {
    name: 'a sound effect after the end of the video',
    code: 'SCENE_TIMING',
    path: 'audio.sfx[0].at',
    build: (c) => {
      at(c.audio?.sfx ?? [], 0).at = 21;
    },
  },

  {
    name: 'a scene that uses an undeclared asset',
    code: 'ASSET_UNDECLARED',
    path: 'scenes[1].assetIds[0]',
    build: (c) => {
      at(c.scenes, 1).assetIds = ['missing-shot'];
    },
  },
  {
    name: 'a hook that uses an undeclared asset',
    code: 'ASSET_UNDECLARED',
    path: 'variants.hooks[0].assetIds[0]',
    build: (c) => {
      at(c.variants.hooks, 0).assetIds = ['missing-shot'];
    },
  },
  {
    name: 'an undeclared logo',
    code: 'ASSET_UNDECLARED',
    path: 'brand.logoAssetId',
    build: (c) => {
      c.brand.logoAssetId = 'missing-logo';
    },
  },
  {
    name: 'a font source that is neither a URL nor a declared asset',
    code: 'ASSET_UNDECLARED',
    path: 'brand.fonts.display.source',
    build: (c) => {
      c.brand.fonts.display.source = 'google';
    },
  },
  {
    name: 'undeclared music',
    code: 'ASSET_UNDECLARED',
    path: 'audio.musicAssetId',
    build: (c) => {
      Object.assign(c.audio as object, { musicAssetId: 'missing-track' });
    },
  },
  {
    name: 'an undeclared sound effect',
    code: 'ASSET_UNDECLARED',
    path: 'audio.sfx[0].assetId',
    build: (c) => {
      at(c.audio?.sfx ?? [], 0).assetId = 'missing-sfx';
    },
  },
  {
    name: 'an asset id that collides with an Object.prototype member',
    code: 'ASSET_UNDECLARED',
    path: 'scenes[1].assetIds[0]',
    build: (c) => {
      at(c.scenes, 1).assetIds = ['constructor'];
    },
  },

  {
    name: 'a file that does not exist',
    code: 'ASSET_UNAVAILABLE',
    path: 'assets.logo.src',
    options: { assetExists: (src) => !src.endsWith('logo.svg') },
    build: () => undefined,
  },
  {
    name: 'an async check that resolves false',
    code: 'ASSET_UNAVAILABLE',
    path: 'assets.logo.src',
    options: { assetExists: async (src) => !src.endsWith('logo.svg') },
    build: () => undefined,
  },
  {
    name: 'a check that throws',
    code: 'ASSET_UNAVAILABLE',
    path: 'assets.logo.src',
    options: {
      assetExists: async (src) => {
        if (src.endsWith('logo.svg')) throw new Error('storage timed out');
        return true;
      },
    },
    build: () => undefined,
  },

  {
    name: 'text citing a claim that does not exist',
    code: 'CLAIM_UNKNOWN',
    path: 'scenes[0].text[0].claimIds[0]',
    build: (c) => {
      at(at(c.scenes, 0).text, 0).claimIds = ['no-such-claim'];
    },
  },
  {
    name: 'a voiceover citing a claim that does not exist',
    code: 'CLAIM_UNKNOWN',
    path: 'scenes[0].voiceover.claimIds[0]',
    build: (c) => {
      Object.assign(at(c.scenes, 0).voiceover as object, { claimIds: ['no-such-claim'] });
    },
  },
  {
    name: 'a hook citing a claim that does not exist',
    code: 'CLAIM_UNKNOWN',
    path: 'variants.hooks[0].text[0].claimIds[0]',
    build: (c) => {
      at(at(c.variants.hooks, 0).text, 0).claimIds = ['no-such-claim'];
    },
  },

  {
    name: 'an invented percentage in a headline',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[0].text[0].value',
    build: (c) => {
      at(at(c.scenes, 0).text, 0).value = 'Builds 73% faster';
    },
  },
  {
    name: 'a number the cited quote does not state',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[0].value',
    build: (c) => {
      at(at(c.scenes, 1).text, 0).value = '60% faster builds';
    },
  },
  {
    name: 'a number that is only a substring of the quoted number',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[2].text[0].value',
    build: (c) => {
      at(at(c.scenes, 2).text, 0).value = '200 teams';
    },
  },
  {
    name: 'a number backed only by a claim another text item cites',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[1].value',
    build: (c) => {
      const label = at(at(c.scenes, 1).text, 1);
      label.value = '40% faster';
      label.claimIds = [];
    },
  },
  {
    name: 'a number in claim.text that the quote does not state',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[0].text[0].value',
    build: (c) => {
      at(c.claims, 0).text = 'Nova cuts build times by 90%';
      const headline = at(at(c.scenes, 0).text, 0);
      headline.value = '90% faster';
      headline.claimIds = [at(c.claims, 0).id];
    },
  },
  {
    name: 'a spelled out multiplier',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[0].text[0].value',
    build: (c) => {
      at(at(c.scenes, 0).text, 0).value = 'Ten times faster builds';
    },
  },
  {
    name: 'an invented money amount in a voiceover',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[0].voiceover.text',
    build: (c) => {
      Object.assign(at(c.scenes, 0).voiceover as object, { text: 'Save $2M a year with Nova.' });
    },
  },
  {
    name: 'a number in a scene CTA',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[3].text[2].value',
    build: (c) => {
      at(at(c.scenes, 3).text, 2).value = 'Try it for 30 days';
    },
  },
  {
    name: 'a number in a variant CTA, which cannot cite a claim',
    code: 'CLAIM_UNBACKED',
    path: 'variants.ctas[0].label',
    build: (c) => {
      at(c.variants.ctas, 0).label = 'Save 50% today';
    },
  },
  {
    name: 'an invented number in a hook',
    code: 'CLAIM_UNBACKED',
    path: 'variants.hooks[0].text[0].value',
    build: (c) => {
      at(at(c.variants.hooks, 0).text, 0).value = 'Waste 5 hours a week on CI?';
    },
  },
  {
    name: 'an invented number in a hook voiceover',
    code: 'CLAIM_UNBACKED',
    path: 'variants.hooks[0].voiceover.text',
    build: (c) => {
      Object.assign(at(c.variants.hooks, 0).voiceover as object, { text: 'Lose 5 hours a week?' });
    },
  },
  {
    name: 'a one unit statistic in a headline',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[0].value',
    build: (c) => {
      const headline = at(at(c.scenes, 1).text, 0);
      headline.value = 'Deploy in one minute';
      headline.claimIds = [];
    },
  },
  {
    name: 'a one unit statistic in a voiceover',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[0].voiceover.text',
    build: (c) => {
      Object.assign(at(c.scenes, 0).voiceover as object, { text: 'Deploy in under one minute.' });
    },
  },
  {
    name: 'a one unit statistic in a hook',
    code: 'CLAIM_UNBACKED',
    path: 'variants.hooks[0].text[0].value',
    build: (c) => {
      at(at(c.variants.hooks, 0).text, 0).value = 'Live in under an hour';
    },
  },
  {
    name: 'a one unit statistic in a variant CTA',
    code: 'CLAIM_UNBACKED',
    path: 'variants.ctas[0].label',
    build: (c) => {
      at(c.variants.ctas, 0).label = 'One month free';
    },
  },
  {
    name: 'a spelled multiplier missing from the word lists',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[0].voiceover.text',
    build: (c) => {
      Object.assign(at(c.scenes, 0).voiceover as object, { text: 'Builds run thrice as fast.' });
    },
  },
  {
    name: 'a halving in a variant CTA',
    code: 'CLAIM_UNBACKED',
    path: 'variants.ctas[0].label',
    build: (c) => {
      at(c.variants.ctas, 0).label = 'Halve your bill';
    },
  },
  {
    name: 'a specific number firmed up from a vague quote',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[0].value',
    build: (c) => citedHeadline(c, '1,000 teams', 'Used by thousands of teams.'),
  },
  {
    name: 'a count backed only by a time in the quote',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[0].value',
    build: (c) => citedHeadline(c, '10 teams', 'Deploy in 10 minutes.'),
  },
  {
    name: 'a unit hidden behind an adjective',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[0].value',
    build: (c) => citedHeadline(c, '10 short seconds', 'Deploy in 10 minutes.'),
  },
  {
    name: 'a multiplier backed by an ordinary word in the quote',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[0].value',
    build: (c) => citedHeadline(c, '2x faster', 'Just double-click to deploy.'),
  },
  {
    name: 'a count backed by a third party',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[0].value',
    build: (c) => citedHeadline(c, '3 teams', 'Audited by a third party.'),
  },
  {
    name: 'a count backed by a year',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[0].value',
    build: (c) => citedHeadline(c, '2,019 teams', 'Founded in 2019.'),
  },
  {
    name: 'a number that only reads as part of a longer quoted number',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[0].value',
    build: (c) => citedHeadline(c, '1,200', 'More than 1,200,000 teams.'),
  },
  {
    name: 'copy with a number smuggled into scene props',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[0].props.stat',
    build: (c) => {
      at(c.scenes, 0).props = { stat: '10x faster' };
    },
  },
  {
    name: 'a sentence with a number nested in scene props',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[0].props.cards[0].caption',
    build: (c) => {
      at(c.scenes, 0).props = { cards: [{ caption: 'Used by 500 teams' }] };
    },
  },

  {
    name: 'a superlative with no cited claim',
    code: 'CLAIM_SUPERLATIVE',
    path: 'scenes[0].text[0].value',
    build: (c) => {
      at(at(c.scenes, 0).text, 0).value = 'The fastest way to ship';
    },
  },
  {
    name: 'a superlative in a voiceover',
    code: 'CLAIM_SUPERLATIVE',
    path: 'scenes[0].voiceover.text',
    build: (c) => {
      Object.assign(at(c.scenes, 0).voiceover as object, { text: 'The industry-leading CI.' });
    },
  },
  {
    name: 'a superlative in a variant CTA',
    code: 'CLAIM_SUPERLATIVE',
    path: 'variants.ctas[0].label',
    build: (c) => {
      at(c.variants.ctas, 0).label = 'Get the best CI';
    },
  },
  {
    name: 'a #1 claim, which is both a superlative and an unbacked number',
    code: 'CLAIM_SUPERLATIVE',
    also: ['CLAIM_UNBACKED'],
    path: 'scenes[0].text[0].value',
    build: (c) => {
      at(at(c.scenes, 0).text, 0).value = 'The #1 CI platform';
    },
  },

  {
    name: 'a headline over the default limit',
    code: 'TEXT_TOO_LONG',
    path: 'scenes[0].text[0].value',
    build: (c) => {
      at(at(c.scenes, 0).text, 0).value = longText;
    },
  },
  {
    name: 'a headline over a limit the registry lowers',
    code: 'TEXT_TOO_LONG',
    path: 'scenes[0].text[0].value',
    options: { sceneRegistry: { ...registry, hero: { text: { headline: 10 } } } },
    build: () => undefined,
  },
  {
    name: 'a variant CTA label over the CTA limit',
    code: 'TEXT_TOO_LONG',
    path: 'variants.ctas[0].label',
    build: (c) => {
      at(c.variants.ctas, 0).label = 'y'.repeat(31);
    },
  },

  {
    name: 'foreground too close to background',
    code: 'CONTRAST_LOW',
    path: 'brand.colors.foreground',
    build: (c) => {
      c.brand.colors.foreground = '#1A2138';
    },
  },
  {
    name: 'primary too close to background',
    code: 'CONTRAST_LOW',
    path: 'brand.colors.primary',
    build: (c) => {
      c.brand.colors.primary = '#1A2138';
    },
  },

  {
    name: 'a scene type the registry does not know',
    code: 'SCENE_TYPE_UNKNOWN',
    path: 'scenes[0].type',
    options: { sceneRegistry: { stat: {}, outro: {}, hero: {} } },
    build: (c) => {
      at(c.scenes, 0).type = 'carousel';
    },
  },
  {
    name: 'a hook type the registry does not know',
    code: 'SCENE_TYPE_UNKNOWN',
    path: 'variants.hooks[0].type',
    options: { sceneRegistry: registry },
    build: (c) => {
      at(c.variants.hooks, 0).type = 'carousel';
    },
  },
  {
    name: 'a scene type that collides with an Object.prototype member',
    code: 'SCENE_TYPE_UNKNOWN',
    path: 'scenes[0].type',
    options: { sceneRegistry: registry },
    build: (c) => {
      at(c.scenes, 0).type = 'constructor';
    },
  },

  {
    name: 'empty formats',
    code: 'VARIANT_INVALID',
    path: 'variants.formats',
    build: (c) => {
      c.variants.formats = [];
    },
  },
  {
    name: 'a duplicate format',
    code: 'VARIANT_INVALID',
    path: 'variants.formats[1]',
    build: (c) => {
      c.variants.formats = ['16:9', '16:9'];
    },
  },
  {
    name: 'an empty CTA label',
    code: 'VARIANT_INVALID',
    path: 'variants.ctas[0].label',
    build: (c) => {
      at(c.variants.ctas, 0).label = '';
    },
  },
  {
    name: 'a blank CTA label',
    code: 'VARIANT_INVALID',
    path: 'variants.ctas[0].label',
    build: (c) => {
      at(c.variants.ctas, 0).label = '   ';
    },
  },
  {
    name: 'a CTA with no label at all',
    code: 'VARIANT_INVALID',
    path: 'variants.ctas[0].label',
    build: (c) => {
      delete (at(c.variants.ctas, 0) as Partial<Campaign['variants']['ctas'][number]>).label;
    },
  },
  {
    name: 'duplicate CTA ids',
    code: 'VARIANT_INVALID',
    path: 'variants.ctas[1].id',
    build: (c) => {
      at(c.variants.ctas, 1).id = at(c.variants.ctas, 0).id;
    },
  },
  {
    name: 'duplicate hook ids',
    code: 'VARIANT_INVALID',
    path: 'variants.hooks[1].id',
    build: (c) => {
      c.variants.hooks.push(structuredClone(at(c.variants.hooks, 0)));
    },
  },
  {
    name: 'a hook id that collides with a scene id',
    code: 'VARIANT_INVALID',
    path: 'variants.hooks[0].id',
    build: (c) => {
      at(c.variants.hooks, 0).id = at(c.scenes, 2).id;
    },
  },
];
