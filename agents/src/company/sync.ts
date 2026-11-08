import { createHash } from 'node:crypto';
import type { AgentDefinition } from '../define.ts';
import { CEO_SWEEP, company, NETRC } from '../definitions/company/index.ts';
import { listAll, type Naive, readSecret } from '../naive/client.ts';
import { type SyncResult, syncAgents } from '../sync.ts';
import {
  bindCeo,
  type CatalogueReport,
  type CeoBinding,
  CONTROL_PLANE_OFF,
  compareCatalogue,
  liveCatalogue,
} from './control-plane.ts';
import { netrc, TOKENS, type TokenName } from './github.ts';
import { interruptHeld, isHalted } from './halt.ts';
import { type GithubReport, githubPreflight } from './preflight.ts';
import { type BoardExposure, exposureLine, liveBoardExposure } from './seats.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export interface DeploymentResult {
  id: string;
  action: 'created' | 'updated' | 'unchanged';
  enabled: boolean;
  schedule_status: string;
}

export interface NetrcResult {
  agent: string;
  token: TokenName;
  computer_id: string;
  computer_action: 'existing' | 'booted';
  boot_session_id: string | null;
  action: 'written' | 'unchanged';
  /** `owner:group mode` of the file, read back after the write. */
  stat: string;
}

export interface CompanyReport {
  catalogue: CatalogueReport;
  agents: SyncResult[];
  ceo: CeoBinding;
  board: { id: string; action: 'created' | 'existing'; cards: Record<string, number> };
  /** Agents the company board offers a board tool their definition does not give them. */
  exposure: BoardExposure[];
  deployment: DeploymentResult;
  netrc: NetrcResult[];
  github: GithubReport;
}

/** The CEO's sweep. Created paused, and never resumed or paused here once it exists. */
export async function syncSweep(client: Naive, ceoId: string): Promise<DeploymentResult> {
  const all = await listAll((query) => client.deployments.list(query));
  const mine = all.filter((deployment) => deployment.agent_id === ceoId);
  if (mine.length > 1) {
    throw new Error(
      `br-ceo has ${mine.length} deployments (${mine.map((item) => item.id).join(', ')}). Delete the extras, then sync again.`,
    );
  }
  const wanted = {
    cron: CEO_SWEEP.cron,
    timezone: CEO_SWEEP.timezone,
    input_template: CEO_SWEEP.input_template,
    budget_micro_usd: CEO_SWEEP.budget_micro_usd,
    window: 'immediate' as const,
  };
  const current = mine[0];
  if (!current) {
    // `enabled: false` creates it paused: the company does not start before the motion library lands.
    const created = await client.deployments.create({ agent_id: ceoId, ...wanted, enabled: false });
    return {
      id: created.id,
      action: 'created',
      enabled: created.enabled,
      schedule_status: created.schedule_status,
    };
  }
  const same = (Object.keys(wanted) as (keyof typeof wanted)[]).every(
    (key) => current[key] === wanted[key],
  );
  if (same) {
    return {
      id: current.id,
      action: 'unchanged',
      enabled: current.enabled,
      schedule_status: current.schedule_status,
    };
  }
  // `enabled` is left as it is: resuming the sweep is the founder's call, not a sync's.
  const updated = await client.deployments.update(current.id, wanted);
  return {
    id: updated.id,
    action: 'updated',
    enabled: updated.enabled,
    schedule_status: updated.schedule_status,
  };
}

async function waitIdle(client: Naive, sessionId: string, maxMs: number) {
  const started = Date.now();
  for (;;) {
    const session = await client.sessions.get(sessionId);
    if (!['running', 'queued'].includes(session.status)) return session;
    if (Date.now() - started > maxMs) {
      await client.sessions.interrupt(sessionId).catch(() => undefined);
      return session;
    }
    await sleep(3000);
  }
}

/**
 * An agent's computer exists only once a session of the agent has needed a filesystem. If it has
 * none yet, a short boot session runs one harmless shell command, which provisions it.
 */
export async function ensureComputer(
  client: Naive,
  agentId: string,
  definition: AgentDefinition,
): Promise<{ id: string; action: 'existing' | 'booted'; session: string | null }> {
  const existing = await client.agents.computer(agentId);
  if (existing && !['failed', 'destroyed'].includes(existing.status)) {
    return { id: existing.id, action: 'existing', session: null };
  }
  const boot = await client.sessions.create({
    agent_id: agentId,
    budget_micro_usd: definition.session.budget_micro_usd,
    metadata: { purpose: 'company:sync boot', agent: definition.name },
    message:
      'This session only starts your computer. It is not a card, so there is nothing to claim. Make exactly one tool call: bash with the command `echo computer-ready`. Then reply with its output and end your turn.',
  });
  await waitIdle(client, boot.id, 4 * 60_000);
  for (let attempt = 0; attempt < 20; attempt++) {
    const computer = await client.agents.computer(agentId);
    if (computer && computer.status !== 'creating') {
      return { id: computer.id, action: 'booted', session: boot.id };
    }
    await sleep(3000);
  }
  throw new Error(
    `${definition.name}'s computer did not appear after its boot session ${boot.id}.`,
  );
}

/**
 * Writes `~/.netrc` with one GitHub token on an agent's computer. The token goes in through Naive's
 * file write only. Every shell command here holds only the path, because Naive keeps shell command
 * text for 30 days. An unchanged file, compared by SHA-256, is left alone.
 */
export async function placeNetrc(
  client: Naive,
  agentId: string,
  definition: AgentDefinition,
  token: TokenName,
): Promise<NetrcResult> {
  const content = netrc(readSecret(TOKENS[token]));
  const computer = await ensureComputer(client, agentId, definition);
  const run = async (command: string) => {
    const result = await client.computers.exec(computer.id, command, 60_000);
    if (result.exit_code !== 0) {
      throw new Error(`${definition.name}: "${command}" exited ${result.exit_code}.`);
    }
    return String(result.stdout).trim();
  };
  const check = 'chmod 600 ~/.netrc && stat -c "%U:%G %a" ~/.netrc && sha256sum ~/.netrc';
  const before = await run('test -f ~/.netrc && sha256sum ~/.netrc || echo none');
  let action: NetrcResult['action'] = 'unchanged';
  if (!before.startsWith(sha256(content))) {
    // `inspect` names the home the file API maps to the shell user's home.
    const home = (await client.computers.inspect(computer.id)).home ?? '/home/naive';
    await client.computers.fs(computer.id, 'write', { path: `${home}/.netrc`, content });
    action = 'written';
  }
  const [stat = '', hash = ''] = (await run(check)).split('\n');
  if (!hash.startsWith(sha256(content))) {
    throw new Error(`${definition.name}: ~/.netrc does not match after the write.`);
  }
  return {
    agent: definition.name,
    token,
    computer_id: computer.id,
    computer_action: computer.action,
    boot_session_id: computer.session,
    action,
    stat,
  };
}

/**
 * `pnpm company:sync`: creates or versions every company agent, with br-ceo's roster and board,
 * binds br-ceo as the organization's CEO, ensures the board, creates the CEO's sweep paused, and
 * writes each GitHub token to the computers that need it. Running it again changes nothing that
 * already matches. It also checks GitHub against the spec and warns about each gap, but changes
 * nothing there.
 *
 * br-ceo is bound only after its new version names every control-plane tool off, and sync stops
 * before changing anything while the control plane serves a tool that br-ceo does not name. A
 * br-ceo that `company:halt` stopped is left alone unless `unhalt` is set.
 */
export async function syncCompany(
  client: Naive,
  log: (line: string) => void = () => undefined,
  {
    preflight = () => githubPreflight(),
    catalogue = () => liveCatalogue(),
    unhalt = false,
  }: {
    preflight?: () => Promise<GithubReport>;
    catalogue?: () => Promise<string[]>;
    /** Restores a br-ceo that `company:halt` stopped. Without it, sync refuses to touch one. */
    unhalt?: boolean;
  } = {},
): Promise<CompanyReport> {
  const live = (await listAll((query) => client.agents.list(query))).filter(
    (agent) => agent.name === 'br-ceo',
  );
  const halted = live.length === 1 && isHalted(live[0]);
  if (halted && !unhalt) {
    throw new Error(
      `br-ceo (${live[0]?.id}) was halted by company:halt, so nothing was changed. Run pnpm company:sync --unhalt to restore it.`,
    );
  }
  if (halted) {
    // Restoring the budget resumes every budget_paused session from its old context, so none is left.
    const held = await interruptHeld(client, (line) => log(line), { only: ['br-ceo'] });
    log(`unhalt    interrupted ${held.length} held br-ceo session(s) before restoring its budget`);
  }
  const served = compareCatalogue(await catalogue());
  if (served.unnamed.length) {
    throw new Error(
      `The control plane serves ${served.unnamed.length} tool(s) that br-ceo does not name, so it would be offered them at "ask": ${served.unnamed.join(', ')}. Add them to src/company/control-plane-tools.ts, then sync again. Nothing was changed.`,
    );
  }
  log(
    `control   ${served.count} control-plane tools served, every one named off on br-ceo${served.gone.length ? ` (${served.gone.length} named but no longer served)` : ''}`,
  );
  const github = await preflight();
  for (const gap of github.gaps) log(`github    WARNING ${gap}`);
  if (!github.gaps.length)
    log('github    each token reaches its own repo only; main and dev have their rules');

  const agents = await syncAgents(client, company);
  for (const result of agents) {
    log(`${result.action.padEnd(9)} ${result.name} ${result.id} v${result.version}`);
  }
  const ceo = agents.find((result) => result.name === 'br-ceo');
  if (!ceo) throw new Error('br-ceo was not synced.');

  // Bind only a br-ceo whose stored toolset names every control-plane tool off.
  const stored = (await client.agents.get(ceo.id)).tools?.configs ?? {};
  const open = CONTROL_PLANE_OFF.filter(
    (name) => stored[name]?.enabled !== false || stored[name]?.permission !== 'deny',
  );
  if (open.length) {
    throw new Error(
      `br-ceo v${ceo.version} does not name ${open.length} control-plane tool(s) off (${open.slice(0, 5).join(', ')}...), so it was not bound.`,
    );
  }
  const binding = await bindCeo(client, ceo.id);
  log(
    `ceo       ${binding.action} ${ceo.id} as the organization's CEO (vault ${binding.vault_id}, credential ${binding.credential_id})`,
  );

  const before = await client.board.get(ceo.id).catch(() => null);
  const board = await client.board.create(ceo.id);
  const boardResult = {
    id: board.id,
    action: before ? ('existing' as const) : ('created' as const),
    cards: board.cards,
  };
  log(`board     ${boardResult.action} ${board.id} ${JSON.stringify(board.cards)}`);
  // Read-only: an agent another branch defines is that branch's to fix, so this only warns.
  const exposure = await liveBoardExposure(client);
  for (const item of exposure) log(`board     WARNING ${exposureLine(item)}`);

  const deployment = await syncSweep(client, ceo.id);
  log(
    `sweep     ${deployment.action} ${deployment.id} enabled=${deployment.enabled} ${deployment.schedule_status}`,
  );

  const netrcResults: NetrcResult[] = [];
  for (const [name, token] of Object.entries(NETRC)) {
    const definition = company.find((item) => item.name === name);
    const agent = agents.find((item) => item.name === name);
    if (!definition || !agent) throw new Error(`${name} is not a company agent.`);
    const result = await placeNetrc(client, agent.id, definition, token);
    netrcResults.push(result);
    log(
      `netrc     ${result.action} ${name} ${token} on ${result.computer_id} (${result.computer_action}) ${result.stat}`,
    );
  }
  if (github.gaps.length) {
    log(
      `github    ${github.gaps.length} gap(s) above. Keep the sweep paused until they are fixed: until then only prompts keep agents off the other repo and off main and dev.`,
    );
  }
  if (exposure.length) {
    log(
      `board     ${exposure.length} agent(s) above can read or write company cards they should not. A card any of them creates and assigns starts its assignee at once, sweep or not.`,
    );
  }
  return {
    catalogue: served,
    agents,
    ceo: binding,
    board: boardResult,
    exposure,
    deployment,
    netrc: netrcResults,
    github,
  };
}
