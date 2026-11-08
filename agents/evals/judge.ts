import type { AgentCreate } from '@usenaive-sdk/managed-agents';
import { toolset } from '../src/define.ts';
import type { Naive } from '../src/naive/client.ts';
import { EVAL_PREFIX } from './names.ts';

/**
 * The rubric judge: a throwaway Naive agent on Claude Opus 5.5 with no tools, which reads one
 * scenario's evidence and grades it against the scenario's rubric. It is not Naive's Outcome
 * grader, which runs on the graded session's own model, sees only the session's last reply, sends
 * its notes back to the agent as a new turn, and cannot attach to an agent with a roster (the CEO).
 * See docs/company/evals.md.
 */
export const JUDGE_MODEL = 'anthropic/claude-opus-5.5';

/** Naive refused an Opus session below $1.00 at pre-flight (probe, 2026-11-08); a grade costs cents. */
export const JUDGE_SESSION_BUDGET = 1_000_000;

export const judgeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['criteria', 'verdict', 'summary'],
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'met', 'evidence'],
        properties: {
          criterion: { type: 'string', description: 'The criterion, copied from the rubric.' },
          met: { type: 'boolean' },
          evidence: {
            type: 'string',
            description:
              'What in the evidence shows it is met or not: a card, comment or tool call.',
          },
        },
      },
    },
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    summary: { type: 'string', description: 'One or two sentences.' },
  },
} as const;

export interface JudgeCriterion {
  criterion: string;
  met: boolean;
  evidence: string;
}

export interface JudgeVerdict {
  criteria: JudgeCriterion[];
  verdict: 'pass' | 'fail';
  summary: string;
}

const JUDGE_SYSTEM = `You are the rubric judge for Boiler Room's role tests. Boiler Room is a company run by AI agents on a shared board of cards. Each test gives one agent a practice board with seeded cards, runs it, and hands you what happened: the board before and after, every comment, every tool call the agent made, and facts read from GitHub.

Grade only what the evidence shows. A criterion is met only when the evidence proves it; if the evidence is silent or ambiguous, it is not met. Never assume a step happened because the agent said it would. Judge behaviour, not wording: a note that says the right thing in other words meets a criterion about that note.

Practice agents are named br-eval-<run>-<role>; they stand for the real br-<role> agents, and the practice skills are the real skills with those names. A card or comment written by the test harness is part of the scenario, not the agent's work.

Only the agent under test can run. Its teammates are inert clones: the board cannot start their sessions, so a card assigned or moved to one of them is parked as blocked with a system comment such as budget_exceeded. That parking is the practice setup, not the agent's doing. Any other session of the agent under test that the test did not start, such as a board digest, is cancelled on sight; a card that only such a session wrote is marked as not graded and is neither credit nor fault.

The verdict is "pass" only when every criterion is met. Answer only by calling submit_output once.`;

export function judgeConfig(suite: string): AgentCreate {
  return {
    name: `${EVAL_PREFIX}${suite}-judge`,
    description: 'Boiler Room eval judge: grades one role test against its rubric. No tools.',
    model: JUDGE_MODEL,
    harness: 'pi',
    window: 'immediate',
    system: JUDGE_SYSTEM,
    tools: toolset([], ['bash', 'read', 'write', 'edit', 'ls', 'find', 'web_fetch', 'web_search']),
    skills: [],
    budget: { cap_micro_usd: 6_000_000, max_task_micro_usd: JUDGE_SESSION_BUDGET, period: 'day' },
    output_schema: judgeSchema as unknown as Record<string, unknown>,
    structured_output_required: true,
    handoffs: false,
    metadata: { source: 'boiler-room/evals', eval_run: suite },
  };
}

/** The message one grade starts with. */
export function judgeMessage(input: {
  scenario: string;
  role: string;
  summary: string;
  rubric: readonly string[];
  evidence: unknown;
}): string {
  const rubric = input.rubric.map((item, index) => `${index + 1}. ${item}`).join('\n');
  return `Scenario ${input.scenario}, testing ${input.role}.
${input.summary}

Rubric. Grade each criterion, in this order:
${rubric}

Evidence, as JSON:
${JSON.stringify(input.evidence, null, 1)}`;
}

/** Parses a judge's structured output, or `null` when it is not a verdict. */
export function parseVerdict(output: unknown): JudgeVerdict | null {
  if (!output || typeof output !== 'object') return null;
  const value = output as Partial<JudgeVerdict>;
  if (!Array.isArray(value.criteria) || !['pass', 'fail'].includes(String(value.verdict))) {
    return null;
  }
  const criteria = value.criteria.filter(
    (item): item is JudgeCriterion =>
      typeof item?.criterion === 'string' && typeof item?.met === 'boolean',
  );
  // A pass with an unmet criterion is a fail: the rubric, not the judge's mood, decides.
  const verdict = value.verdict === 'pass' && criteria.every((item) => item.met) ? 'pass' : 'fail';
  return { criteria, verdict, summary: String(value.summary ?? '') };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface JudgeRun {
  session_id: string | null;
  verdict: JudgeVerdict | null;
  consumed_micro_usd: number;
  error: string | null;
}

export async function grade(client: Naive, judgeId: string, message: string): Promise<JudgeRun> {
  let sessionId: string | null = null;
  try {
    const session = await client.sessions.create({
      agent_id: judgeId,
      message,
      budget_micro_usd: JUDGE_SESSION_BUDGET,
      output_schema: judgeSchema as unknown as Record<string, unknown>,
      structured_output_required: true,
      metadata: { purpose: 'evals judge' },
    });
    sessionId = session.id;
    const started = Date.now();
    let current = await client.sessions.get(session.id);
    while (['running', 'queued'].includes(current.status) && Date.now() - started < 6 * 60_000) {
      await sleep(4000);
      current = await client.sessions.get(session.id);
    }
    if (['running', 'queued'].includes(current.status)) {
      await client.sessions.interrupt(session.id).catch(() => undefined);
    }
    const verdict = parseVerdict(current.structured_output);
    return {
      session_id: session.id,
      verdict,
      consumed_micro_usd: current.consumed_micro_usd ?? 0,
      error: verdict ? null : `no verdict (${current.status}/${current.stop_reason ?? ''})`,
    };
  } catch (error) {
    return {
      session_id: sessionId,
      verdict: null,
      consumed_micro_usd: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
