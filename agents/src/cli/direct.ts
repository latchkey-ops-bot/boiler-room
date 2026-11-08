import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type DirectorBrief, directorBriefSchema, OUTREACH_BRIEF } from '../director/output.ts';
import { direct } from '../director/run.ts';
import { freshReport, ledgerPath, recordSpend, refuseUnlessAllowed } from '../pipeline/ledger.ts';

const usage = `Usage: pnpm direct <research.json> [--brief <brief.json>] [--order] [--approved-only] [--model opus|sonnet|<id>] [--budget-usd 2.5] [--max-repairs 3] [--out <dir>]

  Writes campaign.json and handoff.json beside research.json, and prints the rounds and the cost.
  The files Researcher saved in files/ beside research.json are the asset list.

  --brief          A brief as JSON (see directorBriefSchema). Default: an outreach sample, 16:9, no
                   music, no narration, extracted claims citable.
  --order          A customer order instead of an outreach sample. Extracted claims stay citable
                   unless --approved-only is given.
  --approved-only  Cite only claims with status "approved".
  --model          Override the agent's model for this run (a trial; it mints a new agent version).
  --budget-usd     Spend cap for the session. Default from the agent definition.
  --max-repairs    Rounds of issues sent back to the session. Default 3.
  --out            Folder for the outputs instead of the research file's folder.
  --drill-repair   Send the first submission back on purpose, to prove the repair loop live.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    brief: { type: 'string' },
    order: { type: 'boolean', default: false },
    'approved-only': { type: 'boolean', default: false },
    model: { type: 'string' },
    'budget-usd': { type: 'string' },
    'max-repairs': { type: 'string', default: '3' },
    out: { type: 'string' },
    'drill-repair': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

// pnpm runs the script from agents/, so relative paths are read from where it was called.
const from = process.env.INIT_CWD ?? process.cwd();
const path = (input: string) => (isAbsolute(input) ? input : resolve(from, input));

const research = positionals[0];
if (values.help || !research) {
  console.log(usage);
  process.exit(values.help ? 0 : 1);
}

let brief: DirectorBrief = values.brief
  ? directorBriefSchema.parse(JSON.parse(readFileSync(path(values.brief), 'utf8')))
  : OUTREACH_BRIEF;
if (values.order) brief = { ...brief, kind: 'customer-order' };
if (values['approved-only']) brief = { ...brief, citeExtracted: false };

const budget = values['budget-usd'] === undefined ? undefined : Number(values['budget-usd']);
if (budget !== undefined && !(budget >= 1 && budget <= 3)) {
  console.log('--budget-usd must be from 1 (the Sonnet minimum) to 3, the agent budget per task.');
  process.exit(1);
}

// The film's ledger lives beside its campaign.json: no Director run starts on a film over its limits.
const outDir = values.out ? path(values.out) : dirname(path(research));
const film = basename(outDir);
const ledger = ledgerPath(outDir);
refuseUnlessAllowed(ledger, film, 'director');
const started = Date.now();

const code = await direct({
  researchPath: path(research),
  brief,
  model: values.model,
  budgetUsd: budget,
  maxRepairs: Math.max(0, Number(values['max-repairs'])),
  outDir: values.out ? path(values.out) : undefined,
  drillRepair: values['drill-repair'] ?? false,
});
const report = freshReport(join(outDir, 'director-report.json'), started);
if (report) {
  recordSpend(ledger, film, {
    step: 'director',
    microUsd: Number(report.session_micro_usd ?? 0),
    session: typeof report.session_id === 'string' ? report.session_id : null,
    note: code === 0 ? 'campaign written' : 'no campaign written',
  });
}
process.exit(code);
