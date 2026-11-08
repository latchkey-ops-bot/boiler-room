import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AgentCreate } from '@usenaive-sdk/managed-agents';
import type { AgentDefinition, SkillDefinition } from './define.ts';
import { listAll, type Naive } from './naive/client.ts';

const SKILLS_DIRS = {
  agents: new URL('../skills/', import.meta.url),
  repo: new URL('../../skills/', import.meta.url),
} as const;

export function skillContent(skill: SkillDefinition): string {
  const dir = SKILLS_DIRS[skill.root ?? 'agents'];
  return readFileSync(fileURLToPath(new URL(`${skill.slug}/SKILL.md`, dir)), 'utf8');
}

/** JSON with object keys sorted, so equal configs hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const HASH_KEY = 'definition_sha256';

/** An agent as Naive has it: its id and the version a roster pins. */
export interface AgentRef {
  id: string;
  version: number;
}

/** The `multiagent` config for a coordinator, with each member pinned at its current version. */
export function rosterConfig(
  definition: AgentDefinition,
  members: ReadonlyMap<string, AgentRef>,
): AgentCreate['multiagent'] {
  if (!definition.roster) return undefined;
  const agents = definition.roster.map((name) => {
    const member = members.get(name);
    if (!member)
      throw new Error(`${definition.name} names ${name} on its roster, but it is not synced.`);
    return { type: 'agent' as const, id: member.id, version: member.version };
  });
  return { type: 'coordinator', agents, board: definition.board ?? false };
}

/** The agent config Naive stores for a definition, with its skills pinned to exact versions. */
export function agentConfig(
  definition: AgentDefinition,
  skillVersions: ReadonlyMap<string, number>,
  members: ReadonlyMap<string, AgentRef> = new Map(),
): AgentCreate {
  const skills = definition.skills.map((skill) => {
    const version = skillVersions.get(skill.slug);
    if (version === undefined) throw new Error(`Skill ${skill.slug} has not been pushed.`);
    return `${skill.slug}@${version}`;
  });
  const multiagent = rosterConfig(definition, members);
  const config: AgentCreate = {
    name: definition.name,
    description: definition.description,
    model: definition.model,
    harness: definition.harness,
    window: definition.window,
    system: definition.system,
    tools: definition.tools,
    skills,
    budget: definition.budget,
    output_schema: definition.output_schema,
    structured_output_required: definition.structured_output_required,
    handoffs: definition.handoffs,
    ...(multiagent ? { multiagent } : {}),
    ...(definition.mcp_servers ? { mcp_servers: [...definition.mcp_servers] } : {}),
    ...(definition.metadata ? { metadata: { ...definition.metadata } } : {}),
  };
  // The definition's own metadata is hashed with the rest, so changing it versions the agent.
  const hash = createHash('sha256').update(canonicalJson(config)).digest('hex');
  return {
    ...config,
    metadata: { ...definition.metadata, [HASH_KEY]: hash, source: 'boiler-room/agents' },
  };
}

export interface SyncResult {
  name: string;
  id: string;
  version: number;
  action: 'created' | 'updated' | 'unchanged';
}

/** Pushes each skill. A push of unchanged content mints nothing and answers the current version. */
export async function syncSkills(
  client: Naive,
  definitions: readonly AgentDefinition[],
): Promise<Map<string, number>> {
  const versions = new Map<string, number>();
  for (const skill of definitions.flatMap((definition) => definition.skills)) {
    if (versions.has(skill.slug)) continue;
    const pushed = await client.skills.push({
      slug: skill.slug,
      content: skillContent(skill),
      description: skill.description,
    });
    versions.set(skill.slug, pushed.version);
  }
  return versions;
}

/**
 * Makes Naive match the definitions, by name. A missing agent is created; one whose stored
 * definition hash differs, or that still holds an MCP server its definition no longer names, gets a
 * new version (with `mcp_servers` always written, so a dropped server is cleared); one that matches
 * is left alone. Two agents with one
 * name is an error to resolve by hand, never a guess. Agents with a roster are synced after every
 * other agent, so their members exist and are pinned at the version this run left them on.
 */
export async function syncAgents(
  client: Naive,
  definitions: readonly AgentDefinition[],
): Promise<SyncResult[]> {
  const skillVersions = await syncSkills(client, definitions);
  const existing = await listAll((query) => client.agents.list(query));
  const ordered = [
    ...definitions.filter((definition) => !definition.roster),
    ...definitions.filter((definition) => definition.roster),
  ];
  const members = new Map<string, AgentRef>();
  for (const agent of existing)
    members.set(agent.name, { id: agent.id, version: agent.current_version });
  const results: SyncResult[] = [];
  const record = (result: SyncResult) => {
    results.push(result);
    members.set(result.name, { id: result.id, version: result.version });
  };
  for (const definition of ordered) {
    const matches = existing.filter((agent) => agent.name === definition.name);
    if (matches.length > 1) {
      throw new Error(
        `${matches.length} agents are named "${definition.name}" (${matches.map((agent) => agent.id).join(', ')}). Delete the extras, then sync again.`,
      );
    }
    const config = agentConfig(definition, skillVersions, members);
    const current = matches[0];
    if (!current) {
      const created = await client.agents.create(config);
      record({
        name: definition.name,
        id: created.id,
        version: created.current_version,
        action: 'created',
      });
      continue;
    }
    // An update replaces only the fields it names, and the hash covers only what the definition
    // names, so a server the definition dropped would stay stored for ever. It counts as a change.
    const leftoverServers =
      !definition.mcp_servers?.length && (current.mcp_servers?.length ?? 0) > 0;
    if (current.metadata?.[HASH_KEY] === config.metadata?.[HASH_KEY] && !leftoverServers) {
      record({
        name: definition.name,
        id: current.id,
        version: current.current_version,
        action: 'unchanged',
      });
      continue;
    }
    const { name: _name, harness: _harness, ...patch } = config;
    const updated = await client.agents.update(current.id, {
      ...patch,
      mcp_servers: config.mcp_servers ?? [],
      expected_version: current.current_version,
    });
    record({
      name: definition.name,
      id: updated.id,
      version: updated.current_version,
      action: 'updated',
    });
  }
  // Results in the order the definitions were given, whatever order they were synced in.
  return definitions.map((definition) => {
    const result = results.find((item) => item.name === definition.name);
    if (!result) throw new Error(`${definition.name} was not synced.`);
    return result;
  });
}

/**
 * How a run gets its agents: `sync` makes Naive match the definitions first (`syncAgents`), and
 * `verify` changes nothing on Naive, creates no agent and pushes no skill, and refuses to run
 * agents whose deployed definition is not this checkout's. The film computer runs with `verify`,
 * so its key needs no `agents:write`.
 */
export type AgentSync = 'sync' | 'verify';

/** One way a deployed agent differs from the definition this checkout holds. */
export interface Drift {
  name: string;
  problem: string;
}

/** The deployed agents differ from the definitions: run `pnpm agents:sync`, then try again. */
export class AgentDrift extends Error {
  readonly drift: readonly Drift[];
  constructor(drift: readonly Drift[]) {
    super(
      `The deployed agents do not match this checkout's definitions, so nothing was run: ${drift.map((each) => `${each.name}: ${each.problem}`).join('; ')}. Run pnpm agents:sync from this checkout first.`,
    );
    this.name = 'AgentDrift';
    this.drift = drift;
  }
}

const sha256Text = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Compares each deployed agent with its definition, reading only: its definition hash against the
 * hash of the config this checkout would write with the skill versions the agent pins, and each
 * pinned skill version's content against the skill file here. Returns the agents as they are, and
 * every difference found.
 */
export async function checkAgents(
  client: Naive,
  definitions: readonly AgentDefinition[],
): Promise<{ results: SyncResult[]; drift: Drift[] }> {
  const existing = await listAll((query) => client.agents.list(query));
  const members = new Map<string, AgentRef>();
  for (const agent of existing)
    members.set(agent.name, { id: agent.id, version: agent.current_version });
  const results: SyncResult[] = [];
  const drift: Drift[] = [];
  const skillShas = new Map<string, Map<number, string>>();
  const versionsOf = async (slug: string) => {
    let known = skillShas.get(slug);
    if (!known) {
      const rows = await listAll((query) => client.skills.listVersions(slug, query));
      known = new Map(rows.map((row) => [row.version, row.sha256]));
      skillShas.set(slug, known);
    }
    return known;
  };
  for (const definition of definitions) {
    const matches = existing.filter((agent) => agent.name === definition.name);
    const current = matches[0];
    if (!current || matches.length > 1) {
      drift.push({
        name: definition.name,
        problem: current
          ? `${matches.length} agents have this name`
          : 'no agent of this name is deployed',
      });
      continue;
    }
    const pinned = new Map<string, number>();
    for (const ref of current.skills ?? []) {
      const at = ref.lastIndexOf('@');
      if (at > 0) pinned.set(ref.slice(0, at), Number(ref.slice(at + 1)));
    }
    let skillsMatch = true;
    for (const skill of definition.skills) {
      const version = pinned.get(skill.slug);
      if (version === undefined) {
        drift.push({ name: definition.name, problem: `it does not pin the skill ${skill.slug}` });
        skillsMatch = false;
        continue;
      }
      const deployed = (await versionsOf(skill.slug)).get(version);
      if (deployed !== sha256Text(skillContent(skill))) {
        drift.push({
          name: definition.name,
          problem: `its skill ${skill.slug}@${version} is not the one in this checkout`,
        });
        skillsMatch = false;
      }
    }
    if (skillsMatch) {
      const wanted = agentConfig(definition, pinned, members).metadata?.[HASH_KEY];
      if (current.metadata?.[HASH_KEY] !== wanted)
        drift.push({
          name: definition.name,
          problem: `its definition hash is ${String(current.metadata?.[HASH_KEY] ?? 'missing').slice(0, 12)}, and this checkout's is ${String(wanted).slice(0, 12)}`,
        });
      else if (!definition.mcp_servers?.length && (current.mcp_servers?.length ?? 0) > 0)
        drift.push({ name: definition.name, problem: 'it still holds an MCP server' });
    }
    results.push({
      name: definition.name,
      id: current.id,
      version: current.current_version,
      action: 'unchanged',
    });
  }
  return { results, drift };
}

/** The agents to run: synced first with `sync`, or checked and never changed with `verify`. */
export async function ensureAgents(
  client: Naive,
  definitions: readonly AgentDefinition[],
  mode: AgentSync = 'sync',
): Promise<SyncResult[]> {
  if (mode === 'sync') return syncAgents(client, definitions);
  const { results, drift } = await checkAgents(client, definitions);
  if (drift.length > 0) throw new AgentDrift(drift);
  return results;
}
