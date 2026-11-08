import { describe, expect, it } from 'vitest';
import {
  brandNameGuess,
  buildTemplate,
  type CaptureManifest,
  guessBrandName,
} from '../src/capture/manifest.ts';
import { checkResearch } from '../src/researcher/gate.ts';
import { bundle, SITE } from './fixtures.ts';

function manifest(overrides: Partial<CaptureManifest> = {}): CaptureManifest {
  return {
    version: 1,
    site: SITE,
    host: 'orbitly.example.org',
    captured_at: '2026-11-07T00:00:00.000Z',
    pages: [
      {
        url: SITE,
        final_url: SITE,
        slug: 'home',
        kind: 'home',
        status: 200,
        content_type: 'text/html',
        title: 'Orbitly | Social scheduling',
        text_file: '/home/tenki/br/out/orbitly.example.org/text/home.txt',
        shots: [
          {
            file: 'shots/home.png',
            assetId: 'home-screen',
            kind: 'page',
            label: 'Top',
            mock: false,
            ui: [],
            width: 1920,
            height: 1080,
            sourceUrl: SITE,
          },
          {
            file: 'shots/home-ui-1.png',
            assetId: 'home-ui-1',
            kind: 'ui',
            label: 'frame mockup',
            mock: true,
            ui: [{ label: 'frame mockup', mock: true }],
            width: 1920,
            height: 1080,
            sourceUrl: SITE,
          },
        ],
        ctas: [
          {
            text: 'Start free trial',
            href: 'https://orbitly.example.org/signup',
            placement: 'hero',
            background: { hex: '#4F46E5', alpha: 1 },
            color: { hex: '#FFFFFF', alpha: 1 },
            border: null,
            radius: 8,
            pill: false,
            area: 5000,
          },
          {
            text: 'Start free trial',
            href: 'https://orbitly.example.org/signup',
            placement: 'body',
            background: null,
            color: { hex: '#4F46E5', alpha: 1 },
            border: null,
            radius: 8,
            pill: false,
            area: 5000,
          },
          {
            text: 'Privacy',
            href: 'https://orbitly.example.org/privacy',
            placement: 'footer',
            background: null,
            color: { hex: '#111827', alpha: 1 },
            border: null,
            radius: 0,
            pill: false,
            area: 500,
          },
        ],
        ui: [],
        hidden_overlays: 1,
        error: null,
      },
    ],
    skipped: [],
    probes: [],
    llms_txt: false,
    brand: {
      name: 'Orbitly',
      colors: {
        background: '#FFFFFF',
        foreground: '#111827',
        primary: '#4F46E5',
        accent: null,
        muted: '#6B7280',
        accents: [],
        mode: 'light',
        radius: 8,
        cssVariables: false,
        candidates: [],
        notes: [],
      },
      fonts: [
        {
          role: 'display',
          family: 'Inter',
          weight: 700,
          method: 'substitute',
          url: 'https://fonts.gstatic.com/s/inter/v20/a.woff2',
          siteFamily: '-apple-system, sans-serif',
        },
        {
          role: 'body',
          family: 'Inter',
          weight: 400,
          method: 'substitute',
          url: 'https://fonts.gstatic.com/s/inter/v20/b.woff2',
          siteFamily: '-apple-system, sans-serif',
        },
      ],
      logo: {
        source: 'generated',
        file: 'logo.svg',
        url: null,
        kind: 'svg',
        width: 300,
        height: 96,
      },
    },
    login_links: [{ url: 'https://app.orbitly.example.org/login', text: 'Log in', where: 'nav' }],
    media: [],
    material: [],
    publish: [],
    errors: [],
    ...overrides,
  };
}

describe('buildTemplate', () => {
  const template = buildTemplate(manifest());

  it('fills in everything code measured, with placeholders for file ids', () => {
    expect(template.brand).toEqual({
      name: 'Orbitly',
      colors: {
        background: '#FFFFFF',
        foreground: '#111827',
        primary: '#4F46E5',
        muted: '#6B7280',
      },
      fonts: {
        display: { family: 'Inter', source: 'https://fonts.gstatic.com/s/inter/v20/a.woff2' },
        body: { family: 'Inter', source: 'https://fonts.gstatic.com/s/inter/v20/b.woff2' },
      },
      logoAssetId: 'logo',
      radius: 8,
    });
    expect(template.assets.logo).toMatchObject({
      kind: 'svg',
      provenance: 'generated',
      src: 'naive://files/PUBLISH:logo.svg',
    });
    expect(template.assets['home-ui-1']).toMatchObject({
      kind: 'image',
      src: 'naive://files/PUBLISH:shots/home-ui-1.png',
      width: 1920,
    });
    expect(template.evidence).toMatchObject({
      pages_file_id: 'PUBLISH:pages.json',
      logo: { source: 'generated', url: null },
    });
  });

  it('keeps each call to action once, verbatim, and leaves out the footer', () => {
    expect(template.brief.ctas).toEqual([
      {
        label: 'Start free trial',
        href: 'https://orbitly.example.org/signup',
        source_url: SITE,
        placement: 'hero',
      },
    ]);
  });

  it('proposes what to ask the customer for', () => {
    expect(template.brief.product_ui.status).toBe('mock-only');
    expect(template.needs_upload.map((need) => [need.id, need.blocking])).toEqual([
      ['logo', false],
      ['brand-fonts', false],
      ['product-ui', false],
    ]);
  });

  // Only code text was a stand-in, and the request claimed the whole site used device fonts.
  it('asks for fonts only when headings or body text use a stand-in, and says why', () => {
    const monoOnly = manifest();
    monoOnly.brand.fonts = [
      {
        role: 'display',
        family: 'Brand Sans',
        weight: 700,
        method: 'self-hosted',
        url: 'https://orbitly.example.org/_next/static/media/brand.woff2',
        siteFamily: null,
      },
      {
        role: 'mono',
        family: 'JetBrains Mono',
        weight: 400,
        method: 'substitute',
        url: 'https://fonts.gstatic.com/s/jbm.woff2',
        siteFamily: 'ui-monospace, Menlo, monospace',
        reason: 'system',
      },
    ];
    expect(buildTemplate(monoOnly).needs_upload.map((need) => need.id)).not.toContain(
      'brand-fonts',
    );

    const broken = manifest();
    broken.brand.fonts = [
      {
        role: 'display',
        family: 'Inter',
        weight: 700,
        method: 'substitute',
        url: 'https://fonts.gstatic.com/s/inter/v20/a.woff2',
        siteFamily: 'Brand Sans',
        reason: 'unreachable',
        failed: { url: 'https://orbitly.example.org/media/brand.woff2', status: 404 },
      },
    ];
    const need = buildTemplate(broken).needs_upload.find((item) => item.id === 'brand-fonts');
    expect(need?.what).toContain('could not be downloaded (HTTP 404)');
    expect(need?.what).not.toContain('device');
    expect(need?.request).toContain('font files');
  });

  // Product UI listed a video of a person on the about page and customer logo cards, which a film
  // template trusting the list would show as product shots.
  it('lists as product UI only shots of the product, never video or pictures of people', () => {
    const mixed = manifest();
    const shot = (
      assetId: string,
      ui: CaptureManifest['pages'][number]['shots'][number]['ui'],
    ) => ({
      file: `shots/${assetId}.png`,
      assetId,
      kind: 'ui' as const,
      label: assetId,
      mock: false,
      ui,
      width: 1920,
      height: 1080,
      sourceUrl: SITE,
    });
    const home = mixed.pages[0];
    if (!home) throw new Error('fixture page missing');
    home.shots = [
      shot('home-ui-1', [{ label: 'img: app screenshot', mock: false, grade: 'product' }]),
      shot('home-ui-2', [{ label: 'video', mock: false, grade: 'media' }]),
    ];
    mixed.pages.push({
      ...home,
      url: `${SITE}about`,
      final_url: `${SITE}about`,
      slug: 'about',
      kind: 'about',
      shots: [shot('about-ui-1', [{ label: 'img', mock: false, grade: 'image' }])],
    });
    const template = buildTemplate(mixed);
    expect(template.brief.product_ui).toMatchObject({ status: 'public', asset_ids: ['home-ui-1'] });
  });

  it('proposes only drawn buttons as calls to action, and none from docs pages', () => {
    const navs = manifest();
    const home = navs.pages[0];
    if (!home) throw new Error('fixture page missing');
    const button = home.ctas[0];
    if (!button) throw new Error('fixture cta missing');
    home.ctas = [
      { ...button, text: 'Menu', href: `${SITE}menu`, background: null, border: null },
      button,
    ];
    navs.pages.push({
      ...home,
      url: `${SITE}docs`,
      final_url: `${SITE}docs`,
      slug: 'docs',
      kind: 'docs',
      ctas: [{ ...button, text: 'Start Guide', href: `${SITE}docs/start` }],
    });
    expect(buildTemplate(navs).brief.ctas.map((cta) => cta.label)).toEqual(['Start free trial']);
  });

  it('asks for product UI behind a login as a blocking request', () => {
    const noUi = manifest();
    const home = noUi.pages[0];
    if (!home) throw new Error('fixture page missing');
    home.shots = home.shots.filter((shot) => shot.kind === 'page');
    const need = buildTemplate(noUi).needs_upload.find((item) => item.id === 'product-ui');
    expect(need).toMatchObject({
      blocking: true,
      evidence_url: 'https://app.orbitly.example.org/login',
    });
  });

  it('passes the gate once the agent fills it in', async () => {
    const filled = structuredClone(template);
    const ids = new Map([
      ['logo', 'fil_logo1'],
      ['home-screen', 'fil_home1'],
      ['home-ui-1', 'fil_ui1'],
    ]);
    for (const [id, asset] of Object.entries(filled.assets))
      asset.src = `naive://files/${ids.get(id)}`;
    filled.evidence.pages_file_id = 'fil_pages1';
    filled.evidence.capture_file_id = 'fil_capture1';
    filled.brief.one_liner = 'Orbitly plans social media posts for small teams.';
    filled.brief.what_it_is = 'A social media scheduler.';
    filled.brief.product_ui.notes = 'Only an HTML mockup with sample data.';
    filled.claims = [
      {
        id: 'plan-speed',
        text: 'Plans a month in 10 minutes',
        sourceUrl: SITE,
        quote: 'Orbitly plans a month of social posts in 10 minutes.',
        status: 'extracted',
      },
    ];
    const { failures } = await checkResearch(filled, bundle());
    expect(failures).toEqual([]);
  });
});

describe('guessBrandName', () => {
  it.each([
    [{ 'og:site_name': 'Orbitly' }, 'Anything at all', 'orbitly.example.org', '', 'Orbitly'],
    [{}, 'Orbitly | Social scheduling for teams', 'orbitly.example.org', '', 'Orbitly'],
    [{}, 'Social scheduling for teams - Orbitly', 'www.orbitly.example.org', '', 'Orbitly'],
    [{}, 'Example Domain', 'example.com', '', 'Example Domain'],
    [
      {},
      'Welcome to the best scheduling tool for every team on the planet',
      'zq.example',
      'Acme logo',
      'Acme',
    ],
  ])('%j %s %s', (meta, title, host, alt, expected) => {
    expect(guessBrandName(meta, title, host, alt)).toBe(expected);
  });

  // A site with no title and no site name was called "Danluu"-style, capitalised from its domain,
  // although it only ever writes its name in lower case.
  it('never recases a name taken from the domain, and says where it came from', () => {
    expect(brandNameGuess({}, '', 'zq.example')).toEqual({ name: 'zq', source: 'domain' });
    expect(brandNameGuess({}, '', 'www.zq.example', '', 'Posts by ZQ, since 2013.')).toEqual({
      name: 'ZQ',
      source: 'text',
    });
    expect(brandNameGuess({}, '', 'zq.example', '', 'The zqx project').source).toBe('domain');
  });
});
