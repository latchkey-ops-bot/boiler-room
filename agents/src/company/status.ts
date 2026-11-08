import { company } from '../definitions/company/index.ts';
import { listAll, type Naive, usd } from '../naive/client.ts';
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

/** The sum of the ledger's debits for one agent. */
async function ledgerTotal(client: Naive, agentId: string): Promise<number> {
  const entries = await listAll((query) => client.credits.ledger({ ...query, agent_id: agentId }));
  return entries
    .filter((entry) => entry.type === 'debit')
    .reduce((sum, entry) => sum + Math.abs(entry.amount_micro_usd), 0);
}

/**
 * What `pnpm company:status` prints: the agents, br-ceo's roster, the board, the sweep, spend, and
 * how GitHub differs from the spec.
 */
export async function companyStatus(
  client: Naive,
  preflight: () => Promise<GithubReport> = () => githubPreflight(),
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

  return {
    agents,
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
        }
      : null,
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
