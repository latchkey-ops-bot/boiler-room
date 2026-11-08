import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browsers, captureResilient } from '../src/capture/run.ts';

/**
 * Loads pages from a server on loopback with the capture's own page loader. Skipped when
 * Playwright's Chromium is not installed.
 */

const PAGE = (body: string) =>
  `<!doctype html><html><head><title>Orbitly</title><style>body{margin:0;font-family:sans-serif}.app-frame{width:1400px;height:700px;margin-top:1500px;background:#0E1117;color:#fff}</style></head><body>${body}</body></html>`;

let server: Server;
let origin = '';
let out = '';
let available = true;

beforeAll(async () => {
  try {
    const { chromium } = await import('playwright');
    const probe = await chromium.launch();
    await probe.close();
  } catch {
    available = false;
  }
  server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      PAGE(
        `<h1>Orbitly ${request.url}</h1><p>Plan a month of posts in ten minutes, with the whole team.</p><div class="app-frame">Followers this week: 12,480</div>`,
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  out = mkdtempSync(join(tmpdir(), 'br-capture-'));
  for (const dir of ['text', 'shots', 'pages']) mkdirSync(join(out, dir), { recursive: true });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(out, { recursive: true, force: true });
});

const options = { withStyles: false, withLogos: false, uiShots: 3 };

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
        options,
      );
      expect(file.stored.text.rendered).toContain('Orbitly /contact');
      expect(file.record.shots).toEqual([]);
    } finally {
      await browsers.close();
    }
  });
});
