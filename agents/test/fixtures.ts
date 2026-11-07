import type { ResearchOutput } from '../src/researcher/output.ts';
import type { PagesBundle, StoredPage } from '../src/researcher/verify.ts';

/** A made-up product, so no test depends on a real company. */
export const SITE = 'https://orbitly.example.org/';

function page(
  path: string,
  text: Partial<StoredPage['text']> & { rendered: string },
  title = path,
): StoredPage {
  const url = new URL(path, SITE).href;
  const dom = text.dom ?? text.rendered;
  return {
    url,
    final_url: url,
    origin: 'site',
    file_id: null,
    status: 200,
    content_type: 'text/html; charset=utf-8',
    title,
    text: {
      rendered: text.rendered,
      dom,
      meta: text.meta ?? '',
      clean: text.clean ?? dom,
      illustrative: text.illustrative ?? '',
    },
  };
}

const HOME_RENDERED = [
  'Orbitly',
  'Pricing Docs About',
  'Schedule posts\nwithout the spreadsheet',
  'Orbitly plans a month of social posts in 10 minutes.',
  'Start free trial',
  'Followers this week: 12,480',
  'Trusted by 3,200 small teams.',
].join('\n');

export function bundle(): PagesBundle {
  return {
    version: 1,
    site: SITE,
    captured_at: '2026-11-07T00:00:00.000Z',
    pages: [
      page(
        '/',
        {
          rendered: HOME_RENDERED,
          dom: `${HOME_RENDERED.replace(/\n/g, ' ')} Is there a free plan? Yes, the Solo plan is free for one account.`,
          clean: `${HOME_RENDERED.replace('Followers this week: 12,480', '').replace(/\n/g, ' ')} Is there a free plan? Yes, the Solo plan is free for one account.`,
          illustrative: 'Followers this week: 12,480',
          meta: 'Orbitly | Social scheduling\nOrbitly helps small teams plan social posts.',
        },
        'Orbitly | Social scheduling',
      ),
      page(
        '/pricing/',
        {
          rendered: 'Pricing\nSolo\n$0 per month\nTeam\n$24 per month, billed yearly\nChoose Team',
        },
        'Pricing | Orbitly',
      ),
      {
        ...page('/x', { rendered: 'Orbitly reached 99.9% uptime in 2025.' }),
        url: 'https://api.vetta.sh/v1/files/fil_material1',
        final_url: 'https://api.vetta.sh/v1/files/fil_material1',
        origin: 'material',
        file_id: 'fil_material1',
        title: 'm01-onepager.pdf',
      },
    ],
  };
}

export function output(): ResearchOutput {
  return {
    brand: {
      name: 'Orbitly',
      colors: {
        background: '#FFFFFF',
        foreground: '#111827',
        primary: '#4F46E5',
        accent: '#F59E0B',
      },
      fonts: {
        display: { family: 'Inter', source: 'https://fonts.gstatic.com/s/inter/v20/display.woff2' },
        body: { family: 'Inter', source: 'https://fonts.gstatic.com/s/inter/v20/body.woff2' },
      },
      logoAssetId: 'logo',
      radius: 8,
    },
    assets: {
      logo: {
        kind: 'svg',
        src: 'naive://files/fil_logo1',
        provenance: 'captured',
        sourceUrl: SITE,
      },
      'home-screen': {
        kind: 'image',
        src: 'naive://files/fil_home1',
        provenance: 'captured',
        width: 1920,
        height: 1080,
        sourceUrl: SITE,
      },
    },
    claims: [
      {
        id: 'home-headline',
        text: 'Orbitly schedules posts without a spreadsheet',
        sourceUrl: SITE,
        quote: 'Schedule posts without the spreadsheet',
        status: 'extracted',
      },
      {
        id: 'plan-speed',
        text: 'A month of posts is planned in 10 minutes',
        sourceUrl: SITE,
        quote: 'Orbitly plans a month of social posts in 10 minutes.',
        status: 'extracted',
      },
      {
        id: 'team-price',
        text: 'The Team plan costs $24 a month billed yearly',
        sourceUrl: 'https://orbitly.example.org/pricing',
        quote: '$24 per month, billed yearly',
        status: 'extracted',
      },
      {
        id: 'free-plan',
        text: 'The Solo plan is free',
        sourceUrl: SITE,
        quote: 'Yes, the Solo plan is free for one account.',
        status: 'extracted',
      },
    ],
    brand_details: {
      mode: 'light',
      accents: ['#F59E0B'],
      fonts: [
        {
          role: 'body',
          family: 'Inter',
          method: 'google-fonts',
          url: 'https://fonts.gstatic.com/s/inter/v20/body.woff2',
        },
      ],
      radius_px: 8,
      css_variables: true,
      notes: [],
    },
    brief: {
      product_name: 'Orbitly',
      one_liner: 'Orbitly plans social media posts for small teams.',
      what_it_is: 'A social media scheduler.',
      audiences: [{ who: 'Small teams', claim_ids: [] }],
      features: [
        {
          name: 'Planning',
          what_it_does: 'Plans a month of posts in 10 minutes',
          claim_ids: ['plan-speed'],
        },
      ],
      pricing: {
        summary: 'A free Solo plan and a paid Team plan',
        free_trial: 'Start free trial',
        plans: [
          { name: 'Solo', price: 'Free', claim_ids: ['free-plan'] },
          { name: 'Team', price: '$24 per month', claim_ids: ['team-price'] },
        ],
        claim_ids: [],
      },
      ctas: [
        {
          label: 'Start free trial',
          href: 'https://orbitly.example.org/signup',
          source_url: SITE,
          placement: 'hero',
        },
      ],
      headline_claim_id: 'home-headline',
      positioning_note: null,
      non_claims: [
        {
          text: 'Followers this week: 12,480',
          source_url: SITE,
          reason: 'Sample figure in a product mockup.',
        },
      ],
      conflicts: [],
      pages: [
        {
          url: SITE,
          kind: 'home',
          title: 'Orbitly | Social scheduling',
          screenshot_asset_id: 'home-screen',
        },
      ],
      product_ui: {
        status: 'mock-only',
        notes: 'Only an HTML mockup with sample data.',
        asset_ids: [],
      },
    },
    needs_upload: [
      {
        id: 'product-ui',
        kind: 'product-ui',
        what: 'Screens of the real product.',
        why: 'The film should show the product.',
        request: 'Please send 3 to 6 screenshots.',
        blocking: false,
        evidence_url: null,
      },
    ],
    evidence: {
      pages_file_id: 'fil_pages1',
      capture_file_id: 'fil_capture1',
      logo: { asset_id: 'logo', source: 'svg', url: 'https://orbitly.example.org/logo.svg' },
      material: [],
    },
  };
}
