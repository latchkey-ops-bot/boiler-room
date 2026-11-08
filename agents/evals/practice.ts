import type { AgentCreate } from '@usenaive-sdk/managed-agents';
import type { AgentDefinition } from '../src/define.ts';
import {
  CEO,
  DESIGN,
  ENGINEER,
  ENGINEERING_LEAD,
  PRODUCT,
} from '../src/definitions/company/common.ts';
import { company } from '../src/definitions/company/index.ts';
import { listAll, type Naive } from '../src/naive/client.ts';
import { type AgentRef, agentConfig, skillContent } from '../src/sync.ts';
import { EVAL_PREFIX, type PracticeNames, substitute } from './names.ts';

/**
 * A practice team: the CEO and the four builders, cloned from the definitions in this repo (the ones
 * `company:sync` pushes), under `br-eval-<run>-*` names, on a board of their own. The clone of
 * br-ceo is the coordinator that owns the practice board; it is never bound as the organization's
 * CEO, so the company board is never touched.
 */
export const TEAM = [CEO, ENGINEERING_LEAD, ENGINEER, PRODUCT, DESIGN] as const;
export type TeamMember = (typeof TEAM)[number];

/** Members first, so the coordinator's roster can pin them at the version they were created at. */
export const CREATE_ORDER: readonly TeamMember[] = [
  ENGINEERING_LEAD,
  ENGINEER,
  PRODUCT,
  DESIGN,
  CEO,
];

/**
 * The budget of a clone that must not run. Naive refuses a session whose task budget is below its
 * pre-flight quote (verified on 2026-11-08: 402 "the remaining budget for this task is below the
 * pre-flight quote"), so a card assigned to an inert clone starts nothing, and a digest for an inert
 * coordinator is skipped and its cards marked reported (docs: team/board).
 */
export const INERT_BUDGET = { cap_micro_usd: 1, max_task_micro_usd: 1, period: 'day' } as const;

export function definitionOf(name: string): AgentDefinition {
  const definition = company.find((item) => item.name === name);
  if (!definition) throw new Error(`${name} is not a company agent.`);
  return definition;
}

/**
 * The practice clone of one company agent: every text rewritten for the practice team, its skills
 * renamed, its roster renamed, and the dashboard's `role: orchestrator` left off, because the
 * dashboard picks its CEO by that field. An inert clone has `INERT_BUDGET`.
 */
export function practiceDefinition(
  definition: AgentDefinition,
  names: PracticeNames,
  live: boolean,
): AgentDefinition {
  const name = names.agents.get(definition.name);
  if (!name) throw new Error(`${definition.name} has no practice name.`);
  const { role: _role, ...metadata } = definition.metadata ?? {};
  return {
    ...definition,
    name,
    description: substitute(definition.description, names),
    system: substitute(definition.system, names),
    skills: definition.skills.map((skill) => ({
      ...skill,
      slug: names.skills.get(skill.slug) ?? `${EVAL_PREFIX}${names.run}-${skill.slug}`,
      description: substitute(skill.description, names),
    })),
    ...(definition.roster
      ? { roster: definition.roster.map((member) => names.agents.get(member) ?? member) }
      : {}),
    metadata,
    budget: live ? definition.budget : INERT_BUDGET,
  };
}

export interface PracticeSkill {
  slug: string;
  description: string;
  content: string;
}

/** The practice copy of every skill the team's agents use, rewritten for the practice team. */
export function practiceSkills(names: PracticeNames): PracticeSkill[] {
  const seen = new Map<string, PracticeSkill>();
  for (const member of TEAM) {
    for (const skill of definitionOf(member).skills) {
      const slug = names.skills.get(skill.slug);
      if (!slug) throw new Error(`Skill ${skill.slug} has no practice slug.`);
      if (seen.has(slug)) continue;
      seen.set(slug, {
        slug,
        description: substitute(skill.description, names),
        content: substitute(skillContent(skill), names),
      });
    }
  }
  return [...seen.values()];
}

/** The config Naive stores for a practice clone, marked so it can never pass for a company agent. */
export function practiceConfig(
  definition: AgentDefinition,
  skillVersions: ReadonlyMap<string, number>,
  members: ReadonlyMap<string, AgentRef>,
  run: string,
): AgentCreate {
  const config = agentConfig(definition, skillVersions, members);
  return {
    ...config,
    metadata: { ...config.metadata, source: 'boiler-room/evals', eval_run: run },
  };
}

export interface PracticeAgent {
  real: TeamMember;
  name: string;
  id: string;
  version: number;
  live: boolean;
}

export interface PracticeTeam {
  names: PracticeNames;
  agents: Map<TeamMember, PracticeAgent>;
  board_id: string;
  skills: string[];
}

/**
 * Creates a practice team on Naive: pushes its skills, creates the four builders, then the CEO
 * clone with them on its roster, then its board. `live` names the members that may run; every
 * other clone is inert.
 */
export async function createTeam(
  client: Naive,
  names: PracticeNames,
  live: readonly TeamMember[],
): Promise<PracticeTeam> {
  const skillVersions = new Map<string, number>();
  for (const skill of practiceSkills(names)) {
    const pushed = await client.skills.push(skill);
    skillVersions.set(skill.slug, pushed.version);
  }
  const members = new Map<string, AgentRef>();
  const agents = new Map<TeamMember, PracticeAgent>();
  for (const real of CREATE_ORDER) {
    const isLive = live.includes(real);
    const definition = practiceDefinition(definitionOf(real), names, isLive);
    const created = await client.agents.create(
      practiceConfig(definition, skillVersions, members, names.run),
    );
    members.set(definition.name, { id: created.id, version: created.current_version });
    agents.set(real, {
      real,
      name: definition.name,
      id: created.id,
      version: created.current_version,
      live: isLive,
    });
  }
  const ceo = agents.get(CEO);
  if (!ceo) throw new Error('The practice CEO was not created.');
  const board = await client.board.create(ceo.id);
  return { names, agents, board_id: board.id, skills: [...skillVersions.keys()] };
}

/** Sets a practice clone's budget: its definition's (`live`) or `INERT_BUDGET`. */
export async function setLive(client: Naive, agent: PracticeAgent, live: boolean): Promise<void> {
  const current = await client.agents.get(agent.id);
  const budget = live ? definitionOf(agent.real).budget : INERT_BUDGET;
  const updated = await client.agents.update(agent.id, {
    budget,
    expected_version: current.current_version,
  });
  agent.version = updated.current_version;
  agent.live = live;
}

export interface TeardownReport {
  agents: string[];
  computers: string[];
  deployments: string[];
  skills: string[];
  boards: { id: string; after: string }[];
  errors: string[];
}

/**
 * Deletes every practice agent, its sweep and its computer, and every practice skill. With a run,
 * only that run's; without one, every `br-eval-` leftover, such as a crashed run's. Boards have no
 * delete route (docs: team/board), so each practice board is read again after its owner is gone
 * and what Naive answered is recorded.
 */
export async function teardown(
  client: Naive,
  run?: string,
  boards: readonly string[] = [],
  keep: readonly string[] = [],
  /** Only agents created at least this long ago: a leftover sweep never touches a running suite. */
  olderThanMinutes = 0,
): Promise<TeardownReport> {
  const prefix = run ? `${EVAL_PREFIX}${run}-` : EVAL_PREFIX;
  const kept = (name: string) => keep.some((item) => name.startsWith(`${EVAL_PREFIX}${item}-`));
  const report: TeardownReport = {
    agents: [],
    computers: [],
    deployments: [],
    skills: [],
    boards: [],
    errors: [],
  };
  const note = (what: string, error: unknown) =>
    report.errors.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
  const agents = (await listAll((query) => client.agents.list(query))).filter(
    (agent) =>
      agent.name.startsWith(prefix) &&
      !kept(agent.name) &&
      Date.now() - Date.parse(agent.created_at) >= olderThanMinutes * 60_000,
  );
  const ids = new Set(agents.map((agent) => agent.id));
  const runs = new Set(agents.map((agent) => agent.name.slice(EVAL_PREFIX.length).split('-')[0]));
  const deployments = (await listAll((query) => client.deployments.list(query))).filter(
    (deployment) => ids.has(deployment.agent_id),
  );
  for (const deployment of deployments) {
    await client.deployments
      .delete(deployment.id)
      .then(() => report.deployments.push(deployment.id))
      .catch((error) => note(`deployment ${deployment.id}`, error));
  }
  for (const agent of agents) {
    // A live session would keep spending after its agent is gone.
    const sessions = await client.sessions
      .list({ agent_id: agent.id, limit: 50 })
      .catch(() => ({ data: [] as { id: string; status: string }[] }));
    for (const session of sessions.data) {
      if (['running', 'queued', 'idle'].includes(session.status)) {
        await client.sessions.cancel(session.id).catch(() => undefined);
      }
    }
    const computer = await client.agents.computer(agent.id).catch(() => null);
    if (computer && computer.status !== 'destroyed') {
      await client.computers
        .delete(computer.id)
        .then(() => report.computers.push(computer.id))
        .catch((error) => note(`computer ${computer.id}`, error));
    }
  }
  // The coordinator last: deleting a member it pins would change nothing, but it reads cleaner.
  const ordered = [
    ...agents.filter((agent) => !agent.name.endsWith('-ceo')),
    ...agents.filter((agent) => agent.name.endsWith('-ceo')),
  ];
  for (const agent of ordered) {
    await client.agents
      .delete(agent.id)
      .then(() => report.agents.push(agent.name))
      .catch((error) => note(`agent ${agent.name}`, error));
  }
  const computers = await listAll((query) => client.computers.list(query)).catch(() => []);
  for (const computer of computers) {
    const orphan =
      (computer.agent_id && ids.has(computer.agent_id)) ||
      (computer.name.startsWith(prefix) && !kept(computer.name));
    if (orphan && computer.status !== 'destroyed' && !report.computers.includes(computer.id)) {
      await client.computers
        .delete(computer.id)
        .then(() => report.computers.push(computer.id))
        .catch((error) => note(`computer ${computer.id}`, error));
    }
  }
  const skills = await listAll((query) => client.skills.list(query)).catch(() => []);
  for (const skill of skills as { slug?: string; name?: string }[]) {
    // The list names a skill by `name`; delete takes it as the slug.
    const slug = skill.slug ?? skill.name ?? '';
    if (!slug.startsWith(prefix) || kept(slug)) continue;
    if (olderThanMinutes && !runs.has(slug.slice(EVAL_PREFIX.length).split('-')[0] ?? '')) continue;
    await client.skills
      .delete(slug)
      .then(() => report.skills.push(slug))
      .catch((error) => note(`skill ${slug}`, error));
  }
  for (const id of boards) {
    const after = await client.board
      .get(id)
      .then(
        (board) => `still readable, owner ${board.agent_id}, cards ${JSON.stringify(board.cards)}`,
      )
      .catch((error: { status?: number; message?: string }) =>
        `gone (${error.status ?? ''} ${error.message ?? ''})`.trim(),
      );
    report.boards.push({ id, after });
  }
  return report;
}
