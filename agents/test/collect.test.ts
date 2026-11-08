import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectPage } from '../src/capture/collect.ts';
import { deriveColors } from '../src/capture/tokens.ts';
import type { RawPage } from '../src/capture/types.ts';

/**
 * Runs the in-page collector in real Chromium against pages served from memory, so no network is
 * used. Skipped when Playwright's Chromium is not installed on this machine.
 */

const ORIGIN = 'https://fixture.example.org';

const LIGHT_SITE = `<!doctype html><html lang="en"><head><title>Orbitly | Social scheduling</title>
<meta name="description" content="Orbitly plans social posts."><meta property="og:site_name" content="Orbitly">
<style>
  body { margin: 0; background: #FBFBFD; color: #10131A; font-family: -apple-system, system-ui, sans-serif; }
  header { position: sticky; top: 0; display: flex; gap: 20px; padding: 16px 40px; background: #FBFBFD; }
  .btn { display: inline-block; padding: 12px 20px; border-radius: 8px; background: #3A5BF6; color: #FFFFFF; text-decoration: none; }
  .ghost { background: transparent; border: 1px solid #C8CCD6; color: #10131A; }
  .hl { color: #3A5BF6; }
  .app-frame { background: #0E1117; color: #D0D4DC; margin: 40px; height: 420px; padding: 24px; border-radius: 12px; }
  .cookie { position: fixed; bottom: 0; left: 0; right: 0; background: #222; color: #fff; padding: 20px; z-index: 9999; }
  .mark { fill: #3A5BF6; }
  h1 { font-size: 56px; text-transform: uppercase; }
</style></head><body>
<header><a href="/" aria-label="Orbitly home"><svg width="120" height="28" viewBox="0 0 120 28"><rect class="mark" width="28" height="28" rx="6"/><text x="36" y="20">Orbitly</text></svg></a>
<nav><a href="/pricing">Pricing</a> <a href="/docs">Docs</a> <a href="/privacy">Privacy</a></nav>
<a href="https://app.fixture.example.org/login">Log in</a> <a class="btn" href="/signup">Start free</a></header>
<section style="padding: 40px"><h1>Schedule posts <span class="hl">without spreadsheets</span></h1>
<p>Orbitly plans a month of posts in 10 minutes.</p>
<a class="btn" href="/signup">Start your free trial</a> <a class="btn ghost" href="/demo">Watch the demo</a></section>
<div class="app-frame"><div>Followers this week: 12,480</div><div>acme / main</div></div>
<details><summary>Is there a free plan?</summary><p>Yes, the Solo plan is free.</p></details>
<div class="cookie">We use cookies to improve your experience. <button>Accept all</button></div>
</body></html>`;

const DARK_SITE = `<!doctype html><html><head><title>Nightjar</title><style>
  :root { --brand-primary: oklch(0.86 0.15 120); --surface: color-mix(in srgb, black 98%, white); }
  body { margin: 0; background: #FFFFFF; font-family: Georgia, serif; }
  .shell { min-height: 3000px; background: var(--surface); color: rgb(251 251 253 / 0.95); }
  .cta { display: inline-block; padding: 12px 24px; border-radius: 999px; background: #FBFBFD; color: #050505; }
  .nav-cta { display: inline-block; padding: 8px 16px; border-radius: 999px; background: var(--brand-primary); color: #050505; }
  h1 { color: #FBFBFD; } h1 em { color: var(--brand-primary); font-style: normal; }
</style></head><body><div class="shell"><header><a class="nav-cta" href="/start">Start</a></header>
<h1>Night <em>shift</em> analytics</h1><p>Read the numbers that matter while you sleep, every single night.</p><a class="cta" href="/tour">Take the tour</a></div></body></html>`;

// A link list with browser-default links, wrapped buttons, a big palette and a declared scheme.
const PALETTE = Array.from(
  { length: 240 },
  (_, index) => `--palette-${index}: #${(index * 4099).toString(16).padStart(6, '0').slice(0, 6)};`,
).join(' ');
const LINK_SITE = `<!doctype html><html><head><title>Notes</title><meta name="color-scheme" content="light dark"><style>
  :root { ${PALETTE} --primary: #242424; }
  body { margin: 0; background: #FFFFFF; color: #000000; }
  .pill { display: inline-block; padding: 10px 18px; border-radius: 9999px; background: #242424; color: #FFFFFF; }
  .toggle { display: inline-block; padding: 8px 12px; }
</style></head><body>
<header><a href="/" class="toggle-btn"><span class="toggle">Menu</span></a> <a href="/start"><span class="pill">Start now</span></a></header>
<main><ul>${Array.from({ length: 40 }, (_, index) => `<li>2026-01-${String((index % 28) + 1).padStart(2, '0')} <a href="/post-${index}">A long essay about building reliable software, part ${index}</a></li>`).join('')}</ul>
<p>Written over many years, these notes are kept as plain pages with no styling at all.</p></main>
<footer>Footer text in the default colour.</footer></body></html>`;

let browser: Browser | undefined;

beforeAll(async () => {
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
  } catch {
    browser = undefined;
  }
});

afterAll(async () => {
  await browser?.close();
});

async function collect(html: string, withStyles = true): Promise<{ raw: RawPage; page: Page }> {
  if (!browser) throw new Error('no browser');
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: html }),
  );
  await page.goto(`${ORIGIN}/`);
  const raw = await page.evaluate(collectPage, { withStyles, withLogos: true });
  return { raw, page };
}

describe('collectPage in Chromium', () => {
  it('stores visible, hidden and mockup text separately', async (context) => {
    if (!browser) return context.skip();
    const { raw, page } = await collect(LIGHT_SITE);
    expect(raw.text.rendered).toContain('SCHEDULE POSTS WITHOUT SPREADSHEETS');
    expect(raw.text.dom).toContain('Schedule posts without spreadsheets');
    expect(raw.text.dom).toContain('Yes, the Solo plan is free.');
    expect(raw.text.rendered).not.toContain('Yes, the Solo plan is free.');
    expect(raw.text.illustrative).toContain('Followers this week: 12,480');
    expect(raw.text.clean).not.toContain('12,480');
    expect(raw.text.clean).toContain('Orbitly plans a month of posts in 10 minutes.');
    expect(raw.text.meta).toContain('Orbitly plans social posts.');
    await page.close();
  });

  it('marks the cookie banner for hiding but keeps the sticky header', async (context) => {
    if (!browser) return context.skip();
    const { raw, page } = await collect(LIGHT_SITE);
    expect(raw.hidden).toBe(1);
    expect(
      await page.locator('[data-br-overlay]').evaluateAll((els) => els.map((el) => el.className)),
    ).toEqual(['cookie']);
    expect(raw.ctas.map((cta) => [cta.text, cta.placement])).toEqual([
      ['Start free', 'nav'],
      ['Start your free trial', 'hero'],
      ['Watch the demo', 'hero'],
    ]);
    expect(raw.loginLinks.map((link) => link.url)).toContain(
      'https://app.fixture.example.org/login',
    );
    expect(raw.ui.map((item) => [item.kind, item.mock])).toEqual([['frame', true]]);
    await page.close();
  });

  it('measures a light brand from computed styles, ignoring the dark mockup', async (context) => {
    if (!browser) return context.skip();
    const { raw, page } = await collect(LIGHT_SITE);
    if (!raw.styles) throw new Error('styles missing');
    const colors = deriveColors(raw.styles);
    expect(colors).toMatchObject({
      background: '#FBFBFD',
      foreground: '#10131A',
      primary: '#3A5BF6',
      mode: 'light',
      radius: 8,
      cssVariables: false,
    });
    expect(raw.fonts?.uses.map((use) => use.role)).toEqual(['display', 'body']);
    await page.close();
  });

  it('finds the inline SVG logo and writes its colours as hex', async (context) => {
    if (!browser) return context.skip();
    const { raw, page } = await collect(LIGHT_SITE);
    const logo = raw.logos.find((item) => item.kind === 'inline-svg');
    expect(logo).toMatchObject({ inHeader: true, homeLink: true, width: 120, height: 28 });
    expect(logo?.svg).toContain('fill="#3A5BF6"');
    expect(logo?.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(
      raw.logos.some((item) => item.kind === 'icon' && item.url === `${ORIGIN}/favicon.ico`),
    ).toBe(true);
    await page.close();
  });

  it('measures a dark brand set through variables, modern colour syntax and a painted wrapper', async (context) => {
    if (!browser) return context.skip();
    const { raw, page } = await collect(DARK_SITE);
    if (!raw.styles) throw new Error('styles missing');
    const colors = deriveColors(raw.styles);
    expect(colors.mode).toBe('dark');
    expect(colors.background).toBe('#050505');
    expect(colors.radius).toBe(999);
    expect(colors.cssVariables).toBe(true);
    expect(colors.primary).not.toBe('#FBFBFD');
    expect(colors.candidates[0]?.sources).toContain('nav button fill');
    await page.close();
  });

  it('marks link and navigation text, so the body copy sets the text colour', async (context) => {
    if (!browser) return context.skip();
    const { raw, page } = await collect(LINK_SITE);
    if (!raw.styles) throw new Error('styles missing');
    const links = raw.styles.texts.filter((item) => item.link);
    expect(links.length).toBeGreaterThan(0);
    expect(raw.styles.texts.some((item) => item.chrome && !item.link)).toBe(true);
    const colors = deriveColors(raw.styles);
    expect(colors.foreground).toBe('#000000');
    await page.close();
  });

  it('reads the drawn box inside a link, and keeps brand variables past a big palette', async (context) => {
    if (!browser) return context.skip();
    const { raw, page } = await collect(LINK_SITE);
    if (!raw.styles) throw new Error('styles missing');
    const start = raw.ctas.find((cta) => cta.text === 'Start now');
    expect(start).toMatchObject({ pill: true, background: { hex: '#242424' } });
    expect(raw.styles.colorVariables.length).toBe(200);
    expect(raw.styles.colorVariables.map((item) => item.name)).toContain('--primary');
    expect(raw.styles.colorScheme).toBe('light dark');
    const colors = deriveColors(raw.styles);
    expect(colors).toMatchObject({ primary: '#242424', radius: 999 });
    await page.close();
  });
});
