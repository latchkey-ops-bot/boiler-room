import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CONTROL_PLANE,
  CONTROL_PLANE_OFF,
  compareCatalogue,
  controlPlaneTool,
} from '../src/company/control-plane.ts';
import { CONTROL_PLANE_TOOLS } from '../src/company/control-plane-tools.ts';
import { GITHUB_OWNER, netrc, TOKENS } from '../src/company/github.ts';
import { syncSweep } from '../src/company/sync.ts';
import {
  AGENTMAIL_TOOLS,
  APP_TOOLS,
  allowedTools,
  appTool,
  SANDBOX,
  SOCIAL,
} from '../src/company/tools.ts';
import {
  CEO_TOOLS_MESSAGE,
  judgeCeoTools,
  judgeVerify,
  verifySchema,
  verifySteps,
} from '../src/company/verify.ts';
import { BOARD_OFF } from '../src/define.ts';
import { CEO_METADATA } from '../src/definitions/company/ceo.ts';
import {
  CEO_ROSTER,
  CEO_SWEEP,
  ceo,
  company,
  design,
  engineer,
  engineeringLead,
  GTM,
  gtmLead,
  inboxReader,
  NETRC,
  OUT_OF_SCOPE,
  PRIORITIES,
  product,
  scout,
  social,
} from '../src/definitions/company/index.ts';
import { researcher } from '../src/definitions/index.ts';
import { ENV_FILE, type Naive } from '../src/naive/client.ts';
import { agentConfig, HASH_KEY, skillContent, syncAgents } from '../src/sync.ts';

const OFF = { enabled: false, permission: 'deny' };
const skillVersions = new Map(
  company.flatMap((agent) => agent.skills).map((skill) => [skill.slug, 1] as const),
);
const memberRefs = (version = 1) =>
  new Map(company.map((agent, index) => [agent.name, { id: `agt_${index}`, version }]));

describe('the company', () => {
  it('has the nine agents the spec names, each once', () => {
    expect(company.map((agent) => agent.name)).toEqual([
      'br-ceo',
      'br-eng-lead',
      'br-engineer-1',
      'br-product',
      'br-design',
      'br-gtm-lead',
      'br-scout',
      'br-social',
      'br-inbox-reader',
    ]);
  });

  it('uses the models the spec gives each role', () => {
    const models = Object.fromEntries(company.map((agent) => [agent.name, agent.model]));
    expect(models).toEqual({
      'br-ceo': 'anthropic/claude-sonnet-5.5',
      'br-eng-lead': 'anthropic/claude-sonnet-5.5',
      'br-engineer-1': 'anthropic/claude-sonnet-5.5',
      'br-product': 'anthropic/claude-sonnet-5.5',
      'br-design': 'anthropic/claude-sonnet-5.5',
      'br-gtm-lead': 'anthropic/claude-sonnet-5.5',
      'br-scout': 'anthropic/claude-haiku-5.5',
      'br-social': 'anthropic/claude-haiku-5.5',
      'br-inbox-reader': 'anthropic/claude-haiku-5.5',
    });
  });

  it('runs every agent on pi, with no handoffs', () => {
    for (const agent of company) {
      expect(agent, agent.name).toMatchObject({ harness: 'pi', handoffs: false });
    }
  });
});

describe('every company toolset', () => {
  it.each(company.map((agent) => [agent.name, agent] as const))(
    '%s denies by default and names the invoker as off',
    (_name, agent) => {
      expect(agent.tools.default_config.permission).toBe('deny');
      expect(agent.tools.configs['vetta.tools_search']).toEqual(OFF);
      expect(agent.tools.configs['vetta.tools_execute']).toEqual(OFF);
    },
  );

  it.each(company.map((agent) => [agent.name, agent] as const))(
    '%s never asks a person and never delegates',
    (_name, agent) => {
      for (const tool of [
        'ask_operator',
        'request_tools',
        'propose_plan',
        'send_to_agent',
        'wait_for_agents',
        'list_agents',
        'company.set_logo',
        'company.set_brand',
        'company.set_timezone',
      ]) {
        expect(agent.tools.configs[tool], `${agent.name} ${tool}`).toEqual(OFF);
      }
    },
  );

  it.each(company.map((agent) => [agent.name, agent] as const))(
    '%s names every app tool and keeps allowed_apps explicit',
    (_name, agent) => {
      for (const tool of APP_TOOLS) {
        expect(agent.tools.configs[appTool(tool)], `${agent.name} ${tool}`).toBeDefined();
      }
      expect(agent.tools.configs.apps?.config).toHaveProperty('allowed_apps');
    },
  );

  it('names every tool of every MCP server an agent connects to', () => {
    for (const agent of company) {
      for (const server of agent.mcp_servers ?? []) {
        const named = Object.keys(agent.tools.configs).filter((name) =>
          name.startsWith(`${server.name}.`),
        );
        expect(named.length, agent.name).toBe(AGENTMAIL_TOOLS.length);
      }
    }
  });

  it('gives each role exactly the tools its role file allows', () => {
    const base = ['board_read', 'board_write', 'read_skill', 'session_spend'];
    const code = ['bash', 'edit', 'find', 'ls', 'publish_file', 'read', 'write'];
    const sorted = (names: string[]) => [...names].sort();
    expect(allowedTools(ceo.tools)).toEqual(sorted([...base, 'br-app.company_metrics']));
    expect(allowedTools(engineeringLead.tools)).toEqual(sorted([...base, ...code]));
    expect(allowedTools(engineer.tools)).toEqual(sorted([...base, ...code]));
    expect(allowedTools(product.tools)).toEqual(
      sorted([...base, ...code, 'br-app.feedback_summaries']),
    );
    expect(allowedTools(design.tools)).toEqual(
      sorted([
        ...base,
        ...code,
        'br-app.feedback_summaries',
        'find_stock_photo',
        'generate_image',
        'view_image',
      ]),
    );
    const gtmBase = base.filter((name) => name !== 'board_write');
    expect(allowedTools(gtmLead.tools)).toEqual(
      sorted([
        ...gtmBase,
        'br-app.inbox_summaries',
        'br-app.leads',
        'br-app.leads_upsert',
        'br-app.request_sample',
        'br-app.send_email',
        'data_describe',
        'data_search',
      ]),
    );
    expect(allowedTools(scout.tools)).toEqual(
      sorted([
        ...gtmBase,
        'br-app.inbox_summaries',
        'br-app.leads',
        'br-app.leads_upsert',
        'data_describe',
        'data_run',
        'data_search',
      ]),
    );
    expect(allowedTools(social.tools)).toEqual(sorted([...gtmBase, ...SOCIAL]));
    expect(allowedTools(inboxReader.tools)).toEqual(
      sorted(['agentmail.get_message', 'read_skill', 'session_spend']),
    );
  });

  it('keeps web search and browsing away from every builder', () => {
    for (const agent of [ceo, engineeringLead, engineer, product, design]) {
      for (const tool of ['web_search', 'web_fetch', 'browser']) {
        expect(agent.tools.configs[tool], `${agent.name} ${tool}`).toEqual(OFF);
      }
    }
  });

  it('gives the CEO no computer and no deploy, and only the lead the apps tool', () => {
    for (const tool of SANDBOX) expect(ceo.tools.configs[tool], tool).toEqual(OFF);
    for (const agent of company.filter((item) => item !== engineeringLead)) {
      expect(agent.tools.configs.apps, agent.name).toMatchObject(OFF);
    }
  });
});

describe('GTM', () => {
  it.each(GTM.map((agent) => [agent.name, agent] as const))(
    '%s has a $0 budget and starts no session that could spend',
    (_name, agent) => {
      expect(agent.budget).toEqual({ cap_micro_usd: 0, max_task_micro_usd: 0, period: 'day' });
      expect(agent.session.budget_micro_usd).toBe(0);
    },
  );

  it.each(GTM.map((agent) => [agent.name, agent] as const))(
    '%s has no bash, write, edit or file fetch',
    (_name, agent) => {
      for (const tool of ['bash', 'write', 'edit', 'read', 'fetch_file', 'browser', 'web_fetch']) {
        expect(agent.tools.configs[tool], `${agent.name} ${tool}`).toEqual(OFF);
      }
    },
  );

  it('lets the inbox reader make one read and send nothing', () => {
    const allowed = allowedTools(inboxReader.tools).filter((name) => name.startsWith('agentmail.'));
    expect(allowed).toEqual(['agentmail.get_message']);
    expect(inboxReader.tools.configs.board_read).toEqual(OFF);
    expect(inboxReader.tools.configs.board_write).toEqual(OFF);
    expect(inboxReader.structured_output_required).toBe(true);
  });
});

describe('the roster', () => {
  it('seats every company agent except the inbox reader, on a board owned by br-ceo', () => {
    expect([...CEO_ROSTER].sort()).toEqual(
      [
        'br-design',
        'br-eng-lead',
        'br-engineer-1',
        'br-gtm-lead',
        'br-product',
        'br-scout',
        'br-social',
      ].sort(),
    );
    expect(ceo.roster).toEqual(CEO_ROSTER);
    expect(ceo.board).toBe(true);
    expect(CEO_ROSTER).not.toContain('br-inbox-reader');
  });

  it('makes br-ceo the only coordinator, one level deep', () => {
    expect(company.filter((agent) => agent.roster).map((agent) => agent.name)).toEqual(['br-ceo']);
    const names = company.map((agent) => agent.name);
    for (const member of CEO_ROSTER) expect(names).toContain(member);
  });

  it('pins each member at its synced version, so a member version re-versions the CEO', () => {
    const config = agentConfig(ceo, skillVersions, memberRefs(1));
    expect(config.multiagent).toEqual({
      type: 'coordinator',
      board: true,
      agents: CEO_ROSTER.map((name) => ({
        type: 'agent',
        id: memberRefs().get(name)?.id,
        version: 1,
      })),
    });
    const hash = (version: number) =>
      agentConfig(ceo, skillVersions, memberRefs(version)).metadata?.[HASH_KEY];
    expect(hash(1)).toBe(hash(1));
    expect(hash(2)).not.toBe(hash(1));
  });

  it('refuses a roster whose member is not synced', () => {
    expect(() => agentConfig(ceo, skillVersions, new Map())).toThrow(/not synced/);
  });
});

describe("br-ceo as the organization's CEO", () => {
  it('lists the whole control-plane catalogue once, sorted', () => {
    expect(CONTROL_PLANE_TOOLS.length).toBe(368);
    expect(new Set(CONTROL_PLANE_TOOLS).size).toBe(CONTROL_PLANE_TOOLS.length);
    expect([...CONTROL_PLANE_TOOLS]).toEqual([...CONTROL_PLANE_TOOLS].sort());
    for (const tool of ['agents_create', 'agents_patch', 'vaults_create', 'sessions_create']) {
      expect(CONTROL_PLANE_TOOLS, tool).toContain(tool);
    }
  });

  it.each([...CONTROL_PLANE_TOOLS])('names vetta.%s off on br-ceo', (tool) => {
    expect(ceo.tools.configs[controlPlaneTool(tool)]).toEqual(OFF);
  });

  it('allows no control-plane tool, so a bound session keeps only its board tools', () => {
    expect(CONTROL_PLANE_OFF.every((name) => name.startsWith(`${CONTROL_PLANE.server}.`))).toBe(
      true,
    );
    expect(allowedTools(ceo.tools).filter((name) => name.startsWith('vetta.'))).toEqual([]);
    expect(allowedTools(ceo.tools)).toEqual([
      'board_read',
      'board_write',
      'br-app.company_metrics',
      'read_skill',
      'session_spend',
    ]);
  });

  it('flags a served tool that br-ceo does not name, and one that is no longer served', () => {
    expect(compareCatalogue(CONTROL_PLANE_TOOLS)).toEqual({ count: 368, unnamed: [], gone: [] });
    const report = compareCatalogue([...CONTROL_PLANE_TOOLS.slice(1), 'agents_clone']);
    expect(report.unnamed).toEqual(['agents_clone']);
    expect(report.gone).toEqual([CONTROL_PLANE_TOOLS[0]]);
  });

  it('carries the metadata the dashboard reads to pick its CEO, inside the definition hash', () => {
    const config = agentConfig(ceo, skillVersions, memberRefs());
    expect(config.metadata).toMatchObject({ role: 'orchestrator', source: 'boiler-room/agents' });
    expect(ceo.metadata).toEqual(CEO_METADATA);
    const other = agentConfig({ ...ceo, metadata: { role: 'group' } }, skillVersions, memberRefs());
    expect(other.metadata?.[HASH_KEY]).not.toBe(config.metadata?.[HASH_KEY]);
    for (const agent of company.filter((item) => item !== ceo)) {
      expect(agent.metadata, agent.name).toBeUndefined();
    }
  });

  it('judges a bound session by the tools it was offered and called, not by what it says', () => {
    const intended = ['board_read', 'board_write', 'read_skill', 'session_spend', 'submit_output'];
    expect(judgeCeoTools(intended, ['submit_output'])).toEqual({
      ok: true,
      failures: [],
      extra: [],
    });
    const leaked = judgeCeoTools([...intended, 'vetta__agents_create'], ['vetta.agents_list']);
    expect(leaked.ok).toBe(false);
    expect(leaked.extra).toEqual(['vetta.agents_list', 'vetta__agents_create']);
    expect(judgeCeoTools(['submit_output'], []).failures).toContain(
      'br-ceo was not offered board_read',
    );
    expect(judgeCeoTools(null, []).ok).toBe(false);
    expect(CEO_TOOLS_MESSAGE).toMatch(/exactly one tool call: submit_output/);
  });

  it('declares no MCP server, so nothing connects br-ceo to the control plane on purpose', () => {
    expect(ceo.mcp_servers).toBeUndefined();
  });
});

describe('the company board', () => {
  it('lets only the builders and the CEO write cards', () => {
    const writers = company
      .filter((agent) => agent.tools.configs.board_write?.permission === 'allow')
      .map((agent) => agent.name);
    expect(writers.sort()).toEqual(
      ['br-ceo', 'br-design', 'br-eng-lead', 'br-engineer-1', 'br-product'].sort(),
    );
  });

  it.each([gtmLead, scout, social].map((agent) => [agent.name, agent] as const))(
    '%s names board_write off while GTM is inactive, and can still read the board',
    (_name, agent) => {
      expect(agent.tools.configs.board_write).toEqual(OFF);
      expect(agent.tools.configs.board_read?.permission).toBe('allow');
    },
  );

  it('names both board tools off on every production crew agent', () => {
    expect([...BOARD_OFF]).toEqual(['board_read', 'board_write']);
    for (const tool of BOARD_OFF) expect(researcher.tools.configs[tool], tool).toEqual(OFF);
  });
});

describe('budgets', () => {
  it.each(company.map((agent) => [agent.name, agent] as const))(
    '%s has a daily cap, a task ceiling and a session budget within them',
    (_name, agent) => {
      expect(agent.budget.period).toBe('day');
      expect(agent.budget.max_task_micro_usd).toBeLessThanOrEqual(agent.budget.cap_micro_usd);
      expect(agent.session.budget_micro_usd).toBeLessThanOrEqual(agent.budget.max_task_micro_usd);
    },
  );

  it('matches the spec, and clears the Sonnet pre-flight floor for every active agent', () => {
    const budgets = Object.fromEntries(
      company.map((agent) => [
        agent.name,
        [agent.budget.cap_micro_usd, agent.budget.max_task_micro_usd],
      ]),
    );
    expect(budgets).toMatchObject({
      'br-ceo': [5_000_000, 1_000_000],
      'br-eng-lead': [10_000_000, 1_500_000],
      'br-engineer-1': [10_000_000, 1_500_000],
      'br-product': [4_000_000, 1_000_000],
      'br-design': [5_000_000, 1_000_000],
    });
    for (const agent of [ceo, engineeringLead, engineer, product, design]) {
      expect(agent.session.budget_micro_usd, agent.name).toBeGreaterThanOrEqual(1_000_000);
    }
  });

  it('runs the sweep every 2 hours within the CEO cap', () => {
    expect(CEO_SWEEP).toMatchObject({ cron: '0 */2 * * *', timezone: 'America/New_York' });
    expect(CEO_SWEEP.budget_micro_usd).toBeLessThanOrEqual(ceo.budget.cap_micro_usd);
    expect(CEO_SWEEP.input_template.split('\n')[0]).toBe('Company sweep');
  });
});

describe("the CEO's direction", () => {
  it('seeds the three priorities in order, and rules out what the founder is building', () => {
    const at = (text: string) => ceo.system.indexOf(text);
    expect(PRIORITIES[0]).toMatch(/^The scene library/);
    expect(PRIORITIES[0]).toContain('docs/motion/scenes');
    expect(PRIORITIES[0]).toContain('packages/motion');
    expect(PRIORITIES[1]).toMatch(/^Reliability of the film pipeline/);
    expect(PRIORITIES[2]).toMatch(/^The customer dashboard/);
    expect(PRIORITIES[2]).toContain('FOUNDER card');
    expect(at(PRIORITIES[0])).toBeGreaterThan(0);
    expect(at(PRIORITIES[0])).toBeLessThan(at(PRIORITIES[1]));
    expect(at(PRIORITIES[1])).toBeLessThan(at(PRIORITIES[2]));
    for (const item of OUT_OF_SCOPE) expect(ceo.system).toContain(item);
  });

  it('hands every release to the founder, and keeps GTM out of the work', () => {
    expect(ceo.system).toContain("Releases are the founder's");
    expect(ceo.system).toContain('FOUNDER: release <slug>');
    expect(ceo.system).toContain('The founder approves nothing else');
    expect(ceo.system).not.toMatch(/RELEASE cards?/);
    expect(CEO_SWEEP.input_template).toContain('FOUNDER: release');
    expect(CEO_SWEEP.input_template).not.toContain('RELEASE cards');
    expect(ceo.system).toMatch(/Never assign them a card/);
  });

  it('limits open slugs, not open DIR cards, since product closes DIR at the spec PR', () => {
    expect(ceo.system).toContain('Hold at most two open slugs');
    expect(ceo.system).toContain('does not close the slug');
    const skill = skillContent({ slug: 'ceo', description: '' });
    expect(skill).toContain('A `DIR` card moving to `done` does not close its slug');
    expect(skill).not.toMatch(/fewer than two `DIR` cards are open \(not `done`\)/);
  });

  it('never duplicates a card across sweeps', () => {
    const skill = skillContent({ slug: 'ceo', description: '' });
    expect(skill).toContain('Within one session, a retried write with the same title is a no-op');
    expect(skill).toMatch(/if a card titled `FOUNDER: release <slug>` exists, in any status, skip/);
    expect(skill).toMatch(
      /`FOUNDER: stalled cards` card that is not `done` already exists, comment/,
    );
    expect(skill).toContain('`DIR: <slug> r2`');
    expect(skill).not.toMatch(/create `RELEASE: <slug>`/);
  });
});

describe('main and production', () => {
  it('belong to the founder: no company agent merges into main or deploys production', () => {
    const lead = skillContent({ slug: 'eng-lead', description: '' });
    expect(lead).not.toMatch(/pull request from `dev` into `main`/);
    expect(lead).not.toMatch(/Deploy production with/);
    expect(lead).toContain('Never merge into `main`, never open a pull request into `main`');
    expect(lead).toContain("`releases are the founder's`");
    for (const agent of [engineeringLead, engineer]) {
      expect(agent.system, agent.name).toContain("Releases are the founder's");
      expect(agent.system, agent.name).not.toMatch(/only from a RELEASE card/);
      expect(agent.description, agent.name).not.toMatch(/promotes dev to main/);
    }
  });
});

describe('skills', () => {
  it('has a skill file with front matter for every skill a company agent names', () => {
    for (const skill of company.flatMap((agent) => agent.skills)) {
      expect(skillContent(skill)).toMatch(new RegExp(`^---\\nname: ${skill.slug}\\n`));
    }
  });

  it('keeps each prompt short, with the procedure in the skill', () => {
    for (const agent of company) {
      expect(agent.skills.length, agent.name).toBe(1);
      expect(agent.system, agent.name).toContain(`"${agent.skills[0]?.slug}"`);
      expect(agent.system.length, agent.name).toBeLessThan(4500);
    }
  });
});

describe('secrets', () => {
  const everything = [
    ...company.map((agent) => JSON.stringify(agentConfig(agent, skillVersions, memberRefs()))),
    ...company.flatMap((agent) => agent.skills).map(skillContent),
  ].join('\n');

  it('no definition or skill contains anything shaped like a secret', () => {
    for (const pattern of [
      /github_pat_[A-Za-z0-9_]{20,}/,
      /gh[pousr]_[A-Za-z0-9]{20,}/,
      /sk_(live|test)_[A-Za-z0-9]{10,}/,
      /pk_(live|test)_[A-Za-z0-9]{10,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /\b(NAIVE_API_KEY|AGENTMAIL_API_KEY|CLERK_SECRET_KEY)=/,
      /password\s+\S{8,}/,
    ]) {
      expect(everything, String(pattern)).not.toMatch(pattern);
    }
  });

  it.runIf(existsSync(ENV_FILE))(
    'no definition or skill contains a value from the env file',
    () => {
      const values = readFileSync(ENV_FILE, 'utf8')
        .split('\n')
        .map((line) => /^(?:export\s+)?([A-Z0-9_]+)=["']?([^"'\s]+)/.exec(line))
        .filter(
          (match): match is RegExpExecArray => match !== null && (match[2]?.length ?? 0) >= 12,
        );
      // Only names are reported, so a failure never prints a secret.
      const leaked = values.filter((match) => everything.includes(match[2] ?? '')).map((m) => m[1]);
      expect(leaked).toEqual([]);
    },
  );
});

describe('GitHub credentials', () => {
  it('gives the engineering token to engineering and the design token to product and design', () => {
    expect(NETRC).toEqual({
      'br-eng-lead': 'engineering',
      'br-engineer-1': 'engineering',
      'br-product': 'design',
      'br-design': 'design',
    });
    expect(TOKENS).toEqual({
      engineering: 'BR_GITHUB_TOKEN_ENG',
      design: 'BR_GITHUB_TOKEN_DESIGN',
    });
  });

  it('writes a netrc that git and the REST API both read', () => {
    expect(netrc('github_pat_example')).toBe(
      `machine github.com\nlogin ${GITHUB_OWNER}\npassword github_pat_example\nmachine api.github.com\nlogin ${GITHUB_OWNER}\npassword github_pat_example\n`,
    );
    expect(() => netrc('two\nlines')).toThrow(/unexpected format/);
  });

  it('verifies with commands that never print the file or carry a token', () => {
    for (const command of verifySteps('boiler-room', 'boiler-room-design')) {
      expect(command).not.toMatch(/\bcat\b|GIT_TRACE|--verbose|\s-v\b|password/);
    }
    expect(verifySteps('boiler-room', 'boiler-room-design')[1]).toContain('git ls-remote');
  });

  it('checks that each token is refused by the other repo, not only accepted by its own', () => {
    const steps = verifySteps('boiler-room', 'boiler-room-design');
    const own = `git push --dry-run https://github.com/${GITHUB_OWNER}/boiler-room `;
    const other = `git push --dry-run https://github.com/${GITHUB_OWNER}/boiler-room-design `;
    expect(steps[3]).toContain(own);
    expect(steps[4]).toContain(other);
    expect(steps.join('\n')).not.toContain('"push"');
    expect(steps[2]).toContain('https://api.github.com/user');
    expect(verifySchema.required).toContain('other_push_dry_run');
  });
});

describe('judging a verification', () => {
  const pass = {
    netrc: 'mode 600 size 214',
    ls_remote: '5f95f29\trefs/heads/dev',
    api_auth: 'auth 200',
    push_dry_run: `To https://github.com/${GITHUB_OWNER}/boiler-room\n * [new branch]      HEAD -> netrc-check`,
    other_push_dry_run: `remote: Permission to ${GITHUB_OWNER}/boiler-room-design.git denied to ${GITHUB_OWNER}.\nfatal: unable to access 'https://github.com/${GITHUB_OWNER}/boiler-room-design/': The requested URL returned error: 403`,
    errors: [],
  };

  it('passes a token that pushes to its own repo and is refused by the other', () => {
    expect(judgeVerify(pass)).toEqual({ ok: true, failures: [] });
  });

  it('fails a token that the other repo accepts', () => {
    const verdict = judgeVerify({ ...pass, other_push_dry_run: pass.push_dry_run });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join()).toMatch(/reaches both repos/);
  });

  it('fails when the negative step is missing or unclear', () => {
    expect(judgeVerify({ ...pass, other_push_dry_run: '' }).ok).toBe(false);
    expect(judgeVerify({ ...pass, other_push_dry_run: undefined }).ok).toBe(false);
  });

  it('fails a refused own push, a failed auth, a missing file and no output', () => {
    expect(judgeVerify({ ...pass, push_dry_run: pass.other_push_dry_run }).ok).toBe(false);
    expect(judgeVerify({ ...pass, api_auth: 'auth 401' }).ok).toBe(false);
    expect(judgeVerify({ ...pass, netrc: 'no ~/.netrc' }).ok).toBe(false);
    expect(judgeVerify({ ...pass, netrc: 'mode 644 size 214' }).ok).toBe(false);
    expect(judgeVerify(null).ok).toBe(false);
  });
});

describe('the single-repo rule', () => {
  it('is stated as a rule, never as something the token prevents', () => {
    for (const slug of ['product', 'design']) {
      const skill = skillContent({ slug, description: '' });
      expect(skill, slug).not.toMatch(/token cannot/i);
      expect(skill, slug).toContain('This is a rule, not a limit of your token');
    }
    for (const agent of [engineeringLead, engineer, product, design]) {
      expect(agent.system, agent.name).toContain('This is a rule, not a limit of your token');
    }
  });
});

describe('syncAgents with a roster', () => {
  it('creates the members before the coordinator, pinned at the versions it just made', async () => {
    const created: string[] = [];
    const client = {
      skills: { push: vi.fn(async ({ slug }: { slug: string }) => ({ slug, version: 1 })) },
      agents: {
        list: vi.fn(async () => ({ data: [], has_more: false, next_cursor: null })),
        create: vi.fn(async (body: { name: string }) => {
          created.push(body.name);
          return { id: `agt_${body.name}`, name: body.name, current_version: 1 };
        }),
        update: vi.fn(),
      },
    };
    const results = await syncAgents(client as unknown as Naive, company);
    expect(results.map((result) => result.name)).toEqual(company.map((agent) => agent.name));
    expect(created.at(-1)).toBe('br-ceo');
    const ceoCall = client.agents.create.mock.calls.find(([body]) => body.name === 'br-ceo');
    expect((ceoCall?.[0] as { multiagent?: unknown } | undefined)?.multiagent).toMatchObject({
      type: 'coordinator',
      board: true,
      agents: CEO_ROSTER.map((name) => ({ type: 'agent', id: `agt_${name}`, version: 1 })),
    });
  });
});

describe('the sweep deployment', () => {
  const deployment = (overrides: Record<string, unknown> = {}) => ({
    id: 'dep_1',
    agent_id: 'agt_ceo',
    cron: CEO_SWEEP.cron,
    timezone: CEO_SWEEP.timezone,
    input_template: CEO_SWEEP.input_template,
    budget_micro_usd: CEO_SWEEP.budget_micro_usd,
    window: 'immediate',
    enabled: false,
    schedule_status: 'paused',
    ...overrides,
  });
  const fake = (existing: ReturnType<typeof deployment>[]) => ({
    deployments: {
      list: vi.fn(async () => ({ data: existing, has_more: false, next_cursor: null })),
      create: vi.fn(async (body: Record<string, unknown>) =>
        deployment({ ...body, id: 'dep_new' }),
      ),
      update: vi.fn(async (_id: string, body: Record<string, unknown>) => deployment(body)),
    },
  });

  it('creates the sweep paused', async () => {
    const client = fake([]);
    const result = await syncSweep(client as unknown as Naive, 'agt_ceo');
    expect(client.deployments.create).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'agt_ceo', enabled: false, cron: '0 */2 * * *' }),
    );
    expect(result).toMatchObject({ action: 'created', enabled: false });
  });

  it('leaves a matching sweep alone, and never resumes or pauses one that exists', async () => {
    const same = fake([deployment()]);
    expect((await syncSweep(same as unknown as Naive, 'agt_ceo')).action).toBe('unchanged');
    const resumed = fake([deployment({ enabled: true, budget_micro_usd: 500_000 })]);
    await syncSweep(resumed as unknown as Naive, 'agt_ceo');
    const patch = resumed.deployments.update.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('enabled');
    expect(patch.budget_micro_usd).toBe(CEO_SWEEP.budget_micro_usd);
  });
});
