/**
 * The contract between the website and the runner on a film's Naive computer, version 1.
 *
 * There is one contract file: `services/film-runner/src/contract.ts`, which the runner runs on the
 * computer and the website imports as `@boiler-room/film-runner/contract`. It holds the bootstrap
 * path, the launch and stop commands, the canonical string, the key derivation, the event shapes
 * and the upload kinds. This module only gives the website's code the names it uses, and adds the
 * website's signing helpers on top of the same canonical string. It must not define any part of
 * the wire format itself.
 *
 * Every runner request is signed with a key for its own film and run:
 *
 *   K = HMAC-SHA256(RUNNER_SIGNING_SECRET, "br-runner/v1/" + filmId + "/" + runId)
 *
 * The website derives K per request, so D1 holds nothing secret. The runner gets K as hex in the
 * bootstrap file and keeps it in memory. A leaked computer can sign only for its own film and run.
 */
import {
  type Approval,
  type CanonicalInput,
  canonicalString,
  EMPTY_SHA256,
  HEADERS,
  newNonce,
  type Phase,
  sha256Hex,
  signCanonical,
  verifyCanonical,
} from '@boiler-room/film-runner/contract';

export {
  ADAPTERS,
  type Adapter,
  BOOTSTRAP_PATH,
  type Bootstrap,
  CONTRACT_VERSION,
  canonicalString,
  deriveRunKey,
  deriveWatchdogKey,
  EMPTY_SHA256,
  type EventsAnswer,
  FILM_ID_PATTERN as FILM_ID,
  fromHex,
  HEADERS,
  type Instructions,
  LAUNCH_COMMAND,
  MAX_BYTES_PER_FILM,
  MAX_CLOCK_SKEW_SECONDS as MAX_SKEW_SECONDS,
  MAX_FILES_PER_FILM,
  newNonce,
  RUN_DIR_NAME,
  RUN_ID_PATTERN as RUN_ID,
  RUN_KEY_FILE_PATH,
  RUNNER_API_PREFIX as RUNNER_BASE_PATH,
  type RunnerEvent,
  SAMPLE_FORMATS,
  SCRUB_COMMAND,
  STOP_COMMAND,
  sha256Hex,
  signWatchdog,
  toHex,
  UPLOAD_KINDS,
  type UploadKind,
  variantKey,
  WATCHDOG_FILM as WATCHDOG_ID,
} from '@boiler-room/film-runner/contract';

export type RunnerPhase = Phase;
/** The customer's approval, as the runner's instructions carry it. */
export type ApprovalInput = Approval;
/** The fields the canonical string signs. */
export type SignedParts = CanonicalInput;

/** `v1=<hex>` for the canonical string, signed with K (hex). */
export function signParts(keyHex: string, parts: SignedParts): Promise<string> {
  return signCanonical(keyHex, canonicalString(parts));
}

/** Checks a `v1=` signature in constant time. */
export function verifyParts(keyHex: string, parts: SignedParts, signature: string) {
  return verifyCanonical(keyHex, canonicalString(parts), signature);
}

/**
 * Every header a signed request carries. `url` is the URL that will be fetched; `body` is the
 * exact bytes that will be sent, or null for none. The website's tests sign as a runner with it.
 */
export async function signedHeaders(input: {
  keyHex: string;
  method: string;
  url: string;
  filmId: string;
  runId: string;
  body: Uint8Array<ArrayBuffer> | null;
  nowSeconds: number;
  nonce?: string | undefined;
}): Promise<Record<string, string>> {
  const url = new URL(input.url);
  const bodySha256 = input.body ? await sha256Hex(input.body) : EMPTY_SHA256;
  const parts: SignedParts = {
    method: input.method,
    pathAndQuery: url.pathname + url.search,
    filmId: input.filmId,
    runId: input.runId,
    ts: input.nowSeconds,
    nonce: input.nonce ?? newNonce(),
    bodySha256,
    contentLength: input.body?.byteLength ?? 0,
  };
  return {
    [HEADERS.film]: parts.filmId,
    [HEADERS.run]: parts.runId,
    [HEADERS.ts]: String(parts.ts),
    [HEADERS.nonce]: parts.nonce,
    [HEADERS.bodySha256]: bodySha256,
    [HEADERS.signature]: await signParts(input.keyHex, parts),
  };
}
