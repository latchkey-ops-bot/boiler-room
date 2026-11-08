import { describe, expect, it } from 'vitest';
import {
  brandNameGuess,
  buildTemplate,
  type CaptureManifest,
  guessBrandName,
  productUiNote,
} from '../src/capture/manifest.ts';
import { checkResearch } from '../src/researcher/gate.ts';
import type { MeasuredColor } from '../src/researcher/output.ts';
import { bundle, SITE } from './fixtures.ts';

const MEASURED: MeasuredColor[] = [
  {
    hex: '#FFFFFF',
    property: 'background-color',
    seen_as: 'surface',
    element: 'body',
    page_url: SITE,
    x: 60,
    y: 30,
    share: 1,
    tokens: ['background'],
  },
  {
    hex: '#111827',
    property: 'color',
    seen_as: 'text',
    element: 'p',
    page_url: SITE,
    x: 400,
    y: 320,
    share: null,
    tokens: ['foreground'],
  },
  {
    hex: '#4F46E5',
    property: 'background-color',
    seen_as: 'button',
    element: 'a.btn',
    page_url: SITE,
    x: 520,
    y: 410,
    share: null,
    tokens: ['primary'],
  },
  {
    hex: '#6B7280',
    property: 'color',
    seen_as: 'text',
    element: 'p.small',
    page_url: SITE,
    x: 400,
    y: 600,
    share: null,
    tokens: ['muted'],
  },
];

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
        measured: MEASURED,
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
        found_in: 'generated',
        why: 'no picture of a logo could be downloaded',
        file: 'logo.svg',
        url: null,
        kind: 'svg',
        width: 300,
        height: 96,
        aspect: 3.125,
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
      logo: { source: 'generated', found_in: 'generated', aspect: 3.125, url: null },
    });
  });

  it('copies the measured colours, each with the point it was read at', () => {
    expect(template.brand_details.measured).toEqual(MEASURED);
    const background = template.brand_details.measured.find((item) =>
      item.tokens.includes('background'),
    );
    expect(background).toMatchObject({ hex: template.brand.colors.background, seen_as: 'surface' });
  });

  it('asks for the real logo when the capture only found an icon or the social image', () => {
    for (const found_in of ['apple-touch-icon', 'og-image'] as const) {
      const iconOnly = manifest();
      iconOnly.brand.logo = {
        source: found_in === 'og-image' ? 'png' : 'favicon',
        found_in,
        file: 'logo.png',
        url: `${SITE}icon.png`,
        kind: 'image',
        width: 512,
        height: 512,
        aspect: 1,
      };
      const need = buildTemplate(iconOnly).needs_upload.find((item) => item.id === 'logo');
      expect(need).toMatchObject({ kind: 'logo', blocking: false });
    }
    const header = manifest();
    header.brand.logo = {
      ...header.brand.logo,
      source: 'inline-svg',
      found_in: 'header-home-link',
    };
    expect(buildTemplate(header).needs_upload.some((item) => item.id === 'logo')).toBe(false);
  });

  it('records where an older capture found its logo when the manifest does not say', () => {
    const older = manifest();
    older.brand.logo = {
      source: 'svg',
      file: 'logo.svg',
      url: 'https://orbitly.example.org/logo.svg',
      kind: 'svg',
      width: 120,
      height: 30,
    };
    expect(buildTemplate(older).evidence.logo).toMatchObject({ found_in: 'header', aspect: 4 });
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
    filled.brief.one_liner = {
      text: 'Orbitly plans social posts.',
      claim_ids: ['plan-speed'],
    };
    filled.brief.what_it_is = { text: 'Social scheduling.', claim_ids: ['plan-speed'] };
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
    // The capture writes the same measured colours into the bundle it publishes.
    const { failures } = await checkResearch(filled, { ...bundle(), measured_colors: MEASURED });
    expect(failures).toEqual([]);
  });
});

describe('guessBrandName', () => {
  it.each([
    [{ 'og:site_name': 'Orbitly' }, 'Anything at all', 'orbitly.example.org', '', 'Orbitly'],
    [{}, 'Orbitly | Social scheduling for teams', 'orbitly.example.org', '', 'Orbitly'],
    [{}, 'Social scheduling for teams - Orbitly', 'www.orbitly.example.org', '', 'Orbitly'],
    [{}, 'Example Domain', 'example.com', '', 'Example Domain'],
    // danluu.com: its about page is titled "About danluu.com", and the site writes its name so.
    [{}, 'About danluu.com', 'danluu.com', '', 'danluu.com'],
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
    expect(brandNameGuess({}, '', 'zq.example', '', 'About zq.example, the blog')).toEqual({
      name: 'zq.example',
      source: 'text',
    });
  });
});

// allbirds.com: the brief said "No login, demo or sign-in page was found", but the home page has
// no sign-in link and sign-in pages are never loaded, so the capture could not know.
describe('productUiNote', () => {
  it('says what was probed and which sign-in links were seen, and nothing it did not check', () => {
    const probes = [
      {
        path: '/demo',
        url: `${SITE}demo`,
        status: 200,
        final_url: `${SITE}demo/team/eng`,
        content_type: 'text/html',
        title: 'Engineering',
        length: 900,
        found: true,
        reason: 'rendered in a browser: HTTP 200',
        rendered: true,
      },
      {
        path: '/tour',
        url: `${SITE}tour`,
        status: 404,
        final_url: null,
        content_type: null,
        title: '',
        length: 0,
        found: false,
        reason: 'HTTP 404',
      },
    ];
    const linked = productUiNote(
      manifest({
        probes,
        login_links: [
          { url: 'https://app.orbitly.example.org/login', text: 'Log in', where: 'nav' },
        ],
      }),
    );
    expect(linked).toBe(
      `Probed /demo found at ${SITE}demo/team/eng, /tour not found, judged on the page a browser rendered where the server answers every path alike. The home page links to sign-in or app pages: Log in (https://app.orbitly.example.org/login). Sign-in pages are never loaded, so nothing behind them was seen.`,
    );
    const none = productUiNote(manifest({ probes: probes.slice(1), login_links: [] }));
    expect(none).toContain('whether the product has one was not checked');
    expect(none).not.toMatch(/no (login|sign-in) (page )?(was|is) found/i);
  });
});
