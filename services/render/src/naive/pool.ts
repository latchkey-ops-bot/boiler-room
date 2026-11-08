/**
 * Every computer a render creates, from the moment Naive answers the create. The pool destroys them
 * all at the end, on failure and on Ctrl-C, and keeps the bill: each one's charge so far, and what
 * the next 10-minute block would add. Before a create would take the run past its cost limit,
 * counting the creates still in flight, or before the clock reaches a block the limit cannot pay
 * for, it refuses and stops the run.
 */
import {
  blockEnd,
  type ComputerSize,
  CostLimitExceeded,
  chargedUsd,
  ratePerSecond,
} from '../cost.ts';
import type { Naive } from './client.ts';
import { listAll, scrub } from './client.ts';
import { Aborted, withRetry } from './exec.ts';
import { RUN_DEADLINE_MS } from './reap.ts';

export interface ComputerRecord {
  id: string;
  name: string;
  role: string;
  size: ComputerSize;
  snapshotId: string | null;
  createdAt: string;
  createdMs: number;
  /** Create sent to ready to work: running, and the renderer checked. */
  readySeconds: number | null;
  destroyedAt: string | null;
  destroyedMs: number | null;
  /** What the pool worked out Naive has charged, from the published rates. */
  chargedUsd: number;
}

export interface PoolOptions {
  runId: string;
  limitUsd: number;
  log: (line: string) => void;
  /** Called once the pool has decided the run must stop, for example at the cost limit. */
  onStop: (error: Error) => void;
  now?: () => number;
  /** How long the run may hold computers. Other runs reap a computer older than this. */
  deadlineMs?: number;
}

/** How long before a billing block begins the pool stops a run that could not pay for it. */
const BLOCK_GUARD_MS = 30_000;

export class ComputerPool {
  readonly records: ComputerRecord[] = [];
  private readonly live = new Set<string>();
  private readonly pendingCreates = new Set<Promise<unknown>>();
  private readonly destroying = new Map<string, Promise<void>>();
  /** The first block of every create still in flight, which is charged the moment it answers. */
  private reservedUsd = 0;
  private closed = false;
  private watchdog: NodeJS.Timeout | undefined;
  private readonly now: () => number;
  private readonly client: Naive;
  private readonly options: PoolOptions;
  private readonly deadline: number;

  constructor(client: Naive, options: PoolOptions) {
    this.client = client;
    this.options = options;
    this.now = options.now ?? Date.now;
    this.deadline = this.now() + (options.deadlineMs ?? RUN_DEADLINE_MS);
    this.watchdog = setInterval(() => {
      this.checkNextBlock();
      this.checkDeadline();
    }, 5000);
    this.watchdog.unref();
  }

  private pastDeadline(): Aborted | undefined {
    if (this.now() <= this.deadline) return undefined;
    const minutes = Math.round((this.options.deadlineMs ?? RUN_DEADLINE_MS) / 60_000);
    return new Aborted(
      `The run passed its deadline of ${minutes} min with computers. Later runs reap a computer older than that, so it stops here.`,
    );
  }

  /** Stops a run at its deadline, so no live run ever holds a computer another run would reap. */
  private checkDeadline() {
    if (this.closed || this.live.size === 0) return;
    const past = this.pastDeadline();
    if (past) this.options.onStop(past);
  }

  get prefix() {
    return `br-render-${this.options.runId}`;
  }

  /** What every computer of this run has been charged so far. */
  chargedUsd(at = this.now()): number {
    return this.records.reduce(
      (sum, record) => sum + chargedUsd(record.size, record.createdMs, record.destroyedMs ?? at),
      0,
    );
  }

  /** What the run will have been charged once the clock enters the next block. */
  projectedUsd(at = this.now()): number {
    const next = blockEnd(at);
    return this.records.reduce(
      (sum, record) => sum + chargedUsd(record.size, record.createdMs, record.destroyedMs ?? next),
      this.reservedUsd,
    );
  }

  private checkNextBlock() {
    if (this.closed || this.live.size === 0) return;
    const at = this.now();
    if (blockEnd(at) - at > BLOCK_GUARD_MS) return;
    const projected = this.projectedUsd(at);
    if (projected > this.options.limitUsd) {
      this.options.onStop(
        new CostLimitExceeded(this.options.limitUsd, projected, 'The next billing block'),
      );
    }
  }

  /** Creates a computer, after checking that its first block fits under the limit. */
  async create(
    role: string,
    size: ComputerSize,
    snapshotId: string | null,
    signal?: AbortSignal,
  ): Promise<ComputerRecord> {
    if (this.closed || signal?.aborted) throw new Aborted();
    const past = this.pastDeadline();
    if (past) throw past;
    const at = this.now();
    const firstBlock = (ratePerSecond(size) * (blockEnd(at) - at)) / 1000;
    // Creates in flight count too: two that start together would each see the other missing.
    const needed = this.chargedUsd(at) + this.reservedUsd + firstBlock;
    if (needed > this.options.limitUsd) {
      throw new CostLimitExceeded(this.options.limitUsd, needed, `Creating ${role}`);
    }
    this.reservedUsd += firstBlock;
    const name = `${this.prefix}-${role}`;
    const request = this.client.computers.create({
      name,
      vcpu: size.vcpu,
      memory_mb: size.memoryMb,
      disk_gb: size.diskGb,
      ...(snapshotId ? { snapshot_id: snapshotId } : {}),
    });
    this.pendingCreates.add(request);
    let computer: Awaited<typeof request>;
    try {
      computer = await request;
    } finally {
      // Released as the record that replaces it is added, with no await between the two.
      this.pendingCreates.delete(request);
      this.reservedUsd -= firstBlock;
    }
    const createdMs = Date.parse(computer.created_at) || at;
    const record: ComputerRecord = {
      id: computer.id,
      name,
      role,
      size,
      snapshotId,
      createdAt: new Date(createdMs).toISOString(),
      createdMs,
      readySeconds: null,
      destroyedAt: null,
      destroyedMs: null,
      chargedUsd: 0,
    };
    this.records.push(record);
    this.live.add(computer.id);
    this.options.log(
      `created ${computer.id} (${role}, ${size.vcpu} vCPU${snapshotId ? ', from the base snapshot' : ''})`,
    );
    if (this.closed || signal?.aborted) {
      await this.destroy(computer.id);
      throw new Aborted();
    }
    return record;
  }

  /** Waits until a new computer is running. Naive answers a create before the machine is up. */
  async waitRunning(record: ComputerRecord, signal?: AbortSignal, timeoutMs = 180_000) {
    const deadline = this.now() + timeoutMs;
    for (;;) {
      if (signal?.aborted) throw new Aborted();
      const computer = await withRetry(() => this.client.computers.get(record.id), { signal });
      if (computer.status === 'running') return;
      if (computer.status === 'failed' || computer.status === 'destroyed') {
        throw new Error(`Computer ${record.id} is ${computer.status}.`);
      }
      if (this.now() > deadline) throw new Error(`Computer ${record.id} was not running in time.`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  /** Destroys one computer. Two calls for the same computer share one delete. */
  destroy(id: string): Promise<void> {
    if (!this.live.has(id)) return Promise.resolve();
    const pending = this.destroying.get(id);
    if (pending) return pending;
    const request = this.deleteNow(id).finally(() => this.destroying.delete(id));
    this.destroying.set(id, request);
    return request;
  }

  private async deleteNow(id: string): Promise<void> {
    const record = this.records.find((item) => item.id === id);
    try {
      await withRetry(() => this.client.computers.delete(id), { attempts: 5 });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 404) {
        this.options.log(`could not destroy ${id}: ${scrub(String(error))}`);
        return;
      }
    }
    this.live.delete(id);
    if (record) {
      record.destroyedMs = this.now();
      record.destroyedAt = new Date(record.destroyedMs).toISOString();
      record.chargedUsd = chargedUsd(record.size, record.createdMs, record.destroyedMs);
    }
    this.options.log(`destroyed ${id}`);
  }

  /**
   * Destroys every computer of the run, including any whose create is still in flight, then lists
   * the org's computers and destroys any left with this run's name. Returns those still alive.
   */
  async close(): Promise<string[]> {
    this.closed = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = undefined;
    await Promise.allSettled([...this.pendingCreates]);
    await Promise.allSettled([...this.live].map((id) => this.destroy(id)));
    return this.sweep();
  }

  /** The computers named for this run that Naive still lists as not destroyed. */
  async sweep(): Promise<string[]> {
    const listed = await withRetry(() => listAll((query) => this.client.computers.list(query)));
    const left = listed.filter(
      ({ name, status }) => name.startsWith(this.prefix) && status !== 'destroyed',
    );
    for (const { id } of left) {
      this.live.add(id);
      await this.destroy(id);
    }
    const again = await withRetry(() => listAll((query) => this.client.computers.list(query)));
    return again
      .filter(({ name, status }) => name.startsWith(this.prefix) && status !== 'destroyed')
      .map(({ id }) => id);
  }
}
