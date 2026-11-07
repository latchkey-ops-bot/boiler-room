import { describe, expect, it } from 'vitest';
import nova from '../examples/nova.campaign.json' with { type: 'json' };
import { type Campaign, campaignSchema } from '../src/campaign.ts';

const clone = (): Campaign => campaignSchema.parse(structuredClone(nova));
const rejects = (mutate: (campaign: Campaign) => void) => {
  const campaign = clone();
  mutate(campaign);
  return !campaignSchema.safeParse(campaign).success;
};

describe('campaignSchema', () => {
  it('accepts the Nova example', () => {
    expect(campaignSchema.safeParse(nova).success).toBe(true);
  });

  it('is a plain object schema, so parsed output equals its input', () => {
    expect(campaignSchema.parse(nova)).toEqual(nova);
    expect(campaignSchema.def.type).toBe('object');
  });

  it('rejects unknown keys instead of silently dropping them', () => {
    const typoInScene = structuredClone(nova) as unknown as {
      scenes: Record<string, unknown>[];
    };
    (typoInScene.scenes[0] as Record<string, unknown>).voiceOver = { text: 'lost', claimIds: [] };
    expect(campaignSchema.safeParse(typoInScene).success).toBe(false);
    expect(campaignSchema.safeParse({ ...nova, extra: true }).success).toBe(false);
  });

  it.each([
    ['a text item', (c: Campaign) => c.scenes[0]?.text[0]],
    ['a voiceover', (c: Campaign) => c.scenes[0]?.voiceover],
    ['a hook', (c: Campaign) => c.variants.hooks[0]],
    ['an asset', (c: Campaign) => c.assets.logo],
    ['a claim', (c: Campaign) => c.claims[0]],
    ['a variant CTA', (c: Campaign) => c.variants.ctas[0]],
    ['the variants', (c: Campaign) => c.variants],
    ['the brand', (c: Campaign) => c.brand],
    ['the colours', (c: Campaign) => c.brand.colors],
    ['the fonts', (c: Campaign) => c.brand.fonts],
    ['a font', (c: Campaign) => c.brand.fonts.display],
    ['the audio', (c: Campaign) => c.audio],
    ['the voice', (c: Campaign) => c.audio?.voice],
    ['a sound effect', (c: Campaign) => c.audio?.sfx?.[0]],
  ])('rejects an unknown key in %s', (_name, inside) => {
    expect(rejects((c) => Object.assign(inside(c) as object, { extra: true }))).toBe(true);
  });

  it('keeps scene props open for template parameters', () => {
    const campaign = clone();
    Object.assign(campaign.scenes[0] as object, {
      props: { columns: 3, nested: { easing: 'spring' } },
    });
    expect(campaignSchema.safeParse(campaign).success).toBe(true);
  });

  it.each([
    ['schemaVersion', (c: Campaign) => Object.assign(c, { schemaVersion: 2 })],
    ['id that is not a slug', (c: Campaign) => Object.assign(c, { id: 'Nova Launch' })],
    ['sourceUrl that is not a URL', (c: Campaign) => Object.assign(c, { sourceUrl: 'nova' })],
    ['fractional fps', (c: Campaign) => Object.assign(c, { fps: 29.97 })],
    ['zero durationSeconds', (c: Campaign) => Object.assign(c, { durationSeconds: 0 })],
    ['no scenes', (c: Campaign) => Object.assign(c, { scenes: [] })],
    [
      'a colour with alpha, which has no defined contrast',
      (c: Campaign) => Object.assign(c.brand.colors, { primary: '#7C9CFF80' }),
    ],
    ['a CSS colour name', (c: Campaign) => Object.assign(c.brand.colors, { background: 'black' })],
    ['a missing font source', (c: Campaign) => Object.assign(c.brand.fonts.body, { source: '' })],
    [
      'an unknown asset kind',
      (c: Campaign) => Object.assign(c.assets.logo as object, { kind: 'gif' }),
    ],
    [
      'an unknown provenance',
      (c: Campaign) => Object.assign(c.assets.logo as object, { provenance: 'scraped' }),
    ],
    ['a claim with no quote', (c: Campaign) => Object.assign(c.claims[0] as object, { quote: '' })],
    [
      'an unknown claim status',
      (c: Campaign) => Object.assign(c.claims[0] as object, { status: 'rejected' }),
    ],
    [
      'an unknown text role',
      (c: Campaign) => Object.assign(c.scenes[0]?.text[0] as object, { role: 'title' }),
    ],
    [
      'a voice provider other than elevenlabs',
      (c: Campaign) => Object.assign(c.audio?.voice as object, { provider: 'playht' }),
    ],
    [
      'a negative scene start',
      (c: Campaign) => Object.assign(c.scenes[0] as object, { start: -1 }),
    ],
    ['a negative scene end', (c: Campaign) => Object.assign(c.scenes[0] as object, { end: -1 })],
    [
      'a negative sound effect time',
      (c: Campaign) => Object.assign(c.audio?.sfx?.[0] as object, { at: -1 }),
    ],
    ['a negative durationSeconds', (c: Campaign) => Object.assign(c, { durationSeconds: -20 })],
    [
      'a claim id that is not a slug',
      (c: Campaign) => Object.assign(c.claims[0] as object, { id: 'Build Times' }),
    ],
    [
      'a claim sourceUrl that is not a URL',
      (c: Campaign) => Object.assign(c.claims[0] as object, { sourceUrl: 'nova.example.com' }),
    ],
    [
      'an asset sourceUrl that is not a URL',
      (c: Campaign) => Object.assign(c.assets.logo as object, { sourceUrl: 'nova.example.com' }),
    ],
  ])('rejects %s', (_name, mutate) => {
    expect(rejects(mutate)).toBe(true);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,hello'],
  ])('rejects a %s href', (_name, href) => {
    expect(
      rejects((c) => {
        Object.assign(c.variants.ctas[0] as object, { href });
      }),
    ).toBe(true);
  });

  it('accepts a campaign without the optional fields', () => {
    const campaign = clone();
    delete campaign.audio;
    delete campaign.brand.radius;
    delete campaign.brand.colors.accent;
    delete campaign.brand.colors.muted;
    delete campaign.scenes[0]?.voiceover;
    delete campaign.scenes[0]?.transitionOut;
    expect(campaignSchema.safeParse(campaign).success).toBe(true);
  });
});
