import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext, Browser } from 'playwright';
import { normaliseUrl, normaliseWhitespace, siteHost, slugify } from '../researcher/text.ts';
import type { PagesBundle, StoredPage } from '../researcher/verify.ts';
import { collectPage } from './collect.ts';
import { contrast } from './color.ts';
import {
  type FontFace,
  facesFromRaw,
  families,
  genericOf,
  isSystemFamily,
  parseFontFaces,
  pickFace,
  type ResolvedFont,
  resolveFonts,
  SUBSTITUTES,
  substituteCssUrl,
} from './fonts.ts';
import { type LogoSource, pngSize, rankLogos, sniff, wordmarkSvg } from './logo.ts';
import {
  buildTemplate,
  type CapturedPage,
  type CaptureManifest,
  guessBrandName,
  type MaterialEntry,
  type PublishItem,
  placeholderFor,
  type Shot,
} from './manifest.ts';
import {
  BASELINE_PATH,
  type CandidateLink,
  classifyLink,
  judgeProbe,
  type LinkKind,
  MAX_PAGES,
  PROBE_PATHS,
  type ProbeResponse,
  type ProbeResult,
  parseRobots,
  robotsAllow,
  sameSite,
  suggestPages,
} from './pages.ts';
import { htmlTitle, htmlToText } from './text-extract.ts';
import { deriveColors } from './tokens.ts';
import type { RawPage, RawUiCandidate } from './types.ts';

const VIEWPORT = { width: 1920, height: 1080 };
const NAV_GAP_MS = 1500;
const REQUEST_GAP_MS = 1000;
const PAGE_TIMEOUT_MS = 90_000;
const MAX_UI_SHOTS_PER_PAGE = 3;
const MAX_UI_SHOTS = 10;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message: string) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);

export interface Paths {
  base: string;
  out: string;
}

export function pathsFor(base: string, url: string): Paths {
  return { base, out: join(base, 'out', siteHost(url)) };
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Turns on a 2 GiB swapfile. Chromium needs about 1.1 GB on heavy pages and the box has 1 GiB. */
/**
 * Set on a developer machine to test the tool: it then never touches swap, installs no system
 * package and kills no browser, since other programs there own theirs.
 */
export const LOCAL = process.env.BR_LOCAL === '1';

export function ensureSwap(): string {
  if (LOCAL) return 'skipped (BR_LOCAL=1)';
  const script =
    'swapon --show | grep -q swapfile || sudo -n swapon /swapfile 2>/dev/null || (sudo -n fallocate -l 2G /swapfile && sudo -n chmod 600 /swapfile && sudo -n mkswap /swapfile >/dev/null && sudo -n swapon /swapfile); swapon --show';
  const result = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  return `${result.stdout}${result.stderr}`.trim();
}

export function setup(base: string): void {
  log(`swap: ${ensureSwap().replace(/\n/g, ' | ') || 'none'}`);
  const run = (command: string, timeoutMs: number) => {
    log(`$ ${command}`);
    const result = spawnSync('sh', ['-c', command], {
      cwd: base,
      encoding: 'utf8',
      timeout: timeoutMs,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
      .trim()
      .split('\n')
      .slice(-5)
      .join('\n');
    if (output) log(output);
    if (result.status !== 0) throw new Error(`"${command}" failed with exit ${result.status}`);
  };
  const installed = join(base, 'node_modules', 'playwright', 'package.json');
  if (!existsSync(installed) || readJson<{ version: string }>(installed).version !== '1.65.0') {
    if (!existsSync(join(base, 'package.json'))) run('npm init -y >/dev/null', 60_000);
    run('npm install playwright@1.65.0 --no-audit --no-fund --loglevel=error', 300_000);
  } else log('playwright 1.65.0 is already installed');
  const cache = join(process.env.HOME ?? '/root', '.cache', 'ms-playwright');
  const hasShell =
    existsSync(cache) &&
    readdirSync(cache).some((name) => name.startsWith('chromium_headless_shell'));
  if (!hasShell) run('npx playwright install --with-deps --only-shell chromium', 480_000);
  else log('chromium headless shell is already installed');
  const summary = 'SETUP DONE. The capture tool is ready.';
  writeFileSync(join(base, 'jobs', 'setup-summary.txt'), `${summary}\n`);
}

class Ledger {
  private readonly file: string;
  readonly pages: string[];
  constructor(out: string) {
    this.file = join(out, 'ledger.json');
    this.pages = existsSync(this.file) ? readJson<{ pages: string[] }>(this.file).pages : [];
  }
  has(url: string): boolean {
    return this.pages.includes(normaliseUrl(url) ?? url);
  }
  /** Records a page load, or refuses it past the per-site limit. */
  take(url: string): boolean {
    const key = normaliseUrl(url) ?? url;
    if (this.pages.includes(key)) return true;
    if (this.pages.length >= MAX_PAGES) return false;
    this.pages.push(key);
    writeJson(this.file, { limit: MAX_PAGES, pages: this.pages });
    return true;
  }
}

interface PageFile {
  record: CapturedPage;
  stored: StoredPage;
  raw: RawPage | null;
}

let lastSiteRequest = 0;
async function politely(gap: number) {
  const wait = lastSiteRequest + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastSiteRequest = Date.now();
}

async function launch(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
}

/** Closes the browser even when Chromium hangs, so the job can always exit. */
async function closeBrowser(browser: Browser | undefined) {
  if (!browser) return;
  await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
}

async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000}s`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function describeUi(ui: RawUiCandidate): string {
  return `${ui.kind}${ui.mock ? ' mockup' : ''}${ui.label ? `: ${ui.label}` : ''}`;
}

function emptyText(): StoredPage['text'] {
  return { rendered: '', dom: '', meta: '', clean: '', illustrative: '' };
}

/**
 * Loads one page read-only and stores its text, a 1920x1080 screenshot of the top and of each
 * product interface on it. It never clicks or types: non-GET navigations are refused, downloads are
 * off, and the only interaction is scrolling the window. Text and styles are read before overlays
 * are hidden and before any screenshot, so a failed screenshot never costs the text.
 */
async function capturePage(
  browser: Browser,
  paths: Paths,
  url: string,
  slug: string,
  kind: LinkKind,
  options: { withStyles: boolean; withLogos: boolean; uiShots: number },
): Promise<PageFile> {
  const record: CapturedPage = {
    url,
    final_url: url,
    slug,
    kind,
    status: null,
    content_type: null,
    title: '',
    text_file: join(paths.out, 'text', `${slug}.txt`),
    shots: [],
    ctas: [],
    ui: [],
    hidden_overlays: 0,
    error: null,
  };
  const stored: StoredPage = {
    url,
    final_url: url,
    origin: 'site',
    file_id: null,
    status: null,
    content_type: null,
    title: '',
    text: emptyText(),
  };
  let raw: RawPage | null = null;
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    acceptDownloads: false,
    serviceWorkers: 'block',
    locale: 'en-US',
  });
  await context.route('**/*', (route) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.method() !== 'GET') return route.abort();
    if (request.resourceType() === 'media') return route.abort();
    return route.continue();
  });
  try {
    const page = await context.newPage();
    page.on('dialog', (dialog) => {
      dialog.dismiss().catch(() => {});
    });
    await politely(NAV_GAP_MS);
    await withTimeout(
      (async () => {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        record.status = response?.status() ?? null;
        record.content_type = response?.headers()['content-type'] ?? null;
        record.final_url = page.url();
        Object.assign(stored, {
          final_url: record.final_url,
          status: record.status,
          content_type: record.content_type,
        });
        if (response && record.content_type && !record.content_type.includes('html')) {
          const text = await response.text();
          stored.text = { rendered: text, dom: text, meta: '', clean: text, illustrative: '' };
          record.title = url.split('/').pop() ?? url;
          stored.title = record.title;
          return;
        }
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(800);
        await page.evaluate(async () => {
          const height = Math.min(document.documentElement.scrollHeight, 25_000);
          for (let y = 0; y < height; y += 700) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(1200);
        raw = await page.evaluate(collectPage, {
          withStyles: options.withStyles,
          withLogos: options.withLogos,
        });
        const collected = raw as RawPage;
        record.title = collected.title;
        record.ctas = collected.ctas;
        record.ui = collected.ui;
        record.hidden_overlays = collected.hidden;
        stored.title = collected.title;
        stored.text = collected.text;

        await page.evaluate(() => {
          for (const el of Array.from(document.querySelectorAll('[data-br-overlay]'))) {
            (el as HTMLElement).style.setProperty('display', 'none', 'important');
          }
          for (const el of [document.documentElement, document.body])
            el?.style.setProperty('overflow', 'auto', 'important');
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(500);
        const file = join('shots', `${slug}.png`);
        await page.screenshot({ path: join(paths.out, file), type: 'png', timeout: 30_000 });
        const top: Shot = {
          file,
          assetId: `${slug}-screen`,
          kind: 'page',
          label: `Top of ${record.final_url}`,
          mock: false,
          ui: [],
          width: 1920,
          height: 1080,
          sourceUrl: record.final_url,
        };
        record.shots.push(top);

        // One 1920x1080 shot per product UI candidate, unless an earlier shot of this page already
        // shows it; then that shot is marked as showing product UI instead of taking a duplicate.
        const taken: { y: number; shot: Shot }[] = [{ y: 0, shot: top }];
        let uiCount = 0;
        for (const ui of collected.ui) {
          if (uiCount >= options.uiShots) break;
          const seen = { label: describeUi(ui), mock: ui.mock };
          const covering = taken.find(
            (item) =>
              ui.top >= item.y && ui.top + Math.min(ui.height, 600) <= item.y + VIEWPORT.height,
          );
          if (covering) {
            covering.shot.ui.push(seen);
            continue;
          }
          const wanted = Math.max(0, ui.top - Math.max(0, (VIEWPORT.height - ui.height) / 2));
          await page.evaluate((target) => window.scrollTo(0, target), wanted);
          await page.waitForTimeout(700);
          const y = await page.evaluate(() => window.scrollY);
          uiCount += 1;
          const uiFile = join('shots', `${slug}-ui-${uiCount}.png`);
          await page.screenshot({ path: join(paths.out, uiFile), type: 'png', timeout: 30_000 });
          const shot: Shot = {
            file: uiFile,
            assetId: `${slug}-ui-${uiCount}`,
            kind: 'ui',
            label: seen.label,
            mock: ui.mock,
            ui: [seen],
            width: 1920,
            height: 1080,
            sourceUrl: record.final_url,
          };
          record.shots.push(shot);
          taken.push({ y, shot });
        }
      })(),
      PAGE_TIMEOUT_MS,
      `Loading ${url}`,
    );
  } catch (cause) {
    record.error =
      cause instanceof Error ? (cause.message.split('\n')[0] ?? 'failed') : String(cause);
    log(`  ! ${url}: ${record.error}`);
  } finally {
    await Promise.race([context.close().catch(() => {}), sleep(5000)]);
  }
  writeTextFile(record, stored);
  return { record, stored, raw };
}

/** The page text the agent reads to pick quotes, with hidden and mockup text marked off. */
function writeTextFile(record: CapturedPage, stored: StoredPage) {
  const parts = [`# ${record.title}`, `URL: ${record.final_url}`, '', stored.text.rendered.trim()];
  const visible = normaliseWhitespace(stored.text.rendered);
  const hiddenOnly = normaliseWhitespace(stored.text.dom);
  if (hiddenOnly.length > visible.length * 1.3 + 200) {
    parts.push(
      '',
      '--- Text in the page that is not visible (collapsed or hidden). Quotable. ---',
      stored.text.dom.replace(/[ \t]+/g, ' ').trim(),
    );
  }
  if (stored.text.illustrative.trim()) {
    parts.push(
      '',
      '--- Text inside product mockups, terminals and code. Sample data: never a claim. ---',
      stored.text.illustrative.trim(),
    );
  }
  if (stored.text.meta.trim())
    parts.push(
      '',
      '--- Page title, meta tags and alt text. Quotable. ---',
      stored.text.meta.trim(),
    );
  writeFileSync(record.text_file, `${parts.join('\n')}\n`);
}

function savePage(paths: Paths, file: PageFile) {
  writeJson(join(paths.out, 'pages', `${file.record.slug}.json`), file);
}

function loadPages(paths: Paths): PageFile[] {
  const dir = join(paths.out, 'pages');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson<PageFile>(join(dir, name)));
}

function slugFor(url: string, taken: Set<string>): string {
  const { pathname } = new URL(url);
  let slug = pathname === '/' ? 'home' : slugify(pathname);
  for (let index = 2; taken.has(slug); index++) slug = `${slugify(pathname)}-${index}`;
  taken.add(slug);
  return slug;
}

interface Fetched {
  status: number;
  url: string;
  contentType: string | null;
  body: Buffer;
}

async function fetchResource(
  request: APIRequestContext,
  url: string,
  maxBytes: number,
  polite: boolean,
): Promise<Fetched | null> {
  try {
    if (polite) await politely(REQUEST_GAP_MS);
    const response = await request.get(url, {
      maxRedirects: 5,
      timeout: 20_000,
      failOnStatusCode: false,
    });
    const length = Number(response.headers()['content-length'] ?? 0);
    if (length > maxBytes)
      return {
        status: response.status(),
        url: response.url(),
        contentType: response.headers()['content-type'] ?? null,
        body: Buffer.alloc(0),
      };
    const body = await response.body();
    return {
      status: response.status(),
      url: response.url(),
      contentType: response.headers()['content-type'] ?? null,
      body: body.subarray(0, maxBytes),
    };
  } catch (cause) {
    log(`  ! fetch ${url}: ${cause instanceof Error ? cause.message.split('\n')[0] : cause}`);
    return null;
  }
}

function probeResponse(fetched: Fetched | null): ProbeResponse {
  if (!fetched) return { status: null, final_url: null, content_type: null, title: '', length: 0 };
  const html = fetched.body.toString('utf8');
  return {
    status: fetched.status,
    final_url: fetched.url,
    content_type: fetched.contentType,
    title: htmlTitle(html),
    length: htmlToText(html).length,
  };
}

export interface DiscoverFile {
  site: string;
  requested: string;
  links: CandidateLink[];
  probes: ProbeResult[];
  robots: { disallow: string[]; allow: string[]; delaySeconds: number | null };
  sitemap_urls: number;
  llms_txt: boolean;
  suggested: CandidateLink[];
}

/**
 * Loads the home page (one of the 15 page loads), reads robots.txt, the sitemap and llms.txt,
 * probes the paths where public product UI usually lives, and suggests the pages to capture.
 */
export async function discover(base: string, url: string, script: string): Promise<void> {
  const paths = pathsFor(base, url);
  for (const dir of ['pages', 'text', 'shots'])
    mkdirSync(join(paths.out, dir), { recursive: true });
  log(`swap: ${ensureSwap().replace(/\n/g, ' | ') || 'none'}`);
  const ledger = new Ledger(paths.out);
  let browser: Browser | undefined;
  try {
    browser = await launch();
    log(`loading ${url}`);
    if (!ledger.take(url)) throw new Error('The 15-page limit for this site is already used.');
    const home = await capturePage(browser, paths, url, 'home', 'home', {
      withStyles: true,
      withLogos: true,
      uiShots: MAX_UI_SHOTS_PER_PAGE,
    });
    if (home.record.error && !home.raw)
      throw new Error(`The home page could not be loaded: ${home.record.error}`);
    savePage(paths, home);
    const site = home.record.final_url;
    const fetchContext = await browser.newContext({ viewport: VIEWPORT });
    const request = fetchContext.request;

    const origin = new URL(site).origin;
    const robotsFile = await fetchResource(request, `${origin}/robots.txt`, 500_000, true);
    const robotsText =
      robotsFile && robotsFile.status < 400 && !robotsFile.contentType?.includes('html')
        ? robotsFile.body.toString('utf8')
        : '';
    const robots = parseRobots(robotsText);

    const sitemapUrls: string[] = [];
    const sitemapRefs = [...robotsText.matchAll(/^sitemap:\s*(\S+)/gim)]
      .map((match) => match[1] ?? '')
      .filter(Boolean);
    const firstSitemap = sitemapRefs[0] ?? `${origin}/sitemap.xml`;
    const sitemap = await fetchResource(request, firstSitemap, 3_000_000, true);
    if (sitemap && sitemap.status < 400) {
      let xml = sitemap.body.toString('utf8');
      if (/<sitemapindex/i.test(xml)) {
        const children = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(
          (match) => match[1] ?? '',
        );
        const child = children.find((item) => /page|main|site|en/i.test(item)) ?? children[0];
        const next = child ? await fetchResource(request, child, 3_000_000, true) : null;
        xml = next && next.status < 400 ? next.body.toString('utf8') : '';
      }
      for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        if (sitemapUrls.length >= 400) break;
        if (match[1] && sameSite(match[1], site)) sitemapUrls.push(match[1]);
      }
    }

    const llms = await fetchResource(request, `${origin}/llms.txt`, 2_000_000, true);
    const llmsTxt = Boolean(
      llms &&
        llms.status < 400 &&
        !/html/.test(llms.contentType ?? '') &&
        llms.body.length > 0 &&
        !/^\s*</.test(llms.body.toString('utf8', 0, 200)),
    );

    log('probing for public product UI');
    const baseline = probeResponse(
      await fetchResource(request, `${origin}${BASELINE_PATH}`, 2_000_000, true),
    );
    const probes: ProbeResult[] = [];
    for (const path of PROBE_PATHS) {
      const target = `${origin}${path}`;
      if (!robotsAllow(robots, path)) {
        probes.push({
          path,
          url: target,
          status: null,
          final_url: null,
          content_type: null,
          title: '',
          length: 0,
          found: false,
          reason: 'disallowed by robots.txt',
        });
        continue;
      }
      probes.push(
        judgeProbe(
          path,
          target,
          probeResponse(await fetchResource(request, target, 2_000_000, true)),
          baseline,
          site,
        ),
      );
    }
    await fetchContext.close().catch(() => {});

    const raw = home.raw as RawPage | null;
    const linkText = new Map<string, CandidateLink>();
    for (const link of raw?.links ?? []) {
      const key = normaliseUrl(link.url);
      if (key && !linkText.has(key))
        linkText.set(key, {
          url: link.url,
          text: link.text,
          where: link.where,
          kind: classifyLink(link.url, link.text, site),
        });
    }
    for (const item of sitemapUrls) {
      const key = normaliseUrl(item);
      if (key && !linkText.has(key))
        linkText.set(key, {
          url: item,
          text: '',
          where: 'sitemap',
          kind: classifyLink(item, '', site),
        });
    }
    const links = [...linkText.values()].filter((link) =>
      robotsAllow(robots, new URL(link.url).pathname),
    );
    const suggested = suggestPages(site, links, probes);
    const file: DiscoverFile = {
      site,
      requested: url,
      links,
      probes,
      robots,
      sitemap_urls: sitemapUrls.length,
      llms_txt: llmsTxt,
      suggested,
    };
    writeJson(join(paths.out, 'discover.json'), file);

    const byKind = new Map<string, CandidateLink[]>();
    for (const link of links) byKind.set(link.kind, [...(byKind.get(link.kind) ?? []), link]);
    const lines = [
      `DISCOVER DONE for ${site}`,
      `Home: "${home.record.title}" (HTTP ${home.record.status}). Page loads used: ${ledger.pages.length} of ${MAX_PAGES}.`,
      `robots.txt: ${robots.disallow.length} disallow rules. Sitemap URLs: ${sitemapUrls.length}. llms.txt: ${llmsTxt ? 'yes' : 'no'}.`,
      '',
      'Probes for public product UI:',
      ...probes.map(
        (probe) =>
          `  ${probe.path.padEnd(14)} ${probe.found ? 'FOUND' : 'no   '} ${probe.reason}${probe.final_url && probe.found ? ` -> ${probe.final_url}` : ''}`,
      ),
      '',
      'Links by kind (first 8 each):',
      ...[...byKind].map(
        ([kind, items]) =>
          `  ${kind}: ${items
            .slice(0, 8)
            .map((item) => `${new URL(item.url).pathname}${item.text ? ` "${item.text}"` : ''}`)
            .join(', ')}`,
      ),
      '',
      `Login or app links: ${(raw?.loginLinks ?? []).map((link) => `${link.text || '(no text)'} -> ${link.url}`).join('; ') || 'none'}`,
      '',
      `Suggested pages (${suggested.length}, home already captured):`,
      ...suggested.map((link) => `  ${link.kind.padEnd(9)} ${link.url}`),
      '',
      'Next: capture these, or your own choice of at most 15 pages in total, in one command:',
      `  node ${script} capture ${site} ${suggested
        .slice(1)
        .map((link) => link.url)
        .join(' ')}`,
    ];
    writeFileSync(join(base, 'jobs', 'discover-summary.txt'), `${lines.join('\n')}\n`);
  } finally {
    await closeBrowser(browser);
  }
}

async function resolveBrandFonts(
  request: APIRequestContext,
  raw: RawPage,
  site: string,
): Promise<{ fonts: ResolvedFont[]; notes: string[] }> {
  const notes: string[] = [];
  const fonts = raw.fonts;
  if (!fonts) return { fonts: [], notes: ['Fonts were not measured.'] };
  const faces: FontFace[] = facesFromRaw(fonts.faces, site);
  const host = new URL(site).hostname;
  const fetchable = fonts.unreadable
    .filter((href) => /fonts\.googleapis\.com|typekit\.net/.test(href) || sameSite(href, site))
    .slice(0, 6);
  for (const href of fetchable) {
    const css = await fetchResource(request, href, 1_000_000, sameSite(href, site));
    if (css && css.status < 400) faces.push(...parseFontFaces(css.body.toString('utf8'), href));
  }
  const resolved = resolveFonts(fonts, faces, host);
  for (const font of resolved) {
    if (font.method !== 'system') continue;
    const stack = fonts.uses.find((use) => use.role === font.role)?.stack ?? '';
    const named = families(stack).find((name) => !isSystemFamily(name));
    for (const family of [named, SUBSTITUTES[font.role === 'mono' ? 'mono' : genericOf(stack)]]) {
      if (!family) continue;
      const cssUrl = substituteCssUrl(family, [font.weight]);
      const css = await fetchResource(request, cssUrl, 500_000, false);
      const face =
        css && css.status < 400
          ? pickFace(parseFontFaces(css.body.toString('utf8'), cssUrl), family, font.weight)
          : undefined;
      if (face) {
        Object.assign(font, {
          siteFamily: family === named ? null : stack || null,
          family,
          method: family === named ? 'google-fonts' : 'substitute',
          url: face.url,
        });
        if (family === named)
          notes.push(
            `${font.role}: the site names ${family} but loads no file for it; the Google Fonts file is used.`,
          );
        break;
      }
    }
    if (font.method === 'system') {
      notes.push(
        `${font.role}: no font file could be found, so a font stylesheet address stands in.`,
      );
      Object.assign(font, {
        method: 'substitute',
        siteFamily: stack || null,
        url: substituteCssUrl(font.family, [font.weight]),
      });
    }
  }
  return { fonts: resolved, notes };
}

async function downloadLogo(
  request: APIRequestContext,
  paths: Paths,
  raw: RawPage,
  site: string,
  name: string,
  display: string,
  color: string,
): Promise<CaptureManifest['brand']['logo']> {
  for (const ranked of rankLogos(raw.logos).slice(0, 8)) {
    const { candidate } = ranked;
    if (candidate.kind === 'inline-svg' && candidate.svg) {
      writeFileSync(join(paths.out, 'logo.svg'), candidate.svg);
      return {
        source: 'inline-svg',
        file: 'logo.svg',
        url: site,
        kind: 'svg',
        width: candidate.width || null,
        height: candidate.height || null,
      };
    }
    if (!candidate.url) continue;
    let bytes: Buffer | null = null;
    if (candidate.url.startsWith('data:')) {
      const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(candidate.url);
      if (match?.[3])
        bytes = match[2]
          ? Buffer.from(match[3], 'base64')
          : Buffer.from(decodeURIComponent(match[3]));
    } else {
      const fetched = await fetchResource(
        request,
        candidate.url,
        3_000_000,
        sameSite(candidate.url, site),
      );
      if (fetched && fetched.status < 400) bytes = fetched.body;
    }
    if (!bytes || bytes.length === 0) continue;
    const kind = sniff(bytes);
    if (kind === 'html' || kind === 'unknown') {
      log(`  logo candidate ${candidate.url} is ${kind}, not an image (soft 404); skipped`);
      continue;
    }
    if (kind === 'ico' && ranked.source !== 'favicon') continue;
    const file = `logo.${kind === 'jpeg' ? 'jpg' : kind}`;
    writeFileSync(join(paths.out, file), bytes);
    const size = pngSize(bytes);
    const source: LogoSource =
      ranked.source === 'favicon' ? 'favicon' : kind === 'svg' ? 'svg' : 'png';
    return {
      source,
      file,
      url: candidate.url.startsWith('data:') ? site : candidate.url,
      kind: kind === 'svg' ? 'svg' : 'image',
      width: size?.width ?? (candidate.width || null),
      height: size?.height ?? (candidate.height || null),
    };
  }
  log('  no logo, inline logo or favicon could be downloaded; writing a wordmark of the name');
  const svg = wordmarkSvg(name, display, color);
  writeFileSync(join(paths.out, 'logo.svg'), svg);
  const width = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 0) || null;
  return { source: 'generated', file: 'logo.svg', url: null, kind: 'svg', width, height: 96 };
}

/** Text and images the customer supplied, fetched next to the tool, with `materials.json` beside them. */
function readMaterial(base: string): { entries: MaterialEntry[]; pages: StoredPage[] } {
  const manifestPath = join(base, 'materials.json');
  if (!existsSync(manifestPath)) return { entries: [], pages: [] };
  const list = readJson<Omit<MaterialEntry, 'path' | 'text_chars' | 'image'>[]>(manifestPath);
  const entries: MaterialEntry[] = [];
  const pages: StoredPage[] = [];
  for (const item of list) {
    const candidates = readdirSync(base).filter(
      (name) => name === item.name || name.includes(item.file_id),
    );
    const path = candidates[0] ? join(base, candidates[0]) : null;
    let text = '';
    let image: MaterialEntry['image'] = null;
    if (path) {
      const bytes = readFileSync(path);
      const type = item.content_type.toLowerCase();
      if (/^image\//.test(type)) {
        const size = pngSize(bytes);
        image = { width: size?.width ?? null, height: size?.height ?? null };
      } else if (/pdf/.test(type)) {
        let result = spawnSync('pdftotext', ['-layout', path, '-'], {
          encoding: 'utf8',
          maxBuffer: 20_000_000,
        });
        if (result.error && !LOCAL) {
          spawnSync('sh', ['-c', 'sudo -n apt-get install -y -q poppler-utils >/dev/null 2>&1'], {
            timeout: 180_000,
          });
          result = spawnSync('pdftotext', ['-layout', path, '-'], {
            encoding: 'utf8',
            maxBuffer: 20_000_000,
          });
        }
        text = result.stdout ?? '';
      } else if (/html/.test(type)) {
        text = htmlToText(bytes.toString('utf8'));
      } else if (/^text\/|json|markdown|csv|xml/.test(type)) {
        text = bytes.toString('utf8');
      }
    }
    entries.push({ ...item, path, text_chars: text.length, image });
    if (text) {
      pages.push({
        url: item.source_url,
        final_url: item.source_url,
        origin: 'material',
        file_id: item.file_id,
        status: null,
        content_type: item.content_type,
        title: item.name,
        text: { rendered: text, dom: text, meta: item.name, clean: text, illustrative: '' },
      });
      writeFileSync(join(base, `${item.name}.txt`), text);
    }
  }
  return { entries, pages };
}

/**
 * Captures the chosen pages, then measures the brand from the home page, downloads the logo,
 * resolves fonts, reads customer material, and writes the bundle the gate checks claims against
 * (`pages.json`), the manifest (`capture.json`), the result template and a summary. The last line
 * names the SHA-256 of `pages.json`, which binds the published bundle to this run.
 */
export async function capture(
  base: string,
  url: string,
  requested: string[],
  script: string,
): Promise<void> {
  const paths = pathsFor(base, url);
  const discoverPath = join(paths.out, 'discover.json');
  if (!existsSync(discoverPath)) await discover(base, url, script);
  const found = readJson<DiscoverFile>(discoverPath);
  const site = found.site;
  for (const dir of ['pages', 'text', 'shots'])
    mkdirSync(join(paths.out, dir), { recursive: true });
  log(`swap: ${ensureSwap().replace(/\n/g, ' | ') || 'none'}`);
  const ledger = new Ledger(paths.out);
  const existing = loadPages(paths);
  const taken = new Set(existing.map((page) => page.record.slug));
  const known = new Map(found.links.map((link) => [normaliseUrl(link.url), link]));
  const skipped: CaptureManifest['skipped'] = [];
  const queue: { url: string; kind: LinkKind }[] = [];
  for (const item of requested) {
    const key = normaliseUrl(item);
    if (!key) {
      skipped.push({ url: item, reason: 'not an http(s) address' });
      continue;
    }
    if (!sameSite(item, site)) {
      skipped.push({ url: item, reason: 'not on the site being researched' });
      continue;
    }
    const kind = known.get(key)?.kind ?? classifyLink(item, '', site);
    if (kind === 'login') {
      skipped.push({ url: item, reason: 'a sign-in or app page; never loaded' });
      continue;
    }
    if (!robotsAllow(found.robots, new URL(item).pathname)) {
      skipped.push({ url: item, reason: 'disallowed by robots.txt' });
      continue;
    }
    if (ledger.has(item) || queue.some((entry) => normaliseUrl(entry.url) === key)) continue;
    queue.push({ url: item, kind });
  }

  let browser: Browser | undefined;
  try {
    browser = await launch();
    let uiShots = existing.reduce(
      (sum, page) => sum + page.record.shots.filter((shot) => shot.kind === 'ui').length,
      0,
    );
    for (const item of queue) {
      if (!ledger.take(item.url)) {
        skipped.push({ url: item.url, reason: `over the ${MAX_PAGES}-page limit` });
        continue;
      }
      const slug = slugFor(item.url, taken);
      log(`loading ${item.url} (${ledger.pages.length}/${MAX_PAGES})`);
      const page = await capturePage(browser, paths, item.url, slug, item.kind, {
        withStyles: false,
        withLogos: false,
        uiShots: Math.max(0, Math.min(MAX_UI_SHOTS_PER_PAGE, MAX_UI_SHOTS - uiShots)),
      });
      uiShots += page.record.shots.filter((shot) => shot.kind === 'ui').length;
      savePage(paths, page);
    }

    const pages = loadPages(paths).sort((a, b) =>
      a.record.slug === 'home' ? -1 : b.record.slug === 'home' ? 1 : 0,
    );
    const home = pages.find((page) => page.record.slug === 'home');
    const raw = home?.raw;
    if (!raw?.styles) throw new Error('The home page has no measured styles. Run discover again.');

    const fetchContext = await browser.newContext({ viewport: VIEWPORT });
    const request = fetchContext.request;
    const colors = deriveColors(raw.styles);
    const { fonts, notes: fontNotes } = await resolveBrandFonts(request, raw, site);
    colors.notes.push(...fontNotes);
    const logoAlt = raw.logos.find((logo) => logo.alt)?.alt ?? '';
    const name = guessBrandName(raw.meta, raw.title, new URL(site).hostname, logoAlt);
    const display =
      fonts.find((font) => font.role === 'display')?.family ??
      fonts.find((font) => font.role === 'body')?.family ??
      'sans-serif';
    const wordmarkColor =
      contrast(colors.primary, colors.background) >= 3 ? colors.primary : colors.foreground;
    const logo = await downloadLogo(request, paths, raw, site, name, display, wordmarkColor);
    await fetchContext.close().catch(() => {});

    const material = readMaterial(base);
    const bundle: PagesBundle = {
      version: 1,
      site,
      captured_at: new Date().toISOString(),
      pages: [...pages.map((page) => page.stored), ...material.pages],
    };
    const bundleText = `${JSON.stringify(bundle)}\n`;
    writeFileSync(join(paths.out, 'pages.json'), bundleText);
    const digest = createHash('sha256').update(bundleText).digest('hex');

    const publish: PublishItem[] = [
      {
        path: join(paths.out, 'pages.json'),
        placeholder: placeholderFor('pages.json'),
        what: 'stored page text (evidence.pages_file_id)',
      },
      {
        path: join(paths.out, 'capture.json'),
        placeholder: placeholderFor('capture.json'),
        what: 'capture manifest (evidence.capture_file_id)',
      },
      {
        path: join(paths.out, logo.file),
        placeholder: placeholderFor(logo.file),
        what: `logo (${logo.source})`,
      },
      ...pages.flatMap((page) =>
        page.record.shots.map((shot: Shot) => ({
          path: join(paths.out, shot.file),
          placeholder: placeholderFor(shot.file),
          what: `screenshot ${shot.assetId}`,
        })),
      ),
    ];
    const manifest: CaptureManifest = {
      version: 1,
      site,
      host: siteHost(site),
      captured_at: bundle.captured_at,
      pages: pages.map((page) => page.record),
      skipped,
      probes: found.probes,
      llms_txt: found.llms_txt,
      brand: { name, colors, fonts, logo },
      login_links: raw.loginLinks,
      media: pages.flatMap((page) =>
        (page.raw?.media ?? []).map((item) => ({ ...item, page: page.record.final_url })),
      ),
      material: material.entries,
      publish,
      errors: pages
        .filter((page) => page.record.error)
        .map((page) => `${page.record.url}: ${page.record.error}`),
    };
    writeJson(join(paths.out, 'capture.json'), manifest);
    writeJson(join(paths.out, 'result.template.json'), buildTemplate(manifest));
    writeFileSync(
      join(base, 'jobs', 'capture-summary.txt'),
      `${captureSummary(manifest, paths, script)}\nBR_CAPTURE_DONE sha256=${digest} pages=${bundle.pages.length}\n`,
    );
    log(`BR_CAPTURE_DONE sha256=${digest} pages=${bundle.pages.length}`);
  } finally {
    await closeBrowser(browser);
  }
}

function captureSummary(manifest: CaptureManifest, paths: Paths, script: string): string {
  const { brand } = manifest;
  const c = brand.colors;
  const lines = [
    `CAPTURE DONE for ${manifest.site}`,
    `Output folder: ${paths.out}`,
    '',
    `Pages (${manifest.pages.length} of at most ${MAX_PAGES}). Read each text file before writing claims:`,
    ...manifest.pages.map(
      (page) =>
        `  ${page.kind.padEnd(9)} HTTP ${page.status ?? '---'} ${page.final_url}  "${page.title}"  -> ${page.text_file}${page.error ? `  ERROR ${page.error}` : ''}${page.hidden_overlays ? `  (${page.hidden_overlays} overlay(s) hidden for screenshots)` : ''}`,
    ),
    ...(manifest.skipped.length
      ? ['Skipped:', ...manifest.skipped.map((item) => `  ${item.url}: ${item.reason}`)]
      : []),
    '',
    `Brand, measured from computed styles: name guess "${brand.name}"`,
    `  background ${c.background}  foreground ${c.foreground}  primary ${c.primary}  accent ${c.accent ?? '-'}  muted ${c.muted ?? '-'}  mode ${c.mode}  radius ${c.radius ?? '-'}  css colour variables: ${c.cssVariables ? 'yes' : 'no'}`,
    `  brand colour candidates: ${c.candidates.map((item) => `${item.hex} (${item.sources.join(', ')})`).join('; ') || 'none'}`,
    ...c.notes.map((note) => `  note: ${note}`),
    `  fonts: ${brand.fonts.map((font) => `${font.role} ${font.family} [${font.method}] ${font.url ?? ''}`).join(' | ')}`,
    `  logo: ${brand.logo.source} -> ${join(paths.out, brand.logo.file)}${brand.logo.url ? ` from ${brand.logo.url}` : ''}`,
    '',
    'Calls to action seen (verbatim, with the page they are on):',
    ...manifest.pages.flatMap((page) =>
      page.ctas
        .slice(0, 8)
        .map(
          (cta) =>
            `  [${cta.placement}] "${cta.text}" -> ${cta.href ?? '(no link)'}  on ${page.final_url}`,
        ),
    ),
    '',
    'Product UI:',
    ...manifest.pages.flatMap((page) =>
      page.shots.flatMap((shot) =>
        shot.ui.map(
          (ui) =>
            `  ${shot.assetId} shows ${ui.label}${ui.mock ? ' (HTML mockup: figures are samples)' : ''} on ${page.final_url}`,
        ),
      ),
    ),
    `  probes: ${manifest.probes.map((probe) => `${probe.path} ${probe.found ? 'FOUND' : 'no'}`).join(', ')}`,
    `  login or app links: ${manifest.login_links.map((link) => link.url).join(', ') || 'none'}`,
    ...(manifest.media.length
      ? [`  video and embeds: ${manifest.media.map((item) => item.src).join(', ')}`]
      : []),
    ...(manifest.material.length
      ? [
          '',
          'Customer material (provenance "uploaded"):',
          ...manifest.material.map(
            (item) =>
              `  ${item.name} ${item.file_id} ${item.content_type} text: ${item.text_chars} chars${item.path ? '' : ' NOT FOUND on this computer'}; cite as ${item.source_url}`,
          ),
        ]
      : []),
    '',
    'Publish each of these files with publish_file, then replace its placeholder in the template with the fil_ id it returns:',
    ...manifest.publish.map(
      (item) => `  ${item.path}  (${item.what})  placeholder ${item.placeholder}`,
    ),
    '',
    `Template: ${join(paths.out, 'result.template.json')}. Copy it to ${join(paths.out, 'result.json')}, fill it in, then run:`,
    `  node ${script} verify ${join(paths.out, 'result.json')}`,
  ];
  if (manifest.errors.length)
    lines.push('', 'Errors:', ...manifest.errors.map((error) => `  ${error}`));
  return lines.join('\n');
}
