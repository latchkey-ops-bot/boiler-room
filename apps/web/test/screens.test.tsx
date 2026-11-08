/**
 * The signed-in screens, rendered for real: the app layout and the films pages, against a local D1,
 * with films the SimulatedPipeline walks through its stages. Only Clerk and Next's router are
 * stood in for, because there is no signed-in browser here.
 *
 * To look at the screens, write them out and serve the folder:
 *   SCREENS_OUT=/some/dir pnpm --filter @boiler-room/web exec vitest run test/screens.test.tsx
 * Each screen is a static HTML file that links /styles/*.css and /brand/*.svg; serve the folder
 * with apps/web/src/styles at /styles and apps/web/public/brand at /brand.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import FilmPage from '../src/app/(app)/films/[id]/page.tsx';
import NewFilmPage from '../src/app/(app)/films/new/page.tsx';
import FilmsPage from '../src/app/(app)/films/page.tsx';
import AppLayout from '../src/app/(app)/layout.tsx';
import { addDays, utcToday } from '../src/lib/launch.ts';
import type { ApiContext, Principal } from '../src/server/api/context.ts';
import { createFilm, getFilmDetail, reviewScript } from '../src/server/api/films.ts';
import { setLaunchPlan } from '../src/server/api/launch.ts';
import { contextFor, startWorkerEnv } from './helpers.ts';

const page = vi.hoisted(() => ({
  principal: { userId: 'user_screens', orgId: null } as Principal,
  context: null as null | (() => Promise<ApiContext>),
  bindings: {} as Record<string, unknown>,
  pathname: '/films',
}));

vi.mock('../src/server/next.ts', () => ({
  pageContext: () => {
    if (!page.context) throw new Error('No page context');
    return page.context();
  },
  requireSignedIn: async () => page.principal,
  currentPrincipal: async () => page.principal,
  workerBindings: () => page.bindings,
}));

vi.mock('@clerk/nextjs', async () => {
  const { createElement } = await import('react');
  return {
    UserButton: () => createElement('span', { className: 'user-button-stand-in', title: 'You' }),
  };
});

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => page.pathname,
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }),
}));

type Proxy = Awaited<ReturnType<typeof startWorkerEnv>>;
let proxy: Proxy;

/** A clock set by hand, close to now so "12 min ago" reads true in the browser too. */
const NOW = Date.now();
let clockAt = NOW;
const clock = () => new Date(clockAt);
const at = (msFromNow: number) => {
  clockAt = NOW + msFromNow;
};
const SECOND = 1000;
const MINUTE = 60 * SECOND;

let users = 0;
async function signIn(): Promise<() => Promise<ApiContext>> {
  users += 1;
  const principal: Principal = { userId: `user_screens_${users}`, orgId: null };
  page.principal = principal;
  const make = () => contextFor(principal, proxy.env, clock);
  page.context = make;
  return make;
}

beforeAll(async () => {
  proxy = await startWorkerEnv();
  page.bindings = { DB: proxy.env.DB, FILMS: proxy.env.FILMS, PIPELINE: 'simulated' };
});
afterAll(async () => {
  await proxy?.dispose();
});

/** Renders a page inside the real app layout, as the browser gets it before any script runs. */
async function render(pathname: string, content: Promise<ReactElement> | ReactElement) {
  page.pathname = pathname;
  const children = await content;
  const shell = await AppLayout({ children: children as ReactNode });
  return renderToStaticMarkup(shell);
}

const OUT = process.env.SCREENS_OUT;
const FONTS =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Nunito:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600;700&family=Pixelify+Sans:wght@600..700&display=swap';

function save(name: string, html: string) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  const document = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/styles/tokens.css">
<link rel="stylesheet" href="/styles/components.css">
<link rel="stylesheet" href="/styles/app.css">
<style>
:root{--font-bricolage:'Bricolage Grotesque';--font-nunito:'Nunito';--font-jetbrains:'JetBrains Mono';--font-pixelify:'Pixelify Sans'}
.user-button-stand-in{display:inline-block;width:28px;height:28px;border-radius:50%;background:var(--br-steel)}
</style>
</head><body>${html}</body></html>`;
  writeFileSync(join(OUT, `${name}.html`), document);
}

const filmPage = (id: string) => FilmPage({ params: Promise.resolve({ id }) });

/** A tag and its text, ignoring the markup inside. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

describe('the film page', () => {
  it('pauses for the founder with one pink call to action, and counts down to launch', async () => {
    const ctx = await signIn();
    at(-12 * MINUTE);
    const { film } = await createFilm(await ctx(), { url: 'nova.example.com' });
    at(0);
    await setLaunchPlan(await ctx(), film.id, {
      // The server counts in UTC; the browser recounts in the viewer's own calendar.
      date: addDays(utcToday(clock()), 11),
      channels: ['x', 'linkedin', 'product_hunt', 'reels'],
    });
    const html = await render(`/films/${film.id}`, filmPage(film.id));
    save('film-needs-you', html);
    const words = text(html);

    expect(words).toContain('Your script is ready');
    expect(words).toContain("Approve it today and you're set for launch day.");
    expect(html.match(/btn btn-primary/g)).toHaveLength(1);
    expect(html).toContain(`href="/films/${film.id}/script"`);
    expect(words).toContain('Step 4 of 10 · paused for you');
    // The four stations before it are done, the approval waits, the rest are queued.
    expect(html.match(/station station-done/g)).toHaveLength(3);
    expect(html.match(/station station-active/g)).toHaveLength(1);
    expect(html.match(/class="station"/g)).toHaveLength(6);
    // Launch plan: the founder's day and channels, and the numbers from the Nova campaign.
    expect(words).toMatch(/11 days to launch/);
    expect(words).toContain('Product Hunt');
    expect(words).toContain('Length 20s');
    expect(words).toContain('Claims · 3 approved 4');
    expect(words).toContain('Videos, at most 12');
    expect(words).toContain('Brand found on nova.example.com');
    expect(words).toContain('Sora for headlines, Inter for text.');
    // The crew's decisions, with the sourced figure highlighted and the unsourced one not.
    expect(words).toContain('Read 6 pages on nova.example.com.');
    expect(html).toContain('class="claim claim-button"');
    expect(html).toMatch(/<button[^>]*class="claim claim-button"[^>]*>40%<\/button>/);
    expect(html).not.toMatch(/claim-button"[^>]*>73%/);
    // Simulated, and said so. Boyle does not steam while the crew waits.
    expect(words).toContain('Simulated');
    expect(words).toContain('This is a simulated video.');
    expect(html).not.toContain('class="puff');
  });

  it('shows the crew at work, with Boyle steaming, and asks for the launch day', async () => {
    const ctx = await signIn();
    at(-10 * SECOND);
    const { film } = await createFilm(await ctx(), { url: 'orbit.example.com' });
    at(0);
    const html = await render(`/films/${film.id}`, filmPage(film.id));
    save('film-working', html);
    const words = text(html);

    expect(words).toContain('The crew is on it');
    expect(words).toContain('The Researcher is reading your site.');
    expect(words).toContain('This page updates by itself.');
    expect(html).toContain('class="puff puff-a"');
    expect(words).toContain('Researching');
    expect(words).toContain('Step 1 of 10 · researching');
    expect(html).not.toContain('alert-needs');
    expect(html).not.toContain('btn btn-primary');
    expect(words).toContain('When do you launch?');
    expect(words).toContain('Where will you post it?');
    expect(words).not.toContain('days to launch');
    expect(words).toContain('once the Director has written your script');
  });

  it('moves on as the crew works: three moments of one film', async () => {
    const ctx = await signIn();
    at(-35 * SECOND);
    const { film } = await createFilm(await ctx(), { url: 'lumen.example.com' });
    const moments: [string, number, string][] = [
      ['film-live-0s', -35 * SECOND, 'Step 1 of 10'],
      ['film-live-20s', -15 * SECOND, 'Step 3 of 10 · checking'],
      ['film-live-35s', 0, 'Step 4 of 10 · paused for you'],
    ];
    for (const [name, when, summary] of moments) {
      at(when);
      const html = await render(`/films/${film.id}`, filmPage(film.id));
      save(name, html);
      expect(text(html)).toContain(summary);
    }
  });

  it('hands over the files once delivered', async () => {
    const ctx = await signIn();
    at(-3 * MINUTE);
    const { film } = await createFilm(await ctx(), { url: 'pebble.example.com' });
    at(-3 * MINUTE + 31 * SECOND);
    await reviewScript(await ctx(), film.id, {
      decision: 'approve',
      version: 1,
      hookId: null,
      ctaId: 'start-free',
      formats: ['16:9', '9:16'],
    });
    at(0);
    const html = await render(`/films/${film.id}`, filmPage(film.id));
    save('film-done', html);
    const words = text(html);
    expect(words).toContain('Your video is ready');
    expect(words).toContain('2 files are waiting');
    expect(html).toContain(`href="/films/${film.id}/deliverables"`);
    expect(words).toContain('Delivered');
    expect(html.match(/station station-done/g)).toHaveLength(10);
    expect(words).toMatch(/You Approved Approved version 1\./);
    expect(html).not.toContain('class="puff');
  });
});

describe('the app home', () => {
  it('lists every video with its state, and puts the one that needs you first', async () => {
    const ctx = await signIn();
    // Delivered yesterday.
    at(-26 * 60 * MINUTE);
    const pebble = await createFilm(await ctx(), { url: 'pebble.example.com' });
    at(-26 * 60 * MINUTE + 31 * SECOND);
    await reviewScript(await ctx(), pebble.film.id, {
      decision: 'approve',
      version: 1,
      hookId: null,
      ctaId: 'start-free',
      formats: ['16:9'],
    });
    at(-26 * 60 * MINUTE + 90 * SECOND);
    await getFilmDetail(await ctx(), pebble.film.id);
    // Waiting on the founder since 12 minutes ago.
    at(-12 * MINUTE);
    const nova = await createFilm(await ctx(), { url: 'nova.example.com' });
    at(-12 * MINUTE + 31 * SECOND);
    await getFilmDetail(await ctx(), nova.film.id);
    // Rendering now.
    at(-60 * SECOND);
    const orbit = await createFilm(await ctx(), { url: 'orbit.example.com' });
    at(-24 * SECOND);
    await reviewScript(await ctx(), orbit.film.id, {
      decision: 'approve',
      version: 1,
      hookId: null,
      ctaId: 'book-demo',
      formats: ['16:9', '9:16', '1:1'],
    });
    // Just started.
    at(-5 * SECOND);
    await createFilm(await ctx(), { url: 'lumen.example.com' });
    at(0);

    const html = await render('/films', FilmsPage());
    save('films-home', html);
    const words = text(html);
    expect(words).toContain('Your videos');
    expect(words).toContain('Nova launch needs you');
    expect(html.match(/btn btn-primary/g)).toHaveLength(1);
    expect(words).toContain('All videos');
    expect(words).toContain('Rendering');
    expect(words).toContain('Researching');
    expect(words).toContain('Needs you');
    expect(words).toContain('Delivered');
    expect(words).toContain('Yesterday');
    expect(words).toContain('Get files');
    expect(words).toContain('Review');
    expect(html.match(/badge-simulated/g)).toHaveLength(4);
  });

  it('offers one way in when there are no videos yet', async () => {
    await signIn();
    at(0);
    const html = await render('/films', FilmsPage());
    save('films-empty', html);
    expect(text(html)).toContain('No videos yet');
    expect(html.match(/btn btn-primary/g)).toHaveLength(1);
  });

  it('starts a video from one field, prefilled from the landing page', async () => {
    await signIn();
    const html = await render(
      '/films/new',
      NewFilmPage({ searchParams: Promise.resolve({ url: 'nova.example.com' }) }),
    );
    save('films-new', html);
    expect(html).toContain('value="nova.example.com"');
    expect(text(html)).toContain('What are you launching?');
  });
});
