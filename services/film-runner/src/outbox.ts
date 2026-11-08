/**
 * The events waiting to reach the website, kept on disk so a relaunch in the same run resends what
 * the last launch could not, under the same sequence numbers. The website drops a sequence number
 * it already has, so a resend after a lost answer changes nothing.
 *
 * Files in the run dir:
 *
 * - `seq`: the next sequence number. Monotonic over the whole run, across launches.
 * - `outbox.jsonl`: every event given a number, in order, one per line.
 * - `outbox.acked`: the highest sequence number the website has confirmed.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunnerEvent } from './contract.ts';

/** An event before it has a number. */
export type Unnumbered<E extends RunnerEvent = RunnerEvent> = E extends RunnerEvent
  ? Omit<E, 'seq'>
  : never;

export class Outbox {
  private readonly dir: string;
  private next: number;
  private acked: number;
  private queue: RunnerEvent[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(dir: string) {
    this.dir = dir;
    this.next = readNumber(join(dir, 'seq'), 1);
    this.acked = readNumber(join(dir, 'outbox.acked'), 0);
    const file = join(dir, 'outbox.jsonl');
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as RunnerEvent;
          if (event.seq > this.acked) this.queue.push(event);
          if (event.seq >= this.next) this.next = event.seq + 1;
        } catch {
          // A line cut short by a crash mid-write: the event never had its number confirmed.
        }
      }
    }
  }

  /** Takes the next sequence number, and saves the counter before handing it out. */
  takeSeq(): number {
    const seq = this.next;
    this.next += 1;
    writeFileSync(join(this.dir, 'seq'), `${this.next}\n`);
    return seq;
  }

  /** Numbers an event, saves it, and queues it for sending. */
  push<E extends RunnerEvent>(event: Unnumbered<E>): E {
    const numbered = { seq: this.takeSeq(), ...event } as unknown as E;
    appendFileSync(join(this.dir, 'outbox.jsonl'), `${JSON.stringify(numbered)}\n`);
    this.queue.push(numbered);
    for (const listener of this.listeners) listener();
    return numbered;
  }

  /** The events not yet confirmed, oldest first. */
  pending(): readonly RunnerEvent[] {
    return this.queue;
  }

  get size(): number {
    return this.queue.length;
  }

  has(predicate: (event: RunnerEvent) => boolean): boolean {
    return this.queue.some(predicate);
  }

  /** The website confirmed every event up to `seq`. */
  ack(seq: number) {
    if (seq <= this.acked) return;
    this.acked = seq;
    writeFileSync(join(this.dir, 'outbox.acked'), `${seq}\n`);
    this.queue = this.queue.filter((event) => event.seq > seq);
    if (this.queue.length === 0) writeFileSync(join(this.dir, 'outbox.jsonl'), '');
    for (const listener of this.listeners) listener();
  }

  /** Calls `listener` whenever an event is pushed or confirmed. Returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function readNumber(file: string, fallback: number): number {
  try {
    const value = Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
