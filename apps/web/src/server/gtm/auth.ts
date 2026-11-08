/**
 * The GTM executor's machine auth. It holds one secret, `GTM_SERVICE_TOKEN`, which the website
 * holds too (a Worker secret set by `pnpm web:secrets:sync:staging` from STAGING_GTM_SERVICE_TOKEN).
 * Every `/api/gtm/v1/` request carries it as a bearer token, and the website compares the two in
 * constant time: both are hashed first, so the comparison never depends on where they differ or on
 * how long the presented one is.
 *
 * The same secret signs the short-lived file links the executor hands to the social provider, under
 * its own label, so a file link can never be replayed as a bearer token.
 */
import { sha256Hex, toHex } from '../runner/contract.ts';

/** A token shorter than this is treated as not configured: the routes answer 503. */
export const MIN_TOKEN_LENGTH = 32;

/** How long a signed file link works. */
export const FILE_LINK_SECONDS = 600;

/** True when `token` is long enough to be the GTM service token. */
export function tokenConfigured(token: string | null | undefined): token is string {
  return typeof token === 'string' && token.trim().length >= MIN_TOKEN_LENGTH;
}

/** Compares two equal-length strings without an early exit. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * True when `presented` is the configured token. Both sides are SHA-256 hashed and the hex digests
 * compared in constant time, so neither the length nor the first differing byte leaks.
 */
export async function tokenMatches(
  presented: string | null | undefined,
  expected: string | null | undefined,
): Promise<boolean> {
  if (!tokenConfigured(expected) || typeof presented !== 'string') return false;
  const [a, b] = await Promise.all([sha256Hex(presented), sha256Hex(expected.trim())]);
  return sameText(a, b);
}

/** The bearer token of a request, or null. */
export function bearerOf(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

const fileMessage = (filmId: string, expires: number) => `br-gtm-file/v1/${filmId}/${expires}`;

/** The signature on a file link for `filmId` that works until `expires` (epoch seconds). */
export function signFileLink(secret: string, filmId: string, expires: number): Promise<string> {
  return hmacHex(secret, fileMessage(filmId, expires));
}

/** True when `sig` signs `filmId` until `expires`, and `expires` has not passed. */
export async function fileLinkValid(
  secret: string,
  filmId: string,
  expires: number,
  sig: string,
  nowSeconds: number,
): Promise<boolean> {
  if (!Number.isInteger(expires) || expires < nowSeconds) return false;
  if (expires > nowSeconds + FILE_LINK_SECONDS) return false;
  return sameText(await signFileLink(secret, filmId, expires), sig.toLowerCase());
}
