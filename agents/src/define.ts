import type { AgentCreate } from '@usenaive-sdk/managed-agents';

export type Toolset = NonNullable<AgentCreate['tools']>;
export type ToolConfig = Toolset['configs'][string];

export const allow: ToolConfig = { enabled: true, permission: 'allow' };
export const off: ToolConfig = { enabled: false, permission: 'deny' };

/**
 * Tools named and switched off on every agent here, on top of the deny default. A deny-by-default
 * toolset still offers the undocumented `vetta.tools_search` and `vetta.tools_execute` until they
 * are named, and no agent may pause to ask a person anything. The company board seats every agent
 * of the organization, so `board_read` and `board_write` are named off too: a crew agent works
 * from its task alone and never posts to, or takes instructions from, the board.
 */
export const ALWAYS_OFF = [
  'ask_operator',
  'board_read',
  'board_write',
  'request_tools',
  'propose_plan',
  'vetta.tools_search',
  'vetta.tools_execute',
  'generate_image',
  'generate_video',
] as const;

/** A toolset that denies everything except `allowed`, with `denied` and `ALWAYS_OFF` named. */
export function toolset(allowed: readonly string[], denied: readonly string[] = []): Toolset {
  const configs: Toolset['configs'] = {};
  for (const name of [...ALWAYS_OFF, ...denied]) configs[name] = off;
  for (const name of allowed) configs[name] = allow;
  return { default_config: { permission: 'deny' }, configs };
}

/**
 * A skill kept in this repo and pushed by `agents:sync`: `agents/skills/<slug>/SKILL.md`, or
 * `skills/<slug>/SKILL.md` at the repo root when `root` is `repo`, for a production-crew skill that
 * the docs share.
 */
export interface SkillDefinition {
  slug: string;
  description: string;
  /** Where the skill file lives. Defaults to `agents`. */
  root?: 'agents' | 'repo';
}

/**
 * One agent of the company, as code. `agents:sync` creates it on Naive, or mints a new version
 * when this definition changes, so every agent is reproducible from the repo. `session` holds the
 * defaults a run of the agent uses and is not sent to Naive.
 */
export interface AgentDefinition {
  name: string;
  description: string;
  model: string;
  harness: 'pi';
  window: 'immediate';
  system: string;
  tools: Toolset;
  skills: readonly SkillDefinition[];
  budget: AgentCreate['budget'];
  output_schema: Record<string, unknown> | null;
  structured_output_required: boolean;
  handoffs: false;
  session: {
    /** Spend cap for one session, in micro-USD. */
    budget_micro_usd: number;
    /** Wall-clock limit for one run, after which it is interrupted. */
    max_minutes: number;
  };
}
