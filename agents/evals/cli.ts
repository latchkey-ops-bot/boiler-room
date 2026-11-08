import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { naiveClient, scrub, usd } from '../src/naive/client.ts';
import { GithubApi } from './github.ts';
import { fullCleanup, readState, runScenario, type ScenarioResult } from './harness.ts';
import { judgeConfig } from './judge.ts';
import { teardown } from './practice.ts';
import { ceoScenarios } from './scenarios/ceo.ts';
import { leadScenarios } from './scenarios/eng-lead.ts';
import { engineerScenarios } from './scenarios/engineer.ts';
import { type RoleScore, score } from './score.ts';
import type { Scenario } from './types.ts';

/**
 * `pnpm evals <command>`:
 *   run [--role ceo|eng-lead|engineer-1] [--only id,id] [--budget usd]   runs scenarios, grades them, writes results
 *   prepare --only id                                                    seeds a scenario whose cards must age
 *   cleanup                                                              deletes every br-eval- agent, skill, computer, PR and branch
 *   list                                                                 lists the scenarios
 */

export const SCENARIOS: Scenario[] = [...ceoScenarios, ...leadScenarios, ...engineerScenarios];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    role: { type: 'string' },
    only: { type: 'string' },
    budget: { type: 'string', default: '12' },
  },
});
const command = positionals[0] ?? 'list';
const log = (line: string) => console.log(scrub(line));

const pick = () => {
  const only = values.only
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return SCENARIOS.filter(
    (scenario) =>
      (!values.role || scenario.role === values.role) && (!only || only.includes(scenario.id)),
  );
};

if (command === 'list') {
  for (const scenario of SCENARIOS) {
    console.log(
      `${scenario.role.padEnd(11)} ${scenario.id.padEnd(24)} ${scenario.safety ? 'SAFETY ' : '       '}${scenario.title}`,
    );
  }
  process.exit(0);
}

const client = naiveClient();
const github = new GithubApi('engineering');

if (command === 'cleanup') {
  const report = await fullCleanup(client, github);
  log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const prepared = SCENARIOS.filter((scenario) => readState(scenario.id)?.run).map(
  (scenario) => readState(scenario.id)?.run as string,
);

if (command === 'prepare') {
  for (const scenario of pick()) {
    if (readState(scenario.id)?.run) {
      log(`${scenario.id} is already prepared`);
      continue;
    }
    await runScenario({ client, github, judgeId: '', log }, scenario, { prepare: true });
  }
  process.exit(0);
}

if (command !== 'run') throw new Error(`Unknown command ${command}.`);

const suite = `s${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '')}`;
const budget = Number(values.budget) * 1e6;
const scenarios = pick();
// Leftovers of a crashed run go first: teams over two hours old, except one prepared for an aged
// scenario. Each scenario closes its own pull requests and branches; `cleanup` sweeps them all.
const leftovers = await teardown(client, undefined, [], prepared, 120);
if (leftovers.agents.length)
  log(`cleanup   removed ${leftovers.agents.length} leftover br-eval- agent(s)`);
const balanceBefore = (await client.credits.show()).balance_micro_usd;
const judge = await client.agents.create(judgeConfig(suite));
log(
  `suite     ${suite}: ${scenarios.length} scenario(s), judge ${judge.id}, budget ${usd(budget)}`,
);
const results: ScenarioResult[] = [];
let spent = 0;
try {
  for (const scenario of scenarios) {
    if (spent > budget) {
      log(`budget    ${usd(spent)} spent of ${usd(budget)}: ${scenario.id} not run`);
      continue;
    }
    log(`--- ${scenario.id} (${scenario.role}${scenario.safety ? ', safety' : ''})`);
    const result = (await runScenario(
      { client, github, judgeId: judge.id, log },
      scenario,
    )) as ScenarioResult;
    results.push(result);
    spent += result.cost.total_micro_usd;
    for (const item of result.checks.filter((entry) => !entry.pass))
      log(`  check FAIL ${item.name}: ${item.detail.slice(0, 200)}`);
    for (const item of result.judge.criteria.filter((entry) => !entry.met))
      log(`  judge NOT MET ${item.criterion}: ${item.evidence.slice(0, 200)}`);
    if (result.judge.error) log(`  judge error ${result.judge.error}`);
  }
} finally {
  await client.agents.delete(judge.id).catch(() => undefined);
  const balanceAfter = (await client.credits.show()).balance_micro_usd;
  const scores: RoleScore[] = score(results);
  const out = {
    suite,
    date: new Date().toISOString(),
    org_balance_before_micro_usd: balanceBefore,
    org_balance_after_micro_usd: balanceAfter,
    sessions_micro_usd: spent,
    scores,
    results,
  };
  const dir = new URL('./results/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = new URL(`${suite}.json`, dir);
  writeFileSync(file, `${scrub(JSON.stringify(out, null, 2))}\n`);
  for (const role of scores) {
    log(
      `score     ${role.role.padEnd(11)} ${role.passed}/${role.total} (${Math.round(role.ratio * 100)}%) safety ${role.safety_all_passed ? 'all passed' : 'FAILED'} -> ${role.pass ? 'PASS' : 'FAIL'}`,
    );
  }
  log(
    `spend     sessions ${usd(spent)}; org balance ${usd(balanceBefore)} -> ${usd(balanceAfter)} (${usd(balanceBefore - balanceAfter)}, other jobs included)`,
  );
  log(`results   ${file.pathname} (${readdirSync(dir).length} file(s) in results/)`);
}
