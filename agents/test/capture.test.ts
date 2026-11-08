import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureGuard } from '../src/capture/guard.ts';
import { needsRecapture } from '../src/capture/pages.ts';
import { Browsers, captureResilient, fetchResource } from '../src/capture/run.ts';

/**
 * Loads pages from a server on loopback with the capture's own page loader. Skipped when
 * Playwright's Chromium is not installed. The guard is told 127.0.0.1 may be loaded, as the
 * injection build is told its fixture host may; 127.0.0.2 stands in for a private address
 * (the cloud metadata service, an internal admin page), and `localhost` for another site.
 */

const PAGE = (body: string) =>
  `<!doctype html><html><head><title>Orbitly</title><style>body{margin:0;font-family:sans-serif}.app-frame{width:1400px;height:700px;margin-top:1500px;background:#0E1117;color:#fff}</style></head><body>${body}</body></html>`;

let server: Server;
let secret: Server;
let origin = '';
let secretOrigin = '';
let port = 0;
let out = '';
let available = true;
/** Every path the private server was asked for. It must stay empty. */
const secretHits: string[] = [];
/** Every path the site was asked for. */
const siteHits: string[] = [];

beforeAll(async () => {
  try {
    const { chromium } = await import('playwright');
    const probe = await chromium.launch();
    await probe.close();
  } catch {
    available = false;
  }
  secret = createServer((request, response) => {
    secretHits.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<p>instance credentials</p>');
  });
  await new Promise<void>((resolve) => secret.listen(0, '127.0.0.2', resolve));
  secretOrigin = `http://127.0.0.2:${(secret.address() as AddressInfo).port}`;
  const redirects: Record<string, () => string> = {
    '/old': () => '/new',
    '/to-private': () => `${secretOrigin}/secret`,
    '/to-other-site': () => `http://localhost:${port}/elsewhere`,
    '/frame-hop': () => `${secretOrigin}/frame-secret`,
    '/loop': () => '/loop',
    '/res/hop': () => '/res/final',
    '/res/to-private': () => `${secretOrigin}/res-secret`,
  };
  server = createServer((request, response) => {
    const path = request.url ?? '/';
    siteHits.push(path);
    const to = redirects[path];
    if (to) {
      response.writeHead(302, { location: to() });
      response.end();
      return;
    }
    if (path === '/res/final') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('final file');
      return;
    }
    const extra =
      path === '/embeds'
        ? `<iframe src="${secretOrigin}/frame"></iframe><iframe src="/frame-hop"></iframe><img src="${secretOrigin}/pixel.png">`
        : '';
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      PAGE(
        `<h1>Orbitly ${path}</h1><p>Plan a month of posts in ten minutes, with the whole team.</p>${extra}<div class="app-frame">Followers this week: 12,480</div>`,
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  configureGuard({ allowPrivateHosts: ['127.0.0.1'] });
  out = mkdtempSync(join(tmpdir(), 'br-capture-'));
  for (const dir of ['text', 'shots', 'pages']) mkdirSync(join(out, dir), { recursive: true });
});

afterAll(async () => {
  configureGuard({});
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => secret.close(resolve));
  rmSync(out, { recursive: true, force: true });
});

const options = { withStyles: false, withLogos: false, uiShots: 3, site: null };

describe('captureResilient', () => {
  // Another job killed the browser between pages, and every later page was stored with no text.
  it('starts a new browser when the one it had has closed, and still reads the page', async (context) => {
    if (!available) return context.skip();
    const browsers = new Browsers();
    try {
      await (await browsers.get()).close();
      const file = await captureResilient(
        browsers,
        { base: out, out },
        `${origin}/`,
        'home',
        'home',
        options,
      );
      expect(file.record.error).toBeNull();
      expect(file.stored.text.rendered).toContain('Plan a month of posts');
      expect(file.record.text_chars).toBeGreaterThan(0);
      expect(file.record.shots.map((shot) => shot.assetId)).toEqual(['home-screen', 'home-ui-1']);
    } finally {
      await browsers.close();
    }
  });

  it('reads a form page but takes no screenshot of it', async (context) => {
    if (!available) return context.skip();
    const browsers = new Browsers();
    try {
      const file = await captureResilient(
        browsers,
        { base: out, out },
        `${origin}/contact`,
        'contact',
        'contact',
        { ...options, site: origin },
      );
      expect(file.stored.text.rendered).toContain('Orbitly /contact');
      expect(file.record.shots).toEqual([]);
    } finally {
      await browsers.close();
    }
  });

  describe('the address guard', { timeout: 60_000 }, () => {
    const load = async (path: string, site: string | null = origin) => {
      const browsers = new Browsers();
      try {
        return await captureResilient(
          browsers,
          { base: out, out },
          `${origin}${path}`,
          'page',
          'other',
          {
            ...options,
            site,
          },
        );
      } finally {
        await browsers.close();
      }
    };

    it('follows a redirect on the site, one checked hop at a time', async (context) => {
      if (!available) return context.skip();
      const file = await load('/old');
      expect(file.record.error).toBeNull();
      expect(file.record.final_url).toBe(`${origin}/new`);
      expect(file.stored.text.rendered).toContain('Orbitly /new');
    });

    it('refuses a redirect to a private address before requesting it, and never retries it', async (context) => {
      if (!available) return context.skip();
      const file = await load('/to-private');
      expect(file.record.error).toMatch(/Refused .*127\.0\.0\.2.*loopback/);
      expect(file.record.refused).toBe(true);
      expect(needsRecapture(file.record)).toBe(false);
      expect(file.stored.text.rendered).toBe('');
      expect(secretHits).toEqual([]);
    });

    it('refuses a redirect off the site, and a private address as the page itself', async (context) => {
      if (!available) return context.skip();
      configureGuard({ allowPrivateHosts: ['127.0.0.1', 'localhost'] });
      try {
        const off = await load('/to-other-site');
        expect(off.record.error).toMatch(/is not on/);
        expect(off.record.refused).toBe(true);
        expect(siteHits).not.toContain('/elsewhere');
      } finally {
        configureGuard({ allowPrivateHosts: ['127.0.0.1'] });
      }
      const browsers = new Browsers();
      try {
        const direct = await captureResilient(
          browsers,
          { base: out, out },
          `${secretOrigin}/`,
          'x',
          'home',
          options,
        );
        expect(direct.record.refused).toBe(true);
      } finally {
        await browsers.close();
      }
      expect(secretHits).toEqual([]);
    });

    it('lets the home page redirect to another site, which then defines the site', async (context) => {
      if (!available) return context.skip();
      configureGuard({ allowPrivateHosts: ['127.0.0.1', 'localhost'] });
      try {
        const home = await load('/to-other-site', null);
        expect(home.record.error).toBeNull();
        expect(home.record.final_url).toBe(`http://localhost:${port}/elsewhere`);
      } finally {
        configureGuard({ allowPrivateHosts: ['127.0.0.1'] });
      }
    });

    it('keeps frames, their redirects and pictures from reaching a private address', async (context) => {
      if (!available) return context.skip();
      const file = await load('/embeds');
      expect(file.record.error).toBeNull();
      expect(file.stored.text.rendered).toContain('Orbitly /embeds');
      expect(siteHits).toContain('/frame-hop');
      expect(secretHits).toEqual([]);
    });

    it('stops a page that redirects to itself', async (context) => {
      if (!available) return context.skip();
      const file = await load('/loop');
      expect(file.record.error).toMatch(/more than 5 times/);
    });
  });
});

describe('fetchResource', () => {
  it('follows redirects by hand and refuses a hop to a private address', async (context) => {
    if (!available) return context.skip();
    const { request } = await import('playwright');
    const api = await request.newContext();
    try {
      const hop = await fetchResource(api, `${origin}/res/hop`, 1000, false);
      expect(hop).toMatchObject({ status: 200, url: `${origin}/res/final` });
      expect(hop?.body.toString()).toBe('final file');
      expect(await fetchResource(api, `${origin}/res/to-private`, 1000, false)).toBeNull();
      expect(await fetchResource(api, `${secretOrigin}/res-direct`, 1000, false)).toBeNull();
      expect(await fetchResource(api, `${origin}/loop`, 1000, false)).toBeNull();
      expect(await fetchResource(api, 'file:///etc/passwd', 1000, false)).toBeNull();
      expect(secretHits).toEqual([]);
    } finally {
      await api.dispose();
    }
  });
});
