import { CEO } from '../definitions/company/common.ts';
import { company } from '../definitions/company/index.ts';
import { listAll, type Naive } from '../naive/client.ts';
import { HASH_KEY } from '../sync.ts';
import { organization } from './control-plane.ts';
import { HELD_STOP_REASONS, heldSessions } from './status.ts';

/**
 * The kill switch. Removing the `Orchestrator control plane` credential or its vault does not
 * unbind br-ceo: `ceo_agent_id` stays set (verified on a probe), and `PATCH /v1/organizations`
 * takes only `name`, `timezone`, `logo_svg` and `brand` (docs: api/organizations). So halting is
 * done on br-ceo itself: a $0 budget lets no turn run, the sweep is paused, and every live session
 * is interrupted. Only deleting br-ceo clears `ceo_agent_id`, and that also deletes its sweep and
 * leaves its open cards unassigned (docs: api/agents), so it needs br-ceo's id on the command line.
 */

/** Stored in place of br-ceo's definition hash, so `company:sync` sees the halt and restores nothing unasked. */
export const HALTED = 'halted';

/** Stop reasons of a session that is still live: it resumes, or runs a call, once someone acts. */
export const LIVE_STOP_REASONS = [
  ...HELD_STOP_REASONS,
  'awaiting_answer',
  'awaiting_input',
  'awaiting_delegation',
] as const;

export interface HaltReport {
  dry_run: boolean;
  ceo: { id: string; version: number };
  /** `zeroed` when this run set the $0 cap, `already` when br-ceo was halted before. */
  budget: 'zeroed' | 'already' | 'would zero';
  sweeps: { id: string; action: 'paused' | 'already paused' | 'would pause' }[];
  sessions: { id: string; state: string; action: 'interrupted' | 'would interrupt' }[];
  deleted: boolean;
  ceo_agent_id: string | null;
}

async function findCeo(client: Naive) {
  const matches = (await listAll((query) => client.agents.list(query))).filter(
    (agent) => agent.name === CEO,
  );
  if (matches.length !== 1) {
    throw new Error(`${matches.length} agents are named ${CEO}; halt needs exactly one.`);
  }
  return client.agents.get((matches[0] as { id: string }).id);
}

/** Whether a stored agent was halted by `company:halt`. */
export const isHalted = (agent: { metadata?: Record<string, unknown> | null } | null | undefined) =>
  agent?.metadata?.[HASH_KEY] === HALTED;

/** Every session of one agent that is running, queued, or idle waiting for someone. */
export async function liveSessions(client: Naive, agentId: string) {
  const found = new Map<string, string>();
  for (const status of ['running', 'queued']) {
    for (const session of await listAll((query) =>
      client.sessions.list({ ...query, agent_id: agentId, status }),
    )) {
      found.set(session.id, status);
    }
  }
  for (const stop_reason of LIVE_STOP_REASONS) {
    for (const session of await listAll((query) =>
      client.sessions.list({ ...query, agent_id: agentId, stop_reason }),
    )) {
      found.set(session.id, `idle/${stop_reason}`);
    }
  }
  return [...found.entries()].map(([id, state]) => ({ id, state }));
}

/**
 * `pnpm company:halt`: gives br-ceo a $0 budget, pauses its sweep, and interrupts every live br-ceo
 * session, in that order, so nothing started in between can spend. `unbind`, br-ceo's own id, then
 * deletes br-ceo, which is the only thing that clears `ceo_agent_id`. `dryRun` changes nothing and
 * reports what it would do. Run `pnpm company:sync --unhalt` to restore br-ceo.
 */
export async function haltCeo(
  client: Naive,
  log: (line: string) => void = () => undefined,
  { dryRun = false, unbind = null }: { dryRun?: boolean; unbind?: string | null } = {},
): Promise<HaltReport> {
  const ceo = await findCeo(client);
  if (unbind !== null && unbind !== ceo.id) {
    throw new Error(
      `--unbind names ${unbind}, but ${CEO} is ${ceo.id}. Nothing was changed. Pass br-ceo's own id to delete it.`,
    );
  }

  let budget: HaltReport['budget'] = 'already';
  if (!isHalted(ceo) || ceo.budget.cap_micro_usd !== 0) {
    budget = dryRun ? 'would zero' : 'zeroed';
    if (!dryRun) {
      await client.agents.update(ceo.id, {
        budget: { cap_micro_usd: 0, max_task_micro_usd: 0, period: ceo.budget.period },
        metadata: { ...ceo.metadata, [HASH_KEY]: HALTED },
        expected_version: ceo.current_version,
      });
    }
  }
  log(`budget    ${budget} ${CEO} ${ceo.id}: $0 a day, so no turn can run`);

  const sweeps: HaltReport['sweeps'] = [];
  const deployments = (await listAll((query) => client.deployments.list(query))).filter(
    (deployment) => deployment.agent_id === ceo.id,
  );
  for (const deployment of deployments) {
    const action = !deployment.enabled ? 'already paused' : dryRun ? 'would pause' : 'paused';
    if (action === 'paused') await client.deployments.pause(deployment.id);
    sweeps.push({ id: deployment.id, action });
    log(`sweep     ${action} ${deployment.id}`);
  }

  // Twice: a session the board or a chat started while the first pass ran is caught by the second.
  const sessions: HaltReport['sessions'] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const session of await liveSessions(client, ceo.id)) {
      if (sessions.some((item) => item.id === session.id)) continue;
      const action = dryRun ? 'would interrupt' : 'interrupted';
      if (!dryRun) await client.sessions.interrupt(session.id);
      sessions.push({ ...session, action });
      log(`session   ${action} ${session.id} (${session.state})`);
    }
    if (dryRun) break;
  }

  let deleted = false;
  if (unbind !== null && !dryRun) {
    await client.agents.delete(ceo.id);
    deleted = true;
    log(`deleted   ${CEO} ${ceo.id}, its sweep with it; its open cards are left unassigned`);
  }
  const org = await organization(client);
  log(`ceo       the organization's CEO is ${org.ceo_agent_id ?? 'none'}`);
  return {
    dry_run: dryRun,
    ceo: { id: ceo.id, version: ceo.current_version },
    budget,
    sweeps,
    sessions,
    deleted,
    ceo_agent_id: org.ceo_agent_id ?? null,
  };
}

/**
 * `pnpm company:halt --held`: interrupts every company agent's `budget_paused` and
 * `awaiting_approval` session and changes nothing else. Run it before raising a budget, which
 * would resume a paused session from its old context, or approving anything.
 */
export async function interruptHeld(
  client: Naive,
  log: (line: string) => void = () => undefined,
  { dryRun = false, only = null }: { dryRun?: boolean; only?: readonly string[] | null } = {},
) {
  const existing = await listAll((query) => client.agents.list(query));
  const names = only ?? company.map((definition) => definition.name);
  const agents = existing.filter((agent) => names.includes(agent.name));
  const held = await heldSessions(client, agents);
  for (const session of held) {
    if (!dryRun) await client.sessions.interrupt(session.id);
    log(
      `session   ${dryRun ? 'would interrupt' : 'interrupted'} ${session.agent} ${session.id} (${session.stop_reason})`,
    );
  }
  return held;
}
