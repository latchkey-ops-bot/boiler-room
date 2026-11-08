import { readdirSync, readFileSync } from 'node:fs';
import {
  type Campaign,
  campaignSchema,
  type Scene,
  sceneRegistry,
  type TextRole,
} from '@boiler-room/schema';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ScriptReview, usedIn } from '../src/components/script-review.tsx';
import { BRAND_FALLBACK_STACK, brandFontsHrefs, fontStack } from '../src/lib/brand-scene.ts';
import type { ApprovalView, FilmDetail, FilmEventView, FilmView } from '../src/server/api/films.ts';
import {
  buildReviewModel as build,
  type ReviewModel,
  sourceLabel,
  words,
} from '../src/server/script-review.ts';
import nova from './fixtures/nova.campaign.json';

/**
 * The tests read a copy of the Nova example pinned here, so a change to the schema's examples
 * cannot change what they expect. The tests at the end run every example in
 * `packages/schema/examples` and every scene type in the registry instead.
 */
const NOVA: Campaign = campaignSchema.parse(nova);
const EXAMPLES = new URL('../../../packages/schema/examples/', import.meta.url);

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
  title: 'nova.example.com',
  status: 'needs_you',
  stage: 'approval',
  pipeline: 'simulated',
  simulated: true,
  scriptVersion: 1,
  chosenHook: null,
  chosenCta: null,
  formats: [],
  showcaseOptIn: false,
  launchDate: null,
  launchChannels: [],
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
    campaign: extra.campaign ?? NOVA,
    events: extra.events ?? [event('director', 'decision', 0), event('validator', 'passed', 1)],
    approvals: extra.approvals ?? [],
    deliverables: [],
    revisions: [],
  };
}

const sendBack = (version: number, note: string): ApprovalView => ({
  scriptVersion: version,
  decision: 'changes_requested',
  note,
  confirmedClaimIds: [],
  decidedAt: '2026-11-07T12:00:40.000Z',
});

const approval = (confirmedClaimIds: string[] = ['pricing']): ApprovalView => ({
  scriptVersion: 1,
  decision: 'approved',
  note: null,
  confirmedClaimIds,
  decidedAt: '2026-11-07T12:00:40.000Z',
});

const buildReviewModel = (input: FilmDetail & { campaign: Campaign }) =>
  build(input, { maxRevisions: 3 });

describe('the script review model', () => {
  const model = buildReviewModel(detail());

  it('lays out every scene with its timing, words and voiceover', () => {
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
    expect(speed?.lines.map((line) => [line.label, line.value])).toEqual([
      ['Headline', '40% faster builds'],
      ['Label', 'Every commit'],
      ['Label', 'Built sooner'],
    ]);
    expect(speed?.voiceover?.text).toBe(
      'Teams on Nova cut build times by 40% in their first month.',
    );
    expect(speed?.claimIds).toEqual(['build-times']);
    // A scene's sources are the claims its voiceover cites as well as its lines.
    expect(model.scenes[2]?.claimIds).toEqual(['team-count', 'deploy-rate']);
    expect(model.scenes[3]?.claimIds).toEqual(['pricing']);
  });

  it('leads each scene with its headline, or its first line when the scene type has none', () => {
    expect(model.scenes.map((scene) => scene.lines.map((line) => [line.role, line.value]))).toEqual(
      [
        [['headline', 'Your builds are waiting.']],
        [
          ['headline', '40% faster builds'],
          ['label', 'Every commit'],
          ['label', 'Built sooner'],
        ],
        // A site-hero has only its address, an end-card its button and address.
        [['label', 'nova.example.com/product']],
        [
          ['cta', 'Start free'],
          ['label', 'nova.example.com'],
        ],
      ],
    );
    // A headline leads wherever the scene lists it, and the rest keep their order.
    const speed = NOVA.scenes[1] as Scene;
    const [headline, cause, effect] = speed.text;
    const moved = buildReviewModel(
      detail(
        {},
        {
          campaign: {
            ...NOVA,
            scenes: [{ ...speed, text: [cause, headline, effect] as Scene['text'] }],
          },
        },
      ),
    );
    expect(moved.scenes[0]?.lines.map((line) => line.id)).toEqual([
      'speed-headline',
      'speed-cause',
      'speed-effect',
    ]);
    // The preview draws the lines as the scene lists them.
    expect(moved.scenes[0]?.frame.lines.map((line) => line.id)).toEqual([
      'speed-cause',
      'speed-headline',
      'speed-effect',
    ]);
  });

  it('draws each scene for the preview with its alignment and product shot', () => {
    // The motion library's scene types take no align prop, so the preview sets their copy left.
    expect(model.scenes.map((scene) => [scene.frame.align, scene.frame.showsProduct])).toEqual([
      ['left', false],
      ['left', true],
      ['left', true],
      ['left', false],
    ]);
    const open = NOVA.scenes[0] as Scene;
    const centred = buildReviewModel(
      detail({}, { campaign: { ...NOVA, scenes: [{ ...open, props: { align: 'center' } }] } }),
    );
    expect(centred.scenes[0]?.frame.align).toBe('center');
    expect(model.scenes[3]?.frame.lines).toEqual([
      { id: 'close-cta', role: 'cta', value: 'Start free' },
      { id: 'close-address', role: 'label', value: 'nova.example.com' },
    ]);
  });

  it('keeps developer detail out of what the customer sees', () => {
    const keys = Object.keys(model);
    for (const hidden of ['campaignJson', 'ticks', 'music', 'sfx']) {
      expect(keys).not.toContain(hidden);
    }
    expect(Object.keys(model.scenes[0] ?? {})).not.toContain('props');
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

  it('lists every claim with its quote, source, who checked it and the scenes that use it', () => {
    expect(
      model.claims.map((claim) => [
        claim.id,
        claim.sourceLabel,
        claim.checked,
        claim.confirmedByYou,
        claim.usedIn,
      ]),
    ).toEqual([
      ['build-times', 'nova.example.com/customers', true, false, [2]],
      ['team-count', 'nova.example.com', true, false, [3]],
      ['deploy-rate', 'nova.example.com/customers', true, false, [3]],
      ['pricing', 'nova.example.com/pricing', false, false, [4]],
    ]);
    expect(model.claims[0]?.quote).toBe(
      'Teams on Nova cut build times by 40% in their first month.',
    );
  });

  it('flags copy that cites a claim nobody has confirmed, with the number to confirm', () => {
    expect(model.unconfirmed).toEqual([
      {
        claimId: 'pricing',
        sceneNumber: 4,
        // Only the voiceover cites it, so the voiceover is what the founder confirms.
        says: 'Plans start at $29 per seat. Start free today.',
        figure: '$29',
        hookId: null,
      },
    ]);
  });

  it('carries the choices the founder makes, and the revision limit', () => {
    expect(model.ctas.map((cta) => cta.id)).toEqual(['start-free', 'book-demo']);
    expect(model.formats).toEqual(['16:9', '9:16', '1:1']);
    expect(model.maxRevisions).toBe(3);
  });

  it('passes the brand to the preview, never ours', () => {
    expect(model.look).toMatchObject({
      name: 'Nova',
      background: '#0B1020',
      primary: '#7C9CFF',
      radius: 12,
      displayFont: 'Sora',
      bodyFont: 'Inter',
    });
  });
});

describe('the customer’s fonts', () => {
  it('load from Google Fonts by name, one stylesheet per face', () => {
    expect(brandFontsHrefs({ displayFont: 'Sora', bodyFont: 'Inter' })).toEqual([
      'https://fonts.googleapis.com/css2?family=Sora:wght@700&display=swap',
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap',
    ]);
    expect(brandFontsHrefs({ displayFont: 'Open Sans', bodyFont: 'Open Sans' })).toEqual([
      'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap',
    ]);
  });

  it('fall back to a neutral system face, never one of ours', () => {
    expect(fontStack('Sora')).toBe(`'Sora', ${BRAND_FALLBACK_STACK}`);
    expect(fontStack("Evil'; } body { x")).toBe(`'Evil  body  x', ${BRAND_FALLBACK_STACK}`);
    expect(BRAND_FALLBACK_STACK).not.toContain('--br-');
  });
});

describe('where the script is', () => {
  it('is the founder’s to decide while the run waits at approval', () => {
    const model = buildReviewModel(detail());
    expect(model.state).toBe('waiting');
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
  });

  it('is being rewritten from the founder’s note', () => {
    const model = buildReviewModel(
      detail(
        { status: 'working', stage: 'script' },
        { approvals: [sendBack(1, 'Say teams, not customers.')] },
      ),
    );
    expect(model.state).toBe('rewriting');
    expect(model.rewriteNote).toBe('Say teams, not customers.');
  });

  it('waits again once version 2 is ready, after a send back on version 1', () => {
    const model = buildReviewModel(
      detail({ scriptVersion: 2 }, { approvals: [sendBack(1, 'Shorter.')] }),
    );
    expect(model.state).toBe('waiting');
    expect(model.rewriteNote).toBeNull();
  });

  it('is approved, with the founder’s choices and confirmations, once they approve', () => {
    const model = buildReviewModel(
      detail(
        {
          status: 'working',
          stage: 'motion',
          chosenHook: 'open-question',
          chosenCta: 'book-demo',
          formats: ['16:9', '1:1'],
        },
        { approvals: [approval()] },
      ),
    );
    expect(model.state).toBe('approved');
    expect(model.approved).toEqual({
      hookId: 'open-question',
      ctaId: 'book-demo',
      formats: ['16:9', '1:1'],
      confirmedClaimIds: ['pricing'],
    });
    expect(model.claims.find((claim) => claim.id === 'pricing')?.confirmedByYou).toBe(true);
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

  it('names the scenes a claim is in', () => {
    expect(usedIn([])).toBe('Not in the video');
    expect(usedIn([2])).toBe('In scene 2');
    expect(usedIn([2, 3, 4])).toBe('In scenes 2, 3 and 4');
  });
});

/** Text as a reader sees it: tags gone, entities decoded. */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

function render(model: ReviewModel, banner = false) {
  const html = renderToStaticMarkup(createElement(ScriptReview, { model, banner }));
  return { html, text: plain(html) };
}

/** Each scene card in the script, in order: its heading (null without one) and its text. */
function sceneCards(html: string) {
  const start = html.indexOf('aria-label="The script"');
  const list = html.slice(start, html.indexOf('</ol>', start));
  return list
    .split('<li class="card scene-card')
    .slice(1)
    .map((card) => {
      const heading = /<h3>(.*?)<\/h3>/s.exec(card)?.[1];
      return {
        html: card,
        text: plain(card),
        heading: heading === undefined ? null : plain(heading),
      };
    });
}

/** The heading a scene's card should lead with: its headline, else its first line. */
function expectedHeading(scene: Scene): string | null {
  const lead = scene.text.find((item) => item.role === 'headline') ?? scene.text[0];
  if (!lead) return null;
  return lead.role === 'cta' ? `Button ${lead.value}` : lead.value;
}

/**
 * Every scene card shows all of its scene's words, led by the right line, its voiceover, and the
 * quote and source of every claim it cites.
 */
function expectWholeScript(campaign: Campaign, html: string) {
  const cards = sceneCards(html);
  expect(cards).toHaveLength(campaign.scenes.length);
  const claims = new Map(campaign.claims.map((claim) => [claim.id, claim]));
  campaign.scenes.forEach((scene, index) => {
    const card = cards[index];
    expect(card?.heading, `scene ${scene.id} (${scene.type})`).toBe(expectedHeading(scene));
    for (const item of scene.text) expect(card?.text).toContain(item.value);
    if (scene.voiceover) expect(card?.text).toContain(scene.voiceover.text);
    const cited = new Set([
      ...scene.text.flatMap((item) => item.claimIds),
      ...(scene.voiceover?.claimIds ?? []),
    ]);
    for (const id of cited) {
      const claim = claims.get(id);
      expect(claim, `claim ${id} in scene ${scene.id}`).toBeDefined();
      expect(card?.text).toContain(claim?.quote);
      expect(card?.html).toContain(`href="${claim?.sourceUrl}"`);
    }
  });
}

describe('the script review screen', () => {
  it('shows the whole script: every scene’s words, voiceover and sources', () => {
    const { html } = render(buildReviewModel(detail()));
    expectWholeScript(NOVA, html);
    expect(sceneCards(html).map((card) => card.heading)).toEqual([
      'Your builds are waiting.',
      '40% faster builds',
      'nova.example.com/product',
      'Button Start free',
    ]);
    // Links to customer pages open apart from the app, without handing it the opener.
    expect(html).toContain('rel="noopener noreferrer"');
    expect((html.match(/class="card scene-card/g) ?? []).length).toBe(4);
  });

  it('shows no developer detail: no JSON, no template chips, no counters, no timeline', () => {
    const { html, text } = render(buildReviewModel(detail()));
    expect(text).not.toContain('campaign.json');
    expect(text).not.toMatch(/Template ·|Align ·|Out ·/);
    expect(text).not.toContain('24 / 60');
    expect(html).not.toContain('class="timeline"');
  });

  it('labels the shape and opening toggles as preview only', () => {
    const { html, text } = render(buildReviewModel(detail()));
    expect(text).toContain('Preview as');
    expect(html).toContain('aria-label="Preview as: shape"');
    expect(html).toContain('aria-label="Preview as: opening"');
  });

  it('shows the other opening and both calls to action in the script, before the dialog', () => {
    const { html, text } = render(buildReviewModel(detail()));
    const script = html.slice(html.indexOf('aria-label="The script"'), html.indexOf('<dialog'));
    expect(script).toContain('Still waiting on CI?');
    expect(script).toContain('Start free');
    expect(script).toContain('Book a demo');
    expect(text).toContain('Approve and start');
  });

  it('offers one approve and one ask-for-changes, after the script', () => {
    const { html, text } = render(buildReviewModel(detail()));
    expect((text.match(/Approve script/g) ?? []).length).toBe(1);
    expect(text).not.toContain('Request changes');
    expect(text).not.toContain('Send to the Director');
    // The decision comes after the last scene.
    const lastScene = html.lastIndexOf('class="card scene-card');
    expect(lastScene).toBeGreaterThan(-1);
    expect(html.indexOf('aria-label="Your decision"')).toBeGreaterThan(lastScene);
    expect(html).toContain('class="card changes-dialog"');
  });

  it('asks the founder to confirm the unchecked number, in pink, with yes and remove', () => {
    const { html, text } = render(buildReviewModel(detail()));
    expect(text).toContain('One number to confirm');
    expect(text).toContain('Scene 4 says "Plans start at $29 per seat. Start free today."');
    expect(text).toContain('Yes, $29 is right');
    expect(text).toContain('Remove it');
    expect(html).toContain('card confirm confirm-needs');
    // The dialog holds Approve until it is confirmed.
    expect(text).toContain('One number still needs you.');
    expect(html).toMatch(/<button class="btn btn-primary" type="submit" disabled="">/);
  });

  it('uses round single-choice radios for the opening and call to action', () => {
    const { html } = render(buildReviewModel(detail()));
    expect((html.match(/class="radio"/g) ?? []).length).toBe(4);
    expect(html).toContain(
      'Once it&#x27;s delivered, you can still ask for changes up to 3 times.',
    );
  });

  it('labels a simulated film once, unless the app banner already does', () => {
    expect(render(buildReviewModel(detail())).text).toContain('Simulated');
    expect(render(buildReviewModel(detail()), true).text).not.toContain('Simulated');
    expect(render(buildReviewModel(detail())).text).toContain(
      "Preview · Nova's brand · not rendered yet",
    );
  });

  it('shows no simulated label on a real film', () => {
    const { text } = render(buildReviewModel(detail({ simulated: false, pipeline: 'naive' })));
    expect(text).not.toContain('Simulated');
  });

  it('offers no decision once the script is approved, and names what was confirmed', () => {
    const { text } = render(
      buildReviewModel(
        detail(
          { status: 'working', stage: 'motion', formats: ['16:9'], chosenCta: 'start-free' },
          { approvals: [approval()] },
        ),
      ),
    );
    expect(text).not.toContain('Approve script');
    expect(text).not.toContain('Ask for changes');
    expect(text).toContain('You approved version 1.');
    expect(text).toContain('You confirmed: Plans start at $29 per seat.');
    expect(text).toContain('Back to the video');
  });
});

describe('every scene type in the motion library', () => {
  // One scene per type in the registry, with a line for each role its spec in docs/motion/scenes
  // gives it. The roles go in reverse, so a headline is never listed first and has to be moved up.
  const types = Object.entries(sceneRegistry);
  const scenes: Scene[] = types.map(([type, limits], index) => {
    const claim = NOVA.claims[index % NOVA.claims.length];
    const roles = Object.keys(limits.text ?? {}).reverse() as TextRole[];
    return {
      id: `${type}-scene`,
      type,
      start: index,
      end: index + 1,
      props: {},
      text: roles.map((role, at) => ({
        id: `${type}-${role}`,
        role,
        value: `${type} ${role}`,
        claimIds: at === roles.length - 1 && claim ? [claim.id] : [],
      })),
      voiceover: { text: `The ${type} voiceover.`, claimIds: claim ? [claim.id] : [] },
      assetIds: [],
    };
  });
  const campaign: Campaign = { ...NOVA, durationSeconds: scenes.length, scenes };
  const model = buildReviewModel(detail({}, { campaign }));

  it('covers all of them', () => {
    expect(types.length).toBe(15);
    expect(model.scenes).toHaveLength(types.length);
  });

  it('shows each scene’s words led by its headline, its voiceover and its sources', () => {
    const { html } = render(model);
    expectWholeScript(campaign, html);
    for (const scene of model.scenes) {
      const roles = new Set(scene.lines.map((line) => line.role));
      if (roles.has('headline')) expect(scene.lines[0]?.role).toBe('headline');
    }
    // A scene with no words, such as a tile wall, still shows its voiceover and source.
    const tiles = sceneCards(html)[types.findIndex(([type]) => type === 'tile-wall')];
    expect(tiles?.heading).toBeNull();
    expect(tiles?.text).toContain('The tile-wall voiceover.');
  });
});

describe('every campaign in the schema’s examples', () => {
  const files = readdirSync(EXAMPLES).filter((file) => file.endsWith('.campaign.json'));

  it('includes the Nova sample the simulated films serve', () => {
    expect(files).toContain('nova.campaign.json');
  });

  it.each(files)('%s shows every scene’s words, voiceover and sources', (file) => {
    const campaign = campaignSchema.parse(
      JSON.parse(readFileSync(new URL(file, EXAMPLES), 'utf8')),
    );
    const model = buildReviewModel(detail({}, { campaign }));
    for (const [index, scene] of campaign.scenes.entries()) {
      expect(model.scenes[index]?.lines.map((line) => line.value).sort()).toEqual(
        scene.text.map((item) => item.value).sort(),
      );
    }
    const { html, text } = render(model);
    expectWholeScript(campaign, html);
    for (const hook of model.hooks) expect(text).toContain(hook.headline);
  });
});
