import { randomBytes } from 'node:crypto';
import { listAll, type Naive, readSecret } from '../naive/client.ts';
import { CONTROL_PLANE_TOOLS } from './control-plane-tools.ts';

/**
 * The platform's control plane: Naive's own API, served as an MCP server. A `static_bearer`
 * credential for its URL, bound to one agent under the key `ceo_<agent id>` in the vault with this
 * exact name, makes that agent the organization's CEO (`ceo_agent_id`). Docs: api/vaults, "How
 * injection works", and api/organizations, `ceo_agent_id`.
 */
export const CONTROL_PLANE = {
  server: 'vetta',
  url: 'https://api.vetta.sh/v1/mcp',
  vault: 'Orchestrator control plane',
} as const;

export const ceoKey = (agentId: string) => `ceo_${agentId}`;

/** A control-plane tool as an agent's tool config names it. */
export const controlPlaneTool = (tool: string) => `${CONTROL_PLANE.server}.${tool}`;

/** Every control-plane tool, as br-ceo's toolset names it off. */
export const CONTROL_PLANE_OFF: readonly string[] = CONTROL_PLANE_TOOLS.map(controlPlaneTool);

export interface CatalogueReport {
  count: number;
  /** Served now, but not in `CONTROL_PLANE_TOOLS`: br-ceo would be offered each of them at "ask". */
  unnamed: string[];
  /** In `CONTROL_PLANE_TOOLS`, but no longer served. Harmless; regenerate the list to drop them. */
  gone: string[];
}

export function compareCatalogue(live: readonly string[]): CatalogueReport {
  const known = new Set<string>(CONTROL_PLANE_TOOLS);
  const served = new Set(live);
  return {
    count: served.size,
    unnamed: [...served].filter((name) => !known.has(name)).sort(),
    gone: CONTROL_PLANE_TOOLS.filter((name) => !served.has(name)),
  };
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The control plane's catalogue, as `tools/list` answers this organization's API key. The key goes
 * in a header only. The SDK has no MCP call on purpose (docs: api/mcp), so this is plain JSON-RPC.
 */
export async function liveCatalogue(
  fetchFn: FetchFn = fetch,
  key: () => string = () => readSecret('NAIVE_API_KEY'),
): Promise<string[]> {
  const call = async (id: number, method: string, params: Record<string, unknown>) => {
    const response = await fetchFn(CONTROL_PLANE.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    if (!response.ok)
      throw new Error(`The control plane answered ${method} with ${response.status}.`);
    const body = (await response.json()) as {
      result?: { tools?: { name: string }[]; nextCursor?: string };
      error?: { message?: string };
    };
    if (body.error) throw new Error(`The control plane refused ${method}: ${body.error.message}`);
    return body.result ?? {};
  };
  await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  const names: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const result = await call(2 + page, 'tools/list', cursor ? { cursor } : {});
    names.push(...(result.tools ?? []).map((tool) => tool.name));
    cursor = result.nextCursor;
    if (!cursor) return names;
  }
  throw new Error('The control plane catalogue did not end after 50 pages.');
}

/** The organization the API key belongs to. */
export async function organization(client: Naive) {
  const { data } = await client.orgs.list();
  const [org, ...rest] = data;
  if (!org || rest.length) {
    throw new Error(
      `The API key lists ${data.length} organizations; it must belong to exactly one.`,
    );
  }
  return org;
}

export interface CeoBinding {
  vault_id: string;
  credential_id: string;
  action: 'bound' | 'unchanged';
  ceo_agent_id: string | null;
}

/**
 * Makes br-ceo the organization's CEO, or leaves an existing binding alone. It never replaces
 * another CEO: if the organization, or the vault, already names a different agent, it stops and
 * says so, because which agent runs the company is the founder's call.
 *
 * The platform never injects a credential for its own `/v1/mcp` (docs: api/vaults); binding only
 * records the CEO, and the CEO gets a short-lived credential each turn. So the stored value is 32
 * random bytes that authenticate nothing, made here and never printed. Writing a vault credential
 * needs the `admin` scope, and once br-ceo is bound, so does every later update of br-ceo.
 */
export async function bindCeo(
  client: Naive,
  ceoId: string,
  value: () => string = () => randomBytes(32).toString('base64url'),
): Promise<CeoBinding> {
  const org = await organization(client);
  if (org.ceo_agent_id && org.ceo_agent_id !== ceoId) {
    throw new Error(
      `The organization's CEO is ${org.ceo_agent_id}, not br-ceo (${ceoId}). Replacing another CEO is the founder's call: delete that agent, then sync again.`,
    );
  }
  const vaults = (await listAll((query) => client.vaults.list(query))).filter(
    (vault) => vault.display_name === CONTROL_PLANE.vault,
  );
  if (vaults.length > 1) {
    throw new Error(
      `${vaults.length} vaults are named "${CONTROL_PLANE.vault}" (${vaults.map((vault) => vault.id).join(', ')}). Delete the extras, then sync again.`,
    );
  }
  const vault = vaults[0] ?? (await client.vaults.create({ display_name: CONTROL_PLANE.vault }));
  const credentials = await listAll((query) => client.vaults.credentials.list(vault.id, query));
  const others = credentials.filter(
    (item) => item.mcp_server_url === CONTROL_PLANE.url && item.agent_id !== ceoId,
  );
  if (others.length) {
    throw new Error(
      `"${CONTROL_PLANE.vault}" binds the control plane to ${others.map((item) => item.agent_id ?? 'every agent').join(', ')}, not br-ceo. Remove that credential (${others.map((item) => item.id).join(', ')}), then sync again.`,
    );
  }
  const existing = credentials.find(
    (item) =>
      item.kind === 'static_bearer' &&
      item.key === ceoKey(ceoId) &&
      item.mcp_server_url === CONTROL_PLANE.url &&
      item.agent_id === ceoId,
  );
  const credential =
    existing ??
    (await client.vaults.credentials.create(vault.id, {
      kind: 'static_bearer',
      key: ceoKey(ceoId),
      value: value(),
      mcp_server_url: CONTROL_PLANE.url,
      agent_id: ceoId,
    }));
  const after = await organization(client);
  if (after.ceo_agent_id !== ceoId) {
    throw new Error(
      `The control plane is bound to br-ceo (${credential.id}), but the organization's CEO reads ${after.ceo_agent_id}.`,
    );
  }
  return {
    vault_id: vault.id,
    credential_id: credential.id,
    action: existing ? 'unchanged' : 'bound',
    ceo_agent_id: after.ceo_agent_id,
  };
}
