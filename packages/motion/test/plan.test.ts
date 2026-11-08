import { describe, expect, it } from 'vitest';
import { planFilm } from '../src/film/plan.ts';
import { FilmRejected, prepareFilm } from '../src/film/prepare.ts';
import { at, exampleProbe, novaCopy, quillhavenCopy } from './fixtures.ts';

const novaPlan = () =>
  planFilm({
    campaign: novaCopy(),
    format: '16:9',
    logo: { kind: 'image', src: 'assets/nova/logo.svg', aspect: 373 / 112 },
    imageSizes: { 'dashboard-shot': { width: 2880, height: 1800 } },
  });

describe('planFilm', () => {
  it('is plain data, since Remotion hands it from calculateMetadata to each render tab', () => {
    const plan = novaPlan();
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });

  it('keeps the length and size the campaign and format give', () => {
    expect(novaPlan()).toMatchObject({ width: 1920, height: 1080, fps: 30, durationInFrames: 600 });
  });

  it('plans the transition the resolver chose on each boundary', () => {
    expect(novaPlan().transitions.map(({ name, boundary }) => [name, boundary])).toEqual([
      ['t3', 120],
      ['t3', 270],
      ['t3', 420],
    ]);
  });

  it('takes the skin and ground from the brand: dark Nova is on the plate', () => {
    const plan = novaPlan();
    expect(plan.skin).toBe('kinetic-plate');
    expect(plan.scenes.map(({ ground }) => ground)).toEqual(['plate', 'plate', 'plate', 'plate']);
    const quillhaven = planFilm({
      campaign: quillhavenCopy(),
      format: '1:1',
      logo: { kind: 'wordmark', reason: 'too-small' },
      imageSizes: { 'editor-shot': { width: 2880, height: 1800 } },
    });
    expect(quillhaven.skin).toBe('neutral-cut');
    expect(new Set(quillhaven.scenes.map(({ ground }) => ground))).toEqual(new Set(['base']));
  });

  it("stops the film's clock, the ground included, where the end card holds", () => {
    const plan = novaPlan();
    const close = at(plan.scenes, 3);
    expect(plan.stillFrom).toBe(close.span.from + close.span.durationInFrames - 69);
  });

  it('times each scene to keep everything to its last frame, and a blinked scene after its blank', () => {
    for (const scenePlan of novaPlan().scenes) {
      expect(scenePlan.timing.text.exitFrames).toBe(0);
      expect(scenePlan.timing.container.exitFrames).toBe(0);
      expect(scenePlan.timing.container.enterAt).toBe(0);
    }
    const quillhaven = planFilm({
      campaign: quillhavenCopy(),
      format: '16:9',
      logo: { kind: 'wordmark', reason: 'too-small' },
      imageSizes: { 'editor-shot': { width: 2880, height: 1800 } },
    });
    // The second card follows a T5: 2 spec frames of ground, which are 2 frames at 24 fps.
    expect(at(quillhaven.scenes, 3).timing.container.enterAt).toBe(2);
    expect(at(quillhaven.scenes, 3).span.in).toMatchObject({ name: 't5', blank: 2 });
  });
});

describe('prepareFilm', () => {
  it('plans both examples in every format', async () => {
    for (const campaign of [novaCopy(), quillhavenCopy()]) {
      for (const format of campaign.variants.formats) {
        const plan = await prepareFilm({ campaign, format }, exampleProbe());
        expect(plan.durationInFrames).toBe(campaign.durationSeconds * campaign.fps);
      }
    }
  });

  it('sets the name as a wordmark when the logo is a favicon', async () => {
    const plan = await prepareFilm({ campaign: quillhavenCopy(), format: '1:1' }, exampleProbe());
    expect(plan.logo).toEqual({ kind: 'wordmark', reason: 'too-small' });
  });

  it('refuses a campaign validateCampaign rejects, listing what to change', async () => {
    const campaign = novaCopy();
    at(at(campaign.scenes, 1).text, 0).value = '90% faster builds';
    const rejection = prepareFilm({ campaign, format: '16:9' }, exampleProbe());
    await expect(rejection).rejects.toThrow(FilmRejected);
    await expect(rejection).rejects.toThrow(/CLAIM_UNBACKED at scenes\[1\]\.text\[0\]\.value/);
  });

  it('refuses a scene type that has no template yet, by name', async () => {
    const campaign = novaCopy();
    at(campaign.scenes, 1).type = 'proof-bars';
    const rejection = prepareFilm({ campaign, format: '16:9' }, exampleProbe());
    await expect(rejection).rejects.toThrow(
      /SCENE_TYPE_UNBUILT at scenes\[1\]\.type: Scene type "proof-bars" is in the scene library, but motion has no template for it yet/,
    );
  });

  it('shows a raster logo no larger than its own pixels', async () => {
    const campaign = novaCopy();
    const logo = campaign.assets.logo;
    if (logo) Object.assign(logo, { kind: 'image', src: 'assets/nova/logo.png' });
    const plan = await prepareFilm(
      { campaign, format: '16:9' },
      exampleProbe({
        'logo.png': {
          loaded: true,
          width: 373,
          height: 112,
          animated: false,
          coverage: 0.4,
          palette: [{ color: '#7799FF', share: 1 }],
        },
      }),
    );
    expect(plan.logo).toMatchObject({ kind: 'image', naturalWidth: 373 });
  });

  it('refuses a cut whose selection does not exist', async () => {
    await expect(
      prepareFilm({ campaign: novaCopy(), format: '16:9', hookId: 'missing' }, exampleProbe()),
    ).rejects.toThrow(/VARIANT_UNKNOWN/);
  });

  it('validates the cut again with its hook and CTA in place', async () => {
    const plan = await prepareFilm(
      { campaign: novaCopy(), format: '9:16', hookId: 'open-question', ctaId: 'book-demo' },
      exampleProbe(),
    );
    expect(at(plan.campaign.scenes, 0).id).toBe('open-question');
    expect(at(plan.campaign.scenes, 3).text.find(({ role }) => role === 'cta')?.value).toBe(
      'Book a demo',
    );
  });

  it('refuses a film whose product image cannot be loaded', async () => {
    await expect(
      prepareFilm(
        { campaign: novaCopy(), format: '16:9' },
        exampleProbe({ 'dashboard.png': { loaded: false } }),
      ),
    ).rejects.toThrow(/IMAGE_MISSING at assets\.dashboard-shot\.src/);
  });

  it('refuses an animated product image, which would play on the browser clock', async () => {
    const animated = { loaded: true, width: 2880, height: 1800, animated: true };
    await expect(
      prepareFilm(
        { campaign: novaCopy(), format: '16:9' },
        exampleProbe({ 'dashboard.png': animated }),
      ),
    ).rejects.toThrow(/IMAGE_ANIMATED at assets\.dashboard-shot\.src/);
  });

  it('refuses a product image whose bytes cannot be read to check it is still', async () => {
    const unread = { loaded: true, width: 2880, height: 1800 };
    await expect(
      prepareFilm(
        { campaign: novaCopy(), format: '16:9' },
        exampleProbe({ 'dashboard.png': unread }),
      ),
    ).rejects.toThrow(/IMAGE_UNREADABLE at assets\.dashboard-shot\.src/);
  });

  it('refuses a brand font that cannot be loaded, naming the font, its file and why', async () => {
    const corrupt = { loaded: false, reason: 'Invalid font data in ArrayBuffer.' } as const;
    const rejection = prepareFilm(
      { campaign: novaCopy(), format: '16:9' },
      exampleProbe({}, { 'sora.woff2': corrupt }),
    );
    await expect(rejection).rejects.toThrow(FilmRejected);
    await expect(rejection).rejects.toThrow(
      /FONT_UNAVAILABLE at assets\.font-display\.src: The display font "Sora" could not be loaded from "assets\/fonts\/sora\.woff2": Invalid font data in ArrayBuffer\./,
    );
  });

  it('names the source of a font given as a URL', async () => {
    const campaign = novaCopy();
    campaign.brand.fonts.body.source = 'https://fonts.example.com/brand.woff2';
    await expect(
      prepareFilm(
        { campaign, format: '16:9' },
        exampleProbe({}, { 'brand.woff2': { loaded: false, reason: 'Failed to fetch' } }),
      ),
    ).rejects.toThrow(/FONT_UNAVAILABLE at brand\.fonts\.body\.source: The body font "Inter"/);
  });

  const withShot = (width: number, height: number) =>
    exampleProbe({ 'dashboard.png': { loaded: true, width, height, animated: false } });

  it('refuses a product image too small for the size it is shown at', async () => {
    const rejection = prepareFilm({ campaign: novaCopy(), format: '16:9' }, withShot(160, 100));
    await expect(rejection).rejects.toThrow(/IMAGE_TOO_SMALL at assets\.dashboard-shot\.src/);
  });

  it.each([
    ['a full-page capture', 1440, 9000],
    ['a sliver', 3000, 150],
  ])('refuses %s, which would be shown as a strip', async (_kind, width, height) => {
    const rejection = prepareFilm(
      { campaign: novaCopy(), format: '9:16' },
      withShot(width, height),
    );
    await expect(rejection).rejects.toThrow(/IMAGE_WRONG_SHAPE at assets\.dashboard-shot\.src/);
  });

  it('takes a laptop capture at device scale 2 in every format', async () => {
    for (const format of ['16:9', '9:16', '1:1'] as const) {
      await expect(
        prepareFilm({ campaign: novaCopy(), format }, withShot(2560, 1600)),
      ).resolves.toMatchObject({ format });
    }
  });

  it('refuses a capture at device scale 1, which a 9:16 site hero shows as a column', async () => {
    const rejection = prepareFilm({ campaign: novaCopy(), format: '9:16' }, withShot(1280, 800));
    await expect(rejection).rejects.toThrow(/IMAGE_TOO_SMALL at assets\.dashboard-shot\.src/);
  });

  it('takes a phone screenshot in 9:16, and refuses it across a 16:9 frame', async () => {
    await expect(
      prepareFilm({ campaign: novaCopy(), format: '9:16' }, withShot(1170, 2532)),
    ).resolves.toMatchObject({ format: '9:16' });
    await expect(
      prepareFilm({ campaign: novaCopy(), format: '16:9' }, withShot(1170, 2532)),
    ).rejects.toThrow(/IMAGE_TOO_SMALL/);
  });

  it('sets the name as a wordmark when the logo animates', async () => {
    const logo = { loaded: true, width: 373, height: 112, coverage: 0.4, animated: true };
    const plan = await prepareFilm(
      { campaign: novaCopy(), format: '16:9' },
      exampleProbe({ 'logo.svg': logo }),
    );
    expect(plan.logo).toEqual({ kind: 'wordmark', reason: 'animated' });
  });
});
