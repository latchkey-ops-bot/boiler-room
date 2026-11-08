/**
 * A stand-in for the website's runner routes, for tests and for the end-to-end run on a Naive
 * computer. It checks what the website will check: the signature, the clock, the film id in the
 * path, the body hash, replays, upload kinds and sizes. It keeps what it receives in memory and, when
 * given a directory, on disk, so it survives a pause of the computer it runs on.
 *
 * Only `node:` built-ins and the contract, so it runs from a bare checkout:
 *
 *   node test/receiver.ts --dir <dir> [--port 8787]
 *
 * reads `<dir>/master` (the signing secret), `<dir>/film.json` (`{ filmId, runId }`) and, on every
 * instructions call, `<dir>/instructions.json`. It writes `<dir>/state.json` and `<dir>/files/`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BODY_LIMITS,
  deriveRunKey,
  type EventsBody,
  type Instructions,
  RUNNER_API_PREFIX,
  type RunnerEvent,
  UPLOAD_KINDS,
  type UploadKind,
  verifyRequest,
} from '../src/contract.ts';

export interface ReceivedFile {
  fileId: string;
  kind: UploadKind;
  version: number;
  variant: string | null;
  name: string;
  contentType: string;
  bytes: number;
  sha256: string;
  path: string | null;
}

export interface ReceiverState {
  hellos: unknown[];
  events: RunnerEvent[];
  files: ReceivedFile[];
  rejected: Array<{ status: number; code: string; path: string }>;
  nonces: string[];
  instructionsCalls: number;
}

export interface ReceiverOptions {
  master: string;
  filmId: string;
  runId: string;
  instructions: () => Instructions;
  port?: number;
  host?: string;
  /** Where to keep state.json and files/. In memory only when left out. */
  dir?: string;
  /** Answer POST events with `control.stop` once this returns true. */
  stop?: () => { stop: boolean; reason?: string };
  /** Answer the next N calls with this status, for retry tests. */
  failNext?: { count: number; status: number; code?: string };
  /** Refuse a batch of events with this status and code, as the website does in a wrong state. */
  refuseEvents?: (events: RunnerEvent[]) => { status: number; code: string } | null;
  /** Server clock in ms. */
  now?: () => number;
  log?: (line: string) => void;
}

export interface Receiver {
  url: string;
  callbackBase: string;
  state: ReceiverState;
  options: ReceiverOptions;
  close(): Promise<void>;
}

function emptyState(): ReceiverState {
  return { hellos: [], events: [], files: [], rejected: [], nonces: [], instructionsCalls: 0 };
}

export async function startReceiver(options: ReceiverOptions): Promise<Receiver> {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => undefined);
  const stateFile = options.dir ? join(options.dir, 'state.json') : null;
  const filesDir = options.dir ? join(options.dir, 'files') : null;
  if (filesDir) mkdirSync(filesDir, { recursive: true });
  const state: ReceiverState =
    stateFile && existsSync(stateFile)
      ? (JSON.parse(readFileSync(stateFile, 'utf8')) as ReceiverState)
      : emptyState();
  const nonces = new Set(state.nonces);
  const key = await deriveRunKey(options.master, options.filmId, options.runId);
  const save = () => {
    state.nonces = [...nonces].slice(-5000);
    if (stateFile) writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  };

  const send = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, {
      'content-type': 'application/json',
      date: new Date(now()).toUTCString(),
    });
    response.end(JSON.stringify(body));
  };
  const reject = (
    response: ServerResponse,
    status: number,
    code: string,
    path: string,
    extra = {},
  ) => {
    state.rejected.push({ status, code, path });
    save();
    log(`rejected ${status} ${code} ${path}`);
    send(response, status, { error: { code, message: code }, ...extra });
  };

  const readBody = (request: IncomingMessage, limit: number) =>
    new Promise<Buffer | null>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          resolve(null);
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => resolve(Buffer.concat(chunks)));
      request.on('error', reject);
    });

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://receiver.local');
    const path = url.pathname;
    // An unsigned liveness probe for the script that starts the receiver. It touches no state.
    if (path === '/_alive' && request.method === 'GET') return send(response, 200, { ok: true });
    if (options.failNext && options.failNext.count > 0) {
      options.failNext.count -= 1;
      return reject(response, options.failNext.status, options.failNext.code ?? 'injected', path);
    }
    const method = request.method ?? 'GET';
    const contentLength = Number(request.headers['content-length'] ?? 0);
    const verified = await verifyRequest({
      method,
      url,
      headers: { get: (name) => (request.headers[name] as string | undefined) ?? null },
      contentLength,
      now: Math.floor(now() / 1000),
      keyFor: async (filmId, runId) =>
        filmId === options.filmId && runId === options.runId ? key : null,
    });
    if (!verified.ok) {
      return reject(response, verified.status, verified.code, path, {
        serverTime: Math.floor(now() / 1000),
      });
    }
    const films = `${RUNNER_API_PREFIX}/films/${options.filmId}`;
    let limit: number = BODY_LIMITS.events;
    let kind: UploadKind | null = null;
    if (method === 'PUT' && path === `${films}/files`) {
      kind = url.searchParams.get('kind') as UploadKind;
      if (!kind || !(kind in UPLOAD_KINDS)) return reject(response, 400, 'bad_kind', path);
      limit = UPLOAD_KINDS[kind].maxBytes;
      if (contentLength > limit) return reject(response, 413, 'file_too_large', path);
    } else if (path === `${films}/hello`) {
      limit = BODY_LIMITS.hello;
    }
    const body = await readBody(request, limit);
    if (body === null) return reject(response, 413, 'too_large', path);
    if (body.length !== contentLength) return reject(response, 400, 'length', path);
    const sha256 = createHash('sha256').update(body).digest('hex');
    if (sha256 !== verified.bodySha256) return reject(response, 400, 'checksum', path);
    if (nonces.has(verified.nonce)) return reject(response, 409, 'replay', path);
    nonces.add(verified.nonce);

    if (method === 'POST' && path === `${films}/hello`) {
      state.hellos.push(JSON.parse(body.toString('utf8')));
      save();
      log('hello');
      return send(response, 200, {
        serverTime: Math.floor(now() / 1000),
        phase: options.instructions().phase,
      });
    }
    if (method === 'GET' && path === `${films}/instructions`) {
      state.instructionsCalls += 1;
      save();
      return send(response, 200, options.instructions());
    }
    if (method === 'POST' && path === `${films}/events`) {
      const parsed = JSON.parse(body.toString('utf8')) as EventsBody;
      if (parsed.runId !== options.runId) return reject(response, 400, 'run', path);
      if (!Array.isArray(parsed.events) || parsed.events.length < 1 || parsed.events.length > 100) {
        return reject(response, 400, 'batch', path);
      }
      const refused = options.refuseEvents?.(parsed.events);
      if (refused) return reject(response, refused.status, refused.code, path);
      const seen = new Set(state.events.map((event) => event.seq));
      for (const event of parsed.events) {
        if (
          event.type === 'artifact' &&
          !state.files.some((file) => file.fileId === event.fileId)
        ) {
          return reject(response, 409, 'unknown_file', path);
        }
        if (
          event.type === 'script_ready' &&
          !state.files.some((file) => file.fileId === event.campaignFileId)
        ) {
          return reject(response, 409, 'unknown_file', path);
        }
      }
      for (const event of parsed.events) {
        if (!seen.has(event.seq)) state.events.push(event);
        if (event.type !== 'runner.heartbeat') log(`event ${event.seq} ${event.type}`);
      }
      state.events.sort((a, b) => a.seq - b.seq);
      save();
      const last = parsed.events[parsed.events.length - 1];
      return send(response, 200, {
        ok: true,
        lastSeq: last?.seq ?? 0,
        control: options.stop?.() ?? { stop: false },
        serverTime: Math.floor(now() / 1000),
      });
    }
    if (method === 'PUT' && path === `${films}/files` && kind) {
      const contentType = request.headers['content-type'] ?? '';
      const allowed: readonly string[] = UPLOAD_KINDS[kind].contentTypes;
      if (!allowed.includes(contentType)) return reject(response, 415, 'content_type', path);
      const fileId = `fil_${String(state.files.length + 1).padStart(4, '0')}`;
      const name = url.searchParams.get('name') ?? 'file';
      let stored: string | null = null;
      if (filesDir) {
        stored = join(filesDir, `${fileId}-${name}`);
        writeFileSync(stored, body);
      }
      state.files.push({
        fileId,
        kind,
        version: Number(url.searchParams.get('version')),
        variant: url.searchParams.get('variant'),
        name,
        contentType,
        bytes: body.length,
        sha256,
        path: stored,
      });
      save();
      log(`file ${fileId} ${kind} ${name} ${body.length} bytes`);
      return send(response, 200, { ok: true, fileId, bytes: body.length });
    }
    return reject(response, 404, 'not_found', path);
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      log(`error ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) send(response, 500, { error: { code: 'internal' } });
    });
  });
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://${host}:${port}`;
  return {
    url,
    callbackBase: `${url}${RUNNER_API_PREFIX}`,
    state,
    options,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Run as a program: node test/receiver.ts --dir <dir> [--port 8787]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { dir: { type: 'string' }, port: { type: 'string' } },
  });
  const dir = values.dir;
  if (!dir) {
    console.error('usage: receiver.ts --dir <dir> [--port 8787]');
    process.exit(2);
  }
  const master = readFileSync(join(dir, 'master'), 'utf8').trim();
  const film = JSON.parse(readFileSync(join(dir, 'film.json'), 'utf8')) as {
    filmId: string;
    runId: string;
  };
  const receiver = await startReceiver({
    master,
    ...film,
    dir,
    port: Number(values.port ?? 8787),
    instructions: () =>
      JSON.parse(readFileSync(join(dir, 'instructions.json'), 'utf8')) as Instructions,
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
  console.log(`receiver listening on ${receiver.url}`);
}
