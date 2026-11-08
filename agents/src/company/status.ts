import { company } from '../definitions/company/index.ts';
import { listAll, type Naive, usd } from '../naive/client.ts';
import { CONTROL_PLANE, compareCatalogue, liveCatalogue, organization } from './control-plane.ts';
import { type GithubReport, githubPreflight } from './preflight.ts';

export interface StatusAgent {
  name: string;
  id: string | null;
  version: number | null;
  model: string | null;
  daily_cap: string | null;
  task_ceiling: string | null;
  computer: string | null;
  /** Spent in the agent's current budget period, against `daily_cap`. */
  spent_today: string;
  /** Every debit the ledger books to the agent. Computer time books a few minutes late. */
  spent_total: string;
}

/**
 * Stop reasons that wait for a person. A raised budget resumes a `budget_paused` session from its
 * old context, and an approval runs the call an `awaiting_approval` session holds, so each one is
 * listed before anyone raises a budget or approves anything.
 */
export const HELD_STOP_REASONS = ['budget_paused', 'awaiting_approval'] as const;
export type HeldStopReason = (typeof HELD_STOP_REASONS)[number];

export interface HeldSession {
  agent: string;
  id: string;
  stop_reason: HeldStopReason;
  deployment_id: string | null;
  created_at: string;
}

/** Every session of these agents that is waiting for a person, oldest first. */
export async function heldSessions(
  client: Naive,
  agents: readonly { name: string; id: string }[],
): Promise<HeldSession[]> {
  const held: HeldSession[] = [];
  for (const agent of agents) {
    for (const stop_reason of HELD_STOP_REASONS) {
      const sessions = await listAll((query) =>
        client.sessions.list({ ...query, agent_id: agent.id, stop_reason }),
      );
      for (const session of sessions) {
        held.push({
          agent: agent.name,
          id: session.id,
          stop_reason,
          deployment_id: session.deployment_id ?? null,
          created_at: session.created_at,
        });
      }
    }
  }
  return held.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Titles that more than one card carries, each with its cards oldest first. Card ids derive from the
 * writing session, so two sessions that create one title make two cards.
 */
export function duplicateTitles(
  cards: readonly { id: string; title: string; status: string; created_at: string }[],
): { title: string; cards: string[] }[] {
  const byTitle = new Map<string, { id: string; status: string; created_at: string }[]>();
  for (const card of cards) byTitle.set(card.title, [...(byTitle.get(card.title) ?? []), card]);
  return [...byTitle.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([title, group]) => ({
      title,
      cards: [...group]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((card) => `${card.id} ${card.status}`),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The sum of the ledger's debits for one agent. */
async function ledgerTotal(client: Naive, agentId: string): Promise<number> {
  const entries = await listAll((query) => client.credits.ledger({ ...query, agent_id: agentId }));
  return entries
    .filter((entry) => entry.type === 'debit')
    .reduce((sum, entry) => sum + Math.abs(entry.amount_micro_usd), 0);
}

/**
 * What `pnpm company:status` prints: the agents, whether br-ceo is the organization's CEO, br-ceo's
 * roster, the board and any duplicate titles on it, the sweep, the sessions waiting for a person,
 * spend, and how GitHub differs from the spec.
 */
export async function companyStatus(
  client: Naive,
  preflight: () => Promise<GithubReport> = () => githubPreflight(),
  catalogue: () => Promise<string[]> = () => liveCatalogue(),
) {
  const existing = await listAll((query) => client.agents.list(query));
  const byId = new Map(existing.map((agent) => [agent.id, agent]));

  const agents: StatusAgent[] = [];
  let total = 0;
  for (const definition of company) {
    const agent = existing.find((item) => item.name === definition.name);
    const computer = agent ? await client.agents.computer(agent.id) : null;
    const today = agent ? (await client.agents.spend(agent.id)).spent_micro_usd : 0;
    const spent = agent ? await ledgerTotal(client, agent.id) : 0;
    total += spent;
    agents.push({
      name: definition.name,
      id: agent?.id ?? null,
      version: agent?.current_version ?? null,
      model: agent?.model ?? null,
      daily_cap: agent ? usd(agent.budget.cap_micro_usd) : null,
      task_ceiling: agent ? usd(agent.budget.max_task_micro_usd) : null,
      computer: computer ? `${computer.id} ${computer.status}` : null,
      spent_today: usd(today),
      spent_total: usd(spent),
    });
  }

  const ceo = existing.find((agent) => agent.name === 'br-ceo');
  const multiagent = ceo?.multiagent && typeof ceo.multiagent === 'object' ? ceo.multiagent : null;
  const roster = (multiagent?.agents ?? []).map((member) => {
    if (member.type !== 'agent') return { name: member.type, version: null };
    const version = 'version' in member ? (member.version ?? null) : null;
    return { name: byId.get(member.id)?.name ?? member.id, version };
  });

  const board = ceo ? await client.board.get(ceo.id).catch(() => null) : null;
  const cards = ceo
    ? (await client.board.cards.list(ceo.id, { limit: 100 }).catch(() => ({ data: [] }))).data
    : [];
  const deployments = ceo
    ? (await listAll((query) => client.deployments.list(query))).filter(
        (deployment) => deployment.agent_id === ceo.id,
      )
    : [];
  const balance = await client.credits.show();
  const github = await preflight();
  const org = await organization(client);
  const vault = (await listAll((query) => client.vaults.list(query))).find(
    (item) => item.display_name === CONTROL_PLANE.vault,
  );
  const credentials = vault
    ? await listAll((query) => client.vaults.credentials.list(vault.id, query))
    : [];
  const served = compareCatalogue(await catalogue());
  const held = await heldSessions(
    client,
    agents.flatMap((agent) => (agent.id ? [{ name: agent.name, id: agent.id }] : [])),
  );

  return {
    agents,
    ceo: {
      ceo_agent_id: org.ceo_agent_id,
      is_br_ceo: !!ceo && org.ceo_agent_id === ceo.id,
      dashboard_role: (ceo?.metadata?.role as string | undefined) ?? null,
      vault: vault?.id ?? null,
      credentials: credentials.map((item) => `${item.id} ${item.key} -> ${item.agent_id}`),
      control_plane: served,
    },
    roster: { board: multiagent?.board ?? false, members: roster },
    board: board
      ? {
          id: board.id,
          counts: board.cards,
          cards: cards.map((card) => ({
            id: card.id,
            title: card.title,
            status: card.status,
            assignee: card.assignee,
            reported_status: card.reported_status,
            woken_session_id: card.woken_session_id,
          })),
          duplicates: duplicateTitles(cards),
        }
      : null,
    held,
    deployments: deployments.map((deployment) => ({
      id: deployment.id,
      cron: `${deployment.cron} ${deployment.timezone}`,
      enabled: deployment.enabled,
      schedule_status: deployment.schedule_status,
      next_run_at: deployment.next_run_at,
      budget: usd(deployment.budget_micro_usd),
    })),
    spend: { company_total: usd(total), org_balance: usd(balance.balance_micro_usd) },
    github,
  };
}
