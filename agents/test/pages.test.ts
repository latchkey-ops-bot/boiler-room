import { describe, expect, it } from 'vitest';
import {
  type CandidateLink,
  classifyLink,
  duplicateOf,
  judgeProbe,
  MAX_PAGES,
  needsRecapture,
  type ProbeResponse,
  parseRobots,
  robotsAllow,
  suggestPages,
} from '../src/capture/pages.ts';

const HOME = 'https://site.example.org/';

describe('classifyLink', () => {
  it.each([
    ['https://site.example.org/', '', 'home'],
    ['https://site.example.org/pricing', '', 'pricing'],
    ['https://site.example.org/plans/', 'Plans', 'pricing'],
    ['https://site.example.org/features/sync', '', 'product'],
    ['https://site.example.org/docs/', '', 'docs'],
    ['https://site.example.org/company', 'About', 'about'],
    ['https://site.example.org/how-it-works', '', 'demo'],
    ['https://site.example.org/site.example.org', 'View live demo', 'demo'],
    ['https://site.example.org/contact', 'Book a demo', 'contact'],
    ['https://site.example.org/contact/demo', '', 'contact'],
    ['https://site.example.org/demo', '', 'demo'],
    ['https://site.example.org/sales', 'Talk to sales', 'contact'],
    ['https://site.example.org/login', '', 'login'],
    ['https://app.site.example.org/', 'Open app', 'login'],
    ['https://site.example.org/x', 'Sign in', 'login'],
    ['https://site.example.org/privacy-policy', '', 'legal'],
    ['https://site.example.org/careers', '', 'careers'],
    ['https://site.example.org/blog/launch', '', 'blog'],
    ['https://site.example.org/team-retreat-2024', '', 'other'],
  ])('%s "%s" is %s', (url, text, kind) => {
    expect(classifyLink(url, text, HOME)).toBe(kind);
  });
});

describe('judgeProbe', () => {
  const ok = (overrides: Partial<ProbeResponse> = {}): ProbeResponse => ({
    status: 200,
    final_url: 'https://site.example.org/demo',
    content_type: 'text/html',
    title: 'Interactive demo',
    length: 5200,
    ...overrides,
  });
  const missing = ok({
    status: 404,
    title: 'Not found',
    length: 300,
    final_url: 'https://site.example.org/br-x',
  });
  const judge = (response: ProbeResponse, baseline: ProbeResponse | null = missing) =>
    judgeProbe('/demo', 'https://site.example.org/demo', response, baseline, HOME);

  it('finds a real page', () => {
    expect(judge(ok())).toMatchObject({ found: true, reason: 'HTTP 200' });
  });

  it('rejects an error status, a redirect home, a sign-in wall and an off-site redirect', () => {
    expect(judge(ok({ status: 404 })).found).toBe(false);
    expect(judge(ok({ final_url: HOME })).reason).toBe('redirects to the home page');
    expect(judge(ok({ final_url: 'https://site.example.org/login?next=/demo' })).reason).toContain(
      'sign-in',
    );
    expect(judge(ok({ final_url: 'https://other.example/demo' })).reason).toContain('off the site');
    expect(judge(ok({ final_url: 'https://site.example.org/talk-to-sales' })).reason).toContain(
      'contact or sales',
    );
    expect(judge(ok({ content_type: 'application/pdf' })).found).toBe(false);
  });

  it('rejects a soft 404 that answers 200 like a missing page does', () => {
    const shell = ok({ title: 'Site', length: 8425, final_url: 'https://site.example.org/x' });
    expect(judge(ok({ title: 'Site', length: 8500 }), shell)).toMatchObject({
      found: false,
      reason: expect.stringContaining('soft 404'),
    });
    expect(
      judgeProbe(
        '/demo',
        'https://site.example.org/demo',
        ok({ title: 'Site', length: 20000 }),
        shell,
        HOME,
        true,
      ).found,
    ).toBe(true);
  });

  // A site that serves its users' pages at /<username> answered /product with a private person's
  // booking page, which was captured and screenshotted as the product.
  it('rejects a page that is neither linked from the site nor named for what was probed', () => {
    const person = ok({
      final_url: 'https://site.example.org/product',
      title: 'Jane Roe | Site',
      heading: 'Jane Roe',
    });
    const probe = (response: ProbeResponse, linked = false) =>
      judgeProbe('/product', 'https://site.example.org/product', response, missing, HOME, linked);
    expect(probe(person)).toMatchObject({ found: false, reason: expect.stringContaining('user') });
    expect(probe(person, true).found).toBe(true);
    expect(
      probe(ok({ final_url: 'https://site.example.org/product', title: 'Product tour | Site' }))
        .found,
    ).toBe(true);
    expect(
      probe(
        ok({
          final_url: 'https://site.example.org/product',
          title: 'Site',
          heading: 'The product',
        }),
      ).found,
    ).toBe(true);
    expect(
      probe(ok({ final_url: 'https://site.example.org/product-analytics', title: 'Site' })).found,
    ).toBe(true);
    expect(
      judgeProbe(
        '/how-it-works',
        'https://site.example.org/how-it-works',
        ok({ final_url: 'https://site.example.org/how-it-works', title: 'How it works' }),
        missing,
        HOME,
      ).found,
    ).toBe(true);
  });
});

describe('duplicateOf', () => {
  const text = 'Schedule posts without the spreadsheet. '.repeat(10);
  const home = { finalUrl: 'https://site.example.org/', text };

  // One page served at / and at /homepage cost a page load and two identical screenshots.
  it('finds a second address of a page by its address after redirects or its visible text', () => {
    expect(duplicateOf({ finalUrl: 'https://site.example.org/homepage', text }, [home])).toBe(home);
    expect(duplicateOf({ finalUrl: 'https://site.example.org', text: 'other' }, [home])).toBe(home);
    expect(
      duplicateOf({ finalUrl: 'https://site.example.org/pricing', text: `${text} Pricing` }, [
        home,
      ]),
    ).toBeUndefined();
  });

  it('does not call two short or empty pages the same page', () => {
    expect(
      duplicateOf({ finalUrl: 'https://site.example.org/a', text: 'Hi' }, [
        { finalUrl: 'https://site.example.org/b', text: 'Hi' },
      ]),
    ).toBeUndefined();
  });
});

describe('needsRecapture', () => {
  it('marks a failed load and an HTML page that read no text, and nothing else', () => {
    const page = { error: null, status: 200, content_type: 'text/html', text_chars: 4000 };
    expect(needsRecapture(page)).toBe(false);
    expect(needsRecapture({ ...page, text_chars: 0 })).toBe(true);
    expect(
      needsRecapture({
        ...page,
        error: 'browser.newContext: Target page, context or browser has been closed',
      }),
    ).toBe(true);
    expect(needsRecapture({ ...page, status: 404, text_chars: 0 })).toBe(false);
  });
});

describe('robots.txt', () => {
  const robots = parseRobots(`
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /admin
Disallow: /*.pdf$
Allow: /admin/public
Crawl-delay: 2
`);

  it('reads the rules for every crawler only', () => {
    expect(robots).toEqual({
      disallow: ['/admin', '/*.pdf$'],
      allow: ['/admin/public'],
      delaySeconds: 2,
    });
  });

  it('lets the longest matching rule win', () => {
    expect(robotsAllow(robots, '/pricing')).toBe(true);
    expect(robotsAllow(robots, '/admin/users')).toBe(false);
    expect(robotsAllow(robots, '/admin/public/page')).toBe(true);
    expect(robotsAllow(robots, '/files/report.pdf')).toBe(false);
  });
});

describe('suggestPages', () => {
  const link = (path: string, text: string, where = 'nav'): CandidateLink => {
    const url = new URL(path, HOME).href;
    return { url, text, where, kind: classifyLink(url, text, HOME) };
  };

  it('chooses the pages a launch film needs, probes included, and never sign-in or legal pages', () => {
    const links = [
      link('/blog/post', 'Blog post', 'body'),
      link('/login', 'Log in'),
      link('/privacy', 'Privacy', 'footer'),
      link('/about', 'About', 'footer'),
      link('/docs', 'Docs'),
      link('/pricing', 'Pricing'),
      link('/features', 'Features'),
      link('/customers', 'Customers'),
      link('https://elsewhere.example/pricing', 'Partner'),
    ];
    const probes = [
      {
        path: '/tour',
        url: 'https://site.example.org/tour',
        status: 200,
        final_url: 'https://site.example.org/tour',
        content_type: 'text/html',
        title: 'Tour',
        length: 1,
        found: true,
        reason: 'HTTP 200',
      },
      {
        path: '/demo',
        url: 'https://site.example.org/demo',
        status: 404,
        final_url: null,
        content_type: null,
        title: '',
        length: 0,
        found: false,
        reason: 'HTTP 404',
      },
    ];
    const chosen = suggestPages(HOME, links, probes).map((item) => new URL(item.url).pathname);
    expect(chosen.slice(0, 6)).toEqual(['/', '/pricing', '/features', '/docs', '/about', '/tour']);
    expect(chosen).toContain('/customers');
    expect(chosen).not.toContain('/login');
    expect(chosen).not.toContain('/privacy');
  });

  it('never suggests more than the page limit', () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      link(`/features/f${index}`, `Feature ${index}`),
    );
    expect(suggestPages(HOME, many, []).length).toBeLessThanOrEqual(MAX_PAGES);
  });
});
