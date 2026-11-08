/**
 * Collapses every run of whitespace to one space and trims. Zero-width characters are removed,
 * because a page can put them between words where the eye sees nothing. Nothing else changes:
 * case, punctuation and quotation marks stay as they are, so a quote that matches is verbatim.
 */
export function normaliseWhitespace(text: string): string {
  return text
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The form two addresses of one page share: lower-case host, no fragment, no default port, and no
 * trailing slash on a path other than the root. The query is kept, since it can select content.
 */
export function normaliseUrl(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  url.hash = '';
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/';
  return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
}

/** The host a run is filed under, without a leading `www.`. */
export function siteHost(input: string): string {
  return new URL(input).hostname.toLowerCase().replace(/^www\./, '');
}

/** A lowercase slug made from any text, such as a page path. Never empty. */
export function slugify(text: string, fallback = 'page'): string {
  const slug = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** Every group of digits in a text, without thousands separators: "1,200.5" gives "1200.5". */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map(([raw]) =>
    raw.replace(/,(?=\d{3}(?:\D|$))/g, ''),
  );
}
