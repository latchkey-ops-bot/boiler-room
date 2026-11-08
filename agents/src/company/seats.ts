import type { ToolConfig } from '../define.ts';
import { company } from '../definitions/company/index.ts';
import { listAll, type Naive } from '../naive/client.ts';
import { allowedTools } from './tools.ts';

/**
 * Who the company board gives a board tool. br-ceo is the organization's CEO, so its board is the
 * company board, which seats every agent of the organization, roster or not, with nothing to
 * configure (docs: team/board). A seated agent is offered `board_read` and `board_write` even under
 * a deny default, unless it names them off (verified: neither named, offered both). So binding the
 * CEO gives `board_write`, which creates and assigns cards that start builders, to every agent that
 * does not name it off, including agents other branches define and sync.
 *
 * The platform has no organization-wide policy (docs: concepts/policies) and no way to seat only a
 * roster on the company board, so naming both tools off on each agent is the only fix, and this is
 * the check that every agent does.
 */
export const BOARD_TOOLS = ['board_read', 'board_write'] as const;
export type BoardTool = (typeof BOARD_TOOLS)[number];

type Configs = Readonly<Record<string, Partial<ToolConfig> | undefined>>;

/** Whether a seated agent is offered a board tool: unless the tool is named off, it is. */
export function boardOffered(configs: Configs, tool: BoardTool): boolean {
  const config = configs[tool];
  return !config || (config.enabled !== false && config.permission !== 'deny');
}

/** The board tools an agent is meant to have: a company agent's from its definition, any other none. */
export function intendedBoardTools(name: string): BoardTool[] {
  const definition = company.find((agent) => agent.name === name);
  if (!definition) return [];
  const allowed = allowedTools(definition.tools);
  return BOARD_TOOLS.filter((tool) => allowed.includes(tool));
}

export interface BoardExposure {
  name: string;
  id: string;
  version: number;
  /** Board tools the agent is offered on the company board that its definition does not give it. */
  offered: BoardTool[];
}

/** Every agent offered a board tool it is not meant to have, by its stored toolset. */
export function boardExposure(
  agents: readonly {
    name: string;
    id: string;
    current_version: number;
    tools?: { configs?: Configs } | null;
  }[],
): BoardExposure[] {
  return agents
    .map((agent) => {
      const configs = agent.tools?.configs ?? {};
      const intended = intendedBoardTools(agent.name);
      const offered = BOARD_TOOLS.filter(
        (tool) => boardOffered(configs, tool) && !intended.includes(tool),
      );
      return { name: agent.name, id: agent.id, version: agent.current_version, offered };
    })
    .filter((item) => item.offered.length)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `boardExposure` over every agent in the organization, as Naive stores it now. Read-only. */
export async function liveBoardExposure(client: Naive): Promise<BoardExposure[]> {
  const listed = await listAll((query) => client.agents.list(query));
  const stored = [];
  for (const agent of listed) stored.push(await client.agents.get(agent.id));
  return boardExposure(stored);
}

/** One line per exposed agent, for sync, status and verify. */
export const exposureLine = (item: BoardExposure) =>
  `${item.name} ${item.id} v${item.version} is seated on the company board and offered ${item.offered.join(' and ')}. Its definition must name ${item.offered.length > 1 ? 'both' : 'it'} off (toolset() in src/define.ts names both), then sync it.`;
