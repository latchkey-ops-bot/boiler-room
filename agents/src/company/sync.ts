import { createHash } from 'node:crypto';
import type { AgentDefinition } from '../define.ts';
import { CEO_SWEEP, company, DEPLOY_KEYS, NETRC } from '../definitions/company/index.ts';
import { listAll, type Naive, readSecret } from '../naive/client.ts';
import { type SyncResult, syncAgents } from '../sync.ts';
import { DEPLOY_ENV_FILE, deployEnvFile, deployEnvKeys } from './cloudflare.ts';
import {
  bindCeo,
  type CatalogueReport,
  type CeoBinding,
  CONTROL_PLANE_OFF,
  compareCatalogue,
  liveCatalogue,
} from './control-plane.ts';
import { netrc, TOKENS, type TokenName } from './github.ts';
import { GTM_HALTED, interruptHeld, isHalted } from './halt.ts';
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

/** One secret file placed on an agent's computer. */
export interface PlacedFile {
  agent: string;
  /** The file, relative to the home folder, such as `.netrc`. */
  file: string;
  computer_id: string;
  computer_action: 'existing' | 'booted';
  boot_session_id: string | null;
  action: 'written' | 'unchanged';
  /** `owner:group mode` of the file, read back after the write. */
  stat: string;
}

export interface NetrcResult extends PlacedFile {
  token: TokenName;
}

/** Whether a computer that must not hold the Cloudflare keys has the file anyway. */
export interface DeployKeysElsewhere {
  agent: string;
  computer_id: string | null;
  present: boolean;
}

export interface DeployKeysReport {
  placed: PlacedFile[];
  elsewhere: DeployKeysElsewhere[];
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
  deploy_keys: DeployKeysReport;
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
 * Writes one secret file into an agent's home folder, with mode 600. The content goes in through
 * Naive's file write only. Every shell command here holds only the path, because Naive keeps shell
 * command text for 30 days. An unchanged file, compared by SHA-256, is left alone.
 */
export async function placeFile(
  client: Naive,
  agentId: string,
  definition: AgentDefinition,
  file: string,
  content: string,
): Promise<PlacedFile> {
  if (!/^\.[A-Za-z0-9._-]+$/.test(file)) throw new Error(`Not a home dotfile: ${file}`);
  const computer = await ensureComputer(client, agentId, definition);
  const run = async (command: string) => {
    const result = await client.computers.exec(computer.id, command, 60_000);
    if (result.exit_code !== 0) {
      throw new Error(`${definition.name}: "${command}" exited ${result.exit_code}.`);
    }
    return String(result.stdout).trim();
  };
  const path = `~/${file}`;
  const check = `chmod 600 ${path} && stat -c "%U:%G %a" ${path} && sha256sum ${path}`;
  const before = await run(`test -f ${path} && sha256sum ${path} || echo none`);
  let action: PlacedFile['action'] = 'unchanged';
  if (!before.startsWith(sha256(content))) {
    // `inspect` names the home the file API maps to the shell user's home.
    const home = (await client.computers.inspect(computer.id)).home ?? '/home/naive';
    await client.computers.fs(computer.id, 'write', { path: `${home}/${file}`, content });
    action = 'written';
  }
  const [stat = '', hash = ''] = (await run(check)).split('\n');
  if (!hash.startsWith(sha256(content))) {
    throw new Error(`${definition.name}: ${path} does not match after the write.`);
  }
  return {
    agent: definition.name,
    file,
    computer_id: computer.id,
    computer_action: computer.action,
    boot_session_id: computer.session,
    action,
    stat,
  };
}

/** Writes `~/.netrc` with one GitHub token on an agent's computer. */
export async function placeNetrc(
  client: Naive,
  agentId: string,
  definition: AgentDefinition,
  token: TokenName,
): Promise<NetrcResult> {
  const content = netrc(readSecret(TOKENS[token]));
  return { ...(await placeFile(client, agentId, definition, '.netrc', content)), token };
}

/**
 * Writes `~/.boiler-room.env` with the Cloudflare keys and the Clerk publishable keys
 * (`deployEnvEntries`) on a computer `DEPLOY_KEYS` names, where the deploy scripts read them.
 */
export async function placeDeployKeys(
  client: Naive,
  agentId: string,
  definition: AgentDefinition,
): Promise<PlacedFile> {
  return placeFile(client, agentId, definition, DEPLOY_ENV_FILE, deployEnvFile());
}

/**
 * Whether a computer that must not hold the Cloudflare keys has `~/.boiler-room.env`. Read only: a
 * file found there is reported, never deleted, because sync did not write it. An agent with no
 * computer yet has no file.
 */
export async function deployKeysOn(
  client: Naive,
  agentId: string,
  name: string,
): Promise<DeployKeysElsewhere> {
  const computer = await client.agents.computer(agentId);
  if (!computer || ['failed', 'destroyed'].includes(computer.status)) {
    return { agent: name, computer_id: null, present: false };
  }
  const result = await client.computers.exec(
    computer.id,
    `test -e ~/${DEPLOY_ENV_FILE} && echo present || echo absent`,
    60_000,
  );
  const out = String(result.stdout).trim();
  if (result.exit_code !== 0 || !['present', 'absent'].includes(out)) {
    throw new Error(`${name}: could not tell whether ~/${DEPLOY_ENV_FILE} is there.`);
  }
  return { agent: name, computer_id: computer.id, present: out === 'present' };
}

/**
 * `pnpm company:sync`: creates or versions every company agent, with br-ceo's roster and board,
 * binds br-ceo as the organization's CEO, ensures the board, creates the CEO's sweep paused,
 * writes each GitHub token to the computers that need it, and writes the Cloudflare keys to the
 * engineering lead's computer only, checking that no other computer with a token has them. Running
 * it again changes nothing that already matches. It also checks GitHub against the spec, warns about
 * each gap and prints each accepted risk, but changes nothing there.
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
    // The halt also zeroed the GTM agents, and syncing restores their budgets too.
    const held = await interruptHeld(client, (line) => log(line), {
      only: ['br-ceo', ...GTM_HALTED],
    });
    log(
      `unhalt    interrupted ${held.length} held br-ceo and GTM session(s) before restoring budgets`,
    );
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
  for (const line of github.accepted) log(`github    ACCEPTED ${line}`);
  for (const gap of github.gaps) log(`github    WARNING ${gap}`);
  for (const line of github.unknown) log(`github    ${line}`);
  if (!github.gaps.length && !github.unknown.length) {
    log(
      `github    each token reaches its own repo${github.accepted.length ? ' (and the other, accepted above)' : ' only'}; main and dev have their rules`,
    );
  }

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

  const deployKeys: DeployKeysReport = { placed: [], elsewhere: [] };
  for (const name of DEPLOY_KEYS) {
    const definition = company.find((item) => item.name === name);
    const agent = agents.find((item) => item.name === name);
    if (!definition || !agent) throw new Error(`${name} is not a company agent.`);
    const result = await placeDeployKeys(client, agent.id, definition);
    deployKeys.placed.push(result);
    log(
      `deploy    ${result.action} ${name} ~/${result.file} (${deployEnvKeys().join(', ')}) on ${result.computer_id} (${result.computer_action}) ${result.stat}`,
    );
  }
  for (const name of Object.keys(NETRC).filter((item) => !DEPLOY_KEYS.includes(item))) {
    const agent = agents.find((item) => item.name === name);
    if (!agent) throw new Error(`${name} is not a company agent.`);
    const result = await deployKeysOn(client, agent.id, name);
    deployKeys.elsewhere.push(result);
    log(
      result.present
        ? `deploy    WARNING ${name} has ~/${DEPLOY_ENV_FILE} on ${result.computer_id}, and only ${DEPLOY_KEYS.join(', ')} may. Sync did not write it and does not delete it: remove it by hand.`
        : `deploy    absent ${name} ~/${DEPLOY_ENV_FILE}`,
    );
  }
  if (github.gaps.length) {
    log(
      `github    ${github.gaps.length} gap(s) above. Keep the sweep paused until they are fixed: until then only prompts keep agents off main and dev.`,
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
    deploy_keys: deployKeys,
    github,
  };
}
