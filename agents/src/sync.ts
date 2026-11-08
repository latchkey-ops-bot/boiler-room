import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AgentCreate } from '@usenaive-sdk/managed-agents';
import type { AgentDefinition, SkillDefinition } from './define.ts';
import { listAll, type Naive } from './naive/client.ts';

const SKILLS_DIR = new URL('../skills/', import.meta.url);
const REPO_SKILLS_DIR = new URL('../../skills/', import.meta.url);

export function skillContent(skill: SkillDefinition): string {
  const dir = skill.root === 'repo' ? REPO_SKILLS_DIR : SKILLS_DIR;
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

/** The agent config Naive stores for a definition, with its skills pinned to exact versions. */
export function agentConfig(
  definition: AgentDefinition,
  skillVersions: ReadonlyMap<string, number>,
): AgentCreate {
  const skills = definition.skills.map((skill) => {
    const version = skillVersions.get(skill.slug);
    if (version === undefined) throw new Error(`Skill ${skill.slug} has not been pushed.`);
    return `${skill.slug}@${version}`;
  });
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
  };
  const hash = createHash('sha256').update(canonicalJson(config)).digest('hex');
  return { ...config, metadata: { [HASH_KEY]: hash, source: 'boiler-room/agents' } };
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
 * definition hash differs gets a new version; one that matches is left alone. Two agents with one
 * name is an error to resolve by hand, never a guess.
 */
export async function syncAgents(
  client: Naive,
  definitions: readonly AgentDefinition[],
): Promise<SyncResult[]> {
  const skillVersions = await syncSkills(client, definitions);
  const existing = await listAll((query) => client.agents.list(query));
  const results: SyncResult[] = [];
  for (const definition of definitions) {
    const config = agentConfig(definition, skillVersions);
    const matches = existing.filter((agent) => agent.name === definition.name);
    if (matches.length > 1) {
      throw new Error(
        `${matches.length} agents are named "${definition.name}" (${matches.map((agent) => agent.id).join(', ')}). Delete the extras, then sync again.`,
      );
    }
    const current = matches[0];
    if (!current) {
      const created = await client.agents.create(config);
      results.push({
        name: definition.name,
        id: created.id,
        version: created.current_version,
        action: 'created',
      });
      continue;
    }
    if (current.metadata?.[HASH_KEY] === config.metadata?.[HASH_KEY]) {
      results.push({
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
      expected_version: current.current_version,
    });
    results.push({
      name: definition.name,
      id: updated.id,
      version: updated.current_version,
      action: 'updated',
    });
  }
  return results;
}
