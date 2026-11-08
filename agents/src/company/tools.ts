import type { ToolConfig, Toolset } from '../define.ts';
import { ALWAYS_OFF, allow, off } from '../define.ts';

/**
 * The company's toolsets, from docs/company/README.md section 3 and the role files.
 *
 * Every company agent denies by default, allows only the tools its role lists, and names as off
 * every tool any role mentions. Naming matters for two reasons the probes showed: a deny default
 * still offers `vetta.tools_search` and `vetta.tools_execute` until they are named, and an
 * unnamed MCP or app tool is offered at "ask", which parks an unattended session.
 */

/**
 * Tools every company agent may use. `submit_output` is offered to every session even under a deny
 * default, and Naive refuses it as a name ("`submit_output` is not a tool"), so it is not listed.
 */
export const BASE_ALLOW = ['board_read', 'board_write', 'session_spend', 'read_skill'];

/** Teammate tools. Work moves by card, and nobody waits on a teammate. */
export const TEAM_OFF = ['send_to_agent', 'wait_for_agents', 'list_agents'] as const;

/** Tools that change the company's own settings. They always need an owner's approval. */
export const COMPANY_SETTINGS = ['company.set_timezone', 'company.set_logo', 'company.set_brand'];

export const SANDBOX = ['bash', 'read', 'write', 'edit', 'ls', 'find'] as const;
export const FILES = ['publish_file', 'fetch_file', 'view_image'] as const;
export const WEB = ['browser', 'web_fetch', 'web_search'] as const;
export const MEDIA = ['generate_image', 'find_stock_photo'] as const;
export const DATA = ['data_search', 'data_describe', 'data_run'] as const;
export const SOCIAL = [
  'social.accounts',
  'social.post',
  'social.status',
  'social.post_metrics',
  'social.cancel',
] as const;

/**
 * The tools the Boiler Room app will serve on its own `/mcp` route, registered by Naive as
 * `br-app.<tool>`. The app does not exist yet. Every agent names all of them, so a tool the app
 * adds later is never offered at "ask"; adding one here and re-running `company:sync` is the
 * whole change.
 */
export const APP = 'br-app';
export const APP_TOOLS = [
  'company_metrics',
  'feedback_summaries',
  'send_email',
  'leads_upsert',
  'request_sample',
  'inbox_summaries',
  'leads',
] as const;
export type AppTool = (typeof APP_TOOLS)[number];
export const appTool = (tool: AppTool) => `${APP}.${tool}`;

/** AgentMail's hosted MCP server. Its key is a vault credential bound to the reader, never config. */
export const AGENTMAIL = { name: 'agentmail', url: 'https://mcp.agentmail.to/mcp' } as const;

/** Every tool AgentMail's MCP server lists (54, read from `tools/list` on 2026-11-07). */
export const AGENTMAIL_TOOLS = [
  'list_inboxes',
  'search_inboxes',
  'get_inbox',
  'create_inbox',
  'update_inbox',
  'delete_inbox',
  'list_threads',
  'search_threads',
  'get_thread',
  'get_attachment',
  'update_thread',
  'delete_thread',
  'list_messages',
  'search_messages',
  'send_message',
  'reply_to_message',
  'forward_message',
  'update_message',
  'get_message',
  'create_draft',
  'list_drafts',
  'get_draft',
  'update_draft',
  'send_draft',
  'delete_draft',
  'upload_file',
  'list_files',
  'get_file',
  'delete_file',
  'get_agenda',
  'get_event',
  'create_event',
  'update_event',
  'delete_event',
  'respond_to_invitation',
  'get_calendar',
  'update_calendar',
  'list_list_entries',
  'get_list_entry',
  'create_list_entry',
  'delete_list_entry',
  'agent_attach_human',
  'agent_verify',
  'get_labs',
  'join_labs',
  'list_apps',
  'search_apps',
  'get_app',
  'list_accounts',
  'connect_app',
  'authorize_inbox',
  'list_organizations',
  'select_organization',
  'send_feedback',
] as const;

/** Every tool named as off on every company agent unless its role allows it. */
export const NAMED_OFF: readonly string[] = [
  ...ALWAYS_OFF,
  ...TEAM_OFF,
  ...COMPANY_SETTINGS,
  ...SANDBOX,
  ...FILES,
  ...WEB,
  ...MEDIA,
  ...DATA,
  ...SOCIAL,
  ...APP_TOOLS.map(appTool),
];

export interface RoleTools {
  /** Tools this role may use, on top of the base. */
  allow?: readonly string[];
  /**
   * Base tools this role does not get. Once br-ceo is the organization's CEO, its board is the
   * company board, which seats every agent of the company, so an agent that must not write cards
   * names `board_write` here.
   */
  without?: readonly string[];
  /** More tools named off for this role only, such as every control-plane tool for the CEO. */
  off?: readonly string[];
  /** The app tools this role may use. Every other app tool is named off. */
  app?: readonly AppTool[];
  /**
   * The `apps` tool. Off by default. `allowed_apps` is always explicit, because without it an agent
   * is offered the tools of every app in the org (docs).
   */
  apps?: { enabled: boolean; allowed_apps: readonly string[] };
  /** Tool configs that need more than allow, such as a browser limited to some domains. */
  configs?: Readonly<Record<string, ToolConfig>>;
  /** An MCP server whose every tool is named: `allow` lists the ones this role may call. */
  mcp?: { server: string; tools: readonly string[]; allow: readonly string[] };
}

/** The toolset of one company role: deny by default, every allowed tool named, the rest named off. */
export function companyToolset(role: RoleTools): Toolset {
  const configs: Toolset['configs'] = {};
  for (const name of [...NAMED_OFF, ...(role.off ?? [])]) configs[name] = off;
  const allowed = [
    ...BASE_ALLOW.filter((name) => !role.without?.includes(name)),
    ...(role.allow ?? []),
    ...(role.app ?? []).map(appTool),
  ];
  for (const name of role.without ?? []) configs[name] = off;
  for (const name of allowed) configs[name] = allow;
  const apps = role.apps ?? { enabled: false, allowed_apps: [] };
  configs.apps = {
    ...(apps.enabled ? allow : off),
    config: { allowed_apps: [...apps.allowed_apps] },
  };
  if (role.mcp) {
    for (const tool of role.mcp.tools) {
      configs[`${role.mcp.server}.${tool}`] = role.mcp.allow.includes(tool) ? allow : off;
    }
  }
  for (const [name, config] of Object.entries(role.configs ?? {})) configs[name] = config;
  return { default_config: { permission: 'deny' }, configs };
}

/** The tools a toolset allows, sorted. */
export function allowedTools(tools: Toolset): string[] {
  return Object.entries(tools.configs)
    .filter(([, config]) => config.enabled !== false && config.permission === 'allow')
    .map(([name]) => name)
    .sort();
}
