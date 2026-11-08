import { closeSync, mkdirSync, openSync, unlinkSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient } from '@usenaive-sdk/managed-agents';
import { GTM_ACTIVE } from '../definitions/company/gtm.ts';
import { runDay } from '../gtm/day.ts';
import { hasMx, nodeTransport } from '../gtm/fetch-node.ts';
import type { NaiveLike } from '../gtm/guard.ts';
import { loadStore, saveStore, writeDayFile } from '../gtm/store-file.ts';
import { pacific, systemClock } from '../gtm/time.ts';
import { createPorts } from '../gtm/wiring.ts';
import { NAIVE_BASE_URL, readSecret, scrub } from '../naive/client.ts';

const usage = `Usage: pnpm gtm:day [--dry-run] [--live] [--board] [--date YYYY-MM-DD]

Runs one whole GTM day: removals, discovery, the scout, the pick, films, drafts, execution and the
report. Dry run is the default: everything happens, the drafts and the report are written to
out/gtm/<date>/, and nothing is posted, sent or ordered.

  --dry-run   The default. Every lane is dry run whatever the store's flags say.
  --live      Lets a lane go live, but only when its flag and every precondition pass (see the
              report). Without the hosted executor and the activation checklist, nothing does.
  --board     Writes the day card and comments on the company board. Off by default until a one-card
              REST probe confirms card keys and comment authors (gtm-operations.md section 22).
  --date      The Pacific date to run. Default today.`;

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    live: { type: 'boolean', default: false },
    board: { type: 'boolean', default: false },
    date: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(usage);
  process.exit(0);
}
if (values.live && values['dry-run']) {
  console.error('Choose one of --dry-run and --live.');
  process.exit(2);
}
const dryRun = !values.live;
const root = process.env.GTM_OUT ?? fileURLToPath(new URL('../../../out/gtm/', import.meta.url));
const log = (line: string) => console.log(scrub(line));

/** One day at a time: the store is one file, and two writers would lose rows. */
mkdirSync(root, { recursive: true });
const lockPath = `${root}/.lock`;
let lock: number;
try {
  lock = openSync(lockPath, 'wx');
  writeSync(lock, String(process.pid));
} catch {
  console.error(`${lockPath} exists: another gtm:day is running. Remove it only if it is not.`);
  process.exit(1);
}

const secret = (name: string): string | null => {
  try {
    return readSecret(name);
  } catch {
    return null;
  }
};

try {
  const store = loadStore(root);
  const ports = await createPorts({
    dryRun,
    useBoard: values.board,
    gtmActive: GTM_ACTIVE,
    secret,
    transport: nodeTransport,
    mx: hasMx,
    now: () => new Date().toISOString(),
    appBase: store.flags.app_base,
    naiveClient: (key) =>
      createClient({ baseUrl: NAIVE_BASE_URL, apiKey: key }) as unknown as NaiveLike,
    fetcher: (url, init) => fetch(url, init),
    log,
  });
  const date = values.date ?? pacific(new Date()).date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date must be YYYY-MM-DD, not ${date}`);
  const result = await runDay({
    store,
    ports,
    clock: systemClock,
    date,
    forcedDryRun: dryRun,
    gtmActive: GTM_ACTIVE,
    save: () => saveStore(root, store),
    writeFile: (name, content) => {
      writeDayFile(root, date, name, scrub(content));
    },
    log,
  });
  saveStore(root, store);
  console.log(`\n${scrub(result.report)}`);
  console.log(`\nFiles: ${root}${date}/ (report.txt, review.md, board.md, metrics.json)`);
} finally {
  closeSync(lock);
  unlinkSync(lockPath);
}
