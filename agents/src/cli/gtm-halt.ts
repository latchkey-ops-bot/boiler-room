import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TIMER_NAME } from '../gtm/schedule.ts';
import { setFlag } from '../gtm/store.ts';
import { loadStore, saveStore } from '../gtm/store-file.ts';

/**
 * `pnpm gtm:halt`: sets the store's mode to `halted`, so every lane but removals is dry run, and
 * stops the daily timer if it is installed. `--lift` sets the mode back to `dry_run`, never to
 * `live`: going live is a separate, deliberate flag change. `company:halt` is the company-wide
 * switch and also sets the GTM agents' budgets to $0.
 */
const { values } = parseArgs({ options: { lift: { type: 'boolean', default: false } } });
const root = process.env.GTM_OUT ?? fileURLToPath(new URL('../../../out/gtm/', import.meta.url));
const store = loadStore(root);
const at = new Date().toISOString();
setFlag(store, 'mode', values.lift ? 'dry_run' : 'halted', 'gtm:halt', at);
saveStore(root, store);
console.log(`GTM mode is ${store.flags.mode}.`);
if (!values.lift) {
  try {
    execFileSync('systemctl', ['--user', 'disable', '--now', `${TIMER_NAME}.timer`], {
      stdio: 'ignore',
    });
    console.log(`Stopped and disabled ${TIMER_NAME}.timer.`);
  } catch {
    console.log(`${TIMER_NAME}.timer is not installed or not running.`);
  }
} else {
  console.log(`The timer is left as it is. Start it with: pnpm gtm:schedule --enable`);
}
