import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentDefinition } from '../define.ts';
import { director } from '../definitions/director.ts';
import { type Naive, naiveClient, scrub, usd } from '../naive/client.ts';
import { closeSession, inputTokens } from '../naive/session.ts';
import { type ResearchOutput, researchOutputSchema } from '../researcher/output.ts';
import { syncAgents } from '../sync.ts';
import {
  checkSubmission,
  type DirectorIssue,
  researchFacts,
  tourPlan,
  type Verdict,
} from './checks.ts';
import { type LoopClient, type LoopResult, runDirectorSession, type StreamEvent } from './loop.ts';
import type { DirectorBrief } from './output.ts';
import { directorResumeTask, directorTask } from './prompt.ts';

export const MODELS: Record<string, string> = {
  sonnet: 'anthropic/claude-sonnet-5.5',
  opus: 'anthropic/claude-opus-5.5',
  haiku: 'anthropic/claude-haiku-5.5',
};

export interface DirectOptions {
  researchPath: string;
  brief: DirectorBrief;
  /** A model id, or `sonnet`, `opus` or `haiku`. Defaults to the definition's. */
  model?: string;
  budgetUsd?: number;
  maxRepairs: number;
  /** Where campaign.json goes. Defaults to the research file's folder. */
  outDir?: string;
  definition?: AgentDefinition;
  /** Sends the first submission back on purpose, to prove the repair loop on a live session. */
  drillRepair?: boolean;
}

/** The issue a repair drill adds to the first submission. */
export const DRILL_ISSUE: DirectorIssue = {
  code: 'REPAIR_DRILL',
  severity: 'error',
  path: 'campaign',
  message:
    'This is a drill of the repair loop: the pipeline sends the first submission back on purpose.',
  fix: 'Change nothing. Call submit_output again with the same whole {campaign, handoff}.',
  owner: 'director',
};

const time = () => new Date().toISOString().slice(11, 19);
const say = (message: string) => console.log(scrub(`${time()} ${message}`));
const oneLine = (value: unknown, max: number) => {
  const text = (typeof value === 'string' ? value : JSON.stringify(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

function describe(event: StreamEvent): string | undefined {
  const data = event.data ?? {};
  switch (event.type) {
    case 'tool.started':
      return `-> ${data.name} ${data.name === 'submit_output' ? '' : oneLine(data.args, 80)}`;
    case 'tool.completed':
      return `${data.is_error ? '!! ' : '   '}${data.name}: ${oneLine(data.output, 160)}`;
    case 'message.completed':
      return data.role === 'user' ? undefined : `agent: ${oneLine(data.content, 300)}`;
    case 'session.usage':
      return `usage: ${usd(Number(data.consumed_micro_usd ?? 0))} so far`;
    case 'session.idle':
      return `idle: ${data.stop_reason}${data.error ? ` (${oneLine(data.error, 200)})` : ''}`;
    case 'budget.exceeded':
    case 'session.retrying':
    case 'session.degraded':
      return `${event.type}: ${oneLine(data, 200)}`;
    default:
      return undefined;
  }
}

/** Asset ids with a downloaded file in `files/` beside the research, as the Researcher saves them. */
function filesOnHand(researchDir: string): Set<string> {
  const dir = join(researchDir, 'files');
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).map((name) => name.replace(/\.[^.]+$/, '')));
}

export function printIssues(issues: readonly DirectorIssue[]): void {
  for (const issue of issues) {
    console.log(`  ${issue.severity} ${issue.code} ${issue.path}: ${issue.message}`);
    console.log(`    fix: ${issue.fix}`);
  }
}

/**
 * One Director run: reads research.json, syncs `br-director`, runs one session with the repair
 * loop, and saves campaign.json and handoff.json beside the research. Exits 1, printing every
 * remaining issue, when the repairs run out. The agent is kept: it is a crew agent.
 */
export async function direct(options: DirectOptions): Promise<number> {
  const base = options.definition ?? director;
  const model = options.model ? (MODELS[options.model] ?? options.model) : base.model;
  const definition: AgentDefinition = { ...base, model };
  const research: ResearchOutput = researchOutputSchema.parse(
    JSON.parse(readFileSync(options.researchPath, 'utf8')),
  );
  const researchDir = dirname(options.researchPath);
  const outDir = options.outDir ?? researchDir;
  mkdirSync(outDir, { recursive: true });
  const facts = researchFacts(research);
  const budgetMicro = Math.round(
    (options.budgetUsd ?? definition.session.budget_micro_usd / 1e6) * 1e6,
  );
  const eventsPath = join(outDir, 'director-events.jsonl');
  writeFileSync(eventsPath, '');

  const client: Naive = naiveClient();
  const balanceBefore = (await client.credits.show()).balance_micro_usd;
  const report: Record<string, unknown> = {
    research: options.researchPath,
    host: facts.host,
    started_at: new Date().toISOString(),
    model,
    brief: options.brief,
    facts,
    budget_micro_usd: budgetMicro,
  };
  const verdicts: Verdict[] = [];
  let exitCode = 1;
  let sessionId: string | undefined;
  const sessionIds: string[] = [];

  try {
    const [synced] = await syncAgents(client, [definition]);
    if (!synced) throw new Error('Agent sync returned nothing.');
    say(`agent ${synced.name} ${synced.id} v${synced.version} (${synced.action}), model ${model}`);
    Object.assign(report, { agent_id: synced.id, agent_version: synced.version });

    const tour = tourPlan(research, options.brief);
    report.tour = tour;
    say(
      tour.support.ok
        ? `site-scroll supported: ${tour.support.assetIds.join(', ')}`
        : `site-scroll not supported, so its row becomes a site-hero on ${tour.screens[0] ?? 'a captured screen'}: ${tour.support.reasons[0]}`,
    );
    const taskInput = {
      research,
      brief: options.brief,
      facts,
      filesOnHand: filesOnHand(researchDir),
      budgetUsd: budgetMicro / 1e6,
      tour,
    };
    const sessions: Record<string, unknown>[] = [];
    report.sessions = sessions;
    const runSession = (task: string, maxRepairs: number, label: string) =>
      runDirectorSession({
        client: client as LoopClient,
        agentId: synced.id,
        task,
        outputSchema: definition.output_schema ?? {},
        budgetMicroUsd: budgetMicro,
        maxRepairs,
        maxMinutes: definition.session.max_minutes,
        metadata: { run: 'direct', host: facts.host, attempt: label },
        onSession: (id) => {
          sessionId = id;
          sessionIds.push(id);
          report.session_id = id;
          say(`session ${id} (${label}) started, budget ${usd(budgetMicro)}`);
        },
        onEvent: (event) => {
          if (event.type !== 'message.delta' && !event.type.startsWith('span.'))
            appendFileSync(eventsPath, `${scrub(JSON.stringify(event))}\n`);
          const line = describe(event);
          if (line) say(line);
        },
        check: async (output) => {
          const verdict = await checkSubmission(output, research, options.brief, tour);
          if (options.drillRepair && verdicts.length === 0) verdict.blocking.push(DRILL_ISSUE);
          verdicts.push(verdict);
          const round = verdicts.length;
          writeFileSync(
            join(outDir, `director-submission-${round}.json`),
            `${JSON.stringify(output, null, 1)}\n`,
          );
          say(
            verdict.blocking.length
              ? `submission ${round}: ${verdict.blocking.length} issue(s) to repair: ${[...new Set(verdict.blocking.map((issue) => issue.code))].join(', ')}`
              : `submission ${round}: passed${verdict.other.length ? ` (${verdict.other.length} left to other agents or warnings)` : ''}`,
          );
          return verdict;
        },
      });
    const recordSession = (label: string, outcome: LoopResult) => {
      sessions.push({
        attempt: label,
        session_id: outcome.sessionId,
        consumed_micro_usd: outcome.consumedMicroUsd,
        ...outcome.input,
        budget_paused: !outcome.ok && outcome.budgetPaused,
        outcome: outcome.ok ? 'passed' : outcome.reason,
      });
    };

    let result = await runSession(directorTask(taskInput), options.maxRepairs, 'first');
    recordSession('first', result);
    // A session paused on its budget has been cancelled. It is retried once, smaller: a fresh
    // session that starts from the last submission and the issues it left, with no drafting and no
    // skills to read again. With no submission to start from, a retry would be the same task, so
    // there is none.
    const lastSubmitted = verdicts.at(-1);
    if (!result.ok && result.budgetPaused) {
      if (lastSubmitted?.campaign) {
        say(`${result.reason}; retrying once from submission ${verdicts.length}`);
        const repairsLeft = Math.max(0, options.maxRepairs - result.rounds.length);
        result = await runSession(
          directorResumeTask({
            ...taskInput,
            submission: result.rounds.at(-1)?.output,
            issues: lastSubmitted.blocking,
          }),
          repairsLeft,
          'resume',
        );
        recordSession('resume', result);
      } else {
        say(
          `${result.reason}, before any submission; not retried, as a retry would be the same task`,
        );
      }
    }
    report.rounds = verdicts.map(({ blocking, other }, index) => ({
      round: index + 1,
      blocking,
      other,
    }));
    const last = verdicts.at(-1);
    if (result.ok && last?.campaign && last.handoff) {
      writeFileSync(join(outDir, 'campaign.json'), `${JSON.stringify(last.campaign, null, 2)}\n`);
      writeFileSync(
        join(outDir, 'handoff.json'),
        `${JSON.stringify({ ...last.handoff, leftToOthers: last.other }, null, 2)}\n`,
      );
      say(
        `saved ${join(outDir, 'campaign.json')} (${last.handoff.template}, ${last.campaign.scenes.length} scenes) and handoff.json`,
      );
      if (last.other.length) {
        say('left to other agents, or warnings:');
        printIssues(last.other);
      }
      exitCode = 0;
    } else {
      report.failed = result.ok ? 'no campaign' : result.reason;
      const remaining = result.ok ? [] : result.remaining;
      writeFileSync(
        join(outDir, 'director-failures.json'),
        `${JSON.stringify(remaining, null, 1)}\n`,
      );
      console.log('');
      console.log(`DIRECTOR FAILED: ${report.failed}. ${remaining.length} issue(s) remain:`);
      printIssues(remaining);
      console.log(
        `No campaign.json was written. Issues are in ${join(outDir, 'director-failures.json')}.`,
      );
    }
  } catch (cause) {
    report.error = cause instanceof Error ? cause.message : String(cause);
    say(`error: ${report.error}`);
  } finally {
    // Every session the run started is left neither spending nor waiting: one still running is
    // interrupted and one paused on its budget is cancelled.
    let spent = 0;
    const tokens: Record<string, number> = {};
    for (const id of sessionIds) {
      const closed = await closeSession(client, id);
      spent += closed.consumedMicroUsd ?? 0;
      tokens[id] = inputTokens(closed.tokenUsage);
      if (closed.cancelled) say(`session ${id} was paused on its budget and has been cancelled`);
      if (id === sessionId) report.token_usage = closed.tokenUsage;
    }
    if (sessionIds.length) {
      report.session_micro_usd = spent;
      report.input_tokens = tokens;
    }
    if (report.agent_id) {
      const computer = await client.agents.computer(String(report.agent_id)).catch(() => null);
      report.computer = computer ? { id: computer.id, status: computer.status } : null;
    }
    const balanceAfter = (await client.credits.show().catch(() => null))?.balance_micro_usd;
    if (balanceAfter !== undefined && balanceBefore !== null && balanceAfter !== null)
      report.balance_delta_micro_usd = balanceBefore - balanceAfter;
    report.finished_at = new Date().toISOString();
    writeFileSync(
      join(outDir, 'director-report.json'),
      scrub(`${JSON.stringify(report, null, 1)}\n`),
    );
    const rounds = verdicts.length;
    say(
      `rounds: ${rounds} submission(s), ${Math.max(0, rounds - 1)} repair(s). cost: session ${usd(Number(report.session_micro_usd ?? 0))}${report.balance_delta_micro_usd !== undefined ? `, balance change ${usd(Number(report.balance_delta_micro_usd))}` : ''}.`,
    );
  }
  return exitCode;
}
