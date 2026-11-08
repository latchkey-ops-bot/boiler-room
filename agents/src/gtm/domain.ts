import { createHash, randomBytes } from 'node:crypto';
import { getDomain, getHostname, getPublicSuffix } from 'tldts';

/**
 * Names and keys. Every comparison of an address, a domain or a handle goes through `normalise`
 * first: lower-case, trimmed, Unicode NFKC, and a domain is its registrable domain by the public
 * suffix list.
 */

export const normalise = (text: string): string => text.normalize('NFKC').trim().toLowerCase();

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The registrable domain of a URL or host, such as `quillbox.example` for `www.quillbox.example`. */
export function registrableDomain(input: string): string | null {
  const host = getHostname(normalise(input));
  if (!host) return null;
  return getDomain(host, { allowPrivateDomains: true }) ?? null;
}

const SINGLE_ADDRESS = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/**
 * One email address, normalised, or null. The whole string must be a single address: a second `@`,
 * a comma, a semicolon, whitespace, `?`, `/`, `:` or a control character makes it none, so a
 * crafted `mailto:` such as `hello@victim.com?,hello@quillbox.example` is no address at all.
 */
export function singleAddress(raw: string): string | null {
  const normal = normalise(raw);
  return SINGLE_ADDRESS.test(normal) ? normal : null;
}

/** The domain part of an email address, as a registrable domain. */
export function emailDomain(address: string): string | null {
  const at = normalise(address).lastIndexOf('@');
  if (at < 1) return null;
  return registrableDomain(normalise(address).slice(at + 1));
}

/** Whether two URLs or hosts share a registrable domain. */
export function sameSite(a: string, b: string): boolean {
  const left = registrableDomain(a);
  return left !== null && left === registrableDomain(b);
}

/** A random opaque id with a prefix, such as `rm-7k2m9q`. Never derived from outside text. */
export function opaqueId(prefix: string, length = 6): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  const bytes = randomBytes(length);
  let id = '';
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return `${prefix}-${id}`;
}

/** A stable opaque id: the same input always gives the same id, and the id reveals nothing. */
export function stableId(prefix: string, input: string, length = 6): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  const digest = createHash('sha256').update(input).digest();
  let id = '';
  for (let index = 0; index < length; index++) {
    id += alphabet[(digest[index] ?? 0) % alphabet.length];
  }
  return `${prefix}-${id}`;
}

/** A random token for an opt-out link, and the hash the app stores in its place. */
export function optOutToken(): { token: string; hash: string } {
  const token = randomBytes(16).toString('hex');
  return { token, hash: sha256(token) };
}

/**
 * Domains GTM never films or contacts: platforms, big companies and hosts that are not one
 * startup's own site. The design names a public ranking's top 10,000; this list covers the hosts
 * the sources actually link to, and the scout rejects `big_company` for the rest.
 */
export const WELL_KNOWN = new Set([
  'github.com',
  'github.io',
  'gitlab.com',
  'bitbucket.org',
  'sourceforge.net',
  'codeberg.org',
  'arxiv.org',
  'medium.com',
  'substack.com',
  'dev.to',
  'hashnode.dev',
  'wordpress.com',
  'blogspot.com',
  'notion.site',
  'notion.so',
  'google.com',
  'youtube.com',
  'youtu.be',
  'x.com',
  'twitter.com',
  't.co',
  'facebook.com',
  'instagram.com',
  'meta.com',
  'threads.net',
  'bsky.app',
  'twitch.tv',
  'linkedin.com',
  'tiktok.com',
  'reddit.com',
  'producthunt.com',
  'ycombinator.com',
  'apple.com',
  'microsoft.com',
  'amazon.com',
  'aws.amazon.com',
  'cloudflare.com',
  'vercel.app',
  'vercel.com',
  'netlify.app',
  'herokuapp.com',
  'pages.dev',
  'workers.dev',
  'fly.dev',
  'replit.app',
  'replit.com',
  'huggingface.co',
  'kaggle.com',
  'npmjs.com',
  'pypi.org',
  'crates.io',
  'apps.apple.com',
  'play.google.com',
  'chromewebstore.google.com',
  'openai.com',
  'anthropic.com',
  'stripe.com',
  'shopify.com',
  'wikipedia.org',
  'archive.org',
  'docs.google.com',
  'drive.google.com',
  'dropbox.com',
  'figma.com',
  'loom.com',
  'itch.io',
  'steampowered.com',
  'steamcommunity.com',
  'gumroad.com',
  'discord.com',
  'discord.gg',
  'telegram.org',
  't.me',
  'gist.github.com',
  'colab.research.google.com',
  'nytimes.com',
  'bbc.co.uk',
  'theverge.com',
  'techcrunch.com',
]);

/**
 * Whether a domain is on the fixed list of well-known domains, or is a subdomain of a hosting
 * platform on it (such as `quillbox.vercel.app`), which is not a startup's own domain.
 */
export function isWellKnown(domain: string): boolean {
  const host = getHostname(normalise(domain)) ?? normalise(domain);
  const registrable = registrableDomain(host);
  const suffix = getPublicSuffix(host, { allowPrivateDomains: true });
  return (
    WELL_KNOWN.has(host) ||
    (registrable !== null && WELL_KNOWN.has(registrable)) ||
    (suffix !== null && WELL_KNOWN.has(suffix))
  );
}
