import nova from '../examples/nova.campaign.json' with { type: 'json' };
import type { Campaign } from '../src/campaign.ts';
import type { IssueCode, ValidateOptions } from '../src/validate.ts';

export interface NegativeFixture {
  name: string;
  /** The only code this fixture may produce, unless `also` lists more. */
  code: IssueCode;
  path: string;
  also?: IssueCode[];
  /** Fixtures are errors unless they say otherwise. */
  severity?: 'warning';
  /** A fragment of the message, for fixtures whose wording is the point. */
  message?: string;
  options?: ValidateOptions;
  /** Changes a copy of Nova. Return a value to replace the input outright. */
  build: (campaign: Campaign) => unknown;
}

const at = <T>(list: T[], index: number): T => list[index] as T;

const longText = 'x'.repeat(61);
const registry = { hero: {}, stat: {}, outro: {} };

export const novaCopy = () => structuredClone(nova) as Campaign;

/** Gives scene 1 a backed headline and an uncited label that changes what the number means. */
const relabelled = (c: Campaign, value: string, label: string, quote: string) => {
  citedHeadline(c, value, quote);
  const item = at(at(c.scenes, 1).text, 1);
  item.value = label;
  item.claimIds = [];
};

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
    name: 'a duplicate text id within a hook',
    code: 'SCHEMA_INVALID',
    path: 'variants.hooks[0].text[1].id',
    build: (c) => {
      const { text } = at(c.variants.hooks, 0);
      text.push({ ...at(text, 0), value: 'Still waiting?' });
    },
  },

  {
    name: 'a gap between scenes',
    code: 'SCENE_TIMING',
    path: 'scenes[1].start',
    message: 'there is a gap after 4s',
    build: (c) => {
      at(c.scenes, 1).start = 4.5;
    },
  },
  {
    name: 'overlapping scenes',
    code: 'SCENE_TIMING',
    path: 'scenes[1].start',
    message: 'it overlaps the scene before, which ends at 4s',
    build: (c) => {
      at(c.scenes, 1).start = 3.5;
    },
  },
  {
    name: 'a gap of one millisecond, which lands on the same frame',
    code: 'SCENE_TIMING',
    path: 'scenes[1].start',
    message: 'there is a gap',
    build: (c) => {
      at(c.scenes, 1).start = 4.001;
    },
  },
  {
    name: 'a gap of ten microseconds, just over the tolerance',
    code: 'SCENE_TIMING',
    path: 'scenes[1].start',
    message: 'there is a gap',
    build: (c) => {
      at(c.scenes, 1).start = 4.00001;
    },
  },
  {
    name: 'an overlap of ten microseconds, just over the tolerance',
    code: 'SCENE_TIMING',
    path: 'scenes[1].start',
    message: 'it overlaps',
    build: (c) => {
      at(c.scenes, 1).start = 3.99999;
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
    message: 'the first scene must start at 0',
    build: (c) => {
      at(c.scenes, 0).start = 1;
      at(c.variants.hooks, 0).start = 1;
    },
  },
  {
    name: 'a last scene that stops ten microseconds before durationSeconds',
    code: 'SCENE_TIMING',
    path: 'scenes[3].end',
    build: (c) => {
      at(c.scenes, 3).end = 19.99999;
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
    name: 'a hook that starts after the first scene',
    code: 'SCENE_TIMING',
    path: 'variants.hooks[0].start',
    build: (c) => {
      at(c.variants.hooks, 0).start = 1;
    },
  },
  {
    name: 'a hook that ends ten microseconds after the first scene',
    code: 'SCENE_TIMING',
    path: 'variants.hooks[0].end',
    build: (c) => {
      at(c.variants.hooks, 0).end = 4.00001;
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
    name: 'a boundary whose two sides round to different frames',
    code: 'SCENE_TIMING',
    path: 'scenes[1].start',
    build: (c) => {
      c.fps = 25;
      at(c.scenes, 0).end = 0.7 - 0.4;
      at(c.variants.hooks, 0).end = 0.7 - 0.4;
      at(c.scenes, 1).start = 0.3;
    },
  },
  {
    name: 'a boundary that splits across a frame at 15 fps',
    code: 'SCENE_TIMING',
    path: 'scenes[1].start',
    build: (c) => {
      c.fps = 15;
      at(c.scenes, 0).end = 0.7 - 0.4;
      at(c.variants.hooks, 0).end = 0.7 - 0.4;
      at(c.scenes, 1).start = 0.3;
    },
  },
  {
    name: 'a hook that ends on a different frame from the scene it replaces',
    code: 'SCENE_TIMING',
    path: 'variants.hooks[0].end',
    build: (c) => {
      at(c.scenes, 0).end = 2.35;
      at(c.scenes, 1).start = 2.35;
      at(c.variants.hooks, 0).end = 2.3 + 0.05;
    },
  },
  {
    name: 'a last scene that ends a frame away from durationSeconds',
    code: 'SCENE_TIMING',
    path: 'scenes[3].end',
    build: (c) => {
      c.durationSeconds = 20.35;
      at(c.scenes, 3).end = 20.349999999;
    },
  },
  {
    name: 'a sound effect ten microseconds after the end of the video',
    code: 'SCENE_TIMING',
    path: 'audio.sfx[0].at',
    build: (c) => {
      at(c.audio?.sfx ?? [], 0).at = 20.00001;
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
    name: 'a logo that is an audio file',
    code: 'ASSET_UNDECLARED',
    path: 'brand.logoAssetId',
    build: (c) => {
      c.brand.logoAssetId = 'music-bed';
    },
  },
  {
    name: 'a font source that is an svg',
    code: 'ASSET_UNDECLARED',
    path: 'brand.fonts.display.source',
    build: (c) => {
      c.brand.fonts.display.source = 'logo';
    },
  },
  {
    name: 'a body font source that is audio',
    code: 'ASSET_UNDECLARED',
    path: 'brand.fonts.body.source',
    build: (c) => {
      c.brand.fonts.body.source = 'whoosh';
    },
  },
  {
    name: 'music that is an svg',
    code: 'ASSET_UNDECLARED',
    path: 'audio.musicAssetId',
    build: (c) => {
      Object.assign(c.audio as object, { musicAssetId: 'logo' });
    },
  },
  {
    name: 'a sound effect that is an image',
    code: 'ASSET_UNDECLARED',
    path: 'audio.sfx[0].assetId',
    build: (c) => {
      at(c.audio?.sfx ?? [], 0).assetId = 'dashboard-shot';
    },
  },
  {
    name: 'a font URL with no host',
    code: 'ASSET_UNDECLARED',
    path: 'brand.fonts.display.source',
    build: (c) => {
      c.brand.fonts.display.source = 'https://';
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
    name: 'one word lifted from a quote that does not state a number',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[0].value',
    build: (c) => citedHeadline(c, 'Half', 'Launched in the first half of the year.'),
  },
  {
    name: 'a number that only reads as part of a longer quoted number',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[0].value',
    build: (c) => citedHeadline(c, '1,200', 'More than 1,200,000 teams.'),
  },
  {
    name: 'a label that turns a cited count into a percent',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text',
    build: (c) => relabelled(c, '40', 'percent faster builds', 'More than 40 teams ship.'),
  },
  {
    name: 'a label that turns a cited count into a multiplier',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text',
    build: (c) => relabelled(c, '40', 'x faster', 'More than 40 teams ship.'),
  },
  {
    name: 'a label that turns a cited count into money',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text',
    build: (c) => relabelled(c, '40', 'dollars per seat', 'More than 40 teams ship.'),
  },
  {
    name: 'a label that changes the unit of a cited number',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text',
    build: (c) => relabelled(c, '40', 'seconds to deploy', 'Deploys take 40 minutes.'),
  },
  {
    name: 'a label that gives a cited count a unit',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text',
    build: (c) =>
      relabelled(c, '1,200', 'hours saved every week', 'More than 1,200 teams ship with Nova.'),
  },
  {
    name: 'a label that gives a cited time a noun',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text',
    build: (c) => relabelled(c, '10', 'teams', 'Deploy in 10 minutes.'),
  },
  {
    name: 'a label that scales a cited number',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text',
    build: (c) => relabelled(c, '40', 'k teams', 'More than 40 teams ship.'),
  },
  {
    name: 'a number split across the text of a hook',
    code: 'CLAIM_UNBACKED',
    path: 'variants.hooks[0].text',
    build: (c) => {
      citedHeadline(c, '40 teams', 'More than 40 teams ship.');
      const hook = at(c.variants.hooks, 0);
      at(hook.text, 0).value = '40';
      at(hook.text, 0).claimIds = ['cited-quote'];
      hook.text.push({ id: 'hook-label', role: 'label', value: 'percent cheaper', claimIds: [] });
    },
  },
  {
    name: 'a statistic in the brand name and nowhere else',
    code: 'CLAIM_UNBACKED',
    path: 'brand.name',
    build: (c) => {
      c.brand.name = 'Nova: 40% faster CI';
    },
  },
  {
    name: 'a money amount in the brand name',
    code: 'CLAIM_UNBACKED',
    path: 'brand.name',
    build: (c) => {
      c.brand.name = 'Nova from $5';
    },
  },
  {
    name: 'a rank in the brand name',
    code: 'CLAIM_UNBACKED',
    path: 'brand.name',
    build: (c) => {
      c.brand.name = 'Nova, the #1 CI';
    },
  },
  {
    name: 'a brand name that is only a number word',
    code: 'CLAIM_UNBACKED',
    path: 'brand.name',
    build: (c) => {
      c.brand.name = 'Ten';
    },
  },
  {
    name: 'a brand name that reads as a multiplier, which a claim quotes',
    code: 'CLAIM_UNBACKED',
    path: 'brand.name',
    severity: 'warning',
    build: (c) => {
      c.brand.name = '10x Genomics';
      c.claims.push({
        id: 'brand-name',
        text: '10x Genomics makes sequencing tools',
        sourceUrl: 'https://nova.example.com/about',
        quote: '10x Genomics makes sequencing tools.',
        status: 'approved',
      });
    },
  },
  {
    name: 'a quote backed only by the digits in the brand name',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[1].text[0].value',
    build: (c) => {
      c.brand.name = '3M';
      citedHeadline(c, '3 million users', '3M announced a new plan.');
    },
  },
  {
    name: 'copy that changes the case of a name with digits',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[0].text[0].value',
    build: (c) => {
      c.brand.name = 'Nova 2';
      at(at(c.scenes, 0).text, 0).value = 'Ship nova 2 today';
    },
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
  ...Object.entries({
    'a grouped number': { value: '1,200' },
    'a suffixed number': { value: '10K' },
    'a lower case suffix': { value: '12k' },
    'a decimal': { value: '99.9' },
    'a number with a plus sign': { value: '1,200+' },
    'a number split from its suffix': { value: '40', suffix: '%' },
    'a rank': { value: '#1' },
    'a trailing currency': { value: '29€' },
    'a hyphenated sentence': { value: 'Trusted-by-1,200-teams' },
    'an underscored sentence': { value: 'Trusted_by_1200_teams' },
    'a word before a colon': { value: 'speed:40%' },
    'a capitalised word before a colon': { value: 'Save:10x' },
    'a leading slash': { value: '/$29' },
    'a word after a slash': { value: '10x/week' },
    'a multiplier that looks like a file name': { value: '1.5x' },
  }).map(
    ([kind, props]): NegativeFixture => ({
      name: `a statistic in scene props: ${kind}`,
      code: 'CLAIM_UNBACKED',
      path: 'scenes[0].props.value',
      build: (c) => {
        at(c.scenes, 0).props = props;
      },
    }),
  ),
  {
    name: 'a statistic in a scene props key',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[0].props.40% faster builds',
    build: (c) => {
      at(c.scenes, 0).props = { '40% faster builds': true };
    },
  },
  {
    name: 'a statistic in a nested scene props key',
    code: 'CLAIM_UNBACKED',
    path: 'scenes[0].props.cards[0].10x',
    build: (c) => {
      at(c.scenes, 0).props = { cards: [{ '10x': 'faster' }] };
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
