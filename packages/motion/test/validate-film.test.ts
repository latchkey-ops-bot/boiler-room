import { describe, expect, it } from 'vitest';
import { validateFilm } from '../src/film/validate-film.ts';
import { at, examples, novaCopy } from './fixtures.ts';

const codes = (issues: ReturnType<typeof validateFilm>) => issues.map(({ code }) => code);

describe('validateFilm', () => {
  it.each(Object.entries(examples))('passes %s in every format it lists', (_name, copy) => {
    const campaign = copy();
    for (const format of campaign.variants.formats) {
      expect(validateFilm(campaign, format)).toEqual([]);
    }
  });

  it('rejects props a template does not accept', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 1).props = { zoom: 9 };
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'PROPS_INVALID', path: 'scenes[1].props.zoom' }),
    ]);
  });

  it('rejects copy a template would never show', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 3).text.push({
      id: 'extra',
      role: 'body',
      value: 'More copy.',
      claimIds: [],
    });
    expect(codes(validateFilm(campaign, '16:9'))).toEqual(['TEXT_UNUSED']);
  });

  it('rejects a scene missing copy its template needs', () => {
    const campaign = novaCopy();
    const close = at(campaign.scenes, 3);
    close.text = close.text.filter(({ role }) => role !== 'cta');
    expect(codes(validateFilm(campaign, '16:9'))).toEqual(['TEXT_MISSING']);
  });

  it('rejects an interface scene with no captured or uploaded image', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 1).assetIds = ['logo'];
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'IMAGE_MISSING', path: 'scenes[1].assetIds' }),
    ]);
  });

  it('does not take a stock image for the product', () => {
    const campaign = novaCopy();
    const shot = campaign.assets['dashboard-shot'];
    if (shot) shot.provenance = 'stock';
    expect(codes(validateFilm(campaign, '16:9'))).toEqual(['IMAGE_MISSING']);
  });

  it('rejects a transition that does not exist', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 0).transitionOut = 'star-wipe';
    expect(codes(validateFilm(campaign, '16:9'))).toEqual(['TRANSITION_UNKNOWN']);
  });

  it('warns about a transition on the last scene', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 3).transitionOut = 'push';
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'TRANSITION_UNUSED', severity: 'warning' }),
    ]);
  });

  it('rejects a format, hook or CTA the campaign does not list', () => {
    const campaign = novaCopy();
    campaign.variants.formats = ['16:9'];
    expect(codes(validateFilm(campaign, '9:16', { hookId: 'nope', ctaId: 'nope' }))).toEqual([
      'FORMAT_UNLISTED',
      'VARIANT_UNKNOWN',
      'VARIANT_UNKNOWN',
    ]);
  });

  it('checks hooks too, since any of them may open the film', () => {
    const campaign = novaCopy();
    at(campaign.variants.hooks, 0).props = { align: 'justify' };
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'PROPS_INVALID', path: 'variants.hooks[0].props.align' }),
    ]);
  });
});
