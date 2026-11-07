import type { AgentCreate } from '@usenaive-sdk/managed-agents';

export type Toolset = NonNullable<AgentCreate['tools']>;
export type ToolConfig = Toolset['configs'][string];

export const allow: ToolConfig = { enabled: true, permission: 'allow' };
export const off: ToolConfig = { enabled: false, permission: 'deny' };

/**
 * Tools named and switched off on every agent here, on top of the deny default. A deny-by-default
 * toolset still offers the undocumented `vetta.tools_search` and `vetta.tools_execute` until they
 * are named, and no agent may pause to ask a person anything.
 */
export const ALWAYS_OFF = [
  'ask_operator',
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

/** An external MCP server an agent connects to. Its credential lives in the Naive vault, never here. */
export interface McpServer {
  name: string;
  url: string;
}

/** A skill kept in this repo as `agents/skills/<slug>/SKILL.md` and pushed by `agents:sync`. */
export interface SkillDefinition {
  slug: string;
  description: string;
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
  /**
   * Makes this agent a coordinator whose roster is these agents, by name. Sync creates the members
   * first and pins each one at its current version, so a member's new version re-versions the
   * coordinator too. A team is one level deep, so no member may have a roster of its own.
   */
  roster?: readonly string[];
  /** Gives the coordinator a board that every rostered agent is seated on. */
  board?: boolean;
  mcp_servers?: readonly McpServer[];
  session: {
    /** Spend cap for one session, in micro-USD. */
    budget_micro_usd: number;
    /** Wall-clock limit for one run, after which it is interrupted. */
    max_minutes: number;
  };
}
