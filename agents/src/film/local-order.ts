/**
 * `FilmOrder` on top of `pnpm film`. Each order starts the film command as its own process, which
 * writes everything under `out/films/<host>/<run-id>/`; status, the file and the decisions are read
 * from there, so any process can poll an order another one placed. Orders are kept in
 * `out/films/orders.json`, by idempotency key. Films are made one at a time by default, because
 * every Researcher run shares the one `br-researcher` computer: a second order waits, `queued`,
 * and starts when a status read finds the first one finished.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { siteHost } from '../researcher/text.ts';
import type {
  FilmDecisions,
  FilmFile,
  FilmFormat,
  FilmLength,
  FilmOrder,
  FilmOrderInput,
  FilmOrderStatus,
  WithdrawReason,
} from './order.ts';
import { DECISIONS_FILE, newRunId, orderProblem, readManifest, writeJson } from './run.ts';

export interface OrderRecord {
  orderId: string;
  idempotencyKey: string;
  url: string;
  host: string;
  runId: string;
  /** The film's folder, relative to the orders root. */
  dir: string;
  leadRef: string;
  budgetMicroUsd: number;
  sample: boolean;
  length: FilmLength;
  format: FilmFormat;
  createdAt: string;
  launchedAt: string | null;
  pid: number | null;
  withdrawn: { reason: WithdrawReason; at: string } | null;
}

/** Starts `pnpm film` with these arguments, its output going to `logFile`. */
export type Launcher = (args: string[], logFile: string) => { pid: number };

export interface LocalFilmOrderOptions {
  /** `out/films`. */
  root: string;
  launch?: Launcher;
  /** Whether a process is still running. */
  alive?: (pid: number) => boolean;
  /** Stops a film that is withdrawn while it is being made. */
  kill?: (pid: number) => void;
  clock?: () => Date;
  /** Films made at once. Default 1: the Researcher's computer takes one run at a time. */
  maxConcurrent?: number;
  /** How long a file link is said to be good for. A local file does not expire. */
  fileTtlMs?: number;
}

export const ORDERS_FILE = 'orders.json';

const FILM_CLI = fileURLToPath(new URL('../cli/film.ts', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Runs the film command under tsx, as `pnpm film` does, detached so it outlives the caller. */
export const launchFilm: Launcher = (args, logFile) => {
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const log = openSync(logFile, 'a');
  const child = spawn(process.execPath, [tsx, FILM_CLI, ...args], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, INIT_CWD: REPO_ROOT },
  });
  child.unref();
  if (child.pid === undefined) throw new Error('the film command did not start');
  return { pid: child.pid };
};

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as { code?: string }).code === 'EPERM';
  }
}

export class LocalFilmOrder implements FilmOrder {
  readonly kind = 'local' as const;
  private readonly root: string;
  private readonly launch: Launcher;
  private readonly alive: (pid: number) => boolean;
  private readonly kill: (pid: number) => void;
  private readonly clock: () => Date;
  private readonly maxConcurrent: number;
  private readonly fileTtlMs: number;

  constructor(options: LocalFilmOrderOptions) {
    this.root = options.root;
    this.launch = options.launch ?? launchFilm;
    this.alive = options.alive ?? processAlive;
    this.kill = options.kill ?? ((pid) => process.kill(pid, 'SIGTERM'));
    this.clock = options.clock ?? (() => new Date());
    this.maxConcurrent = options.maxConcurrent ?? 1;
    this.fileTtlMs = options.fileTtlMs ?? 24 * 3600_000;
  }

  private read(): OrderRecord[] {
    const file = join(this.root, ORDERS_FILE);
    if (!existsSync(file)) return [];
    return (JSON.parse(readFileSync(file, 'utf8')) as { orders: OrderRecord[] }).orders;
  }

  private save(orders: OrderRecord[]) {
    writeJson(join(this.root, ORDERS_FILE), { orders });
  }

  private find(orders: OrderRecord[], orderId: string): OrderRecord {
    const record = orders.find((each) => each.orderId === orderId);
    if (!record) throw new Error(`no film order ${orderId}`);
    return record;
  }

  private running(record: OrderRecord): boolean {
    if (!record.launchedAt || record.withdrawn) return false;
    const manifest = readManifest(join(this.root, record.dir));
    if (manifest && manifest.state !== 'working' && manifest.state !== 'queued') return false;
    const pid = manifest?.pid ?? record.pid;
    return pid !== null && this.alive(pid);
  }

  /** Starts queued orders, oldest first, while fewer than `maxConcurrent` are being made. */
  private pump(orders: OrderRecord[]) {
    let busy = orders.filter((each) => this.running(each)).length;
    let changed = false;
    for (const record of orders) {
      if (busy >= this.maxConcurrent) break;
      if (record.launchedAt || record.withdrawn) continue;
      const dir = join(this.root, record.dir);
      mkdirSync(dir, { recursive: true });
      const args = [
        record.url,
        '--length',
        record.length,
        '--format',
        record.format,
        ...(record.sample ? ['--sample'] : []),
        '--max-usd',
        String(record.budgetMicroUsd / 1e6),
        '--run-id',
        record.runId,
        '--order-id',
        record.orderId,
      ];
      const { pid } = this.launch(args, join(dir, 'film.log'));
      record.pid = pid;
      record.launchedAt = this.clock().toISOString();
      busy += 1;
      changed = true;
    }
    if (changed) this.save(orders);
  }

  async order(input: FilmOrderInput): Promise<{ orderId: string }> {
    const orders = this.read();
    const known = orders.find((each) => each.idempotencyKey === input.idempotencyKey);
    if (known) return { orderId: known.orderId };
    const sample = input.sample ?? true;
    const length = input.length ?? 'short';
    const format = input.format ?? '16:9';
    const problem = orderProblem({
      url: input.url,
      length,
      sample,
      maxMicroUsd: input.budgetMicroUsd,
    });
    if (problem) throw new Error(problem);
    const host = siteHost(input.url);
    const runId = newRunId(
      this.clock(),
      createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 4),
    );
    const record: OrderRecord = {
      orderId: `fo-${runId}`,
      idempotencyKey: input.idempotencyKey,
      url: input.url,
      host,
      runId,
      dir: join(host, runId),
      leadRef: input.leadRef,
      budgetMicroUsd: input.budgetMicroUsd,
      sample,
      length,
      format,
      createdAt: this.clock().toISOString(),
      launchedAt: null,
      pid: null,
      withdrawn: null,
    };
    orders.push(record);
    this.save(orders);
    this.pump(orders);
    return { orderId: record.orderId };
  }

  async status(orderId: string): Promise<FilmOrderStatus> {
    const orders = this.read();
    const record = this.find(orders, orderId);
    this.pump(orders);
    const base = {
      orderId,
      simulated: false,
      script: null,
    } as const;
    if (record.withdrawn) {
      return {
        ...base,
        state: 'withdrawn',
        stage: null,
        qc: 'pending',
        costMicroUsd: readManifest(join(this.root, record.dir))?.spend.totalMicroUsd ?? null,
        failure: `withdrawn: ${record.withdrawn.reason}`,
      };
    }
    const manifest = readManifest(join(this.root, record.dir));
    const pid = manifest?.pid ?? record.pid;
    const gone = record.launchedAt !== null && (pid === null || !this.alive(pid));
    if (!manifest) {
      if (!record.launchedAt)
        return {
          ...base,
          state: 'queued',
          stage: null,
          qc: 'pending',
          costMicroUsd: null,
          failure: null,
        };
      return gone
        ? {
            ...base,
            state: 'failed',
            stage: null,
            qc: 'pending',
            costMicroUsd: null,
            failure: `the film command stopped before it wrote a manifest; see ${join(record.dir, 'film.log')}`,
          }
        : {
            ...base,
            state: 'working',
            stage: 'research',
            qc: 'pending',
            costMicroUsd: null,
            failure: null,
          };
    }
    const unfinished = manifest.state === 'working' || manifest.state === 'queued';
    if (unfinished && gone) {
      return {
        ...base,
        state: manifest.film ? 'ready' : 'failed',
        stage: manifest.stage,
        qc: manifest.film ? manifest.qc : 'pending',
        costMicroUsd: manifest.spend.totalMicroUsd,
        failure: `the film command stopped at ${manifest.step ?? 'an unknown step'}; see ${join(record.dir, 'film.log')}`,
        script: manifest.film ? manifest.script : null,
      };
    }
    return {
      ...base,
      state: manifest.state,
      stage: manifest.stage,
      qc: manifest.state === 'ready' ? manifest.qc : 'pending',
      costMicroUsd: manifest.spend.totalMicroUsd,
      failure: manifest.failure,
      script: manifest.state === 'ready' ? manifest.script : null,
    };
  }

  async file(orderId: string): Promise<FilmFile> {
    const record = this.find(this.read(), orderId);
    if (record.withdrawn) throw new Error(`film order ${orderId} was withdrawn`);
    const dir = join(this.root, record.dir);
    const manifest = readManifest(dir);
    if (manifest?.state !== 'ready' || !manifest.film)
      throw new Error(`film order ${orderId} has no film yet`);
    const path = join(dir, manifest.film.file);
    const bytes = readFileSync(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== manifest.film.sha256)
      throw new Error(`${path} is not the film that was made: its SHA-256 has changed`);
    return {
      url: pathToFileURL(path).href,
      expiresAt: new Date(this.clock().getTime() + this.fileTtlMs).toISOString(),
      contentType: 'video/mp4',
      bytes: bytes.byteLength,
      durationSeconds: manifest.film.durationSeconds,
      sha256,
    };
  }

  async decisions(orderId: string): Promise<FilmDecisions> {
    const record = this.find(this.read(), orderId);
    const file = join(this.root, record.dir, DECISIONS_FILE);
    if (!existsSync(file)) return { orderId, simulated: false, decisions: [] };
    const saved = JSON.parse(readFileSync(file, 'utf8')) as FilmDecisions;
    return { orderId, simulated: false, decisions: saved.decisions };
  }

  async share(): Promise<{ pageUrl: string; shareId: string }> {
    throw new Error(
      'A local film has no page: the web app publishes film pages. Upload the file to the app to share it.',
    );
  }

  async withdraw(orderId: string, reason: WithdrawReason): Promise<void> {
    const orders = this.read();
    const record = this.find(orders, orderId);
    if (!record.withdrawn) {
      const dir = join(this.root, record.dir);
      const pid = readManifest(dir)?.pid ?? record.pid;
      // A film still being made is stopped: the command closes its sessions and computers.
      if (record.launchedAt && pid !== null && this.alive(pid)) this.kill(pid);
      record.withdrawn = { reason, at: this.clock().toISOString() };
      this.save(orders);
    }
    const dir = join(this.root, record.dir);
    rmSync(join(dir, 'film.mp4'), { force: true });
    if (existsSync(dir))
      for (const name of readdirSync(dir).filter((each) => /^round-\d+$/.test(each)))
        rmSync(join(dir, name, 'render', 'film.mp4'), { force: true });
  }
}
