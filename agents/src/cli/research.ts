import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { research } from '../researcher/run.ts';

const usage = `Usage: pnpm research <url> [--material <file or url>]... [--describe "<text>"] [--budget-usd 1.5] [--max-repairs 2] [--keep-agent] [--drill-repair]

  --material      Customer-supplied file or URL. Repeat for more. Stored in Naive files as provenance "uploaded".
  --describe      How the customer describes the product. The Researcher checks it against the live site.
  --budget-usd    Spend cap for the session. Default from the agent definition.
  --max-repairs   Rounds of gate failures sent back to the agent. Default 2.
  --keep-agent    Keep the agent and its computer afterwards. By default the agent is deleted, which is
                  the only way to remove its computer; the next run recreates it from the repo.
  --drill-repair  Refuse the first submission on purpose, to prove the repair loop live.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    material: { type: 'string', multiple: true, default: [] },
    describe: { type: 'string' },
    'budget-usd': { type: 'string' },
    'max-repairs': { type: 'string', default: '2' },
    'keep-agent': { type: 'boolean', default: false },
    'drill-repair': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

const url = positionals[0];
if (values.help || !url || !/^https?:\/\//i.test(url)) {
  console.log(usage);
  process.exit(values.help ? 0 : 1);
}

const budget = values['budget-usd'] === undefined ? undefined : Number(values['budget-usd']);
if (budget !== undefined && !(budget > 0 && budget <= 3)) {
  console.log('--budget-usd must be above 0 and at most 3, the agent budget per task.');
  process.exit(1);
}

const code = await research({
  url,
  material: values.material ?? [],
  description: values.describe,
  budgetUsd: budget,
  maxRepairs: Math.max(0, Number(values['max-repairs'])),
  keepAgent: values['keep-agent'] ?? false,
  drillRepair: values['drill-repair'] ?? false,
  outRoot: fileURLToPath(new URL('../../../out/', import.meta.url)),
});
process.exit(code);
