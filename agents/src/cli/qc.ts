import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  EXPECTED_PLACEHOLDER_FAILURES,
  FILM_LIMITS,
  ledgerPath,
  readLedger,
  recordSpend,
  refuseUnlessAllowed,
  rounds,
  routable,
  spentMicroUsd,
} from '../pipeline/ledger.ts';
import { readRenderDir } from '../quality/render-dir.ts';
import { formatReport, qualityCheckRender } from '../quality/run.ts';

const usage = `Usage: pnpm qc <render-dir> --research <research.json> [--campaign <campaign.json>] [--no-model] [--budget-usd 1] [--json]

  <render-dir>  A folder the render service wrote: film.mp4, film.manifest.json and film.quality/.
  --research    Required. The Researcher's research.json, with the pages.json and report.json of
                the same run beside it. Every claim is traced to it and to the stored page text,
                and brand colours to it.
  --campaign    Review against this campaign file instead of the one the manifest names. Its
                SHA-256 must still match the one the film was rendered from.
  --no-model    Run the code checks only. The verdict is then blocked: no film passes unless
                br-quality-check has opened its frames.
  --budget-usd  Spend cap for the review session (at least 1, Sonnet's minimum).
  --json        Print the report as JSON instead of text.

The report is also written to <render-dir>/<campaign id>.qc/qc-report.json. Exit code 0 is pass,
1 is fail, 2 is a usage or input error.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    research: { type: 'string' },
    campaign: { type: 'string' },
    'no-model': { type: 'boolean', default: false },
    'budget-usd': { type: 'string' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

// pnpm runs a package script from the package folder; INIT_CWD is where the command was typed.
const from = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path);
const dir = positionals[0];
if (values.help || !dir) {
  console.log(usage);
  process.exit(values.help ? 0 : 2);
}
if (!values.research) {
  console.error(
    '--research is required: without the research, a claim whose quote was never on the site passes.',
  );
  process.exit(2);
}
const researchFile = values.research;
for (const path of [dir, values.research, values.campaign]) {
  if (path && !existsSync(from(path))) {
    console.error(`Not found: ${path}`);
    process.exit(2);
  }
}
const budget = values['budget-usd'] === undefined ? undefined : Number(values['budget-usd']);
if (budget !== undefined && !(budget >= 1 && budget <= 1.5)) {
  console.error(
    '--budget-usd must be between 1 (the Sonnet minimum) and 1.5 (the agent budget per task).',
  );
  process.exit(2);
}

// The film's ledger lives beside its campaign.json. A review the agent runs is a Quality Check
// round; none starts on a film over its limits. Code-only runs cost nothing and always run.
let ledger: { file: string; film: string } | undefined;
try {
  const render = readRenderDir(from(dir));
  const campaign = values.campaign
    ? from(values.campaign)
    : render.campaignPath(render.manifest.campaign.file);
  ledger = { file: ledgerPath(dirname(campaign)), film: basename(dirname(campaign)) };
} catch {
  ledger = undefined;
}
if (ledger && !values['no-model']) refuseUnlessAllowed(ledger.file, ledger.film, 'quality-check');

try {
  const report = await qualityCheckRender({
    renderDir: from(dir),
    researchFile: from(researchFile),
    ...(values.campaign ? { campaignFile: from(values.campaign) } : {}),
    model: !values['no-model'],
    ...(budget !== undefined ? { budgetUsd: budget } : {}),
    say: values.json ? (line) => console.error(line) : undefined,
  });
  console.log(values.json ? JSON.stringify(report, null, 2) : `\n${formatReport(report)}`);
  if (ledger && report.review) {
    const after = recordSpend(ledger.file, ledger.film, {
      step: 'quality-check',
      microUsd: report.review.costMicroUsd,
      session: report.review.sessionId,
      note: `verdict ${report.verdict}`,
    });
    const owners = [...routable(report).entries()]
      .map(([owner, list]) => `${list.length} for ${owner}`)
      .join(', ');
    const expected = report.issues.filter((issue) =>
      EXPECTED_PLACEHOLDER_FAILURES.has(issue.check),
    ).length;
    const say = values.json ? console.error : console.log;
    say(
      `\nroute-back: ${owners || 'nothing to send back'}; ${expected} expected placeholder failure(s) send nothing back. Round ${rounds(after)} of ${FILM_LIMITS.maxRounds}; film spend $${(spentMicroUsd(after) / 1e6).toFixed(4)} of $${(FILM_LIMITS.maxMicroUsd / 1e6).toFixed(2)} (${ledger.file}).`,
    );
  } else if (ledger) {
    const known = readLedger(ledger.file, ledger.film);
    if (known.entries.length && !values.json)
      console.log(
        `\nfilm spend so far $${(spentMicroUsd(known) / 1e6).toFixed(4)} (${ledger.file}).`,
      );
  }
  process.exit(report.verdict === 'pass' ? 0 : 1);
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(2);
}
