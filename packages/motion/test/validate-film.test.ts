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
    at(campaign.scenes, 1).props = { demo: 'video' };
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'PROPS_INVALID', path: 'scenes[1].props.demo' }),
    ]);
  });

  it.each([
    ['frame', 'plane', /Plane mode tilts the page in 3D/],
    ['layers', [], /does not draw layers yet/],
    ['activeLayer', 0, /does not light a layer yet/],
  ])('rejects the site-hero prop %s, which is not built, saying so', (key, value, message) => {
    const campaign = novaCopy();
    at(campaign.scenes, 2).props = { [key]: value };
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({
        code: 'PROPS_INVALID',
        path: `scenes[2].props.${key}`,
        message: expect.stringMatching(message),
      }),
    ]);
  });

  it('takes a site-hero focus box in capture pixels', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 2).props = { frame: 'browser', focus: { x: 0, y: 0, w: 1440, h: 900 } };
    expect(validateFilm(campaign, '16:9')).toEqual([]);
    at(campaign.scenes, 2).props = { focus: { x: 0.2, y: 0.3 } };
    expect(codes(validateFilm(campaign, '16:9'))).toEqual(['PROPS_INVALID', 'PROPS_INVALID']);
  });

  it.each([
    [{ textId: 'nope', from: 0, to: 1 }, 'scenes[1].props.accent.textId'],
    [{ textId: 'speed-headline', from: 0, to: 4 }, 'scenes[1].props.accent.to'],
    [{ textId: 'speed-headline', from: 2, to: 1 }, 'scenes[1].props.accent.to'],
  ])('rejects an accent that names no words of the scene: %o', (accent, path) => {
    const campaign = novaCopy();
    at(campaign.scenes, 1).props = { accent };
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'PROPS_INVALID', path }),
    ]);
  });

  it('rejects a feature card set to show a crop it has no image for', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 1).assetIds = [];
    expect(validateFilm(campaign, '16:9')).toEqual([]);
    at(campaign.scenes, 1).props = { demo: 'crop' };
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'IMAGE_MISSING', path: 'scenes[1].assetIds' }),
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

  it('rejects a site hero with no captured or uploaded image', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 2).assetIds = ['logo'];
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'IMAGE_MISSING', path: 'scenes[2].assetIds' }),
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
    at(campaign.scenes, 3).transitionOut = 't3';
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'TRANSITION_UNUSED', severity: 'warning' }),
    ]);
  });

  it('rejects the retired push and carry, and a fade, which are not catalog ids', () => {
    for (const name of ['push', 'carry', 'fade', 'slide']) {
      const campaign = novaCopy();
      at(campaign.scenes, 0).transitionOut = name;
      const [issue] = validateFilm(campaign, '16:9');
      expect(issue).toMatchObject({ code: 'TRANSITION_UNKNOWN', severity: 'error' });
      expect(issue?.fix).toContain('t1, t3, t5');
    }
  });

  it('warns where the resolver plays another id, naming both scenes and both ids', () => {
    const campaign = novaCopy();
    // feature-card leaves on x and site-hero enters on y, so a matched-velocity seam cannot join them.
    at(campaign.scenes, 1).transitionOut = 't1';
    expect(validateFilm(campaign, '16:9')).toEqual([
      {
        code: 'TRANSITION_RESOLVED',
        severity: 'warning',
        path: 'scenes[1].transitionOut',
        message:
          'Between "speed" and "adoption", "t1" was written and t3 plays: t1 needs feature-card\'s exit and site-hero\'s entry to move on one axis with one sign, within 1.5x of each other.',
        fix: 'Write t3 at scenes[1].transitionOut, so the film plays as written.',
      },
    ]);
  });

  it('reports a catalog id with no build yet as unbuilt, and plays the fallback', () => {
    const campaign = novaCopy();
    at(campaign.scenes, 0).transitionOut = 't4';
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({
        code: 'TRANSITION_UNBUILT',
        severity: 'warning',
        path: 'scenes[0].transitionOut',
        message: 'Between "open" and "speed", "t4" was written and t3 plays: t4 is not built yet.',
      }),
    ]);
  });

  it('fills a missing transitionOut and says so', () => {
    const campaign = novaCopy();
    delete at(campaign.scenes, 2).transitionOut;
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({
        code: 'TRANSITION_RESOLVED',
        message: 'Between "adoption" and "close" no transitionOut was written, so t3 plays.',
      }),
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
    at(campaign.variants.hooks, 0).props = { accent: 'loud' };
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'PROPS_INVALID', path: 'variants.hooks[0].props.accent' }),
    ]);
  });
});
