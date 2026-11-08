/**
 * Reclaims what a killed run left behind. A run's computers are destroyed by its own cleanup, which
 * nothing can run when the process is killed outright (SIGKILL, out of memory, a lost machine).
 * Naive has no expiry for a computer, so such a computer bills a new 10-minute block forever.
 *
 * A run may hold computers for at most `RUN_DEADLINE_MS` (the pool stops it then), so a computer
 * named for a run and older than that, with time for the cleanup, belongs to no live run in the
 * org, and any process with the key may destroy it. Every Naive run reaps before it starts, and
 * `pnpm render --reap` reaps on demand.
 */
import type { Naive } from './client.ts';
import { listAll, scrub } from './client.ts';
import { withRetry } from './exec.ts';

/**
 * The longest a run may hold computers. A chunk's commands can take about 45 minutes a try, set-up,
 * readiness, fetch, render and return together, and a chunk has two tries.
 */
export const RUN_DEADLINE_MS = 120 * 60_000;
/** Older than this, a run's computer is an orphan: the deadline, and time for the cleanup. */
export const REAP_AFTER_MS = RUN_DEADLINE_MS + 15 * 60_000;

/** A new run id: the time it starts, to the second, and six random hex digits. */
export const newRunId = (): string =>
  `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').toLowerCase()}-${crypto.randomUUID().slice(0, 6)}`;

/** Every run's computers are named `br-render-<run id>-<role>`. */
export const RUN_PREFIX = 'br-render-';
/** A run id: when it started, and six random hex digits. */
const RUN_ID = '\\d{8}t\\d{6}-[0-9a-f]{6}';
/** A run's Naive files: `boiler-room-<run id>-payload.tgz` and its chunks. */
const RUN_FILE = new RegExp(`^boiler-room-(?:${RUN_PREFIX})?(${RUN_ID})-`);

export interface ReapOptions {
  now?: number;
  /** Reap this run at any age, rather than every run older than `REAP_AFTER_MS`. */
  runId?: string;
  olderThanMs?: number;
  log: (line: string) => void;
}

export interface Reaped {
  computers: string[];
  files: string[];
}

export async function reapOrphans(client: Naive, options: ReapOptions): Promise<Reaped> {
  const now = options.now ?? Date.now();
  const olderThan = options.olderThanMs ?? REAP_AFTER_MS;
  const ofRun = (name: string) => (options.runId ? name.includes(options.runId) : true);
  const old = (createdAt: string) =>
    options.runId !== undefined || now - Date.parse(createdAt) > olderThan;

  const listed = await withRetry(() => listAll((query) => client.computers.list(query)));
  const orphans = listed.filter(
    ({ name, status, created_at }) =>
      name.startsWith(RUN_PREFIX) && status !== 'destroyed' && ofRun(name) && old(created_at),
  );
  const computers: string[] = [];
  for (const { id, name } of orphans) {
    try {
      await withRetry(() => client.computers.delete(id), { attempts: 5 });
    } catch (error) {
      if ((error as { status?: number }).status !== 404) {
        options.log(`could not destroy ${id} (${name}): ${scrub(String(error))}`);
        continue;
      }
    }
    computers.push(id);
    options.log(`destroyed ${id} (${name}), left by an earlier run`);
  }

  const stored = await withRetry(() =>
    listAll((query) => client.files.list({ ...query, search: 'boiler-room-' })),
  );
  const files = stored
    .filter(({ name, created_at }) => RUN_FILE.test(name) && ofRun(name) && old(created_at))
    .map(({ id }) => id);
  for (let start = 0; start < files.length; start += 100) {
    const ids = files.slice(start, start + 100);
    await withRetry(() => client.files.deleteMany({ ids }));
  }
  if (files.length > 0) options.log(`deleted ${files.length} file(s) left by earlier runs`);
  return { computers, files };
}
