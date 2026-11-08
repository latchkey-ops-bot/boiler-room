/**
 * The one input that starts a film: a public website. The crew fetches it, so anything that is not
 * a public http(s) site is refused here, before a film exists. The Worker cannot resolve DNS, so a
 * public name that points at a private address is the fetcher's problem, not this check's.
 */

export const MAX_URL_LENGTH = 2048;

export type FilmUrlResult = { ok: true; url: string } | { ok: false; reason: string };

/** Suffixes that never name a public website. */
const PRIVATE_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'intranet',
  'lan',
  'home',
  'home.arpa',
  'corp',
  'private',
  'test',
  'invalid',
  'example',
  'onion',
];

/**
 * Turns what a founder types into a URL, or says why it cannot be used. A bare host such as
 * `nova.com` gets `https://`. The result has no fragment, so the same site is one string.
 */
export function parseFilmUrl(input: string): FilmUrlResult {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'Paste the address of your website.' };
  if (trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, reason: 'That address is too long.' };
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: "That doesn't look like a web address." };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'Use an http or https address.' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'Remove the user name and password from the address.' };
  }
  if (url.port !== '') {
    return { ok: false, reason: 'Use the address without a port number.' };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || isIpv4(host)) {
    return { ok: false, reason: 'Use your website’s name, not an IP address.' };
  }
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((label) => !isHostLabel(label))) {
    return { ok: false, reason: 'Use a public website, such as yourstartup.com.' };
  }
  if (PRIVATE_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return { ok: false, reason: 'Use a public website, such as yourstartup.com.' };
  }
  const tld = labels[labels.length - 1] ?? '';
  if (/^[0-9]+$/.test(tld)) {
    return { ok: false, reason: 'Use a public website, such as yourstartup.com.' };
  }

  url.hash = '';
  url.hostname = host;
  return { ok: true, url: url.toString() };
}

/** The URL parser has already turned forms such as `0x7f.1` and `2130706433` into dotted quads. */
function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** Letters, digits and hyphens, or an internationalised label already in punycode. */
function isHostLabel(label: string): boolean {
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label);
}
