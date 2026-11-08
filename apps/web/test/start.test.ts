import { describe, expect, it } from 'vitest';
import { MAX_URL_LENGTH } from '../src/lib/film-url.ts';
import { carriedSite, NEW_FILM_PATH, prefillProblem, startTarget } from '../src/lib/start.ts';

describe('the URL field on the marketing site', () => {
  it('carries a website into a new video, as the founder typed it', () => {
    expect(startTarget('nova.com')).toEqual({ ok: true, next: '/films/new?url=nova.com' });
    expect(startTarget('  https://www.nova.com/pricing?plan=team&seats=3  ')).toEqual({
      ok: true,
      next: `/films/new?url=${encodeURIComponent('https://www.nova.com/pricing?plan=team&seats=3')}`,
    });
  });

  it('goes to the new-video page empty when nothing was typed', () => {
    expect(startTarget('')).toEqual({ ok: true, next: NEW_FILM_PATH });
    expect(startTarget('   ')).toEqual({ ok: true, next: NEW_FILM_PATH });
    expect(startTarget(null)).toEqual({ ok: true, next: NEW_FILM_PATH });
  });

  it('sends anything that is not a public website back to the hero, with the text kept', () => {
    const target = startTarget('localhost:3000');
    expect(target).toMatchObject({ ok: false, back: '/?url=localhost%3A3000#start' });
    expect(target.ok ? '' : target.reason).not.toBe('');
    expect(startTarget('ftp://nova.com').ok).toBe(false);
    expect(startTarget('10.0.0.1').ok).toBe(false);
    expect(startTarget('x'.repeat(MAX_URL_LENGTH + 50))).toMatchObject({
      ok: false,
      reason: 'That address is too long.',
    });
  });

  it('never builds a redirect that leaves the site', () => {
    for (const input of [
      '//evil.example',
      'https://evil.example',
      '/\\evil.example',
      'nova.com#x',
    ]) {
      const target = startTarget(input);
      const path = target.ok ? target.next : target.back;
      expect(path.startsWith('/') && !path.startsWith('//')).toBe(true);
      expect(new URL(path, 'https://boilerroom.example').origin).toBe('https://boilerroom.example');
    }
  });

  it('explains a prefilled URL only when it cannot be used', () => {
    expect(prefillProblem('')).toBeNull();
    expect(prefillProblem('nova.com')).toBeNull();
    expect(prefillProblem('nova')).toBe('Use a public website, such as yourstartup.com.');
  });
});

describe('the site carried through sign-up', () => {
  it("reads the site from Clerk's redirect, relative or absolute", () => {
    expect(carriedSite('/films/new?url=nova.com')).toBe('nova.com');
    expect(
      carriedSite('https://boiler-room.example/films/new?url=https%3A%2F%2Fwww.nova.com%2Fpricing'),
    ).toBe('nova.com');
  });

  it('shows nothing for a redirect elsewhere, an empty field or an unusable site', () => {
    expect(carriedSite(null)).toBeNull();
    expect(carriedSite('/films/new')).toBeNull();
    expect(carriedSite('/films?url=nova.com')).toBeNull();
    expect(carriedSite('/films/new?url=localhost%3A3000')).toBeNull();
    expect(carriedSite('http://[::1')).toBeNull();
  });
});
