import type { Campaign } from '@boiler-room/schema';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ScriptReview, usedIn } from '../src/components/script-review.tsx';
import type { ApprovalView, FilmDetail, FilmEventView, FilmView } from '../src/server/api/films.ts';
import { SAMPLE_CAMPAIGN } from '../src/server/pipeline/simulated.ts';
import {
  buildReviewModel,
  type ReviewModel,
  rulerTicks,
  sourceLabel,
  words,
} from '../src/server/script-review.ts';

// The screen is a client component. Outside Next there is no router, so stand in for the two
// Next modules it uses.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}));

const FILM: FilmView = {
  id: 'flm_00000000000000000000',
  url: 'https://nova.example.com',
  host: 'nova.example.com',
  title: 'Nova launch',
  status: 'needs_you',
  stage: 'approval',
  pipeline: 'simulated',
  simulated: true,
  scriptVersion: 1,
  chosenHook: null,
  chosenCta: null,
  formats: [],
  showcaseOptIn: false,
  createdAt: '2026-11-07T12:00:00.000Z',
  updatedAt: '2026-11-07T12:00:31.000Z',
};

function event(agent: FilmEventView['agent'], kind: FilmEventView['kind'], seq: number) {
  return {
    id: `e${seq}`,
    seq,
    at: '2026-11-07T12:00:00.000Z',
    agent,
    kind,
    stage: 'approval',
    status: 'working',
    message: '',
  } satisfies FilmEventView;
}

function detail(
  film: Partial<FilmView> = {},
  extra: { approvals?: ApprovalView[]; events?: FilmEventView[]; campaign?: Campaign } = {},
): FilmDetail & { campaign: Campaign } {
  return {
    film: { ...FILM, ...film },
    campaign: extra.campaign ?? SAMPLE_CAMPAIGN,
    events: extra.events ?? [event('director', 'decision', 0), event('validator', 'passed', 1)],
    approvals: extra.approvals ?? [],
    deliverables: [],
  };
}

const sendBack = (version: number, note: string): ApprovalView => ({
  scriptVersion: version,
  decision: 'changes_requested',
  note,
  decidedAt: '2026-11-07T12:00:40.000Z',
});

describe('the script review model', () => {
  const model = buildReviewModel(detail());

  it('lays out every scene with its timing, words and template settings', () => {
    expect(model.durationSeconds).toBe(20);
    expect(model.scenes.map((scene) => [scene.number, scene.name, scene.start, scene.end])).toEqual(
      [
        [1, 'Open', 0, 4],
        [2, 'Speed', 4, 9],
        [3, 'Adoption', 9, 14],
        [4, 'Close', 14, 20],
      ],
    );
    const speed = model.scenes[1];
    expect(speed?.type).toBe('stat');
    expect(speed?.props).toEqual([{ key: 'Layout', value: 'split' }]);
    expect(speed?.transitionOut).toBe('slide');
    expect(speed?.showsProduct).toBe(true);
    expect(model.scenes[0]?.showsProduct).toBe(false);
    expect(speed?.voiceover?.text).toBe(
      'Teams on Nova cut build times by 40% in their first month.',
    );
    expect(speed?.claimIds).toEqual(['build-times']);
  });

  it('counts characters against the limit for the scene type, or the default', () => {
    // `stat` is not a registered scene type, so the defaults apply: 60 for a headline, 40 a label.
    expect(model.scenes[1]?.text.map((item) => [item.label, item.length, item.limit])).toEqual([
      ['Headline', 17, 60],
      ['Label', 18, 40],
    ]);
    // A registered type uses its own limits.
    const campaign: Campaign = structuredClone(SAMPLE_CAMPAIGN);
    const first = campaign.scenes[1];
    if (first) first.type = 'stat-counter';
    const registered = buildReviewModel(detail({}, { campaign }));
    expect(registered.scenes[1]?.text.map((item) => item.limit)).toEqual([10, 40]);
  });

  it('offers each hook as an opening that keeps the first scene’s timing', () => {
    expect(model.hooks).toHaveLength(1);
    expect(model.hooks[0]).toMatchObject({
      id: 'open-question',
      label: 'Hook B',
      headline: 'Still waiting on CI?',
    });
    expect(model.hooks[0]?.scene).toMatchObject({ number: 1, start: 0, end: 4 });
  });

  it('lists every claim with its quote, source and the scenes that use it', () => {
    expect(
      model.claims.map((claim) => [claim.id, claim.sourceLabel, claim.approved, claim.usedIn]),
    ).toEqual([
      ['build-times', 'nova.example.com/customers', true, [2]],
      ['team-count', 'nova.example.com', true, [3]],
      ['deploy-rate', 'nova.example.com/customers', true, [3]],
      ['pricing', 'nova.example.com/pricing', false, [4]],
    ]);
    expect(model.claims[0]?.quote).toBe(
      'Teams on Nova cut build times by 40% in their first month.',
    );
    expect(model.claims[0]?.sourceUrl).toBe('https://nova.example.com/customers');
  });

  it('flags on-screen copy that cites a claim nobody has confirmed', () => {
    expect(model.unconfirmed).toEqual([
      { claimId: 'pricing', sceneNumber: 4, says: 'From $29 per seat' },
    ]);
  });

  it('carries the choices the founder makes: CTAs and shapes', () => {
    expect(model.ctas.map((cta) => cta.id)).toEqual(['start-free', 'book-demo']);
    expect(model.formats).toEqual(['16:9', '9:16', '1:1']);
  });

  it('puts audio on the timeline', () => {
    expect(model.music).toBe('music-bed');
    expect(model.sfx).toEqual([{ assetId: 'whoosh', at: 4 }]);
    expect(model.ticks).toEqual([0, 5, 10, 15, 20]);
  });

  it('passes the brand to the preview, never ours', () => {
    expect(model.brand).toMatchObject({
      name: 'Nova',
      background: '#0B1020',
      primary: '#7C9CFF',
      radius: 12,
      displayFont: 'Sora',
    });
    expect(JSON.parse(model.campaignJson)).toEqual(SAMPLE_CAMPAIGN);
  });
});

describe('where the script is', () => {
  it('is the founder’s to decide while the run waits at approval', () => {
    const model = buildReviewModel(detail());
    expect(model.state).toBe('waiting');
    expect(model.validatorPassed).toBe(true);
    expect(model.approved).toBeNull();
  });

  it('is still being checked before the Validator passes it', () => {
    const model = buildReviewModel(
      detail(
        { status: 'working', stage: 'checks', scriptVersion: 0 },
        { events: [event('director', 'decision', 0), event('validator', 'sent_back', 1)] },
      ),
    );
    expect(model.state).toBe('checking');
    expect(model.validatorPassed).toBe(false);
  });

  it('is being rewritten from the founder’s note, and an old pass is not shown', () => {
    const model = buildReviewModel(
      detail(
        { status: 'working', stage: 'script' },
        { approvals: [sendBack(1, 'Say teams, not customers.')] },
      ),
    );
    expect(model.state).toBe('rewriting');
    expect(model.rewriteNote).toBe('Say teams, not customers.');
    expect(model.validatorPassed).toBe(false);
  });

  it('waits again once version 2 is ready, after a send back on version 1', () => {
    const model = buildReviewModel(
      detail({ scriptVersion: 2 }, { approvals: [sendBack(1, 'Shorter.')] }),
    );
    expect(model.state).toBe('waiting');
    expect(model.rewriteNote).toBeNull();
  });

  it('is approved, with the founder’s choices, once they approve', () => {
    const model = buildReviewModel(
      detail(
        {
          status: 'working',
          stage: 'motion',
          chosenHook: 'open-question',
          chosenCta: 'book-demo',
          formats: ['16:9', '1:1'],
        },
        {
          approvals: [
            {
              scriptVersion: 1,
              decision: 'approved',
              note: null,
              decidedAt: '2026-11-07T12:00:40.000Z',
            },
          ],
        },
      ),
    );
    expect(model.state).toBe('approved');
    expect(model.approved).toEqual({
      hookId: 'open-question',
      ctaId: 'book-demo',
      formats: ['16:9', '1:1'],
    });
  });

  it('has stopped when the run failed', () => {
    expect(buildReviewModel(detail({ status: 'failed' })).state).toBe('failed');
  });
});

describe('small helpers', () => {
  it('turns ids into words', () => {
    expect(words('open')).toBe('Open');
    expect(words('hero-shot')).toBe('Hero shot');
    expect(words('transition_out')).toBe('Transition out');
  });

  it('shows a source without its scheme or trailing slash', () => {
    expect(sourceLabel('https://nova.example.com/')).toBe('nova.example.com');
    expect(sourceLabel('http://nova.example.com/pricing')).toBe('nova.example.com/pricing');
  });

  it('spaces the ruler for the length of the film', () => {
    expect(rulerTicks(8)).toEqual([0, 2, 4, 6, 8]);
    expect(rulerTicks(20)).toEqual([0, 5, 10, 15, 20]);
    expect(rulerTicks(22)).toEqual([0, 5, 10, 15, 22]);
    expect(rulerTicks(45)).toEqual([0, 10, 20, 30, 45]);
  });

  it('names the scenes a claim is in', () => {
    expect(usedIn([])).toBe('Not in the video');
    expect(usedIn([2])).toBe('In scene 2');
    expect(usedIn([2, 3, 4])).toBe('In scenes 2, 3 and 4');
  });
});

describe('the script review screen', () => {
  function render(model: ReviewModel) {
    const html = renderToStaticMarkup(createElement(ScriptReview, { model }));
    // Text as a reader sees it: tags gone, entities decoded.
    const text = html
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, '&');
    return { html, text };
  }

  it('shows every claim with its verbatim quote and a link to its source', () => {
    const model = buildReviewModel(detail());
    const { html, text } = render(model);
    for (const claim of SAMPLE_CAMPAIGN.claims) {
      expect(text).toContain(claim.quote);
      expect(html).toContain(`href="${claim.sourceUrl}"`);
    }
    // Links to customer pages open apart from the app, without handing it the opener.
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('shows each scene on the timeline with its timing', () => {
    const { html } = render(buildReviewModel(detail()));
    expect(html).toContain('aria-label="Scene 1, Open, 0s to 4s"');
    expect(html).toContain('aria-label="Scene 2, Speed, 4s to 9s"');
    expect(html).toContain('aria-label="Scene 4, Close, 14s to 20s"');
    expect(html).toContain('slide into scene 3');
  });

  it('shows the selected scene’s words, voiceover and character counts', () => {
    const { text } = render(buildReviewModel(detail()));
    expect(text).toContain('Your builds are waiting.');
    expect(text).toContain('Your builds are waiting. Nova gets them moving.');
    expect(text).toContain('24 / 60');
  });

  it('offers both decisions while the script waits, with every choice the API needs', () => {
    const { html, text } = render(buildReviewModel(detail()));
    expect(text).toContain('Approve script');
    expect(text).toContain('Request changes');
    expect(html).toContain('form="changes"');
    expect(html).toContain('id="note"');
    // The approve dialog: openings, calls to action and shapes.
    expect(text).toContain('Still waiting on CI?');
    expect(text).toContain('Book a demo');
    for (const format of ['16:9', '9:16', '1:1']) expect(text).toContain(format);
    expect(text).toContain('Approve and start');
  });

  it('labels a simulated film, and the preview as unrendered', () => {
    const { text } = render(buildReviewModel(detail()));
    expect(text).toContain('Simulated');
    expect(text).toContain('This is a simulated video.');
    expect(text).toContain("Preview · Nova's brand · no render yet");
  });

  it('shows no simulated label on a real film', () => {
    const { text } = render(buildReviewModel(detail({ simulated: false, pipeline: 'naive' })));
    expect(text).not.toContain('Simulated');
    expect(text).not.toContain('This is a simulated video.');
  });

  it('asks the founder to check a claim nobody has confirmed', () => {
    const { text } = render(buildReviewModel(detail()));
    expect(text).toContain('One claim to confirm');
    expect(text).toContain('Scene 4 says "From $29 per seat"');
  });

  it('offers no decision once the script is approved', () => {
    const { text } = render(
      buildReviewModel(
        detail(
          { status: 'working', stage: 'motion', formats: ['16:9'], chosenCta: 'start-free' },
          {
            approvals: [
              {
                scriptVersion: 1,
                decision: 'approved',
                note: null,
                decidedAt: '2026-11-07T12:00:40.000Z',
              },
            ],
          },
        ),
      ),
    );
    expect(text).not.toContain('Approve script');
    expect(text).not.toContain('Ask the Director for a change');
    expect(text).toContain('You approved version 1.');
    expect(text).toContain('Back to the video');
  });
});
