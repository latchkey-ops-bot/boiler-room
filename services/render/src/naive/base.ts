/**
 * The base image: a snapshot of a computer that already has Chrome's libraries, the renderer and
 * its headless browser, so a worker forked from it only checks that the renderer loads. The
 * snapshot is recorded as a Naive file, so any process in the org with the key can find and reuse
 * it, and the record names the recipe it was built from, so a changed recipe builds a new one.
 *
 * There is no separate builder: when no snapshot is recorded, every worker sets itself up, and the
 * first one is snapshotted the moment its setup passes, before any campaign file reaches it.
 */
import { createHash } from 'node:crypto';
import type { ComputerSize } from '../cost.ts';
import { REMOTION_VERSION } from '../versions.ts';
import type { Naive } from './client.ts';
import { listAll } from './client.ts';
import { type CommandOptions, MAX_COMMAND_MS, runCommand, withRetry } from './exec.ts';
import { uploadBytes } from './transfer.ts';

/** Remotion's list for Ubuntu 24.04, and a fallback font so a missing glyph is never a box. */
const CHROME_LIBRARIES = [
  'libnss3',
  'libdbus-1-3',
  'libatk1.0-0',
  'libasound2t64',
  'libxrandr2',
  'libxkbcommon-dev',
  'libxfixes3',
  'libxcomposite1',
  'libxdamage1',
  'libgbm-dev',
  'libcups2',
  'libcairo2',
  'libpango-1.0-0',
  'libatk-bridge2.0-0',
  'fonts-liberation',
];

/** Where the renderer is installed. A job is unpacked below it, so Node finds its modules. */
export const RENDER_DIR = 'render';

/**
 * Installs everything a chunk needs. A ticker prints every 20 s, so the streamed command is never
 * quiet for long enough for a connection to be dropped.
 */
export const SETUP_SCRIPT = `set -euo pipefail
( while true; do echo "setup: working"; sleep 20; done ) &
ticker=$!
trap 'kill $ticker 2>/dev/null || true' EXIT
export DEBIAN_FRONTEND=noninteractive
sudo -E apt-get update -qq
sudo -E apt-get install -y -qq --no-install-recommends ${CHROME_LIBRARIES.join(' ')} > /dev/null
mkdir -p "$HOME/${RENDER_DIR}"
cd "$HOME/${RENDER_DIR}"
printf '%s\\n' '{"name":"boiler-room-render-worker","private":true,"type":"module"}' > package.json
npm install --no-audit --no-fund --loglevel=error @remotion/renderer@${REMOTION_VERSION}
node -e "import('@remotion/renderer').then((r) => r.ensureBrowser())"
echo "setup: done"
`;

/** Loads the renderer and makes sure its browser is there. Fast on a ready computer. */
export const READY_CHECK = `cd "$HOME/${RENDER_DIR}" && node -e "import('@remotion/renderer').then(async (r) => { await r.ensureBrowser(); console.log('renderer ready') })"`;

export const RECIPE_HASH = createHash('sha256')
  .update(`${SETUP_SCRIPT}\n${READY_CHECK}`)
  .digest('hex')
  .slice(0, 16);

const TAG = 'boiler-room-render-base';

export interface BaseRecord {
  snapshotId: string;
  recipeHash: string;
  remotion: string;
  /** The computer the snapshot was taken from. A fork must be at least this large. */
  size: ComputerSize;
  builtAt: string;
  /** A clean computer, from running to the renderer ready. */
  setupSeconds: number;
  snapshotSeconds: number;
}

export const fitsBase = (size: ComputerSize, base: Pick<BaseRecord, 'size'>) =>
  size.vcpu >= base.size.vcpu &&
  size.memoryMb >= base.size.memoryMb &&
  size.diskGb >= base.size.diskGb;

/** The newest recorded base for this recipe whose snapshot still exists. */
export async function findBase(
  client: Naive,
  signal?: AbortSignal,
): Promise<BaseRecord | undefined> {
  const files = await withRetry(() => client.files.list({ tag: TAG, limit: 50 }), { signal });
  const snapshots = new Set(
    (
      await withRetry(() => listAll((query) => client.computers.listSnapshots(query)), { signal })
    ).map(({ snapshot_id }) => snapshot_id),
  );
  for (const file of files.data) {
    if (!file.title?.includes(RECIPE_HASH)) continue;
    try {
      const record = JSON.parse(await client.files.download(file.id)) as BaseRecord;
      if (record.recipeHash === RECIPE_HASH && snapshots.has(record.snapshotId)) return record;
    } catch {
      // An unreadable record is skipped; the next one, or a fresh build, takes its place.
    }
  }
  return undefined;
}

export async function recordBase(client: Naive, record: BaseRecord): Promise<string> {
  const bytes = new TextEncoder().encode(`${JSON.stringify(record, null, 2)}\n`);
  const fileId = await uploadBytes(
    client,
    `render-base-${RECIPE_HASH}.json`,
    'application/json',
    bytes,
  );
  await withRetry(() =>
    client.files.update(fileId, {
      title: `Boiler Room render base ${RECIPE_HASH}`,
      description: `Snapshot ${record.snapshotId}: Chrome libraries, @remotion/renderer ${record.remotion} and its browser.`,
      tags: [TAG],
    }),
  );
  return fileId;
}

/** Runs the setup on a clean computer. Returns the seconds it took. */
export async function setUp(
  client: Naive,
  computerId: string,
  home: string,
  options: Pick<CommandOptions, 'signal' | 'onLine'> = {},
): Promise<number> {
  const started = performance.now();
  await withRetry(() =>
    client.computers.fs(computerId, 'write', {
      path: `${home}/render-setup.sh`,
      content: SETUP_SCRIPT,
    }),
  );
  await runCommand(client, computerId, 'bash "$HOME/render-setup.sh"', {
    ...options,
    timeoutMs: MAX_COMMAND_MS,
  });
  await checkReady(client, computerId, options.signal);
  return (performance.now() - started) / 1000;
}

export async function checkReady(client: Naive, computerId: string, signal?: AbortSignal) {
  const { stdout } = await runCommand(client, computerId, READY_CHECK, {
    timeoutMs: 300_000,
    ...(signal ? { signal } : {}),
  });
  if (!stdout.includes('renderer ready')) {
    throw new Error(`The renderer did not load on ${computerId}: ${stdout.slice(-500)}`);
  }
}

/** Snapshots a computer whose setup just passed, and records it for later runs. */
export async function snapshotBase(
  client: Naive,
  computerId: string,
  size: ComputerSize,
  setupSeconds: number,
): Promise<BaseRecord> {
  const started = performance.now();
  const { snapshot_id } = await client.computers.snapshot(computerId);
  const record: BaseRecord = {
    snapshotId: snapshot_id,
    recipeHash: RECIPE_HASH,
    remotion: REMOTION_VERSION,
    size,
    builtAt: new Date().toISOString(),
    setupSeconds,
    snapshotSeconds: (performance.now() - started) / 1000,
  };
  await recordBase(client, record);
  return record;
}
