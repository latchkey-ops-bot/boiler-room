import type { Campaign } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { checkSubmission, expectedSeams } from '../src/director/checks.ts';
import {
  heroScreens,
  type ScrollCapture,
  scrollCaptures,
  siteScrollSupport,
} from '../src/director/site-scroll.ts';
import { TEMPLATES } from '../src/director/templates.ts';
import { exampleBrief, exampleResearch, exampleSubmission } from './director-fixtures.ts';

const page = (id: string, height: number, extra: Partial<ScrollCapture> = {}): ScrollCapture => ({
  assetId: id,
  sourceUrl: `https://fernhook.example.com/${id}`,
  width: 1920,
  height,
  ...extra,
});
const cta = { x: 640, y: 2400, w: 320, h: 96 };

describe('siteScrollSupport', () => {
  it('refuses one-screen captures, with motion’s own reason, as on the first real film', () => {
    const support = siteScrollSupport([page('home', 1080), page('pricing', 1080)], ['16:9']);
    expect(support.ok).toBe(false);
    if (support.ok) return;
    expect(support.reasons).toEqual([
      'the research records no CTA box or targetY for any captured page, so page 2 has nothing to land on',
      expect.stringContaining(
        'Capture at least 2083 px of the page, from its top, at 1920 px wide.',
      ),
    ]);
  });

  it('refuses long pages when no page 2 has a CTA box or targetY', () => {
    const support = siteScrollSupport([page('home', 4000), page('pricing', 4000)], ['16:9']);
    expect(support).toEqual({
      ok: false,
      reasons: [
        'the research records no CTA box or targetY for any captured page, so page 2 has nothing to land on',
      ],
    });
  });

  it('gives the pages to copy when two long captures pass the fit check, page 2 with a CTA', () => {
    const support = siteScrollSupport(
      [page('home', 4000), page('pricing', 4000, { ctaBox: cta })],
      ['16:9'],
    );
    expect(support).toEqual({
      ok: true,
      assetIds: ['home', 'pricing'],
      pages: [{}, { ctaBox: cta }],
    });
  });

  it('checks every format: pages long enough for 16:9 are too short for 9:16', () => {
    const near = { ...cta, y: 1500 };
    const captures = [page('home', 3000), page('pricing', 3000, { ctaBox: near })];
    expect(siteScrollSupport(captures, ['16:9']).ok).toBe(true);
    const tall = siteScrollSupport(captures, ['16:9', '9:16']);
    expect(tall.ok).toBe(false);
    if (!tall.ok) expect(tall.reasons.join(' ')).toContain('in 9:16');
  });

  it('never scrolls a page past three times as tall as wide', () => {
    expect(
      siteScrollSupport([page('home', 8000), page('pricing', 8000, { ctaBox: cta })], ['16:9']).ok,
    ).toBe(false);
  });

  it('reads no landing point from research.json, which records no DOM boxes', () => {
    const captures = scrollCaptures(exampleResearch());
    expect(captures.map((each) => each.assetId)).toEqual(['home', 'pr-panel']);
    expect(captures.every((each) => each.ctaBox === undefined && each.targetY === undefined)).toBe(
      true,
    );
  });
});

describe('heroScreens', () => {
  it('puts a product page first and a screen another site-hero shows last', () => {
    expect(heroScreens(exampleResearch(), ['16:9'])).toEqual(['pr-panel', 'home']);
    expect(heroScreens(exampleResearch(), ['16:9'], new Set(['pr-panel']))).toEqual([
      'home',
      'pr-panel',
    ]);
  });
});

describe('the tour row', () => {
  const standard = (row5: string): Campaign =>
    ({
      scenes: TEMPLATES.standard.rows.map((row, index) => ({
        type: index === 4 ? row5 : row.type === 'proof' ? 'stat-counter' : row.type,
      })),
    }) as unknown as Campaign;

  it('takes t3 out of a site-hero standing in for the site-scroll, and t1 out of a site-scroll', () => {
    expect(expectedSeams(standard('site-hero'), TEMPLATES.standard)[4]).toBe('t3');
    expect(expectedSeams(standard('site-scroll'), TEMPLATES.standard)[4]).toBe('t1');
  });
});

describe('checkSubmission and the render gate', () => {
  const blocking = async (
    submission: ReturnType<typeof exampleSubmission>,
    research = exampleResearch(),
  ) => (await checkSubmission(submission, research, exampleBrief())).blocking;

  it('sends a site-scroll back as a site-hero when the research cannot support one', async () => {
    const submission = exampleSubmission();
    const scene = submission.campaign.scenes[4];
    if (!scene) throw new Error('fixture changed');
    Object.assign(scene, { type: 'site-scroll', props: {}, text: [] });
    const issues = await blocking(submission);
    const scroll = issues.find((issue) => issue.code === 'SITE_SCROLL');
    expect(scroll).toMatchObject({ path: 'campaign.scenes[4].type', owner: 'director' });
    expect(scroll?.message).toContain('page 2 has nothing to land on');
    expect(scroll?.fix).toContain('Write scenes[4] as a site-hero instead');
    // Row 3's site-hero shows "home", so the stand-in is the product page.
    expect(scroll?.fix).toContain('set assetIds to ["pr-panel"]');
    expect(scroll?.fix).toContain('set transitionOut to "t3"');
    // Motion's own refusal of the same scene is not sent back a second time.
    expect(issues.filter((issue) => issue.path.startsWith('campaign.scenes[4].props'))).toEqual([]);
  });

  it('sends back what validateFilm refuses, such as props a template does not take', async () => {
    const submission = exampleSubmission();
    const hero = submission.campaign.scenes[2];
    if (!hero) throw new Error('fixture changed');
    hero.props = { mode: 'spin' };
    const issues = await blocking(submission);
    expect(issues.map((issue) => `${issue.code} ${issue.path}`)).toContain(
      'PROPS_INVALID campaign.scenes[2].props',
    );
  });

  it('leaves a capture too small to the Researcher, but only once the handoff lists it', async () => {
    const research = exampleResearch();
    const small = {
      ...research.assets.home,
      width: 640,
      height: 1200,
    } as (typeof research.assets)[string];
    research.assets.home = small;
    const submission = exampleSubmission();
    submission.campaign.assets.home = small;
    const verdict = await checkSubmission(submission, research, exampleBrief());
    expect(verdict.other).toContainEqual(
      expect.objectContaining({
        code: 'IMAGE_TOO_SMALL',
        path: 'campaign.assets.home.src',
        owner: 'researcher',
      }),
    );
    expect(verdict.blocking.map((issue) => `${issue.code} ${issue.path}`)).toEqual([
      'HANDOFF handoff.issuesLeft',
    ]);

    submission.handoff.issuesLeft = [
      { code: 'IMAGE_TOO_SMALL', path: 'assets.home.src', owner: 'researcher', note: 'too small' },
    ];
    expect(await blocking(submission, research)).toEqual([]);
  });
});
