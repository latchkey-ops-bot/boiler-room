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
import { type ResearchOutput, researchOutputSchema } from '../researcher/output.ts';
import { syncAgents } from '../sync.ts';
import { checkSubmission, type DirectorIssue, researchFacts, type Verdict } from './checks.ts';
import { type LoopClient, runDirectorSession, type StreamEvent } from './loop.ts';
import type { DirectorBrief } from './output.ts';
import { directorTask } from './prompt.ts';

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

  try {
    const [synced] = await syncAgents(client, [definition]);
    if (!synced) throw new Error('Agent sync returned nothing.');
    say(`agent ${synced.name} ${synced.id} v${synced.version} (${synced.action}), model ${model}`);
    Object.assign(report, { agent_id: synced.id, agent_version: synced.version });

    const result = await runDirectorSession({
      client: client as LoopClient,
      agentId: synced.id,
      task: directorTask({
        research,
        brief: options.brief,
        facts,
        filesOnHand: filesOnHand(researchDir),
        budgetUsd: budgetMicro / 1e6,
      }),
      outputSchema: definition.output_schema ?? {},
      budgetMicroUsd: budgetMicro,
      maxRepairs: options.maxRepairs,
      maxMinutes: definition.session.max_minutes,
      metadata: { run: 'direct', host: facts.host },
      onSession: (id) => {
        sessionId = id;
        report.session_id = id;
        say(`session ${id} started, budget ${usd(budgetMicro)}`);
      },
      onEvent: (event) => {
        if (event.type !== 'message.delta' && !event.type.startsWith('span.'))
          appendFileSync(eventsPath, `${scrub(JSON.stringify(event))}\n`);
        const line = describe(event);
        if (line) say(line);
      },
      check: async (output) => {
        const verdict = await checkSubmission(output, research, options.brief);
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

    report.rounds = result.rounds.map(({ round, blocking, other }) => ({ round, blocking, other }));
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
    if (sessionId) {
      const session = await client.sessions.get(sessionId).catch(() => null);
      if (session && (session.status === 'running' || session.status === 'queued'))
        await client.sessions.interrupt(sessionId).catch(() => {});
      if (session) {
        report.session_micro_usd = session.consumed_micro_usd;
        report.token_usage = session.token_usage;
      }
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
