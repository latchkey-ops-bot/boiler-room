import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';
import { sniff } from '../capture/logo.ts';
import type { AgentDefinition } from '../define.ts';
import { researcher } from '../definitions/researcher.ts';
import { listAll, NAIVE_BASE_URL, type Naive, naiveClient, scrub, usd } from '../naive/client.ts';
import { syncAgents } from '../sync.ts';
import { bundleTool, type ToolBundle } from './bundle.ts';
import {
  checkProvenance,
  checkResearch,
  type GateFailure,
  prunable,
  withoutFailures,
} from './gate.ts';
import { fileIdOf, type ResearchOutput, siteUrlProblem } from './output.ts';
import { CONTINUE_MESSAGE, type MaterialRef, repairMessage, researchTask } from './prompt.ts';
import { siteHost, slugify } from './text.ts';
import { type PagesBundle, pagesBundleSchema } from './verify.ts';

export interface ResearchOptions {
  url: string;
  /** Local paths or http(s) URLs the customer supplied. */
  material: string[];
  description?: string;
  budgetUsd?: number;
  maxRepairs: number;
  /** Keep this run's agent and its computer afterwards, to inspect them. The next run makes its own. */
  keepAgent: boolean;
  /** Fails the first gate on purpose, to prove the repair round trip on a live session. */
  drillRepair: boolean;
  outRoot: string;
  definition?: AgentDefinition;
  /** Extra Naive file ids fetched alongside the capture tool (the injection test's server). */
  extraFileIds?: readonly string[];
  /** Extra numbered steps run after fetch_file and before setup (the injection test). */
  preSteps?: readonly string[];
  /**
   * Hosts the capture tool may load although they resolve privately. Only the injection test sets
   * one, for its fixture on the agent's loopback; it builds and uploads a separate tool file.
   */
  allowPrivateHosts?: readonly string[];
  /**
   * Runs once after the session has stopped and before the agent (and its computer) is torn down,
   * so a caller can read artefacts off the agent's computer. Best-effort; errors are swallowed.
   */
  onBeforeTeardown?: (ctx: {
    client: Naive;
    agentId: string;
    sessionId: string | undefined;
  }) => Promise<void>;
}

/** Stop reasons after which the agent can simply be asked to carry on. */
const RESUMABLE = new Set(['end_turn', 'max_iterations', 'awaiting_input']);
const MAX_CONTINUES = 8;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const time = () => new Date().toISOString().slice(11, 19);

function say(message: string) {
  console.log(scrub(`${time()} ${message}`));
}

const oneLine = (text: unknown, max: number) => {
  const value = typeof text === 'string' ? text : JSON.stringify(text ?? '');
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

/**
 * Files published in the session and capture digests printed in it, read from the event stream.
 * A digest counts only when the capture line names the site this run researches: a line for any
 * other site is kept apart in `foreign`, so a bundle from another site's capture can never bind.
 */
export class EventTracker {
  readonly published = new Map<string, string>();
  readonly digests = new Set<string>();
  /** Digests printed for another site, with the site they name. Never trusted. */
  readonly foreign = new Map<string, string>();
  /** Accepted submit_output calls, so a new submission can be told from the session's last one. */
  submissions = 0;
  private readonly started = new Map<string, { name: string; args: Record<string, unknown> }>();
  private readonly host: string;

  /** `site` is the address this run researches. */
  constructor(site: string) {
    this.host = siteHost(site);
  }

  handle(event: { type: string; data: Record<string, unknown> }): void {
    const data = event.data ?? {};
    if (event.type === 'tool.started') {
      this.started.set(String(data.tool_call_id), {
        name: String(data.name),
        args: (data.args as Record<string, unknown>) ?? {},
      });
    }
    if (event.type !== 'tool.completed' || data.is_error) return;
    if (data.name === 'submit_output') this.submissions += 1;
    const output =
      typeof data.output === 'string' ? data.output : JSON.stringify(data.output ?? '');
    for (const match of output.matchAll(CAPTURE_LINE)) {
      const [, digest, site, requested] = match;
      if (!digest) continue;
      const hosts = [site, requested].filter((item): item is string => Boolean(item));
      if (hosts.includes(this.host)) this.digests.add(digest);
      else this.foreign.set(digest, site ?? '(no site named)');
    }
    if (data.name === 'publish_file') {
      const id = /published as (fil_[a-z0-9]+)/.exec(output)?.[1];
      const path = this.started.get(String(data.tool_call_id))?.args.path;
      if (id && typeof path === 'string') this.published.set(id, path);
    }
  }
}

/** The capture tool's last line: `BR_CAPTURE_DONE sha256=<hex> pages=<n> site=<host> requested=<host>`. */
const CAPTURE_LINE =
  /BR_CAPTURE_DONE sha256=([0-9a-f]{64})(?: pages=\d+)?(?: site=(\S+))?(?: requested=(\S+))?/g;

/**
 * The name of one run's agent. Each run gets its own agent, and with it its own computer, job slot
 * and output folder: runs in parallel never share state, and deleting one never stops another.
 */
export function runAgentName(baseName: string, host: string, suffix: string): string {
  return `${baseName}-${slugify(host, 'site').slice(0, 40)}-${suffix}`.slice(0, 100);
}

/** A short id that sorts by start time and is unique across parallel starts. */
export function runSuffix(now = Date.now(), random = randomBytes(3).toString('hex')): string {
  return `${now.toString(36)}${random}`;
}

/** Whether a Naive call failed because the thing it names does not exist (any more). */
export function isNotFound(cause: unknown): boolean {
  const error = cause as { code?: unknown; status?: unknown } | null;
  if (error && (error.code === 'not_found' || error.status === 404)) return true;
  return /\bnot[_ ]found\b|no such (agent|computer)/i.test(
    cause instanceof Error ? cause.message : String(cause),
  );
}

function describe(event: { type: string; data: Record<string, unknown> }): string | undefined {
  const data = event.data ?? {};
  switch (event.type) {
    case 'tool.started': {
      const args = (data.args as Record<string, unknown>) ?? {};
      const name = String(data.name);
      if (name === 'bash') return `-> bash: ${oneLine(args.command, 160)}`;
      if (name === 'submit_output')
        return `-> submit_output (${Array.isArray(args.claims) ? args.claims.length : '?'} claims)`;
      if (typeof args.path === 'string') return `-> ${name} ${args.path}`;
      return `-> ${name} ${oneLine(args, 120)}`;
    }
    case 'tool.completed': {
      const output =
        typeof data.output === 'string' ? data.output : JSON.stringify(data.output ?? '');
      const lines = output.trim().split('\n');
      const tail = lines.slice(-2).join(' | ');
      return `${data.is_error ? '!! ' : '   '}${data.name}: ${oneLine(tail, 200)}`;
    }
    case 'message.completed':
      return data.role === 'user' ? undefined : `agent: ${oneLine(data.content, 400)}`;
    case 'session.usage':
      return `usage: ${usd(Number(data.consumed_micro_usd ?? 0))} so far, ${data.tool_calls ?? '?'} tool calls`;
    case 'session.idle':
      return `idle: ${data.stop_reason}${data.error ? ` (${oneLine(data.error, 200)})` : ''}`;
    case 'budget.exceeded':
    case 'session.retrying':
    case 'session.degraded':
    case 'session.computer_replaced':
      return `${event.type}: ${oneLine(data, 200)}`;
    default:
      return undefined;
  }
}

/** Uploads the capture tool once per version; a later run reuses the file with the same digest. */
async function ensureToolFile(client: Naive, tool: ToolBundle): Promise<string> {
  const title = `br-research ${tool.sha256.slice(0, 16)}`;
  const found = await client.files.list({ search: title, limit: 10 });
  const existing = found.data.find((file) => file.title === title && file.sha256 === tool.sha256);
  if (existing) return existing.id;
  const form = new FormData();
  form.append('file', new Blob([tool.code], { type: 'text/javascript' }), tool.name);
  form.append('title', title);
  form.append('tags', 'boiler-room,capture-tool');
  form.append('folder', 'Boiler Room tools');
  const uploaded = await client.files.upload(form);
  return uploaded.id;
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

/**
 * Stores customer material in Naive files, tagged as uploaded, and a manifest the capture tool
 * reads. A local file is cited by its Naive file address; a URL is imported and cited as itself.
 */
async function uploadMaterial(
  client: Naive,
  inputs: readonly string[],
  host: string,
): Promise<{ refs: MaterialRef[]; manifestId: string | null }> {
  const refs: MaterialRef[] = [];
  for (const [index, input] of inputs.entries()) {
    const prefix = `m${String(index + 1).padStart(2, '0')}`;
    if (/^https?:\/\//i.test(input)) {
      const file = await client.files.import({
        url: input,
        title: `${host} material ${prefix}`,
        tags: ['boiler-room', 'customer-material'],
        folder: `Boiler Room ${host}`,
      });
      refs.push({
        file_id: file.id,
        name: file.name,
        source_url: input,
        content_type: file.content_type ?? 'application/octet-stream',
      });
    } else {
      if (!existsSync(input)) throw new Error(`Material not found: ${input}`);
      const name = `${prefix}-${basename(input)}`;
      const type = CONTENT_TYPES[extname(input).toLowerCase()] ?? 'application/octet-stream';
      const form = new FormData();
      form.append('file', new Blob([readFileSync(input)], { type }), name);
      form.append('title', `${host} material ${prefix}`);
      form.append('tags', 'boiler-room,customer-material');
      form.append('folder', `Boiler Room ${host}`);
      const file = await client.files.upload(form);
      refs.push({
        file_id: file.id,
        name,
        source_url: `${NAIVE_BASE_URL}/v1/files/${file.id}`,
        content_type: type,
      });
    }
    say(`material ${input} -> ${refs.at(-1)?.file_id}`);
  }
  if (refs.length === 0) return { refs, manifestId: null };
  const manifest = refs.map((ref) => ({
    ...ref,
    origin: ref.source_url.startsWith(NAIVE_BASE_URL) ? 'file' : 'url',
  }));
  const form = new FormData();
  form.append(
    'file',
    new Blob([JSON.stringify(manifest, null, 1)], { type: 'application/json' }),
    'materials.json',
  );
  form.append('tags', 'boiler-room,customer-material');
  form.append('folder', `Boiler Room ${host}`);
  const file = await client.files.upload(form);
  return { refs, manifestId: file.id };
}

interface GateVerdict {
  output: ResearchOutput | undefined;
  failures: GateFailure[];
  bundle: PagesBundle | undefined;
  bundleText: string | undefined;
}

/**
 * The gate. It downloads the stored page text itself, binds it to the capture's printed digest,
 * and runs every check: schema, the campaign validator on brand, assets and claims, Naive file
 * existence, the verbatim verifier, and provenance. Only a result with no failures passes.
 */
async function gate(
  client: Naive,
  raw: unknown,
  tracker: EventTracker,
  material: ReadonlySet<string>,
  drill: boolean,
): Promise<GateVerdict> {
  const pagesId = (raw as { evidence?: { pages_file_id?: unknown } } | null)?.evidence
    ?.pages_file_id;
  if (typeof pagesId !== 'string' || !/^fil_[a-z0-9]+$/.test(pagesId)) {
    const failure: GateFailure = {
      code: 'EVIDENCE_MISSING',
      path: 'evidence.pages_file_id',
      message:
        'evidence.pages_file_id does not name a published file, so the claims cannot be checked.',
      fix: 'Publish the capture tool’s pages.json and set evidence.pages_file_id to its fil_ id.',
    };
    return { output: undefined, failures: [failure], bundle: undefined, bundleText: undefined };
  }
  let bundle: PagesBundle | undefined;
  let bundleText: string | undefined;
  let sha = '';
  try {
    const bytes = Buffer.from(await client.files.downloadBytes(pagesId));
    sha = createHash('sha256').update(bytes).digest('hex');
    bundleText = bytes.toString('utf8');
    bundle = pagesBundleSchema.parse(JSON.parse(bundleText));
  } catch (cause) {
    const failure: GateFailure = {
      code: 'EVIDENCE_UNREADABLE',
      path: 'evidence.pages_file_id',
      message: `${pagesId} could not be read as the capture tool's pages.json: ${cause instanceof Error ? cause.message.slice(0, 200) : cause}`,
      fix: 'Publish the pages.json the capture tool wrote, unchanged, and set evidence.pages_file_id to its id.',
    };
    return { output: undefined, failures: [failure], bundle: undefined, bundleText: undefined };
  }
  const exists = new Map<string, Promise<boolean>>();
  const fileExists = (id: string) => {
    let known = exists.get(id);
    if (!known) {
      known = client.files.get(id).then(
        () => true,
        () => false,
      );
      exists.set(id, known);
    }
    return known;
  };
  const { output, failures } = await checkResearch(raw, bundle, { fileExists });
  if (output) {
    failures.push(
      ...checkProvenance(output, {
        bundleSha256: sha,
        captureDigests: tracker.digests,
        published: tracker.published,
        material,
      }),
    );
  }
  if (drill) {
    failures.push({
      code: 'REPAIR_DRILL',
      path: '$',
      message:
        'This is a drill of the repair loop: the gate refuses the first submission on purpose.',
      fix: 'Change nothing. Run verify on result.json, then call submit_output again with the same whole result.',
    });
  }
  return { output, failures, bundle, bundleText };
}

export interface TeardownResult {
  spend: unknown;
  /** True once the agent is deleted, or was already gone. */
  agentDeleted: boolean;
  computerId: string | null;
  /** True once this run's computer reads destroyed or failed, or no longer exists. */
  computerGone: boolean;
  /** Computers other runs or people still have live in the organisation. Never touched. */
  others: string[];
}

export interface TeardownOptions {
  sleep?: (ms: number) => Promise<unknown>;
  /** How long to wait for the computer to go after the agent is deleted. */
  maxWaitMs?: number;
  pollMs?: number;
}

const LIVE = (status: string) => status !== 'destroyed' && status !== 'failed';

/**
 * Deletes this run's agent, the only way to remove its computer, then waits for that computer to
 * go. An agent that is already gone counts as deleted: retrying a delete that answers "not found"
 * only wastes the wait. The computer is polled by id until it reads destroyed or is gone; the
 * platform removes it a few minutes after the agent, and asking again does not make it faster.
 */
export async function teardown(
  client: Naive,
  agentId: string,
  options: TeardownOptions = {},
): Promise<TeardownResult> {
  const wait = options.sleep ?? sleep;
  const pollMs = options.pollMs ?? 10_000;
  const maxWaitMs = options.maxWaitMs ?? 6 * 60_000;
  const spend = await client.agents
    .spend(agentId, { by: 'component' })
    .catch((cause) => ({ error: String(cause) }));
  const computer = await client.agents.computer(agentId).catch(() => null);
  let agentDeleted = false;
  for (let attempt = 0; attempt < 4 && !agentDeleted; attempt++) {
    try {
      await client.agents.delete(agentId);
      agentDeleted = true;
      say(`deleted agent ${agentId} to release its computer${computer ? ` ${computer.id}` : ''}`);
    } catch (cause) {
      if (isNotFound(cause)) {
        agentDeleted = true;
        say(`agent ${agentId} is already gone`);
        break;
      }
      say(`agent delete retry ${attempt + 1}: ${cause instanceof Error ? cause.message : cause}`);
      await wait(5000);
    }
  }
  let computerGone = computer === null || !LIVE(computer.status);
  if (computer && agentDeleted) {
    for (let waited = 0; !computerGone && waited <= maxWaitMs; waited += pollMs) {
      const status = await client.computers.get(computer.id).then(
        (item) => item.status as string,
        (cause) => (isNotFound(cause) ? 'destroyed' : 'unknown'),
      );
      if (!LIVE(status)) {
        computerGone = true;
        break;
      }
      if ((waited / pollMs) % 3 === 0) say(`waiting for computer ${computer.id} to go (${status})`);
      await wait(pollMs);
    }
  }
  const computers = await listAll((query) => client.computers.list(query)).catch(() => []);
  const others = computers
    .filter((item) => LIVE(item.status) && item.id !== computer?.id)
    .map((item) => `${item.id} ${item.name} ${item.status}`);
  return { spend, agentDeleted, computerId: computer?.id ?? null, computerGone, others };
}

async function downloadAssets(
  client: Naive,
  output: ResearchOutput,
  dir: string,
): Promise<Record<string, string>> {
  mkdirSync(dir, { recursive: true });
  const saved: Record<string, string> = {};
  for (const [id, asset] of Object.entries(output.assets)) {
    const fileId = fileIdOf(asset.src);
    if (!fileId) continue;
    const bytes = Buffer.from(await client.files.downloadBytes(fileId));
    const kind = sniff(bytes);
    const extension =
      kind === 'jpeg' ? 'jpg' : kind === 'unknown' || kind === 'html' ? 'bin' : kind;
    const path = join(dir, `${id}.${extension}`);
    writeFileSync(path, bytes);
    saved[id] = path;
  }
  return saved;
}

/**
 * One research run: uploads the capture tool and any customer material, creates this run's own
 * agent from the definition, starts a session, streams it, gates the result and sends failures
 * back for repair, then saves the result under `out/research/<host>/` and prints the cost. The
 * agent is deleted at the end, which is the only way to remove its computer. Because every run has
 * its own agent, runs in parallel never share a computer and never delete each other's agent.
 */
export async function research(options: ResearchOptions): Promise<number> {
  // A site the result could never cite is refused before any spend.
  const problem = siteUrlProblem(options.url);
  if (problem) {
    say(`error: ${problem}`);
    return 1;
  }
  const base = options.definition ?? researcher;
  const host = siteHost(options.url);
  const definition: AgentDefinition = {
    ...base,
    name: runAgentName(base.name, host, runSuffix()),
  };
  const client = naiveClient();
  const outDir = join(options.outRoot, 'research', host);
  mkdirSync(outDir, { recursive: true });
  // Files an earlier run of this host left behind would read as this run's results.
  for (const name of readdirSync(outDir)) {
    if (/^(research|failures|report|pages)\.json$|^submission-\d+\.json$|^files$/.test(name)) {
      rmSync(join(outDir, name), { recursive: true, force: true });
    }
  }
  const eventsPath = join(outDir, 'events.jsonl');
  writeFileSync(eventsPath, '');
  const startedAt = new Date().toISOString();
  const balanceBefore = (await client.credits.show()).balance_micro_usd;
  const budgetMicro = Math.round(
    (options.budgetUsd ?? definition.session.budget_micro_usd / 1e6) * 1e6,
  );
  const report: Record<string, unknown> = {
    url: options.url,
    host,
    started_at: startedAt,
    agent_name: definition.name,
    model: definition.model,
    budget_micro_usd: budgetMicro,
  };
  const tracker = new EventTracker(options.url);
  let agentId: string | undefined;
  let sessionId: string | undefined;
  let exitCode = 1;
  let cleaned = false;

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    if (sessionId) {
      const session = await client.sessions.get(sessionId).catch(() => null);
      if (session && (session.status === 'running' || session.status === 'queued'))
        await client.sessions.interrupt(sessionId).catch(() => {});
      if (session) report.session_micro_usd = session.consumed_micro_usd;
    }
    if (agentId && options.onBeforeTeardown) {
      await options
        .onBeforeTeardown({ client, agentId, sessionId })
        .catch((cause) =>
          say(`before-teardown hook failed: ${cause instanceof Error ? cause.message : cause}`),
        );
    }
    if (agentId && !options.keepAgent) {
      const result = await teardown(client, agentId);
      report.agent_spend = result.spend;
      report.agent_deleted = result.agentDeleted;
      report.computer_id = result.computerId;
      report.computer_gone = result.computerGone;
      report.other_live_computers = result.others;
      say(
        result.computerGone
          ? `this run's computer${result.computerId ? ` ${result.computerId}` : ''} is gone`
          : `this run's computer ${result.computerId} is still live; it goes when the platform removes it`,
      );
      if (result.others.length)
        say(`other computers live in the org (not this run's): ${result.others.join('; ')}`);
    } else if (agentId) {
      report.agent_spend = await client.agents
        .spend(agentId, { by: 'component' })
        .catch(() => null);
      say(`kept agent ${agentId}; its computer stays until the agent is deleted`);
    }
    const balanceAfter = (await client.credits.show().catch(() => null))?.balance_micro_usd;
    if (balanceAfter !== undefined) report.balance_delta_micro_usd = balanceBefore - balanceAfter;
    report.finished_at = new Date().toISOString();
    writeFileSync(join(outDir, 'report.json'), scrub(`${JSON.stringify(report, null, 1)}\n`));
    const session = Number(report.session_micro_usd ?? 0);
    const agentSpend = (report.agent_spend as { spent_micro_usd?: number } | null)?.spent_micro_usd;
    say(
      `cost: session ${usd(session)}${agentSpend !== undefined ? `, agent total incl. computer ${usd(agentSpend)}` : ''}${report.balance_delta_micro_usd !== undefined ? `, balance change ${usd(Number(report.balance_delta_micro_usd))}` : ''}. Computer time can book a few minutes late.`,
    );
  };
  const onSignal = () => {
    say('interrupted; cleaning up');
    cleanup().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const tool = await bundleTool({ allowPrivateHosts: options.allowPrivateHosts });
    const toolFileId = await ensureToolFile(client, tool);
    say(`capture tool ${tool.name} ${tool.sha256.slice(0, 12)} -> ${toolFileId}`);
    const { refs, manifestId } = await uploadMaterial(client, options.material, host);
    const materialIds = new Set(refs.map((ref) => ref.file_id));

    const [synced] = await syncAgents(client, [definition]);
    if (!synced) throw new Error('Agent sync returned nothing.');
    agentId = synced.id;
    say(`agent ${synced.name} ${synced.id} v${synced.version} (${synced.action})`);
    Object.assign(report, {
      agent_id: synced.id,
      agent_version: synced.version,
      tool_file_id: toolFileId,
      material: refs,
    });

    const session = await client.sessions.create({
      agent_id: synced.id,
      message: researchTask({
        url: options.url,
        host,
        toolFileId,
        materialManifestId: manifestId,
        material: refs,
        budgetUsd: budgetMicro / 1e6,
        description: options.description,
        extraFileIds: options.extraFileIds,
        preSteps: options.preSteps,
      }),
      budget_micro_usd: budgetMicro,
      ...(definition.output_schema ? { output_schema: definition.output_schema } : {}),
      structured_output_required: definition.structured_output_required,
      metadata: { run: 'research', host },
    });
    sessionId = session.id;
    report.session_id = session.id;
    say(`session ${session.id} started, budget ${usd(budgetMicro)}`);

    const deadline = Date.now() + definition.session.max_minutes * 60_000;
    let afterSeq = 0;
    let continues = 0;
    let gated = 0;
    let round = 0;
    const rounds: unknown[] = [];
    let accepted: ResearchOutput | undefined;
    let verdict: GateVerdict | undefined;

    // Streams until the session has stopped working. One stream ends at each idle, and a session
    // can go straight on into another turn: a wrap-up after the iteration limit, or a message that
    // was queued while it ran.
    const settle = async () => {
      for (;;) {
        const timer = setTimeout(
          () => {
            say(`time limit of ${definition.session.max_minutes} minutes reached; interrupting`);
            client.sessions.interrupt(session.id).catch(() => {});
          },
          Math.max(1000, deadline - Date.now()),
        );
        try {
          for await (const event of client.stream(session.id, { afterSeq })) {
            afterSeq = event.seq;
            const record = event as unknown as { type: string; data: Record<string, unknown> };
            tracker.handle(record);
            if (event.type !== 'message.delta' && !event.type.startsWith('span.'))
              appendFileSync(eventsPath, `${scrub(JSON.stringify(event))}\n`);
            const line = describe(record);
            if (line) say(line);
          }
        } finally {
          clearTimeout(timer);
        }
        const state = await client.sessions.get(session.id);
        const working = state.status === 'running' || state.status === 'queued';
        if (!working || Date.now() > deadline) return state;
        await sleep(1000);
      }
    };

    for (;;) {
      const state = await settle();
      // A turn can end on the iteration limit right after submitting, and a session keeps its last
      // result, so only a submit_output seen since the last gate counts as a new submission.
      const fresh = tracker.submissions > gated && Boolean(state.structured_output);
      if (!fresh) {
        // A turn that hits the iteration limit gets a wrap-up and ends as end_turn, with the work
        // unfinished. Nudge it on; stop only on a reason a nudge cannot fix.
        const resumable = state.status === 'idle' && RESUMABLE.has(state.stop_reason ?? '');
        if (resumable && continues < MAX_CONTINUES && Date.now() < deadline) {
          continues += 1;
          say(
            `no result submitted yet; asking the agent to continue (${continues}/${MAX_CONTINUES})`,
          );
          const sent = await client.sessions.send(session.id, {
            message: CONTINUE_MESSAGE,
            queue: true,
          });
          afterSeq = sent.accepted_seq;
          continue;
        }
        say(`the session stopped (${state.status}/${state.stop_reason}) without a new result`);
        report.stop_reason = state.stop_reason;
        break;
      }
      gated = tracker.submissions;
      round += 1;
      verdict = await gate(
        client,
        state.structured_output,
        tracker,
        materialIds,
        options.drillRepair && round === 1,
      );
      rounds.push({ round, failures: verdict.failures });
      writeFileSync(
        join(outDir, `submission-${round}.json`),
        `${JSON.stringify(state.structured_output, null, 1)}\n`,
      );
      if (verdict.failures.length === 0) {
        accepted = verdict.output;
        say(`gate passed on submission ${round}`);
        break;
      }
      say(
        `gate found ${verdict.failures.length} problem(s) in submission ${round}: ${verdict.failures
          .slice(0, 6)
          .map((failure) => failure.code)
          .join(', ')}`,
      );
      if (round > options.maxRepairs || Date.now() > deadline) break;
      const sent = await client.sessions.send(session.id, {
        message: repairMessage(verdict.failures, host, round, options.maxRepairs),
        queue: true,
      });
      afterSeq = sent.accepted_seq;
    }
    report.rounds = rounds;
    report.capture_digests = [...tracker.digests];
    if (tracker.foreign.size) report.foreign_capture_digests = Object.fromEntries(tracker.foreign);
    report.published_files = Object.fromEntries(tracker.published);

    if (!accepted && verdict?.output && verdict.bundle) {
      // Out of repair rounds: drop the claims and non-claims that still fail and correct the page
      // list, and accept the rest only if nothing else fails. An unverified claim never reaches
      // the output.
      const rejected = new Set(
        verdict.failures.flatMap((failure) => (failure.claimId ? [failure.claimId] : [])),
      );
      if (verdict.failures.some(prunable)) {
        const trimmed = withoutFailures(verdict.output, verdict.failures, verdict.bundle);
        const again = await checkResearch(trimmed, verdict.bundle, {});
        const sha = createHash('sha256')
          .update(verdict.bundleText ?? '')
          .digest('hex');
        const left = again.output
          ? [
              ...again.failures,
              ...checkProvenance(again.output, {
                bundleSha256: sha,
                captureDigests: tracker.digests,
                published: tracker.published,
                material: materialIds,
              }),
            ]
          : again.failures;
        report.rejected_claims = verdict.output.claims.filter((claim) => rejected.has(claim.id));
        if (left.length === 0 && again.output) {
          accepted = again.output;
          say(
            `accepted after the gate settled ${verdict.failures.filter(prunable).length} problem(s) itself, dropping ${rejected.size} claim(s) that could not be verified`,
          );
        } else verdict = { ...verdict, failures: left };
      }
    }

    if (verdict?.bundleText) writeFileSync(join(outDir, 'pages.json'), verdict.bundleText);
    if (accepted) {
      writeFileSync(join(outDir, 'research.json'), `${JSON.stringify(accepted, null, 1)}\n`);
      report.assets = await downloadAssets(client, accepted, join(outDir, 'files'));
      report.result = {
        claims: accepted.claims.length,
        assets: Object.keys(accepted.assets).length,
        needs_upload: accepted.needs_upload.length,
      };
      say(
        `saved ${join(outDir, 'research.json')}: ${accepted.claims.length} claims, ${Object.keys(accepted.assets).length} assets, ${accepted.needs_upload.length} upload requests`,
      );
      exitCode = 0;
    } else {
      if (verdict) {
        writeFileSync(
          join(outDir, 'failures.json'),
          `${JSON.stringify(verdict.failures, null, 1)}\n`,
        );
        say(`no result passed the gate; failures are in ${join(outDir, 'failures.json')}`);
      }
      report.failed = true;
    }
  } catch (cause) {
    report.error = cause instanceof Error ? cause.message : String(cause);
    say(`error: ${report.error}`);
  } finally {
    await cleanup();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  return exitCode;
}
