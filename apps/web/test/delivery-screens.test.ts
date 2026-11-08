/**
 * The delivery, settings, empty and error screens, rendered to HTML from real data: films made by
 * the SimulatedPipeline through the API on a local D1. Clerk and the Next router are stubbed, so
 * no signed-in user is needed.
 *
 * To look at the screens, set BR_SCREENS_DIR to a folder. Each screen is also written there as a
 * page in the app shell, linking `/styles/*.css` and `/brand/*`: serve the folder with those two
 * paths pointing at src/styles and public/brand, and open it in a browser.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ pathname: '/films' }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => router.pathname,
  useRouter: () => ({ push() {}, refresh() {} }),
}));
vi.mock('@clerk/nextjs', () => ({
  SignOutButton: ({ children }: { children: ReactNode }) => children,
  useClerk: () => ({ openUserProfile() {} }),
}));

import AppError from '../src/app/(app)/error.tsx';
import AppNotFound from '../src/app/(app)/not-found.tsx';
import { AppNav } from '../src/components/app-nav.tsx';
import { Brand } from '../src/components/brand.tsx';
import { DeliveryScreen } from '../src/components/delivery-screen.tsx';
import { SettingsScreen } from '../src/components/settings-screen.tsx';
import { getDb } from '../src/db/client.ts';
import { deliverables, films } from '../src/db/schema.ts';
import { clock, cutsOf, fileSize, openingName, variantName } from '../src/lib/delivery.ts';
import type { Principal } from '../src/server/api/context.ts';
import {
  createFilm,
  type FilmDetail,
  getFilmDetail,
  MAX_REVISIONS_PER_FILM,
  requestRevision,
  reviewScript,
} from '../src/server/api/films.ts';
import { SAMPLE_CAMPAIGN } from '../src/server/pipeline/simulated.ts';
import { contextFor, startWorkerEnv, testClock } from './helpers.ts';

type Proxy = Awaited<ReturnType<typeof startWorkerEnv>>;
let proxy: Proxy;

beforeAll(async () => {
  proxy = await startWorkerEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});

let users = 0;
function newUser(): Principal {
  users += 1;
  return { userId: `user_screens_${users}`, orgId: null };
}

const approve = (version: number) => ({
  decision: 'approve' as const,
  // The sample's price is cited but nobody has confirmed it: approving vouches for it.
  confirmedClaimIds: ['pricing'],
  version,
  hookId: null,
  ctaId: 'start-free',
  formats: ['16:9' as const, '9:16' as const, '1:1' as const],
});

/** A simulated film walked to where the test wants it. */
async function simulatedFilm(
  until: 'working' | 'script' | 'delivered' | 'revising' | 'revised_script' | 'recut',
) {
  const time = testClock();
  const ctx = await contextFor(newUser(), proxy.env, time.now);
  const { film } = await createFilm(ctx, { url: 'nova.com' });
  const id = film.id;
  time.advance(12);
  if (until === 'working') return getFilmDetail(ctx, id);
  time.advance(19);
  if (until === 'script') return getFilmDetail(ctx, id);
  await reviewScript(ctx, id, approve(1));
  time.advance(41);
  if (until === 'delivered') return getFilmDetail(ctx, id);
  await requestRevision(ctx, id, { version: 1, note: 'Make the logo bigger in the last scene.' });
  time.advance(3);
  if (until === 'revising') return getFilmDetail(ctx, id);
  time.advance(9);
  if (until === 'revised_script') return getFilmDetail(ctx, id);
  await reviewScript(ctx, id, approve(2));
  time.advance(41);
  return getFilmDetail(ctx, id);
}

/** A delivered film with real files in R2, as the Naive crew will deliver them. */
async function realFilm(): Promise<FilmDetail> {
  const time = testClock();
  const ctx = await contextFor(newUser(), proxy.env, time.now);
  const db = getDb(proxy.env.DB);
  const now = time.now();
  const id = 'flm_screensrealfilm00000';
  await db.insert(films).values({
    id,
    accountId: ctx.account.id,
    createdBy: ctx.principal.userId,
    url: 'https://nova.com/',
    status: 'done',
    stage: 'delivery',
    pipeline: 'naive',
    pipelineRunId: 'run_screens',
    scriptVersion: 1,
    campaignJson: JSON.stringify(SAMPLE_CAMPAIGN),
    chosenCta: 'start-free',
    formatsJson: '["16:9","9:16"]',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(deliverables).values(
    (['16:9', '9:16'] as const).map((format, index) => ({
      id: `dlv_real_${index}`,
      filmId: id,
      variantKey: `${format}.main.start-free`,
      format,
      ctaId: 'start-free',
      fileName: `nova-com-${format.replace(':', 'x')}-main.mp4`,
      contentType: 'video/mp4',
      r2Key: `films/${id}/${format}.mp4`,
      bytes: 2_400_000 + index * 600_000,
      durationSeconds: 20,
      scriptVersion: 1,
      createdAt: now,
    })),
  );
  return getFilmDetail(ctx, id);
}

async function failedFilm(): Promise<FilmDetail> {
  const time = testClock();
  const ctx = await contextFor(newUser(), proxy.env, time.now);
  const db = getDb(proxy.env.DB);
  const now = time.now();
  const id = 'flm_screensfailedfilm000';
  await db.insert(films).values({
    id,
    accountId: ctx.account.id,
    createdBy: ctx.principal.userId,
    url: 'https://kite.example.com/',
    status: 'failed',
    stage: 'render',
    pipeline: 'naive',
    pipelineRunId: 'run_failed',
    scriptVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
  return getFilmDetail(ctx, id);
}

function delivery(detail: FilmDetail): string {
  return render(createElement(DeliveryScreen, { detail, maxRevisions: MAX_REVISIONS_PER_FILM }));
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/**
 * The opening tags of every element with this class, on the screen itself. A closed dialog, such
 * as "Ask for changes", is not on the screen until it opens.
 */
function withClass(html: string, name: string): string[] {
  const onScreen = html.replace(/<dialog[\s\S]*?<\/dialog>/g, '');
  return [...onScreen.matchAll(/<[a-z]+\b[^>]*class="([^"]*)"[^>]*>/g)]
    .filter((match) => match[1]?.split(' ').includes(name))
    .map((match) => match[0]);
}

/** What a reader sees: the words, without tags or entities. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('the delivery screen', () => {
  it('shows a delivered simulated video, labelled once, with a preview that plays', async () => {
    const html = delivery(await simulatedFilm('delivered'));
    shoot('delivery-simulated', '/films/x/deliverables', html, true);
    expect(text(html)).toContain('Your video is ready');
    // One simulated label on the screen: the title's, as no app banner shows here.
    expect(withClass(html, 'badge-simulated')).toHaveLength(1);
    expect(text(html)).not.toContain('This is a simulated video.');
    expect(text(html)).toContain("Preview of your approved script · Nova's brand");
    // One row per shape, none downloadable, and no "No file" chips that look like buttons.
    expect(withClass(html, 'file')).toHaveLength(3);
    expect(text(html)).toContain('Landscape');
    expect(text(html)).toContain('Reels, TikTok, Shorts and stories');
    expect(withClass(html, 'btn-primary')).toHaveLength(0);
    expect(text(html).match(/No file/g)).toHaveLength(1);
    expect(text(html)).not.toContain('No file: simulated');
    // The preview plays: a real play control, and the time.
    expect(html).toContain('aria-label="Play"');
    expect(text(html)).toContain('0:00 / 0:20');
    // The preview is the customer's brand and script, through the shared renderer.
    expect(text(html)).toContain(SAMPLE_CAMPAIGN.scenes[0]?.text[0]?.value ?? '');
    expect(html).toContain('--bs-bg:#0B1020');
    expect(html).toContain('--bs-display:&#x27;Sora&#x27;, system-ui');
    // Showcase and the one way to ask for changes, with the limit said plainly.
    expect(text(html)).toContain('Show my video on the Boiler Room showcase');
    expect(text(html)).toContain('Off');
    expect(text(html)).toContain('Simulated videos never appear on the showcase');
    expect(text(html)).toContain(
      `Each video can be changed ${MAX_REVISIONS_PER_FILM} times; this one has ${MAX_REVISIONS_PER_FILM} changes left.`,
    );
    expect(text(html)).toContain('Ask for changes');
    expect(text(html)).not.toContain('Want something changed?');
  });

  it('says nothing simulated when the app banner already labels the screen', async () => {
    const detail = await simulatedFilm('delivered');
    const html = render(
      createElement(DeliveryScreen, { detail, maxRevisions: MAX_REVISIONS_PER_FILM, banner: true }),
    );
    expect(withClass(html, 'badge-simulated')).toHaveLength(0);
  });

  it('plays and downloads a real film, with "Download all" as the one primary action', async () => {
    const detail = await realFilm();
    const html = delivery(detail);
    shoot('delivery-real', '/films/x/deliverables', html, false);
    expect(html).toContain(`<video`);
    expect(html).toContain(`src="${detail.deliverables[0]?.playUrl}"`);
    expect(withClass(html, 'btn-primary')).toHaveLength(1);
    expect(text(html)).toContain('Download all 2');
    expect(text(html)).toContain('2.4 MB');
    expect(text(html)).not.toContain('Simulated');
  });

  it('keeps the first cut while the crew works on the changes', async () => {
    const html = delivery(await simulatedFilm('revising'));
    shoot('delivery-revising', '/films/x/deliverables', html, true);
    expect(text(html)).toContain('The crew is working on your changes');
    expect(text(html)).toContain('The files below are from version 1');
    expect(withClass(html, 'file')).toHaveLength(3);
    // No second revision, and no showcase change, until the new cut is delivered.
    expect(text(html)).not.toContain('Ask for changes');
    expect(text(html)).not.toContain('Show my video');
  });

  it('sends the founder to the new script when it is ready, as the one primary action', async () => {
    const html = delivery(await simulatedFilm('revised_script'));
    shoot('delivery-revised-script', '/films/x/deliverables', html, true);
    expect(text(html)).toContain('Your new script is ready');
    expect(text(html)).toContain('Approve version 2');
    expect(withClass(html, 'btn-primary')).toEqual([
      expect.stringMatching(/href="\/films\/flm_[0-9a-z]{20}\/script"/),
    ]);
  });

  it('shows the new cut first and tucks the first one away', async () => {
    const html = delivery(await simulatedFilm('recut'));
    shoot('delivery-recut', '/films/x/deliverables', html, true);
    expect(text(html)).toContain('3 files · version 2');
    expect(text(html)).toContain('Earlier cut (1)');
    expect(text(html)).toContain('nova-com-16x9-main-v2.mp4');
    expect(text(html)).toContain('nova-com-16x9-main.mp4');
    expect(text(html)).toContain(`this one has ${MAX_REVISIONS_PER_FILM - 1} changes left.`);
  });

  it('says the video is on its way before anything is delivered', async () => {
    const html = delivery(await simulatedFilm('working'));
    shoot('delivery-waiting', '/films/x/deliverables', html, true);
    expect(text(html)).toContain('Your video is on its way');
    expect(html).toContain('puff');
    expect(withClass(html, 'file')).toHaveLength(0);
    expect(withClass(html, 'btn-primary')).toHaveLength(0);
  });

  it('sends the founder to the script when it is waiting for them', async () => {
    const html = delivery(await simulatedFilm('script'));
    shoot('delivery-script-waiting', '/films/x/deliverables', html, true);
    expect(text(html)).toContain('Your script is waiting for you');
    expect(withClass(html, 'btn-primary')).toHaveLength(1);
  });

  it('says plainly when the crew could not finish', async () => {
    const html = delivery(await failedFilm());
    shoot('delivery-failed', '/films/x/deliverables', html, false);
    expect(text(html)).toContain("The crew couldn't finish this video");
    expect(html).toContain('href="/films/new?url=https%3A%2F%2Fkite.example.com%2F"');
  });

  it('offers a new video once the revisions are used up', async () => {
    const detail = await simulatedFilm('delivered');
    const used = {
      ...detail,
      revisions: Array.from({ length: MAX_REVISIONS_PER_FILM }, (_, index) => ({
        scriptVersion: index + 1,
        note: 'x',
        requestedAt: detail.film.updatedAt,
      })),
    };
    const html = delivery(used);
    expect(text(html)).not.toContain('Ask for changes');
    expect(text(html)).toContain(`This video has had ${MAX_REVISIONS_PER_FILM} revisions`);
  });
});

describe('the settings screen', () => {
  const memberSince = new Date('2026-11-07T12:00:00Z');

  it('names the founder, who sees the videos, and the way out', () => {
    const html = render(
      createElement(SettingsScreen, {
        person: { name: 'Sam Rivera', email: 'sam@nova.example.com' },
        owner: { kind: 'user' },
        accountId: 'acc_4k8d2m0r9t1v3w5x7y9z',
        memberSince,
      }),
    );
    shoot('settings', '/settings', html, true);
    expect(text(html)).toContain('Sam Rivera');
    expect(text(html)).toContain('sam@nova.example.com');
    expect(text(html)).toContain('Only you');
    expect(text(html)).toContain('7 November 2026');
    expect(text(html)).toContain('Log out');
    expect(text(html)).toContain('Manage profile and password');
    expect(withClass(html, 'btn-primary')).toHaveLength(0);
    expect(text(html)).toContain('On the public showcase None of your videos.');
  });

  it('says what the founder put on the showcase, next to who sees the videos here', () => {
    const html = render(
      createElement(SettingsScreen, {
        person: null,
        owner: { kind: 'user' },
        showcase: { real: 1, simulated: 1 },
        accountId: 'acc_4k8d2m0r9t1v3w5x7y9z',
        memberSince,
      }),
    );
    expect(text(html)).toContain('Who can see them here Only you');
    expect(text(html)).toContain(
      '1 video, for anyone to see; 1 simulated video you turned on, which never appears.',
    );
    expect(html).toContain('href="/showcase"');
  });

  it('says an organisation shares the videos, even when its name is unknown', () => {
    const named = render(
      createElement(SettingsScreen, {
        person: null,
        owner: { kind: 'org', name: 'Acme' },
        accountId: 'acc_1',
        memberSince,
      }),
    );
    expect(text(named)).toContain('Everyone in Acme');
    const unnamed = render(
      createElement(SettingsScreen, {
        person: null,
        owner: { kind: 'org', name: null },
        accountId: 'acc_1',
        memberSince,
      }),
    );
    expect(text(unnamed)).toContain('Everyone in your organisation');
  });
});

describe('error and not-found states', () => {
  it('lets the founder try again after an error, with a reference for the logs', () => {
    const error = Object.assign(new Error('secret detail'), { digest: '2918374650' });
    const html = render(createElement(AppError, { error, reset() {} }));
    shoot('error', '/films', html, false);
    expect(text(html)).toContain("This page didn't load");
    expect(text(html)).toContain('Reference 2918374650');
    expect(text(html)).not.toContain('secret detail');
    expect(withClass(html, 'btn-primary')).toHaveLength(1);
  });

  it('says a missing video is missing, inside the app', () => {
    const html = render(createElement(AppNotFound));
    shoot('not-found', '/films', html, false);
    expect(text(html)).toContain("We can't find that video");
    expect(html).toContain('href="/films"');
  });
});

describe('delivery words', () => {
  it('names openings, calls to action, sizes and times the way a founder reads them', () => {
    expect(openingName(null, SAMPLE_CAMPAIGN)).toBe('Main opening');
    expect(openingName('open-question', SAMPLE_CAMPAIGN)).toBe('Opening: “Still waiting on CI?”');
    expect(openingName('gone', null)).toBe('Alternate opening');
    expect(
      variantName(
        {
          id: 'dlv',
          format: '16:9',
          hookId: null,
          ctaId: 'book-demo',
          fileName: 'a.mp4',
          contentType: 'video/mp4',
          bytes: null,
          durationSeconds: 20,
          scriptVersion: 1,
          downloadUrl: null,
          playUrl: null,
        },
        SAMPLE_CAMPAIGN,
      ),
    ).toBe('Main opening, ends on “Book a demo”');
    expect(clock(20)).toBe('0:20');
    expect(clock(75)).toBe('1:15');
    expect(fileSize(2_400_000)).toBe('2.4 MB');
    expect(fileSize(12_000)).toBe('12 KB');
    expect(fileSize(null)).toBeNull();
  });

  it('groups files into cuts, newest first, in shape order', () => {
    const file = (format: '16:9' | '9:16' | '1:1', scriptVersion: number) => ({
      id: `${format}-${scriptVersion}`,
      format,
      hookId: null,
      ctaId: null,
      fileName: `${format}.mp4`,
      contentType: 'video/mp4',
      bytes: null,
      durationSeconds: null,
      scriptVersion,
      downloadUrl: null,
      playUrl: null,
    });
    const cuts = cutsOf([file('1:1', 1), file('16:9', 2), file('9:16', 1), file('16:9', 1)]);
    expect(cuts.map((cut) => [cut.version, cut.files.map((item) => item.format)])).toEqual([
      [2, ['16:9']],
      [1, ['16:9', '9:16', '1:1']],
    ]);
  });
});

describe('files from before versions were kept', () => {
  it('never says version 0', async () => {
    const delivered = await simulatedFilm('delivered');
    const old = {
      ...delivered,
      deliverables: delivered.deliverables.map((file) => ({ ...file, scriptVersion: 0 })),
    };
    expect(text(delivery(old))).not.toMatch(/version 0/i);

    const revising = await simulatedFilm('revising');
    const oldRevising = {
      ...revising,
      deliverables: revising.deliverables.map((file) => ({ ...file, scriptVersion: 0 })),
    };
    const html = text(delivery(oldRevising));
    expect(html).not.toMatch(/version 0/i);
    expect(html).toContain('The files below are from your last delivery');
  });
});

// ---------- Optional: write each screen as a page in the app shell ----------

function shoot(name: string, pathname: string, screen: string, simulated: boolean) {
  const dir = process.env.BR_SCREENS_DIR;
  if (!dir) return;
  router.pathname = pathname;
  const side = render(
    createElement(
      'aside',
      { className: 'side' },
      createElement(Brand, { href: '/films' }),
      createElement(AppNav),
      createElement('div', { className: 'me' }, createElement('span', { className: 'avatar' })),
    ),
  );
  const note = simulated
    ? '<p class="env-note" role="note">Simulated films: no crew is working here, and nothing is rendered.</p>'
    : '';
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Nunito:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600;700&family=Pixelify+Sans:wght@600..700&display=swap">
<link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/components.css">
<link rel="stylesheet" href="/styles/app.css"><link rel="stylesheet" href="/styles/delivery.css">
<style>
  :root { --font-bricolage: 'Bricolage Grotesque'; --font-nunito: 'Nunito'; --font-jetbrains: 'JetBrains Mono'; --font-pixelify: 'Pixelify Sans'; }
  .me .avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--br-steel); }
</style></head><body>
<div class="surface-app app-shell">${side}<div>${note}<main id="main" class="app-main">${screen}</main></div></div>
</body></html>`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.html`), page);
}
