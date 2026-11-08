import { describe, expect, it } from 'vitest';
import { planFilm } from '../src/film/plan.ts';
import { FilmRejected, prepareFilm } from '../src/film/prepare.ts';
import { stageFor } from '../src/layout/stage.ts';
import { sceneImplementations } from '../src/scenes/registry.ts';
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

  it('carries the product between scenes that share it, and the mark otherwise', () => {
    const nova = novaPlan();
    expect(nova.carries.map(({ element }) => element)).toEqual([
      { kind: 'image', assetId: 'dashboard-shot' },
    ]);
    expect(at(nova.scenes, 1).carriedOut).toEqual({ kind: 'image', assetId: 'dashboard-shot' });
    const quillhaven = planFilm({
      campaign: quillhavenCopy(),
      format: '1:1',
      logo: { kind: 'wordmark', reason: 'too-small' },
      imageSizes: { 'editor-shot': { width: 2880, height: 1800 } },
    });
    expect(quillhaven.carries.map(({ element }) => element)).toEqual([
      { kind: 'image', assetId: 'editor-shot' },
      { kind: 'mark' },
    ]);
    expect(at(quillhaven.scenes, 3).carriedIn).toEqual({ kind: 'mark' });
  });

  it('hands a carried image over exactly where each scene holds it, so nothing jumps', () => {
    const plan = novaPlan();
    const carry = at(plan.carries, 0);
    const before = at(plan.scenes, carry.outgoing);
    const after = at(plan.scenes, carry.incoming);
    const { campaign } = plan;
    const stage = stageFor(plan.width, plan.height);
    const image = { width: 2880, height: 1800, aspect: 1.6 };
    const anchor = (index: number, frame: number, scenePlan: typeof before) => {
      const scene = at(campaign.scenes, index);
      const definition = sceneImplementations[scene.type];
      return definition?.imageAnchor?.({
        props: definition.props.parse(scene.props),
        stage,
        image,
        durationInFrames: scenePlan.span.durationInFrames,
        fps: plan.fps,
        timing: scenePlan.timing,
        frame,
        text: scene.text,
      });
    };
    // From the cause node of the feature card to the site hero's browser frame and its address.
    expect(carry.image?.from).toEqual(anchor(1, carry.window.from - before.span.from, before));
    expect(carry.image?.to).toEqual(anchor(2, carry.window.to - after.span.from, after));
    expect(carry.image?.from.chrome).toBe(0);
    expect(carry.image?.to).toMatchObject({ address: 'nova.example.com/product' });
    expect(carry.image?.to.chrome).toBeGreaterThan(0);
  });

  it('times each scene for the transitions on either side of it', () => {
    const { scenes } = novaPlan();
    const [open, speed, adoption, close] = scenes;
    // A scene pushed off holds still; the push moves it.
    expect(open?.timing.text.exitFrames).toBe(0);
    // A pushed scene arrives built: its entry starts with the push, so it builds as it slides on.
    expect(speed?.timing.container.enterAt).toBeLessThan(-(speed?.span.preRoll ?? 0));
    expect(speed?.span.preRoll).toBeGreaterThan(0);
    expect(speed?.timing.entryAt).toBe(-(speed?.span.preRoll ?? 0));
    // Words leave before a carry starts.
    const out = speed?.span.out;
    const clearBy = (out?.from ?? 0) - (speed?.span.from ?? 0);
    const { exitAt, exitFrames } = speed?.timing.text ?? { exitAt: 0, exitFrames: 0 };
    expect(exitAt + exitFrames).toBeLessThanOrEqual(clearBy);
    // A carried image lands before the scene it lands in starts its own entry.
    expect(adoption?.timing.entryAt).toBe(
      (adoption?.span.in?.to ?? 0) - (adoption?.span.from ?? 0),
    );
    // A dead-stop cut keeps everything to the last frame, and so does the end of the film.
    expect(adoption?.timing.text.exitFrames).toBe(0);
    expect(close?.timing.container.exitFrames).toBe(0);
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
    at(campaign.scenes, 1).type = 'stat-counter';
    const rejection = prepareFilm({ campaign, format: '16:9' }, exampleProbe());
    await expect(rejection).rejects.toThrow(
      /SCENE_TYPE_UNBUILT at scenes\[1\]\.type: Scene type "stat-counter" is in the scene library, but motion has no template for it yet/,
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
