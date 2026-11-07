import { company } from '../definitions/company/index.ts';
import { listAll, type Naive, usd } from '../naive/client.ts';

export interface StatusAgent {
  name: string;
  id: string | null;
  version: number | null;
  model: string | null;
  daily_cap: string | null;
  task_ceiling: string | null;
  computer: string | null;
  spent_30d: string;
}

/** What `pnpm company:status` prints: the agents, br-ceo's roster, the board, the sweep, and spend. */
export async function companyStatus(client: Naive) {
  const existing = await listAll((query) => client.agents.list(query));
  const spend = await client.credits.spend({ days: 30 });
  const spentBy = new Map(spend.by_agent.map((item) => [item.agent_id, item.spent_micro_usd]));
  const byId = new Map(existing.map((agent) => [agent.id, agent]));

  const agents: StatusAgent[] = [];
  let total = 0;
  for (const definition of company) {
    const agent = existing.find((item) => item.name === definition.name);
    const computer = agent ? await client.agents.computer(agent.id) : null;
    const spent = agent ? (spentBy.get(agent.id) ?? 0) : 0;
    total += spent;
    agents.push({
      name: definition.name,
      id: agent?.id ?? null,
      version: agent?.current_version ?? null,
      model: agent?.model ?? null,
      daily_cap: agent ? usd(agent.budget.cap_micro_usd) : null,
      task_ceiling: agent ? usd(agent.budget.max_task_micro_usd) : null,
      computer: computer ? `${computer.id} ${computer.status}` : null,
      spent_30d: usd(spent),
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
    spend: { company_30d: usd(total), org_balance: usd(balance.balance_micro_usd) },
  };
}
