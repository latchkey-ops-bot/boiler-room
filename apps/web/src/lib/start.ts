import { MAX_URL_LENGTH, parseFilmUrl } from './film-url.ts';

/**
 * Where the marketing site's URL field sends a visitor. `/start?url=` is the one door into the
 * app from the website: it carries what the founder typed into a new video, through sign-up when
 * they have no account yet.
 *
 * - Nothing typed: straight to the new-video page, which asks for the URL.
 * - A usable website: the new-video page with the URL filled in.
 * - Something that is not a public website: back to the hero, with the text still in the field and
 *   the reason under it. The browser normally catches this first; this covers a page without
 *   JavaScript.
 */
export type StartTarget = { ok: true; next: string } | { ok: false; back: string; reason: string };

export const NEW_FILM_PATH = '/films/new';

export function startTarget(input: string | null | undefined): StartTarget {
  const typed = (input ?? '').trim().slice(0, MAX_URL_LENGTH + 1);
  if (typed === '') return { ok: true, next: NEW_FILM_PATH };
  const parsed = parseFilmUrl(typed);
  if (!parsed.ok) {
    return { ok: false, back: `/?url=${encodeURIComponent(typed)}#start`, reason: parsed.reason };
  }
  return { ok: true, next: `${NEW_FILM_PATH}?url=${encodeURIComponent(typed)}` };
}

/** The reason to show under a prefilled hero field, or null when the text is fine or empty. */
export function prefillProblem(input: string | null | undefined): string | null {
  const target = startTarget(input);
  return target.ok ? null : target.reason;
}
