import type { Asset, Campaign, Scene } from '@boiler-room/schema';

/** A made-up product, so no art test depends on a real company. */
export const SITE = 'https://orbitly.example.org';

const capture = (id: string, path: string): [string, Asset] => [
  id,
  {
    kind: 'image',
    src: `naive://files/fil_${id.replace(/-/g, '')}`,
    provenance: 'captured',
    width: 1920,
    height: 1080,
    sourceUrl: `${SITE}${path}`,
  },
];

/** File digests: `home-ui-1` is byte for byte `home-screen`, as a capture with no crop gives. */
export const DIGESTS = new Map([
  ['home-screen', 'aaa'],
  ['home-ui-1', 'aaa'],
  ['features-screen', 'bbb'],
  ['features-ui-1', 'ccc'],
  ['features-ui-2', 'ddd'],
  ['pricing-screen', 'eee'],
  ['docs-screen', 'fff'],
  ['about-screen', 'ggg'],
]);

let from = 0;
function scene(
  id: string,
  type: string,
  frames: number,
  text: Scene['text'],
  extra: Partial<Scene> = {},
): Scene {
  const start = Math.round((from / 30) * 1e6) / 1e6;
  from += frames;
  return {
    id,
    type,
    start,
    end: Math.round((from / 30) * 1e6) / 1e6,
    props: {},
    text,
    assetIds: [],
    transitionOut: 't3',
    ...extra,
  };
}

const line = (
  id: string,
  role: Scene['text'][number]['role'],
  value: string,
  claims: string[],
) => ({
  id,
  role,
  value,
  claimIds: claims,
});

/** A valid campaign with every kind of asset slot: hero, scroll, two feature cards, event, set piece. */
export function artCampaign(colors: Partial<Campaign['brand']['colors']> = {}): Campaign {
  from = 0;
  const scenes = [
    scene('hook', 'word-slam', 90, [line('headline', 'headline', 'Plan posts', ['plan'])]),
    scene('logo', 'logo-reveal', 90, [], { assetIds: ['logo'] }),
    // The Director chose the duplicate of the home page top.
    scene('hero', 'site-hero', 96, [line('label', 'label', 'orbitly.example.org', [])], {
      assetIds: ['home-ui-1'],
    }),
    scene('scroll', 'site-scroll', 72, [line('label', 'label', 'Every plan', ['plan'])]),
    scene('calendar', 'feature-card', 72, [
      line('headline', 'headline', 'A calendar for every post', ['calendar']),
    ]),
    scene('queue', 'feature-card', 72, [
      line('headline', 'headline', 'A queue that fills itself', ['calendar']),
    ]),
    scene('team', 'feature-card', 72, [
      line('headline', 'headline', 'Made for small teams', ['team']),
    ]),
    scene('event', 'colour-event', 42, [line('headline', 'headline', 'Post less', ['plan'])]),
    scene('chain', 'iso-chain', 108, [line('headline', 'headline', 'Draft, plan, post', ['plan'])]),
    scene('end', 'end-card', 113, [line('cta', 'cta', 'Start free trial', [])], {
      transitionOut: undefined,
    }),
  ];
  const duration = Math.round((from / 30) * 1e6) / 1e6;
  return {
    schemaVersion: 1,
    id: 'orbitly-test',
    sourceUrl: `${SITE}/`,
    fps: 30,
    durationSeconds: duration,
    brand: {
      name: 'Orbitly',
      colors: {
        background: '#FFFFFF',
        foreground: '#111111',
        primary: '#5850EC',
        muted: '#6B7280',
        ...colors,
      },
      fonts: {
        display: { family: 'Inter', source: 'https://fonts.gstatic.com/s/inter/v20/x.woff2' },
        body: { family: 'Inter', source: 'https://fonts.gstatic.com/s/inter/v20/x.woff2' },
      },
      logoAssetId: 'logo',
    },
    assets: Object.fromEntries([
      ['logo', { kind: 'svg', src: 'naive://files/fil_logo', provenance: 'captured' }],
      capture('home-screen', '/'),
      capture('home-ui-1', '/'),
      capture('features-screen', '/features'),
      capture('features-ui-1', '/features'),
      capture('features-ui-2', '/features'),
      capture('pricing-screen', '/pricing'),
      capture('docs-screen', '/docs'),
      capture('about-screen', '/about'),
    ]),
    claims: [
      {
        id: 'plan',
        text: 'Orbitly plans social posts',
        sourceUrl: `${SITE}/`,
        quote: 'Orbitly plans a month of social posts.',
        status: 'extracted',
      },
      {
        id: 'calendar',
        text: 'A calendar for posts',
        sourceUrl: `${SITE}/features`,
        quote: 'One calendar for every channel.',
        status: 'extracted',
      },
      {
        id: 'team',
        text: 'Made for small teams',
        sourceUrl: `${SITE}/about`,
        quote: 'We build for small teams.',
        status: 'extracted',
      },
    ],
    scenes,
    variants: { hooks: [], formats: ['16:9'], ctas: [] },
  };
}
