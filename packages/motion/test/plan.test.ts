import { describe, expect, it } from 'vitest';
import { planFilm } from '../src/film/plan.ts';
import { FilmRejected, prepareFilm } from '../src/film/prepare.ts';
import { featurePose, featureSteps } from '../src/scenes/feature-sequence.tsx';
import { interfacePose } from '../src/scenes/interface-reveal.tsx';
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
    const { carries, scenes } = novaPlan();
    expect(carries.map(({ element }) => element)).toEqual([
      { kind: 'image', assetId: 'dashboard-shot' },
      { kind: 'mark' },
    ]);
    expect(at(scenes, 1).carriedOut).toEqual({ kind: 'image', assetId: 'dashboard-shot' });
    expect(at(scenes, 3).carriedIn).toEqual({ kind: 'mark' });
  });

  it('hands a carried image over exactly where each scene holds it, so nothing jumps', () => {
    const plan = novaPlan();
    const carry = at(plan.carries, 0);
    const before = at(plan.scenes, carry.outgoing);
    const after = at(plan.scenes, carry.incoming);
    const campaign = plan.campaign;
    const handOff = carry.window.from - before.span.from;
    const takeBack = carry.window.to - after.span.from;
    expect(carry.image?.from.pose).toEqual(
      interfacePose(handOff, before.span.durationInFrames, at(campaign.scenes, 1).props),
    );
    expect(carry.image?.to.pose).toEqual(
      featurePose(takeBack, featureSteps(1, after.timing), at(campaign.scenes, 2).props),
    );
  });

  it('times each scene for the transitions on either side of it', () => {
    const { scenes } = novaPlan();
    const [open, speed, adoption, close] = scenes;
    // A scene pushed off holds still; the push moves it.
    expect(open?.timing.text.exitFrames).toBe(0);
    // A pushed scene arrives built, and its words wait for the push.
    expect(speed?.timing.container.enterAt).toBeLessThan(-(speed?.span.preRoll ?? 0));
    const pushEnds = (speed?.span.in?.to ?? 0) - (speed?.span.from ?? 0);
    expect(pushEnds).toBeGreaterThan(0);
    expect(speed?.timing.text.enterAt).toBeGreaterThan(pushEnds);
    // Words leave before a carry starts.
    const out = adoption?.span.out;
    const clearBy = (out?.from ?? 0) - (adoption?.span.from ?? 0);
    const { exitAt, exitFrames } = adoption?.timing.text ?? { exitAt: 0, exitFrames: 0 };
    expect(exitAt + exitFrames).toBeLessThanOrEqual(clearBy);
    // The film ends on a held frame.
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
});
