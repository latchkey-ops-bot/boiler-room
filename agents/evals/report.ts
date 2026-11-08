import { readdirSync, readFileSync } from 'node:fs';
import { type RoleScore, score } from './score.ts';

/** One suite file in agents/evals/results, as `pnpm evals run` writes it. */
export interface SuiteFile {
  suite: string;
  date: string;
  sessions_micro_usd: number;
  org_balance_before_micro_usd?: number;
  org_balance_after_micro_usd?: number;
  results: {
    id: string;
    role: string;
    safety: boolean;
    title: string;
    run: string;
    ended_at: string;
    pass: boolean;
    error: string | null;
    cost: { total_micro_usd: number };
    checks: { name: string; pass: boolean }[];
    judge: { verdict: string | null; criteria: { met: boolean }[] };
  }[];
}

export function readSuites(dir: URL): SuiteFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as SuiteFile)
    .sort((a, b) => a.date.localeCompare(b.date));
}

const money = (micro: number) => `$${(micro / 1e6).toFixed(2)}`;

export interface Report {
  latest: (SuiteFile['results'][number] & { suite: string })[];
  scores: RoleScore[];
  spend_micro_usd: number;
  runs: number;
}

/** The latest result of each scenario across every suite file, the role scores from them, and the total spend. */
export function report(suites: readonly SuiteFile[]): Report {
  const all = suites.flatMap((suite) =>
    suite.results.map((result) => ({ ...result, suite: suite.suite })),
  );
  all.sort((a, b) => a.ended_at.localeCompare(b.ended_at));
  const latest = new Map<string, (typeof all)[number]>();
  for (const result of all) latest.set(result.id, result);
  return {
    latest: [...latest.values()],
    scores: score(all),
    spend_micro_usd: suites.reduce((sum, suite) => sum + suite.sessions_micro_usd, 0),
    runs: all.length,
  };
}

/** The scores and every run, as Markdown for docs/company/evals.md. */
export function markdown(suites: readonly SuiteFile[]): string {
  const { scores, spend_micro_usd, runs } = report(suites);
  const lines = [
    '| Role | Passed | Score | Safety | Verdict |',
    '| --- | --- | --- | --- | --- |',
    ...scores.map(
      (item) =>
        `| ${item.role} | ${item.passed} of ${item.total} | ${Math.round(item.ratio * 100)}% | ${item.safety_all_passed ? 'all passed' : 'FAILED'} | ${item.pass ? 'pass' : 'fail'} |`,
    ),
    '',
    `${runs} scenario runs in ${suites.length} suites, ${money(spend_micro_usd)} of session spend in all.`,
    '',
    '| Suite | Ended (UTC) | Scenario | Safety | Result | Checks | Rubric | Cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const suite of suites) {
    for (const result of suite.results) {
      const checks = `${result.checks.filter((item) => item.pass).length}/${result.checks.length}`;
      const rubric = `${result.judge.criteria.filter((item) => item.met).length}/${result.judge.criteria.length}`;
      lines.push(
        `| ${suite.suite} | ${result.ended_at.slice(0, 16).replace('T', ' ')} | \`${result.id}\` | ${result.safety ? 'yes' : ''} | ${result.error ? 'error' : result.pass ? 'pass' : 'FAIL'} | ${checks} | ${rubric} | ${money(result.cost.total_micro_usd)} |`,
      );
    }
  }
  return lines.join('\n');
}
