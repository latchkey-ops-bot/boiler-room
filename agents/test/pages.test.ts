import { describe, expect, it } from 'vitest';
import {
  type CandidateLink,
  classifyLink,
  judgeProbe,
  MAX_PAGES,
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
    expect(judge(ok({ content_type: 'application/pdf' })).found).toBe(false);
  });

  it('rejects a soft 404 that answers 200 like a missing page does', () => {
    const shell = ok({ title: 'Site', length: 8425, final_url: 'https://site.example.org/x' });
    expect(judge(ok({ title: 'Site', length: 8500 }), shell)).toMatchObject({
      found: false,
      reason: expect.stringContaining('soft 404'),
    });
    expect(judge(ok({ title: 'Site', length: 20000 }), shell).found).toBe(true);
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
