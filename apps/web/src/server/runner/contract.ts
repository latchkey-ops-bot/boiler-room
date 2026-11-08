/**
 * The contract between the website and the runner on a film's Naive computer, version 1.
 *
 * This file has no imports, and uses only syntax Node 24 can strip, so the Worker bundle and plain
 * Node (`node src/main.ts` on the computer) load the same file. The runner in
 * `services/film-runner` keeps a copy and a test that checks the two match. Change both together,
 * and only in ways a runner one version behind still understands.
 *
 * Every runner request is signed with a key for its own film and run:
 *
 *   K = HMAC-SHA256(RUNNER_SIGNING_SECRET, "br-runner/v1/" + filmId + "/" + runId)
 *
 * The website derives K per request, so D1 holds nothing secret. The runner gets K as hex in the
 * bootstrap file and keeps it in memory. A leaked computer can sign only for its own film and run.
 */

export const CONTRACT_VERSION = 1;

/** Where the runner's routes live, under the website's origin. */
export const RUNNER_BASE_PATH = '/api/runner/v1';

/**
 * The bootstrap file, relative to the computer's home. The website writes it with `fs/write` just
 * before each launch; the runner reads it, keeps the key in memory and deletes it, so no checkpoint
 * of the disk holds a key.
 */
export const BOOTSTRAP_PATH = 'br-bootstrap.json';

/**
 * The one command the website runs to start the runner. It names no phase, URL or secret: those
 * come from the bootstrap file and the signed instructions call. `setsid` detaches the runner from
 * the exec, which returns at once; `flock -n` makes a second launch exit while one is running.
 */
export const LAUNCH_COMMAND =
  'mkdir -p "$HOME/br-run" && cd "$HOME/film-runner" && ' +
  `setsid -f bash -c 'exec flock -n "$HOME/br-run/lock" node src/main.ts' ` +
  '</dev/null >>"$HOME/br-run/runner.log" 2>&1; echo launched';

/** Stops the runner and the film command: SIGTERM to the group, then SIGKILL after 60 s. */
export const STOP_COMMAND =
  'bash "$HOME/film-runner/bin/stop.sh" </dev/null >/dev/null 2>&1; echo stopped';

export interface Bootstrap {
  v: 1;
  filmId: string;
  runId: string;
  /** Such as `https://boiler-room-web-staging.boilerroom.workers.dev/api/runner/v1`. */
  callbackBase: string;
  /** K, as 64 hex characters. */
  key: string;
  /** Unix seconds. */
  issuedAt: number;
}

export const FILM_ID = /^flm_[0-9a-z]{20}$/;
export const RUN_ID = /^run_[0-9a-z]{20}$/;

export const HEADERS = {
  film: 'x-br-film',
  run: 'x-br-run',
  ts: 'x-br-ts',
  nonce: 'x-br-nonce',
  bodySha256: 'x-br-body-sha256',
  signature: 'x-br-signature',
} as const;

/** How far a request's timestamp may be from the website's clock, in seconds. */
export const MAX_SKEW_SECONDS = 300;

/** The SHA-256 of an empty body. */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** The watchdog signs as this film and run, with its own key. */
export const WATCHDOG_ID = 'watchdog';

export interface SignedParts {
  method: string;
  /** `url.pathname + url.search` of the URL that is fetched, exactly as sent. */
  pathAndQuery: string;
  filmId: string;
  runId: string;
  /** Unix seconds. */
  ts: number;
  /** 32 hex characters, new for every request, retries included. */
  nonce: string;
  bodySha256: string;
  contentLength: number;
}

/** The string both ends sign, one field per line. */
export function canonicalString(parts: SignedParts): string {
  return [
    'BR1',
    parts.method.toUpperCase(),
    parts.pathAndQuery,
    parts.filmId,
    parts.runId,
    String(parts.ts),
    parts.nonce,
    parts.bodySha256,
    String(parts.contentLength),
  ].join('\n');
}

const encoder = new TextEncoder();

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (const byte of view) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error('Not lower-case hex.');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(
  data: ArrayBuffer | Uint8Array<ArrayBuffer> | string,
): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

async function hmacKey(secret: Uint8Array<ArrayBuffer>, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

async function hmacHex(secret: Uint8Array<ArrayBuffer>, message: string): Promise<string> {
  const key = await hmacKey(secret, 'sign');
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** K for one film and run, as hex. `master` is the `RUNNER_SIGNING_SECRET` text. */
export function deriveRunKey(master: string, filmId: string, runId: string): Promise<string> {
  return hmacHex(encoder.encode(master), `br-runner/v1/${filmId}/${runId}`);
}

/** The watchdog's key: only the website's own cron uses it, to call its own route. */
export function deriveWatchdogKey(master: string): Promise<string> {
  return hmacHex(encoder.encode(master), 'br-watchdog/v1');
}

/** `v1=<hex>` for the canonical string, signed with K (hex). */
export async function signParts(keyHex: string, parts: SignedParts): Promise<string> {
  return `v1=${await hmacHex(fromHex(keyHex), canonicalString(parts))}`;
}

/** Checks a `v1=` signature in constant time. */
export async function verifyParts(
  keyHex: string,
  parts: SignedParts,
  signature: string,
): Promise<boolean> {
  const match = /^v1=([0-9a-f]{64})$/.exec(signature);
  if (!match?.[1]) return false;
  const key = await hmacKey(fromHex(keyHex), 'verify');
  return crypto.subtle.verify(
    'HMAC',
    key,
    fromHex(match[1]),
    encoder.encode(canonicalString(parts)),
  );
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/**
 * Every header a signed request carries. `url` is the URL that will be fetched; `body` is the
 * exact bytes that will be sent, or null for none.
 */
export async function signedHeaders(input: {
  keyHex: string;
  method: string;
  url: string;
  filmId: string;
  runId: string;
  body: Uint8Array<ArrayBuffer> | null;
  nowSeconds: number;
  nonce?: string;
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

/** The headers the cron sends with its call to `POST /api/runner/v1/watchdog`. */
export async function signWatchdog(
  master: string,
  url: string,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
  const bytes = encoder.encode(body);
  return {
    'content-type': 'application/json',
    ...(await signedHeaders({
      keyHex: await deriveWatchdogKey(master),
      method: 'POST',
      url,
      filmId: WATCHDOG_ID,
      runId: WATCHDOG_ID,
      body: bytes,
      nowSeconds,
    })),
  };
}

// ---------- Uploads ----------

export const UPLOAD_KINDS = {
  mp4: { contentTypes: ['video/mp4'], maxBytes: 95 * 1024 * 1024 },
  still: { contentTypes: ['image/png', 'image/jpeg'], maxBytes: 10 * 1024 * 1024 },
  quality: { contentTypes: ['image/png', 'application/json'], maxBytes: 15 * 1024 * 1024 },
  campaign: { contentTypes: ['application/json'], maxBytes: 1024 * 1024 },
  research: { contentTypes: ['application/json'], maxBytes: 5 * 1024 * 1024 },
  decisions: { contentTypes: ['application/json'], maxBytes: 2 * 1024 * 1024 },
  manifest: { contentTypes: ['application/json'], maxBytes: 2 * 1024 * 1024 },
  qc: { contentTypes: ['application/json'], maxBytes: 2 * 1024 * 1024 },
} as const;
export type UploadKind = keyof typeof UPLOAD_KINDS;

/** A film may hold at most this many files, and this many bytes, in all. */
export const MAX_FILES_PER_FILM = 60;
export const MAX_BYTES_PER_FILM = 400 * 1024 * 1024;

/** What a GTM sample film is cut to. It has no approval step, so the website picks for it. */
export const SAMPLE_FORMATS = ['16:9'] as const;

// ---------- Instructions: GET films/{filmId}/instructions ----------

export type RunnerPhase = 'script' | 'render' | 'all';

export interface ApprovalInput {
  version: number;
  /** A hook scene id, or null for the main opening. */
  hookId: string | null;
  ctaId: string | null;
  formats: string[];
  /** Claims the customer confirmed. The crew treats them as approved. */
  confirmedClaimIds: string[];
}

export interface Instructions {
  phase: RunnerPhase;
  mode: 'customer' | 'sample';
  url: string;
  /** The script version the run is on: 0 before the first script. */
  scriptVersion: number;
  /** For `render`: exactly the cut to make. Null otherwise. */
  approval: ApprovalInput | null;
  /** For a `script` rewrite: the version sent back and the customer's note. */
  revise: { version: number; note: string } | null;
  /** For `all`: the shapes a sample film is cut to. */
  sampleFormats: string[] | null;
  /** What is left of the film's crew budget, in USD. The runner passes it as `--max-usd`. */
  maxCrewUsd: number;
  spentCrewUsd: number;
  /** ISO time. The runner stops the film by then. */
  deadlineAt: string;
  stop: boolean;
}

// ---------- Events: POST films/{filmId}/events ----------

interface EventBase {
  /** The runner's own sequence, monotonic over the whole run, from 1. */
  seq: number;
  /** ISO time. */
  at: string;
  phase: RunnerPhase;
}

export type RunnerEvent = EventBase &
  (
    | {
        type: 'runner.hello';
        commit: string;
        filmCommit: string;
        node: string;
        freeDiskGb: number;
        swapMb: number;
      }
    | { type: 'runner.heartbeat'; filmPid?: number; load1?: number; memUsedMb?: number }
    | { type: 'stage'; stage: string; status?: string; agent: string; message: string }
    | {
        type: 'decision';
        agent: string;
        stage?: string;
        kind: 'decision' | 'passed' | 'sent_back';
        message: string;
        detail?: Record<string, unknown>;
      }
    | {
        type: 'session';
        agent: string;
        sessionId: string;
        state: 'started' | 'ended';
        microUsd?: number;
      }
    | { type: 'cost'; step: string; microUsd: number; totalMicroUsd: number }
    | {
        type: 'artifact';
        kind: UploadKind;
        fileId: string;
        version: number;
        variantKey?: string;
        bytes: number;
        sha256: string;
      }
    | { type: 'script_ready'; version: number; campaignFileId: string; unconfirmedClaims: number }
    | {
        type: 'qc';
        format: string;
        verdict: 'pass' | 'fail' | 'blocked';
        routable: number;
        issues: {
          severity: string;
          check: string;
          owner: string;
          scene?: string;
          frame?: number;
          message: string;
        }[];
      }
    | { type: 'delivered'; version: number; variants: string[] }
    | {
        type: 'error';
        code: string;
        message: string;
        stage?: string;
        agent?: string;
        retryable: boolean;
      }
    | {
        type: 'runner.exit';
        exitCode: number | null;
        signal: string | null;
        durationMs: number;
      }
  );

export interface EventsBody {
  runId: string;
  events: RunnerEvent[];
}

export interface EventsAnswer {
  ok: true;
  lastSeq: number;
  control: { stop: boolean; reason?: string };
  serverTime: number;
}

/** A variant key: format, opening and CTA, such as `16:9.main.start-free`. */
export function variantKey(format: string, hookId: string | null, ctaId: string | null): string {
  return `${format}.${hookId ?? 'main'}.${ctaId ?? 'none'}`;
}
