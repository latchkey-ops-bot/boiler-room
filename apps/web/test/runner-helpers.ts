import { getDb } from '../src/db/client.ts';
import {
  type Bindings,
  createContext,
  type Principal,
  type Runtime,
  runnerDeps,
} from '../src/server/api/context.ts';
import { BOOTSTRAP_PATH, type Bootstrap, signedHeaders } from '../src/server/runner/contract.ts';
import {
  type ComputerStatus,
  type CreateComputer,
  type ExecResult,
  type NaiveApi,
  NaiveApiError,
  type NaiveComputer,
} from '../src/server/runner/naive-api.ts';
import {
  events,
  files,
  hello,
  instructions,
  RUNNER_BODY_LIMITS,
  runnerRoute,
} from '../src/server/runner/routes.ts';
import type { RunnerDeps } from '../src/server/runner/runs.ts';
import type { startWorkerEnv } from './helpers.ts';
import { testClock } from './helpers.ts';

type Proxy = Awaited<ReturnType<typeof startWorkerEnv>>;

export const HOME = '/home/naive';
export const SECRET = 'test-master-secret-not-a-real-one';

/** Naive, in memory. Every call is logged, and any call can be made to fail once. */
export class FakeNaive implements NaiveApi {
  readonly calls: { op: string; id?: string; detail?: string }[] = [];
  readonly computers = new Map<string, NaiveComputer>();
  readonly snapshots = new Set<string>();
  readonly written = new Map<string, string>();
  readonly #byKey = new Map<string, string>();
  readonly #failures = new Map<string, NaiveApiError>();
  createStatus: ComputerStatus = 'running';
  balance = 20_000_000;
  #count = 0;
  readonly #clock: () => Date;

  constructor(clock: () => Date) {
    this.#clock = clock;
  }

  /** The next call to `op` fails with this status and code. */
  failNext(op: string, status: number, code = `http_${status}`) {
    this.#failures.set(op, new NaiveApiError(status, code, `${op} answered ${status} ${code}`));
  }

  ops(): string[] {
    return this.calls.map((call) => call.op);
  }

  #enter(op: string, id?: string, detail?: string) {
    this.calls.push({ op, id, detail });
    const failure = this.#failures.get(op);
    if (failure) {
      this.#failures.delete(op);
      throw failure;
    }
  }

  #find(id: string): NaiveComputer {
    const computer = this.computers.get(id);
    if (!computer) throw new NaiveApiError(404, 'not_found', `${id} is not here`);
    return computer;
  }

  async createComputer(body: CreateComputer, idempotencyKey: string) {
    this.#enter('create', undefined, body.snapshot_id);
    const known = this.#byKey.get(idempotencyKey);
    if (known) return this.#find(known);
    this.#count += 1;
    const computer: NaiveComputer = {
      id: `cmp_${String(this.#count).padStart(4, '0')}`,
      name: body.name,
      status: this.createStatus,
      snapshot_id: body.snapshot_id,
      created_at: this.#clock().toISOString(),
    };
    this.computers.set(computer.id, computer);
    this.#byKey.set(idempotencyKey, computer.id);
    return { ...computer };
  }

  async getComputer(id: string) {
    this.#enter('get', id);
    return { ...this.#find(id) };
  }

  async listComputers() {
    this.#enter('list');
    return {
      data: [...this.computers.values()].map((c) => ({ ...c })),
      has_more: false,
      next_cursor: null,
    };
  }

  async home(id: string) {
    this.#enter('inspect', id);
    this.#find(id);
    return HOME;
  }

  async writeFile(id: string, path: string, content: string) {
    this.#enter('fs/write', id, path);
    if (this.#find(id).status !== 'running')
      throw new NaiveApiError(409, 'state_conflict', 'not running');
    this.written.set(`${id}:${path}`, content);
  }

  async exec(id: string, command: string, _timeoutMs: number): Promise<ExecResult> {
    this.#enter('exec', id, command);
    this.#find(id);
    return { exit_code: 0 };
  }

  async pause(id: string) {
    this.#enter('pause', id);
    const computer = this.#find(id);
    if (computer.status === 'destroyed') throw new NaiveApiError(404, 'not_found', 'gone');
    computer.status = 'paused';
    return { ...computer };
  }

  async resume(id: string) {
    this.#enter('resume', id);
    const computer = this.#find(id);
    if (computer.status === 'destroyed') throw new NaiveApiError(404, 'not_found', 'gone');
    computer.status = 'running';
    return { ...computer };
  }

  async snapshot(id: string) {
    this.#enter('snapshot', id);
    this.#find(id);
    this.#count += 1;
    const snapshotId = `snp_${String(this.#count).padStart(4, '0')}`;
    this.snapshots.add(snapshotId);
    return { snapshot_id: snapshotId };
  }

  async deleteComputer(id: string) {
    this.#enter('delete', id);
    const computer = this.#find(id);
    computer.status = 'destroyed';
  }

  async deleteSnapshot(id: string) {
    this.#enter('deleteSnapshot', id);
    if (!this.snapshots.has(id)) throw new NaiveApiError(404, 'not_found', 'no snapshot');
    const restored = [...this.computers.values()].some(
      (c) => c.snapshot_id === id && c.status !== 'destroyed',
    );
    if (restored)
      throw new NaiveApiError(409, 'state_conflict', 'a live computer was restored from it');
    this.snapshots.delete(id);
  }

  async balanceMicroUsd() {
    this.#enter('balance');
    return this.balance;
  }

  /** What the website wrote into a computer's bootstrap file. */
  bootstrap(computerId: string): Bootstrap {
    const text = this.written.get(`${computerId}:${HOME}/${BOOTSTRAP_PATH}`);
    if (!text) throw new Error(`No bootstrap on ${computerId}`);
    return JSON.parse(text) as Bootstrap;
  }

  live(): NaiveComputer[] {
    return [...this.computers.values()].filter((c) => c.status !== 'destroyed');
  }
}

/**
 * The local R2 from `getPlatformProxy` lives across a process boundary, which cannot carry a
 * stream of unknown length. In the Worker a request body has its Content-Length and streams
 * straight in. Here it is read first; R2 still checks the SHA-256 the route passes.
 */
export function proxiedBucket(bucket: R2Bucket): R2Bucket {
  return new Proxy(bucket, {
    get(target, prop, receiver) {
      if (prop === 'put') {
        return async (key: string, value: unknown, options?: R2PutOptions) => {
          const body =
            value instanceof ReadableStream ? await new Response(value).arrayBuffer() : value;
          return target.put(key, body as ArrayBuffer, options);
        };
      }
      const member = Reflect.get(target, prop, receiver);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

export interface HarnessOptions {
  /** Clerk user ids given real films. */
  realUsers?: string[];
  vars?: Partial<Bindings>;
  /** When the test's clock starts. */
  start?: string;
}

export function runnerHarness(proxy: Proxy, options: HarnessOptions = {}) {
  const clock = testClock(options.start);
  const naive = new FakeNaive(clock.now);
  const pending: Promise<unknown>[] = [];
  const logs: string[] = [];
  const bindings: Bindings = {
    DB: proxy.env.DB,
    FILMS: proxiedBucket(proxy.env.FILMS),
    PIPELINE: 'simulated',
    APP_ENV: 'staging',
    NAIVE_WEB_KEY: 'test-web-key',
    RUNNER_SIGNING_SECRET: SECRET,
    REAL_FILM_USERS: (options.realUsers ?? []).join(','),
    RUNNER_SNAPSHOT_ID: 'snp_base',
    RUNNER_PUBLIC_URL: 'https://staging.test',
    ...options.vars,
  };
  const runtime: Runtime = {
    waitUntil: (promise) => {
      pending.push(promise);
    },
    naive,
    log: (line) => logs.push(line),
  };
  const deps = (): RunnerDeps => runnerDeps(bindings, getDb(proxy.env.DB), clock.now, runtime);
  return {
    clock,
    naive,
    logs,
    bindings,
    deps,
    db: getDb(proxy.env.DB),
    context: (principal: Principal) => createContext(principal, bindings, clock.now, runtime),
    /** Runs every queued `waitUntil` to the end, including the ones they queue. */
    async flush() {
      while (pending.length > 0) {
        const results = await Promise.allSettled(pending.splice(0));
        for (const result of results) if (result.status === 'rejected') throw result.reason;
      }
    },
  };
}
export type Harness = ReturnType<typeof runnerHarness>;

type Route = 'hello' | 'instructions' | 'events' | 'files';

const ROUTES: Record<
  Route,
  { method: string; handler: Parameters<typeof runnerRoute>[2]; limit: number | null }
> = {
  hello: { method: 'POST', handler: hello, limit: RUNNER_BODY_LIMITS.hello },
  instructions: { method: 'GET', handler: instructions, limit: null },
  events: { method: 'POST', handler: events, limit: RUNNER_BODY_LIMITS.events },
  files: { method: 'PUT', handler: files, limit: null },
};

export interface CallOptions {
  query?: Record<string, string>;
  contentType?: string;
  /** Sign as this film, run or key, or send to this film's path, to test refusals. */
  filmHeader?: string;
  runHeader?: string;
  pathFilm?: string;
  key?: string;
  nonce?: string;
  ts?: number;
  /** Change the request after it was signed. */
  tamper?: (headers: Record<string, string>) => void;
  body?: Uint8Array<ArrayBuffer>;
}

/** What the runner on a film's computer would send, signed with the key from its bootstrap. */
export function runnerClient(harness: Harness, boot: Pick<Bootstrap, 'filmId' | 'runId' | 'key'>) {
  let seq = 0;
  const build = async (route: Route, payload: unknown, options: CallOptions = {}) => {
    const spec = ROUTES[route];
    const filmId = options.pathFilm ?? boot.filmId;
    const url = new URL(`https://staging.test/api/runner/v1/films/${filmId}/${route}`);
    for (const [name, value] of Object.entries(options.query ?? {}))
      url.searchParams.set(name, value);
    const body =
      options.body ??
      (payload === undefined ? null : new TextEncoder().encode(JSON.stringify(payload)));
    const headers: Record<string, string> = await signedHeaders({
      keyHex: options.key ?? boot.key,
      method: spec.method,
      url: url.toString(),
      filmId: options.filmHeader ?? boot.filmId,
      runId: options.runHeader ?? boot.runId,
      body,
      nowSeconds: options.ts ?? Math.floor(harness.clock.now().getTime() / 1000),
      nonce: options.nonce,
    });
    if (body) {
      headers['content-type'] = options.contentType ?? 'application/json';
      headers['content-length'] = String(body.byteLength);
    }
    options.tamper?.(headers);
    const request = new Request(url, { method: spec.method, headers, ...(body ? { body } : {}) });
    const handle = runnerRoute(harness.deps, { jsonLimit: spec.limit }, spec.handler);
    return { request, handle, filmId };
  };
  const send = async (route: Route, payload?: unknown, options: CallOptions = {}) => {
    const { request, handle, filmId } = await build(route, payload, options);
    return handle(request, { params: Promise.resolve({ filmId }) });
  };
  const at = () => harness.clock.now().toISOString();
  return {
    build,
    send,
    nextSeq: () => ++seq,
    async hello(phase: 'script' | 'render' | 'all') {
      seq += 1;
      return send('hello', {
        seq,
        at: at(),
        phase,
        type: 'runner.hello',
        commit: 'abc123',
        filmCommit: 'def456',
        node: 'v24.0.0',
        freeDiskGb: 12,
        swapMb: 4096,
      });
    },
    async events(
      phase: 'script' | 'render' | 'all',
      list: Record<string, unknown>[],
      options?: CallOptions,
    ) {
      const batch = list.map((event) => {
        seq += 1;
        return { seq, at: at(), phase, ...event };
      });
      return send('events', { runId: boot.runId, events: batch }, options);
    },
    async upload(
      query: Record<string, string>,
      bytes: Uint8Array<ArrayBuffer>,
      contentType: string,
      options: CallOptions = {},
    ) {
      return send('files', undefined, { ...options, query, body: bytes, contentType });
    },
  };
}
export type RunnerClient = ReturnType<typeof runnerClient>;

export async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}
