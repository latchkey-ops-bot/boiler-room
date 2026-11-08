import { GTM_LEAD, INBOX_READER, SCOUT, SOCIAL_AGENT } from '../definitions/company/common.ts';
import { onBoard } from '../definitions/company/gtm.ts';
import { company, DEPLOY_KEYS, NETRC } from '../definitions/company/index.ts';
import { listAll, type Naive } from '../naive/client.ts';
import { cloudflareTokenActive, DEPLOY_ENV_FILE, deployEnvKeys } from './cloudflare.ts';
import { liveCatalogue, unnamedOn } from './control-plane.ts';
import { GITHUB_OWNER, otherRepo, REPO_OF } from './github.ts';
import { OTHER_REPO_REACH_ACCEPTED } from './preflight.ts';
import { type BoardExposure, exposureLine, liveBoardExposure } from './seats.ts';
import { allowedTools } from './tools.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const verifySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['netrc', 'ls_remote', 'api_auth', 'push_dry_run', 'other_push_dry_run', 'errors'],
  properties: {
    netrc: { type: 'string', description: 'Output of step 1, verbatim.' },
    ls_remote: { type: 'string', description: 'Output of step 2, verbatim.' },
    api_auth: { type: 'string', description: 'Output of step 3, verbatim.' },
    push_dry_run: { type: 'string', description: 'Output of step 4, verbatim.' },
    other_push_dry_run: { type: 'string', description: 'Output of step 5, verbatim.' },
    errors: { type: 'array', items: { type: 'string' } },
  },
} as const;

/** A dry-run push of a fresh empty commit to a new branch. It sends no objects. */
function dryRunPush(repoName: string): string {
  const url = `https://github.com/${GITHUB_OWNER}/${repoName}`;
  return `cd "$(mktemp -d)" && git init -q && git -c user.name=netrc-check -c user.email=netrc-check@invalid commit -q --allow-empty -m netrc-check && GIT_TERMINAL_PROMPT=0 timeout 25 git push --dry-run ${url} HEAD:refs/heads/netrc-check 2>&1 | tail -n 2`;
}

/**
 * The commands a verification session runs. Each holds only paths and URLs, never the token, and
 * none prints the file. Step 1 prints the file's mode and size. Step 3 prints only the HTTP status
 * of `GET /user`: 200 proves the token authenticates, nothing more. A repo's `"push"` permission
 * reports the user's role, not the token's grant, so it proves nothing about reach. Step 4 must be
 * accepted by the token's own repo. Step 5 records whether the other repo accepts it too: the
 * founder accepted that both tokens reach both repos (`OTHER_REPO_REACH_ACCEPTED`), so either answer
 * is recorded and neither fails.
 */
export function verifySteps(repoName: string, otherRepoName: string): string[] {
  const url = `https://github.com/${GITHUB_OWNER}/${repoName}`;
  return [
    'test -f ~/.netrc && stat -c "mode %a size %s" ~/.netrc || echo "no ~/.netrc"',
    `GIT_TERMINAL_PROMPT=0 timeout 25 git ls-remote ${url} refs/heads/dev 2>&1 | cut -c1-60`,
    'timeout 25 curl --netrc -s -o /dev/null -w "auth %{http_code}" https://api.github.com/user',
    dryRunPush(repoName),
    dryRunPush(otherRepoName),
  ];
}

export function verifyMessage(repoName: string, otherRepoName: string): string {
  const steps = verifySteps(repoName, otherRepoName)
    .map((command, index) => `Step ${index + 1}. Run with bash, exactly: ${command}`)
    .join('\n');
  return `This session checks that your GitHub credential works on ${repoName}, and records whether ${otherRepoName} accepts it too. It is not a card, so there is nothing to claim. Run each step as one bash call, in order, exactly once, and copy its output verbatim. Never print, cat or copy ~/.netrc, and never add -v, --verbose or GIT_TRACE to any command. Steps 4 and 5 are dry runs: they push nothing. Step 5 may be accepted or refused, and either is a correct result to record: do not retry it, try another way, or report it as an error.
${steps}
Step 6. Call submit_output with the five outputs and any errors.`;
}

/** What one verification session proved, judged from its outputs by code, not by the model. */
export interface VerifyVerdict {
  ok: boolean;
  failures: string[];
  /** Results the founder accepted, printed but not failed. */
  accepted?: string[];
}

const PUSHED = /\[new branch\]|->\s*netrc-check/;
const REFUSED =
  /\b40[134]\b|denied|not accessible|not found|Authentication failed|could not read Username/i;

/**
 * Judges a verification session's outputs. It passes only when the file is there with mode 600,
 * the token authenticates, and a dry-run push to its own repo is accepted. A dry-run push the other
 * repo accepts is reported as an accepted risk while `acceptOtherRepo` holds, and fails otherwise.
 */
export function judgeVerify(
  output: Record<string, unknown> | null,
  acceptOtherRepo: boolean = OTHER_REPO_REACH_ACCEPTED,
): VerifyVerdict {
  if (!output) return { ok: false, failures: ['the session returned no output'] };
  const text = (key: string) => (typeof output[key] === 'string' ? (output[key] as string) : '');
  const failures: string[] = [];
  if (!/mode 600\b/.test(text('netrc'))) failures.push('~/.netrc is missing or not mode 600');
  if (!/^auth 200$/m.test(text('api_auth').trim())) {
    failures.push('the token did not authenticate to the REST API');
  }
  const own = text('push_dry_run');
  if (!PUSHED.test(own) || REFUSED.test(own)) {
    failures.push('a dry-run push to its own repo was not accepted');
  }
  const other = text('other_push_dry_run');
  const accepted: string[] = [];
  if (PUSHED.test(other)) {
    if (acceptOtherRepo) {
      accepted.push(
        "a dry-run push to the other repo was accepted: the token reaches both repos, an accepted risk by the founder's decision",
      );
    } else {
      failures.push('a dry-run push to the other repo was accepted: the token reaches both repos');
    }
  } else if (!REFUSED.test(other) && !acceptOtherRepo) {
    failures.push('a dry-run push to the other repo was not clearly refused');
  }
  return { ok: failures.length === 0, failures, accepted };
}

export interface VerifyResult {
  agent: string;
  repo: string;
  other_repo: string;
  session_id: string;
  status: string;
  computer_before: string | null;
  computer_after: string | null;
  output: Record<string, unknown> | null;
  verdict: VerifyVerdict;
  consumed_micro_usd: number;
}

/**
 * `pnpm company:verify`: one session per agent with a token, started after its computer has gone
 * idle, proves that `~/.netrc` is still there in a later session, that the token authenticates and
 * can push to its own repo, and that the other repo refuses it.
 */
export async function verifyNetrc(
  client: Naive,
  log: (line: string) => void = () => undefined,
  { waitForPause = true }: { waitForPause?: boolean } = {},
): Promise<VerifyResult[]> {
  const existing = await listAll((query) => client.agents.list(query));
  const targets = Object.entries(NETRC).map(([name, token]) => {
    const agent = existing.find((item) => item.name === name);
    const definition = company.find((item) => item.name === name);
    if (!agent || !definition) throw new Error(`${name} is not synced. Run company:sync first.`);
    return { agent, definition, repo: REPO_OF[token].name, other: otherRepo(token).name };
  });

  const computerOf = async (agentId: string) => {
    const computer = await client.agents.computer(agentId);
    return computer ? `${computer.id} ${computer.status}` : null;
  };
  if (waitForPause) {
    // A card-started session usually finds the computer paused, so check from there.
    const started = Date.now();
    for (;;) {
      const states = await Promise.all(targets.map((target) => computerOf(target.agent.id)));
      log(`computers ${states.join(', ')}`);
      if (states.every((state) => state?.endsWith('paused')) || Date.now() - started > 6 * 60_000) {
        break;
      }
      await sleep(20_000);
    }
  }

  return Promise.all(
    targets.map(async ({ agent, definition, repo, other }) => {
      const before = await computerOf(agent.id);
      const session = await client.sessions.create({
        agent_id: agent.id,
        budget_micro_usd: definition.session.budget_micro_usd,
        output_schema: verifySchema,
        structured_output_required: true,
        metadata: { purpose: 'company:verify', agent: definition.name },
        message: verifyMessage(repo, other),
      });
      log(`session   ${definition.name} ${session.id}`);
      const started = Date.now();
      let current = await client.sessions.get(session.id);
      while (['running', 'queued'].includes(current.status) && Date.now() - started < 6 * 60_000) {
        await sleep(4000);
        current = await client.sessions.get(session.id);
      }
      if (['running', 'queued'].includes(current.status)) {
        await client.sessions.interrupt(session.id).catch(() => undefined);
      }
      const output = (current.structured_output as Record<string, unknown> | null) ?? null;
      return {
        agent: definition.name,
        repo,
        other_repo: other,
        session_id: session.id,
        status: `${current.status}/${current.stop_reason ?? ''}`,
        computer_before: before,
        computer_after: await computerOf(agent.id),
        output,
        verdict: judgeVerify(output),
        consumed_micro_usd: current.consumed_micro_usd ?? 0,
      };
    }),
  );
}

/**
 * The commands that check `~/.boiler-room.env` on one computer. They hold only the path: the first
 * prints the mode and size, the second only the names of the keys (everything before each `=`),
 * never a value.
 */
export const DEPLOY_KEYS_STEPS = [
  `test -f ~/${DEPLOY_ENV_FILE} && stat -c "mode %a size %s" ~/${DEPLOY_ENV_FILE} || echo absent`,
  `test -f ~/${DEPLOY_ENV_FILE} && grep -v '^#' ~/${DEPLOY_ENV_FILE} | cut -d= -f1 | sort | tr '\\n' ' ' || echo absent`,
] as const;

/**
 * Judges one computer's `~/.boiler-room.env`. A computer `DEPLOY_KEYS` names must have it, with mode
 * 600 and exactly the keys `company:sync` writes there (`expected`, from `deployEnvKeys`: the
 * Cloudflare keys and the Clerk publishable keys). Every other one must not have it at all.
 */
export function judgeDeployKeys(
  wanted: boolean,
  stat: string,
  names: string,
  expected: readonly string[],
): VerifyVerdict {
  const failures: string[] = [];
  const present = !/^absent$/.test(stat.trim());
  if (!wanted) {
    if (present)
      failures.push(
        `~/${DEPLOY_ENV_FILE} is there, and only ${DEPLOY_KEYS.join(', ')} may hold it`,
      );
    return { ok: failures.length === 0, failures };
  }
  if (!present) return { ok: false, failures: [`~/${DEPLOY_ENV_FILE} is missing`] };
  if (!/^mode 600\b/.test(stat.trim())) failures.push(`~/${DEPLOY_ENV_FILE} is not mode 600`);
  const found = names.trim().split(/\s+/).filter(Boolean).sort();
  const want = [...expected].sort();
  if (found.join(',') !== want.join(',')) {
    failures.push(
      `~/${DEPLOY_ENV_FILE} holds ${found.join(', ') || 'nothing'}, not exactly ${want.join(', ')}`,
    );
  }
  return { ok: failures.length === 0, failures };
}

export interface DeployKeysVerify {
  agent: string;
  wanted: boolean;
  computer: string | null;
  stat: string;
  names: string;
  verdict: VerifyVerdict;
}

/**
 * `pnpm company:verify`, the Cloudflare part: Cloudflare says the token is active (checked from
 * this machine), the engineering lead's computer has `~/.boiler-room.env` with mode 600 and exactly
 * the keys `company:sync` writes from the founder's file now (`deployEnvKeys`), and no other
 * computer with a token has the file. It reads with shell commands that hold only the path, and
 * starts no session, so it costs no model spend.
 */
export async function verifyDeployKeys(
  client: Naive,
  active: () => Promise<boolean | null> = () => cloudflareTokenActive(),
  keys: () => readonly string[] = () => deployEnvKeys(),
): Promise<{
  token_active: boolean | null;
  computers: DeployKeysVerify[];
  verdict: VerifyVerdict;
}> {
  const failures: string[] = [];
  let expected: readonly string[] = [];
  try {
    expected = keys();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  const existing = await listAll((query) => client.agents.list(query));
  const computers: DeployKeysVerify[] = [];
  for (const name of Object.keys(NETRC)) {
    const wanted = DEPLOY_KEYS.includes(name);
    const agent = existing.find((item) => item.name === name);
    const computer = agent ? await client.agents.computer(agent.id) : null;
    if (!computer || ['failed', 'destroyed'].includes(computer.status)) {
      computers.push({
        agent: name,
        wanted,
        computer: null,
        stat: 'absent',
        names: '',
        verdict: judgeDeployKeys(wanted, 'absent', '', expected),
      });
      continue;
    }
    const outputs: string[] = [];
    for (const command of DEPLOY_KEYS_STEPS) {
      const result = await client.computers.exec(computer.id, command, 60_000);
      outputs.push(String(result.stdout ?? '').trim());
    }
    const [stat = '', names = ''] = outputs;
    computers.push({
      agent: name,
      wanted,
      computer: `${computer.id} ${computer.status}`,
      stat,
      names,
      verdict: judgeDeployKeys(wanted, stat, names, expected),
    });
  }
  const tokenActive = await active();
  failures.push(
    ...computers.flatMap((item) =>
      item.verdict.failures.map((failure) => `${item.agent}: ${failure}`),
    ),
  );
  if (tokenActive !== true) {
    failures.push(
      tokenActive === false
        ? 'Cloudflare says CLOUDFLARE_API_TOKEN is not active'
        : 'could not tell whether CLOUDFLARE_API_TOKEN is active',
    );
  }
  return {
    token_active: tokenActive,
    computers,
    verdict: { ok: failures.length === 0, failures },
  };
}

/**
 * The tools a bound br-ceo session may be offered: its board and skill tools, the always-offered
 * `submit_output`, and the app tool it is allowed once the app exists. Nothing from the control
 * plane.
 */
export const CEO_OFFERED = [
  'board_read',
  'board_write',
  'br-app.company_metrics',
  'read_skill',
  'session_spend',
  'submit_output',
] as const;

export const ceoToolsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tools_offered'],
  properties: {
    tools_offered: {
      type: 'array',
      items: { type: 'string' },
      description: 'The exact name of every tool offered in this session, sorted.',
    },
  },
} as const;

export const CEO_TOOLS_MESSAGE =
  'This session checks which tools you are offered. It is not a card and not a sweep, so read no skill and touch no card. Make exactly one tool call: submit_output, with tools_offered set to the exact name of every tool you are offered in this session, sorted, copied character for character.';

/**
 * Judges what a bound br-ceo session reported it was offered, and what it called. It fails on any
 * tool outside `CEO_OFFERED`, which is how a control-plane tool left unnamed would show.
 */
export function judgeCeoTools(
  offered: unknown,
  called: readonly string[],
): VerifyVerdict & { extra: string[] } {
  if (!Array.isArray(offered) || !offered.every((name) => typeof name === 'string')) {
    return { ok: false, failures: ['the session reported no tool list'], extra: [] };
  }
  const allowed = new Set<string>(CEO_OFFERED);
  const extra = [...new Set([...offered, ...called])].filter((name) => !allowed.has(name)).sort();
  const failures: string[] = [];
  if (extra.length) failures.push(`br-ceo was offered or called ${extra.join(', ')}`);
  for (const name of ['board_read', 'board_write']) {
    if (!offered.includes(name)) failures.push(`br-ceo was not offered ${name}`);
  }
  return { ok: failures.length === 0, failures, extra };
}

export interface CeoVerifyResult {
  session_id: string;
  status: string;
  offered: unknown;
  called: string[];
  verdict: VerifyVerdict & { extra: string[] };
  consumed_micro_usd: number;
}

/**
 * `pnpm company:verify --ceo`: one br-ceo session, after the binding, that reports the tools it is
 * offered. Code, not the model, compares them with `CEO_OFFERED`.
 */
export async function verifyCeoTools(
  client: Naive,
  log: (line: string) => void = () => undefined,
): Promise<CeoVerifyResult> {
  const existing = await listAll((query) => client.agents.list(query));
  const agent = existing.find((item) => item.name === 'br-ceo');
  const definition = company.find((item) => item.name === 'br-ceo');
  if (!agent || !definition) throw new Error('br-ceo is not synced. Run company:sync first.');
  const session = await client.sessions.create({
    agent_id: agent.id,
    budget_micro_usd: definition.session.budget_micro_usd,
    output_schema: ceoToolsSchema,
    structured_output_required: true,
    metadata: { purpose: 'company:verify --ceo', agent: definition.name },
    message: CEO_TOOLS_MESSAGE,
  });
  log(`session   br-ceo ${session.id}`);
  const started = Date.now();
  let current = await client.sessions.get(session.id);
  while (['running', 'queued'].includes(current.status) && Date.now() - started < 4 * 60_000) {
    await sleep(3000);
    current = await client.sessions.get(session.id);
  }
  if (['running', 'queued'].includes(current.status)) {
    await client.sessions.interrupt(session.id).catch(() => undefined);
  }
  const called: string[] = [];
  for (let after = 0, page = 0; page < 20; page++) {
    const events = await client.sessions.events(session.id, { after_seq: after, limit: 100 });
    for (const event of events.data) {
      if (event.type === 'tool.started') called.push(String(event.data.name ?? ''));
      after = Math.max(after, event.seq);
    }
    if (!events.has_more || !events.data.length) break;
  }
  const offered = (current.structured_output as { tools_offered?: unknown } | null)?.tools_offered;
  return {
    session_id: session.id,
    status: `${current.status}/${current.stop_reason ?? ''}`,
    offered: offered ?? null,
    called,
    verdict: judgeCeoTools(offered, called),
    consumed_micro_usd: current.consumed_micro_usd ?? 0,
  };
}

/**
 * What a GTM agent may be offered: its skill, its spend, and the always-offered `submit_output`.
 * Nothing that sends, posts, spends, writes or reads the board, or runs code, because each one
 * reads text from outside the company. Only an agent on `GTM_ON_BOARD` would also hold the two
 * board tools, and that list is empty.
 */
export const GTM_OFFERED = ['read_skill', 'session_spend', 'submit_output'] as const;
const GTM_NAMES = [GTM_LEAD, SCOUT, SOCIAL_AGENT, INBOX_READER] as const;

/** What a stored GTM agent may allow, by name (`submit_output` cannot be named). */
export function gtmAllowed(name: string): string[] {
  const base = GTM_OFFERED.filter((tool) => tool !== 'submit_output');
  const board = onBoard(name) ? ['board_read', 'board_write'] : [];
  return [...board, ...base].sort();
}

/**
 * Judges the four GTM agents as Naive stores them: each allows only `read_skill` and
 * `session_spend`, plus the board tools for the agents on `GTM_ON_BOARD`, and connects no MCP
 * server. An agent that is not synced yet is not judged.
 */
export function judgeGtmStored(
  stored: readonly {
    name: string;
    tools?: { configs?: Record<string, unknown> } | null;
    mcp_servers?: unknown;
  }[],
): string[] {
  const failures: string[] = [];
  for (const name of GTM_NAMES) {
    const allowed = gtmAllowed(name).join(',');
    const agent = stored.find((item) => item.name === name);
    if (!agent) continue;
    const tools = allowedTools({
      default_config: { permission: 'deny' },
      configs: (agent.tools?.configs ?? {}) as Parameters<typeof allowedTools>[0]['configs'],
    });
    if (tools.join(',') !== allowed) {
      failures.push(
        `${name} allows ${tools.join(', ') || 'nothing'}; a GTM agent may allow only ${allowed}. Sync it from this repo.`,
      );
    }
    if (Array.isArray(agent.mcp_servers) && agent.mcp_servers.length) {
      failures.push(
        `${name} connects ${agent.mcp_servers.length} MCP server(s); a GTM agent connects none.`,
      );
    }
  }
  return failures;
}

export interface LockdownResult {
  /** Agents the company board offers a board tool their definition does not give them. */
  exposure: BoardExposure[];
  /** GTM agents, as stored, that allow more than their skill and their spend. */
  gtm: string[];
  /** Served control-plane tools that br-ceo, as stored, does not name off. */
  unnamed_on_ceo: string[];
  verdict: VerifyVerdict;
}

/**
 * `pnpm company:verify --lockdown`: what the binding exposes, read from Naive as it is now, with no
 * session and no spend. It fails on any agent offered a board tool its definition does not give it,
 * and on any served control-plane tool that br-ceo's stored toolset does not name off. Naive can add
 * a control-plane tool at any time, so run it before trusting a br-ceo run.
 */
export async function verifyLockdown(
  client: Naive,
  catalogue: () => Promise<string[]> = () => liveCatalogue(),
): Promise<LockdownResult> {
  const exposure = await liveBoardExposure(client);
  const existing = await listAll((query) => client.agents.list(query));
  const gtmStored = [];
  for (const agent of existing.filter((item) =>
    (GTM_NAMES as readonly string[]).includes(item.name),
  )) {
    gtmStored.push(await client.agents.get(agent.id));
  }
  const gtm = judgeGtmStored(gtmStored as unknown as Parameters<typeof judgeGtmStored>[0]);
  const ceo = existing.filter((item) => item.name === 'br-ceo');
  if (ceo.length !== 1) throw new Error(`${ceo.length} agents are named br-ceo; expected one.`);
  const stored = (await client.agents.get((ceo[0] as { id: string }).id)).tools?.configs ?? {};
  const unnamed = unnamedOn(await catalogue(), stored);
  const failures = [...exposure.map(exposureLine), ...gtm];
  if (unnamed.length) {
    failures.push(
      `br-ceo is offered ${unnamed.length} control-plane tool(s) at "ask", because its stored toolset does not name them off: ${unnamed.join(', ')}. Add them to src/company/control-plane-tools.ts and run company:sync.`,
    );
  }
  return {
    exposure,
    gtm,
    unnamed_on_ceo: unnamed,
    verdict: { ok: failures.length === 0, failures },
  };
}
