import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { dayMetrics } from '../gtm/report.ts';
import { loadStore } from '../gtm/store-file.ts';
import { pacific } from '../gtm/time.ts';

/**
 * `pnpm gtm:report`: the GTM metrics from the store, with no network and no model. It prints the
 * day's report as `gtm:day` wrote it, then a table of the last N days.
 *
 *   --date YYYY-MM-DD   the last day of the table, default today (Pacific)
 *   --days N            how many days, default 7
 *   --json              the metrics as JSON
 */
const { values } = parseArgs({
  options: {
    date: { type: 'string' },
    days: { type: 'string', default: '7' },
    json: { type: 'boolean', default: false },
  },
});
const root = process.env.GTM_OUT ?? fileURLToPath(new URL('../../../out/gtm/', import.meta.url));
const store = loadStore(root);
const last = values.date ?? pacific(new Date()).date;
const days = Math.max(1, Math.min(90, Number(values.days) || 7));
const dates = Array.from({ length: days }, (_, back) => {
  const day = new Date(`${last}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - back);
  return day.toISOString().slice(0, 10);
}).reverse();
const metrics = dates.map((date) => dayMetrics(store, date));

if (values.json) {
  console.log(JSON.stringify(metrics, null, 2));
} else {
  const saved = join(root, last, 'report.txt');
  console.log(
    existsSync(saved)
      ? readFileSync(saved, 'utf8')
      : `No report for ${last} yet. Run pnpm gtm:day.\n`,
  );
  const usd = (micro: number) => `$${(micro / 1e6).toFixed(3)}`;
  console.log(
    '| Date | Found | Qualified | X posted | X drafts | Emails sent | Email drafts | Films ready | Opt-outs | Removals | Spend | Per qualified lead |',
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const m of metrics) {
    console.log(
      `| ${m.date} | ${m.leads.found} | ${m.leads.qualified} | ${m.x.posted} | ${m.x.drafts} | ${m.email.sent} | ${m.email.drafts} | ${m.films.ready} | ${m.optOuts} | ${m.removals} | ${usd(m.spend.total)} | ${m.costPerQualified === null ? 'n/a' : usd(m.costPerQualified)} |`,
    );
  }
  const total = metrics.reduce((sum, m) => sum + m.spend.total, 0);
  const qualified = metrics.reduce((sum, m) => sum + m.leads.qualified, 0);
  console.log(
    `\n${days} days: ${qualified} qualified, ${usd(total)} spent${qualified ? `, ${usd(total / qualified)} per qualified lead` : ''}. Suppression rows: ${store.suppression.length}. Unknown sends: ${store.actions.filter((row) => row.status === 'unknown').length}.`,
  );
}
