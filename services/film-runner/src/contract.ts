/**
 * The contract between the website and the runner on a film's computer, and between the runner and
 * the film command it wraps. One file with no imports and no Node built-ins, so the Worker bundle
 * (`@boiler-room/film-runner/contract`) and plain Node on the computer load the same code. Hashing
 * and signing use WebCrypto (`crypto.subtle`), which both runtimes have.
 *
 * It holds the signature scheme, the endpoints, the event shapes, the upload kinds, and the film
 * command's flags and exit codes. The package README explains each.
 */

export const CONTRACT_VERSION = 1;

/** Every runner route lives under this path on the website. */
export const RUNNER_API_PREFIX = '/api/runner/v1';

// ---------------------------------------------------------------------------------------------
// Words shared with the website (`apps/web/src/lib/film.ts`). A test checks the lists match.
// ---------------------------------------------------------------------------------------------

export const STAGES = [
  'research',
  'script',
  'checks',
  'approval',
  'art_direction',
  'motion',
  'audio',
  'render',
  'review',
  'delivery',
] as const;
export type Stage = (typeof STAGES)[number];

export const CREW = [
  'coordinator',
  'researcher',
  'director',
  'validator',
  'art_director',
  'motion',
  'audio',
  'render',
  'quality_check',
  'account_manager',
  'customer',
] as const;
export type CrewMember = (typeof CREW)[number];

/** The crew members a film command may speak for. The coordinator and customer are the website's. */
export const FILM_AGENTS = [
  'researcher',
  'director',
  'validator',
  'art_director',
  'motion',
  'audio',
  'render',
  'quality_check',
  'account_manager',
] as const satisfies readonly CrewMember[];
export type FilmAgent = (typeof FILM_AGENTS)[number];

export const FORMATS = ['16:9', '9:16', '1:1'] as const;
export type Format = (typeof FORMATS)[number];

export const PHASES = ['script', 'render', 'all'] as const;
export type Phase = (typeof PHASES)[number];

export const MODES = ['customer', 'sample'] as const;
export type Mode = (typeof MODES)[number];

/** `16:9.main.start-free`: the format, the hook (`main` for the main opening) and the CTA. */
export function variantKey(format: Format, hookId: string | null, ctaId: string | null): string {
  return `${format}.${hookId ?? 'main'}.${ctaId ?? 'none'}`;
}

// ---------------------------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------------------------

export const FILM_ID_PATTERN = /^flm_[0-9a-z]{20}$/;
export const RUN_ID_PATTERN = /^run_[0-9a-z]{20}$/;

// ---------------------------------------------------------------------------------------------
// bootstrap.json: written by the Worker with `fs/write` before each launch
// ---------------------------------------------------------------------------------------------

/**
 * Everything the runner needs to call home, and nothing else. What to do comes from the signed
 * instructions call. The runner deletes the file once read, so no checkpoint holds the key.
 */
export interface Bootstrap {
  v: 1;
  filmId: string;
  runId: string;
  /** `https://<site>/api/runner/v1`, with no trailing slash. */
  callbackBase: string;
  /** The per-run HMAC key, 64 hex characters. See `deriveRunKey`. */
  key: string;
  /** Unix seconds. */
  issuedAt: number;
}

export function parseBootstrap(value: unknown): Bootstrap {
  const problems: string[] = [];
  const record = isRecord(value) ? value : {};
  if (!isRecord(value)) problems.push('not an object');
  if (record.v !== 1) problems.push('v must be 1');
  if (typeof record.filmId !== 'string' || !FILM_ID_PATTERN.test(record.filmId))
    problems.push('filmId');
  if (typeof record.runId !== 'string' || !RUN_ID_PATTERN.test(record.runId))
    problems.push('runId');
  if (typeof record.key !== 'string' || !/^[0-9a-f]{64}$/.test(record.key)) problems.push('key');
  if (typeof record.issuedAt !== 'number' || !Number.isFinite(record.issuedAt))
    problems.push('issuedAt');
  const base = typeof record.callbackBase === 'string' ? record.callbackBase : '';
  let url: URL | undefined;
  try {
    url = new URL(base);
  } catch {
    problems.push('callbackBase');
  }
  if (url) {
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      problems.push('callbackBase must be https');
    if (!url.pathname.endsWith(RUNNER_API_PREFIX))
      problems.push(`callbackBase must end with ${RUNNER_API_PREFIX}`);
    if (url.search || url.hash) problems.push('callbackBase has a query or fragment');
  }
  if (problems.length > 0) throw new Error(`bootstrap.json is not valid: ${problems.join(', ')}`);
  return record as unknown as Bootstrap;
}

// ---------------------------------------------------------------------------------------------
// Instructions: GET films/{filmId}/instructions
// ---------------------------------------------------------------------------------------------

export interface Approval {
  /** The script version the customer approved. */
  version: number;
  hookId: string | null;
  ctaId: string | null;
  formats: Format[];
  confirmedClaimIds: string[];
}

export interface Revise {
  /** The version the customer sent back. */
  version: number;
  note: string;
}

export interface Instructions {
  phase: Phase;
  mode: Mode;
  url: string;
  /** The current script version: 0 before the first script. */
  scriptVersion: number;
  /** Set for phase `render`. */
  approval: Approval | null;
  /** Set for phase `script` after a send-back. */
  revise: Revise | null;
  /** What is left of the film's crew budget, in USD. Passed to the film command as `--max-usd`. */
  maxCrewUsd: number;
  spentCrewUsd: number;
  /** ISO time after which the runner stops the film on its own. */
  deadlineAt: string;
  /** True when the website wants the run stopped before it starts. */
  stop: boolean;
}

export function parseInstructions(value: unknown): Instructions {
  if (!isRecord(value)) throw new Error('instructions are not an object');
  const problems: string[] = [];
  const v = value;
  if (!PHASES.includes(v.phase as Phase)) problems.push('phase');
  if (!MODES.includes(v.mode as Mode)) problems.push('mode');
  if (typeof v.url !== 'string' || !/^https?:\/\//.test(v.url)) problems.push('url');
  if (!isWhole(v.scriptVersion)) problems.push('scriptVersion');
  if (typeof v.maxCrewUsd !== 'number' || !(v.maxCrewUsd >= 0)) problems.push('maxCrewUsd');
  if (typeof v.spentCrewUsd !== 'number' || !(v.spentCrewUsd >= 0)) problems.push('spentCrewUsd');
  if (typeof v.deadlineAt !== 'string' || Number.isNaN(Date.parse(v.deadlineAt)))
    problems.push('deadlineAt');
  if (typeof v.stop !== 'boolean') problems.push('stop');
  const approval = v.approval ?? null;
  if (approval !== null) {
    if (!isRecord(approval)) problems.push('approval');
    else {
      if (!isWhole(approval.version) || (approval.version as number) < 1)
        problems.push('approval.version');
      if (!isNullableString(approval.hookId)) problems.push('approval.hookId');
      if (!isNullableString(approval.ctaId)) problems.push('approval.ctaId');
      if (
        !Array.isArray(approval.formats) ||
        approval.formats.length === 0 ||
        !approval.formats.every((format) => FORMATS.includes(format as Format))
      )
        problems.push('approval.formats');
      if (
        !Array.isArray(approval.confirmedClaimIds) ||
        !approval.confirmedClaimIds.every((id) => typeof id === 'string')
      )
        problems.push('approval.confirmedClaimIds');
    }
  }
  const revise = v.revise ?? null;
  if (revise !== null) {
    if (!isRecord(revise) || !isWhole(revise.version) || typeof revise.note !== 'string')
      problems.push('revise');
  }
  if (v.phase === 'render' && approval === null) problems.push('phase render needs an approval');
  if (problems.length > 0) throw new Error(`instructions are not valid: ${problems.join(', ')}`);
  return { ...(v as unknown as Instructions), approval, revise } as Instructions;
}

// ---------------------------------------------------------------------------------------------
// Events, runner to website: POST films/{filmId}/events
// ---------------------------------------------------------------------------------------------

interface EventBase {
  /** The runner's own sequence, monotonic over the whole run, kept across launches. */
  seq: number;
  /** ISO time the event happened. */
  at: string;
  phase: Phase;
}

/** Sent before the runner has its instructions, so it names no phase. */
export interface HelloEvent extends Omit<EventBase, 'phase'> {
  type: 'runner.hello';
  phase: null;
  commit: string;
  filmCommit: string;
  /** `film` runs the real film command. `standin` fakes every stage; the website must label it. */
  adapter: Adapter;
  node: string;
  freeDiskGb: number;
  swapMb: number;
  launch: number;
}

export interface HeartbeatEvent extends EventBase {
  type: 'runner.heartbeat';
  filmPid: number | null;
  load1: number;
  memUsedMb: number;
}

export interface StageEvent extends EventBase {
  type: 'stage';
  stage: Stage;
  status: 'working';
  agent: FilmAgent;
  message: string;
}

export interface DecisionEvent extends EventBase {
  type: 'decision';
  agent: FilmAgent;
  stage: Stage;
  kind: 'decision' | 'passed' | 'sent_back';
  message: string;
  detail?: Record<string, unknown>;
}

export interface SessionEvent extends EventBase {
  type: 'session';
  agent: FilmAgent;
  sessionId: string;
  state: 'started' | 'ended';
  microUsd?: number;
}

export const COST_STEPS = [
  'researcher',
  'director',
  'art-director',
  'art-images',
  'quality-check',
  'render',
] as const;
export type CostStep = (typeof COST_STEPS)[number];

export interface CostEvent extends EventBase {
  type: 'cost';
  step: CostStep;
  microUsd: number;
  /** The film's crew spend so far. The website keeps the highest it has seen. */
  totalMicroUsd: number;
}

export interface ArtifactEvent extends EventBase {
  type: 'artifact';
  kind: UploadKind;
  /** The id the website gave the upload. */
  fileId: string;
  name: string;
  version: number;
  variantKey?: string;
  bytes: number;
  sha256: string;
}

export interface ScriptReadyEvent extends EventBase {
  type: 'script_ready';
  version: number;
  /** The uploaded `campaign` file. The website reads it from R2 and validates it. */
  campaignFileId: string;
  /** Claim ids nobody has confirmed, which the customer is asked about. */
  unconfirmedClaims: string[];
}

export interface QcIssue {
  severity: string;
  check: string;
  owner: string;
  scene?: string;
  frame?: number;
  message: string;
}

export interface QcEvent extends EventBase {
  type: 'qc';
  format: Format;
  verdict: 'pass' | 'fail' | 'blocked';
  routable: number;
  issues: QcIssue[];
}

export interface DeliveredEvent extends EventBase {
  type: 'delivered';
  version: number;
  /** Variant keys, each of which has an `mp4` upload. */
  variants: string[];
}

export interface ErrorEvent extends EventBase {
  type: 'error';
  code: string;
  /** At most 500 characters, scrubbed of secrets. */
  message: string;
  stage: Stage | null;
  agent?: FilmAgent;
  retryable: boolean;
}

export interface ExitEvent extends EventBase {
  type: 'runner.exit';
  exitCode: number;
  signal: string | null;
  durationMs: number;
}

export type RunnerEvent =
  | HelloEvent
  | HeartbeatEvent
  | StageEvent
  | DecisionEvent
  | SessionEvent
  | CostEvent
  | ArtifactEvent
  | ScriptReadyEvent
  | QcEvent
  | DeliveredEvent
  | ErrorEvent
  | ExitEvent;

export type RunnerEventType = RunnerEvent['type'];

/** The body of POST films/{filmId}/events. 1 to 100 events. */
export interface EventsBody {
  runId: string;
  events: RunnerEvent[];
}

/** The answer to POST events. `control.stop` asks the runner to stop the film now. */
export interface EventsAnswer {
  ok: boolean;
  lastSeq: number;
  control: { stop: boolean; reason?: string };
  serverTime?: number | string;
}

export interface HelloAnswer {
  serverTime: number | string;
  phase: Phase;
}

export interface UploadAnswer {
  ok: boolean;
  fileId: string;
  bytes: number;
}

export const MAX_EVENTS_PER_BATCH = 100;
export const MAX_MESSAGE_CHARS = 500;
export const MAX_DETAIL_BYTES = 4096;

// ---------------------------------------------------------------------------------------------
// Uploads: PUT films/{filmId}/files?kind=&version=&variant=&name=
// ---------------------------------------------------------------------------------------------

const MiB = 1024 * 1024;

export const UPLOAD_KINDS = {
  mp4: { contentTypes: ['video/mp4'], maxBytes: 95 * MiB },
  still: { contentTypes: ['image/png', 'image/jpeg'], maxBytes: 10 * MiB },
  quality: { contentTypes: ['image/png', 'application/json'], maxBytes: 15 * MiB },
  campaign: { contentTypes: ['application/json'], maxBytes: 1 * MiB },
  research: { contentTypes: ['application/json'], maxBytes: 5 * MiB },
  decisions: { contentTypes: ['application/json'], maxBytes: 2 * MiB },
  manifest: { contentTypes: ['application/json'], maxBytes: 2 * MiB },
  qc: { contentTypes: ['application/json'], maxBytes: 2 * MiB },
} as const;
export type UploadKind = keyof typeof UPLOAD_KINDS;
export const UPLOAD_KIND_NAMES = Object.keys(UPLOAD_KINDS) as UploadKind[];

/** A film may hold at most this many files, and this many bytes in all. */
export const MAX_FILES_PER_FILM = 60;
export const MAX_BYTES_PER_FILM = 400 * MiB;

/** Reduces any name to what an R2 key may hold: `[a-z0-9._-]{1,80}`. */
export function safeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : 'file';
}

export interface UploadTarget {
  kind: UploadKind;
  version: number;
  variant?: string;
  name: string;
}

/** The path and query of an upload, built with `URLSearchParams` so both ends serialise alike. */
export function uploadPath(filmId: string, target: UploadTarget): string {
  const query = new URLSearchParams();
  query.set('kind', target.kind);
  query.set('version', String(target.version));
  if (target.variant !== undefined) query.set('variant', target.variant);
  query.set('name', target.name);
  return `${RUNNER_API_PREFIX}/films/${filmId}/files?${query.toString()}`;
}

export const routes = {
  hello: (filmId: string) => `${RUNNER_API_PREFIX}/films/${filmId}/hello`,
  instructions: (filmId: string) => `${RUNNER_API_PREFIX}/films/${filmId}/instructions`,
  events: (filmId: string) => `${RUNNER_API_PREFIX}/films/${filmId}/events`,
  files: uploadPath,
  watchdog: () => `${RUNNER_API_PREFIX}/watchdog`,
};

/** Body limits per JSON route, in bytes. */
export const BODY_LIMITS = {
  hello: 8 * 1024,
  events: 256 * 1024,
  watchdog: 1024,
} as const;

// ---------------------------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------------------------

export const HEADERS = {
  film: 'x-br-film',
  run: 'x-br-run',
  ts: 'x-br-ts',
  nonce: 'x-br-nonce',
  bodySha256: 'x-br-body-sha256',
  signature: 'x-br-signature',
} as const;

export const CANONICAL_TAG = 'BR1';
export const SIGNATURE_PREFIX = 'v1=';
/** A request whose timestamp is further than this from the server's clock is refused as stale. */
export const MAX_CLOCK_SKEW_SECONDS = 300;
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** The film and run headers of the watchdog's call, which belongs to no film. */
export const WATCHDOG_FILM = 'watchdog';
export const WATCHDOG_RUN = 'watchdog';

export interface CanonicalInput {
  method: string;
  /** `url.pathname + url.search`, exactly as sent, with no decoding or reordering. */
  pathAndQuery: string;
  filmId: string;
  runId: string;
  ts: number;
  nonce: string;
  bodySha256: string;
  contentLength: number;
}

/** The string both ends sign: the fields above, one per line. */
export function canonicalString(input: CanonicalInput): string {
  return [
    CANONICAL_TAG,
    input.method.toUpperCase(),
    input.pathAndQuery,
    input.filmId,
    input.runId,
    String(input.ts),
    input.nonce,
    input.bodySha256,
    String(input.contentLength),
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
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error('not lowercase hex');
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

type Bytes = Uint8Array<ArrayBuffer>;

const asBytes = (data: string | Uint8Array): Bytes =>
  typeof data === 'string' ? encoder.encode(data) : (new Uint8Array(data) as Bytes);

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', asBytes(data)));
}

async function hmacKey(secret: Bytes, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

async function hmacHex(secret: Bytes, message: string): Promise<string> {
  const key = await hmacKey(secret, 'sign');
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/**
 * The per-run key: `HMAC-SHA256(master, "br-runner/v1/" + filmId + "/" + runId)`, as hex. The
 * master is the Worker secret `RUNNER_SIGNING_SECRET`, used as the UTF-8 bytes of the string as
 * stored. D1 holds nothing secret; the Worker derives the key per request.
 */
export async function deriveRunKey(master: string, filmId: string, runId: string): Promise<string> {
  if (master.length < 32) throw new Error('The signing secret is too short.');
  return hmacHex(encoder.encode(master) as Bytes, `br-runner/v1/${filmId}/${runId}`);
}

/** The watchdog's key: `HMAC-SHA256(master, "br-watchdog/v1")`, as hex. */
export async function deriveWatchdogKey(master: string): Promise<string> {
  if (master.length < 32) throw new Error('The signing secret is too short.');
  return hmacHex(encoder.encode(master) as Bytes, 'br-watchdog/v1');
}

/** `v1=<hex HMAC-SHA256(key, canonical)>`, where `key` is the per-run key's hex. */
export async function signCanonical(keyHex: string, canonical: string): Promise<string> {
  return `${SIGNATURE_PREFIX}${await hmacHex(fromHex(keyHex), canonical)}`;
}

/** Checks a signature header in constant time (`crypto.subtle.verify`). */
export async function verifyCanonical(
  keyHex: string,
  canonical: string,
  signature: string,
): Promise<boolean> {
  if (!signature.startsWith(SIGNATURE_PREFIX)) return false;
  const hex = signature.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  const key = await hmacKey(fromHex(keyHex), 'verify');
  return crypto.subtle.verify('HMAC', key, fromHex(hex), encoder.encode(canonical));
}

export function newNonce(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export interface SignRequestInput {
  keyHex: string;
  method: string;
  /** The full URL the request goes to. Its `pathname + search` is signed. */
  url: string | URL;
  filmId: string;
  runId: string;
  /** Unix seconds, from the signer's corrected clock. */
  ts: number;
  /** The body's SHA-256 hex. `EMPTY_SHA256` for no body. */
  bodySha256: string;
  contentLength: number;
  /** A fresh one is made when left out. Every request, retries included, needs a new one. */
  nonce?: string;
}

/** The six headers of a signed runner request. */
export async function signRequest(input: SignRequestInput): Promise<Record<string, string>> {
  const url = typeof input.url === 'string' ? new URL(input.url) : input.url;
  const nonce = input.nonce ?? newNonce();
  const canonical = canonicalString({
    method: input.method,
    pathAndQuery: url.pathname + url.search,
    filmId: input.filmId,
    runId: input.runId,
    ts: input.ts,
    nonce,
    bodySha256: input.bodySha256,
    contentLength: input.contentLength,
  });
  return {
    [HEADERS.film]: input.filmId,
    [HEADERS.run]: input.runId,
    [HEADERS.ts]: String(input.ts),
    [HEADERS.nonce]: nonce,
    [HEADERS.bodySha256]: input.bodySha256,
    [HEADERS.signature]: await signCanonical(input.keyHex, canonical),
  };
}

export type VerifyResult =
  | { ok: true; filmId: string; runId: string; nonce: string; ts: number; bodySha256: string }
  | {
      ok: false;
      status: 400 | 401;
      code: 'bad_request' | 'stale' | 'unauthorized';
      message: string;
    };

export interface VerifyInput {
  method: string;
  /** The URL as received. Its `pathname + search` is checked exactly as received. */
  url: string | URL;
  headers: { get(name: string): string | null };
  contentLength: number;
  /** Unix seconds on the verifier's clock. */
  now: number;
  /** Returns the per-run key for a film and run the verifier knows, or null. */
  keyFor: (filmId: string, runId: string) => Promise<string | null>;
}

/**
 * The header and signature checks, in the order the design gives: shape, clock, a known run, then
 * the signature. The body hash, the nonce and the run's state are the caller's next steps.
 */
export async function verifyRequest(input: VerifyInput): Promise<VerifyResult> {
  const get = (name: string) => input.headers.get(name) ?? '';
  const filmId = get(HEADERS.film);
  const runId = get(HEADERS.run);
  const tsText = get(HEADERS.ts);
  const nonce = get(HEADERS.nonce);
  const bodySha256 = get(HEADERS.bodySha256);
  const signature = get(HEADERS.signature);
  const url = typeof input.url === 'string' ? new URL(input.url) : input.url;
  const watchdog = filmId === WATCHDOG_FILM && runId === WATCHDOG_RUN;
  const bad = (message: string): VerifyResult => ({
    ok: false,
    status: 400,
    code: 'bad_request',
    message,
  });
  if (!watchdog && !FILM_ID_PATTERN.test(filmId)) return bad('x-br-film is not a film id');
  if (!watchdog && !RUN_ID_PATTERN.test(runId)) return bad('x-br-run is not a run id');
  if (!watchdog && !url.pathname.startsWith(`${RUNNER_API_PREFIX}/films/${filmId}/`))
    return bad('The film in the path is not x-br-film');
  if (!/^\d{1,12}$/.test(tsText)) return bad('x-br-ts is not unix seconds');
  if (!/^[0-9a-f]{32}$/.test(nonce)) return bad('x-br-nonce is not 32 hex characters');
  if (!/^[0-9a-f]{64}$/.test(bodySha256)) return bad('x-br-body-sha256 is not a SHA-256');
  const ts = Number(tsText);
  if (Math.abs(input.now - ts) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 401, code: 'stale', message: 'The request is stale.' };
  }
  const unauthorized: VerifyResult = {
    ok: false,
    status: 401,
    code: 'unauthorized',
    message: 'The signature does not match.',
  };
  const key = await input.keyFor(filmId, runId);
  if (!key) return unauthorized;
  const canonical = canonicalString({
    method: input.method,
    pathAndQuery: url.pathname + url.search,
    filmId,
    runId,
    ts,
    nonce,
    bodySha256,
    contentLength: input.contentLength,
  });
  if (!(await verifyCanonical(key, canonical, signature))) return unauthorized;
  return { ok: true, filmId, runId, nonce, ts, bodySha256 };
}

/** The headers of the watchdog's call to its own route, signed with the watchdog key. */
export async function signWatchdog(
  master: string,
  url: string | URL,
  body: string,
  ts = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
  const bytes = encoder.encode(body);
  return {
    'content-type': 'application/json',
    ...(await signRequest({
      keyHex: await deriveWatchdogKey(master),
      method: 'POST',
      url,
      filmId: WATCHDOG_FILM,
      runId: WATCHDOG_RUN,
      ts,
      bodySha256: await sha256Hex(bytes),
      contentLength: bytes.byteLength,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// The film command, as the runner calls it (design section 13)
// ---------------------------------------------------------------------------------------------

/** `film` runs `pnpm film` at the pinned crew commit. `standin` runs `standin/film.ts`. */
export const ADAPTERS = ['film', 'standin'] as const;
export type Adapter = (typeof ADAPTERS)[number];

export interface FilmCommandInput {
  url: string;
  phase: Phase;
  /** One stable directory across phases. */
  runDir: string;
  /** The NDJSON events file the command appends to. */
  eventsFile: string;
  /** For phase `render`. */
  approvalFile?: string;
  /** For phase `script` after a send-back. */
  reviseFile?: string;
  maxUsd: number;
}

/**
 * The arguments after the command itself: `pnpm film <these>`. The film command on
 * `feat/crew-agents` must accept exactly these. `--render local` and `--no-sync` are always sent.
 */
export function filmCommandArgs(input: FilmCommandInput): string[] {
  const args = [
    input.url,
    '--phase',
    input.phase,
    '--run-dir',
    input.runDir,
    '--events',
    input.eventsFile,
    '--max-usd',
    input.maxUsd.toFixed(2),
    '--render',
    'local',
    '--no-sync',
  ];
  if (input.approvalFile) args.push('--approval', input.approvalFile);
  if (input.reviseFile) args.push('--revise', input.reviseFile);
  return args;
}

/** What the film command's exit code means. */
export const FILM_EXIT = {
  /** The phase finished: `script_ready` for `script`, `delivered` for `render` and `all`. */
  ok: 0,
  /** The crew failed or refused. */
  failed: 1,
  /** Bad input, such as an approval for another version. */
  badInput: 2,
  /** The film's cost cap. */
  costCap: 4,
  /** Stopped by SIGTERM or SIGINT. */
  stopped: 143,
} as const;

/** The runner's own exit codes, kept apart from the film command's. */
export const RUNNER_EXIT = {
  ok: 0,
  /** bootstrap.json is missing or invalid, or the instructions could not be read. */
  badBootstrap: 20,
  /** Three 401s in a row that were not stale: the key is wrong. */
  unauthorized: 21,
  /** No call to the website succeeded for 15 minutes. */
  unreachable: 22,
  /** The website refused the run (409 wrong_state, or a request it will never accept). */
  refused: 23,
  /** An artifact could not be uploaded after three tries. */
  uploadFailed: 24,
  stopped: 143,
} as const;

// ---------------------------------------------------------------------------------------------
// Film command events: one JSON object per line in --events
// ---------------------------------------------------------------------------------------------

interface FilmEventBase {
  v: 1;
  /** The command's own sequence, from 1 per process. */
  seq: number;
  at: string;
}

type Omitted = 'seq' | 'at' | 'phase';

export type FilmEvent =
  | (FilmEventBase & Omit<StageEvent, Omitted>)
  | (FilmEventBase & Omit<DecisionEvent, Omitted>)
  | (FilmEventBase & Omit<SessionEvent, Omitted>)
  | (FilmEventBase & Omit<CostEvent, Omitted>)
  | (FilmEventBase & Omit<QcEvent, Omitted>)
  | (FilmEventBase & Omit<DeliveredEvent, Omitted>)
  | (FilmEventBase & Omit<ErrorEvent, Omitted>)
  | (FilmEventBase & {
      type: 'artifact';
      kind: UploadKind;
      /** Relative to the run dir. */
      path: string;
      contentType: string;
      version: number;
      variantKey?: string;
    })
  | (FilmEventBase & {
      type: 'script_ready';
      version: number;
      /** Relative to the run dir. */
      campaignPath: string;
      unconfirmedClaims: string[];
    });

export type FilmEventType = FilmEvent['type'];
export const FILM_EVENT_TYPES = [
  'stage',
  'decision',
  'session',
  'cost',
  'artifact',
  'script_ready',
  'qc',
  'delivered',
  'error',
] as const satisfies readonly FilmEventType[];

/**
 * Checks one line of the events file. Returns the event, or the reason it is refused. The runner
 * skips a refused line and logs why.
 */
export function parseFilmEvent(
  line: string,
): { ok: true; event: FilmEvent } | { ok: false; reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  if (!isRecord(value)) return { ok: false, reason: 'not an object' };
  const e = value;
  const fail = (reason: string) => ({ ok: false as const, reason: `${String(e.type)}: ${reason}` });
  if (e.v !== 1) return fail('v must be 1');
  if (!isWhole(e.seq)) return fail('seq');
  if (typeof e.at !== 'string' || Number.isNaN(Date.parse(e.at))) return fail('at');
  const agentOk = (agent: unknown) => FILM_AGENTS.includes(agent as FilmAgent);
  const stageOk = (stage: unknown) => STAGES.includes(stage as Stage);
  const text = (message: unknown) => typeof message === 'string' && message.trim().length > 0;
  switch (e.type) {
    case 'stage':
      if (!stageOk(e.stage) || e.stage === 'approval') return fail('stage');
      if (e.status !== 'working') return fail('status');
      if (!agentOk(e.agent)) return fail('agent');
      if (!text(e.message)) return fail('message');
      break;
    case 'decision':
      if (!agentOk(e.agent)) return fail('agent');
      if (!stageOk(e.stage)) return fail('stage');
      if (!['decision', 'passed', 'sent_back'].includes(e.kind as string)) return fail('kind');
      if (!text(e.message)) return fail('message');
      if (e.detail !== undefined && !isRecord(e.detail)) return fail('detail');
      break;
    case 'session':
      if (!agentOk(e.agent)) return fail('agent');
      if (typeof e.sessionId !== 'string') return fail('sessionId');
      if (e.state !== 'started' && e.state !== 'ended') return fail('state');
      break;
    case 'cost':
      if (!COST_STEPS.includes(e.step as CostStep)) return fail('step');
      if (!isWhole(e.microUsd) || !isWhole(e.totalMicroUsd)) return fail('microUsd');
      break;
    case 'artifact': {
      if (!UPLOAD_KIND_NAMES.includes(e.kind as UploadKind)) return fail('kind');
      if (typeof e.path !== 'string' || !isRelativePath(e.path)) return fail('path');
      const allowed: readonly string[] = UPLOAD_KINDS[e.kind as UploadKind].contentTypes;
      if (typeof e.contentType !== 'string' || !allowed.includes(e.contentType))
        return fail('contentType');
      if (!isWhole(e.version)) return fail('version');
      if (e.variantKey !== undefined && typeof e.variantKey !== 'string') return fail('variantKey');
      if (e.kind === 'mp4' && typeof e.variantKey !== 'string')
        return fail('an mp4 needs a variantKey');
      break;
    }
    case 'script_ready':
      if (!isWhole(e.version) || (e.version as number) < 1) return fail('version');
      if (typeof e.campaignPath !== 'string' || !isRelativePath(e.campaignPath))
        return fail('campaignPath');
      if (
        !Array.isArray(e.unconfirmedClaims) ||
        !e.unconfirmedClaims.every((id) => typeof id === 'string')
      )
        return fail('unconfirmedClaims');
      break;
    case 'qc':
      if (!FORMATS.includes(e.format as Format)) return fail('format');
      if (!['pass', 'fail', 'blocked'].includes(e.verdict as string)) return fail('verdict');
      if (!isWhole(e.routable)) return fail('routable');
      if (!Array.isArray(e.issues)) return fail('issues');
      break;
    case 'delivered':
      if (!isWhole(e.version)) return fail('version');
      if (!Array.isArray(e.variants) || !e.variants.every((key) => typeof key === 'string'))
        return fail('variants');
      break;
    case 'error':
      if (typeof e.code !== 'string' || !/^[a-z0-9_]{1,64}$/.test(e.code)) return fail('code');
      if (typeof e.message !== 'string') return fail('message');
      if (e.stage !== null && e.stage !== undefined && !stageOk(e.stage)) return fail('stage');
      if (e.agent !== undefined && !agentOk(e.agent)) return fail('agent');
      break;
    default:
      return fail('unknown type');
  }
  return { ok: true, event: e as unknown as FilmEvent };
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** A path inside the run dir: relative, no `..`, no backslashes. */
function isRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 300 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    path.split('/').every((part) => part !== '..' && part !== '')
  );
}

/** Cuts a message to the contract's limit, on a character boundary. */
export function clip(message: string, max = MAX_MESSAGE_CHARS): string {
  const chars = Array.from(message.trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/** Reads a server time from an answer: unix seconds, unix milliseconds or an ISO string. */
export function parseServerTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
