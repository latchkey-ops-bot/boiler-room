import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * The credential path: how `company:sync` puts a GitHub token on an agent's computer. The env file is
 * a temporary one with fake tokens, set before any module reads `BOILER_ROOM_ENV`.
 */
const env = await vi.hoisted(async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'br-env-'));
  const file = join(dir, 'test.env');
  const tokens = { eng: 'fake_eng_token_for_tests_1', design: 'fake_design_token_for_tests_2' };
  const cloudflare = {
    token: 'fake-cloudflare-token_for_tests_000000001',
    account: '0123456789abcdef0123456789abcdef',
  };
  writeFileSync(
    file,
    [
      `BR_GITHUB_TOKEN_ENG=${tokens.eng}`,
      `export BR_GITHUB_TOKEN_DESIGN="${tokens.design}"`,
      `CLOUDFLARE_API_TOKEN=${cloudflare.token}`,
      `CLOUDFLARE_ACCOUNT_ID=${cloudflare.account}`,
      'CLERK_SECRET_KEY=fake_clerk_secret_never_placed',
      '',
    ].join('\n'),
  );
  const previous = process.env.BOILER_ROOM_ENV;
  process.env.BOILER_ROOM_ENV = file;
  return { dir, previous, tokens, cloudflare };
});

const { rmSync } = await import('node:fs');
const { GITHUB_OWNER, netrc } = await import('../src/company/github.ts');
const {
  branchRules,
  canPush,
  githubPreflight,
  missingRules,
  OTHER_REPO_REACH_ACCEPTED,
  readBranchRules,
  RULES_RETRY_MS,
} = await import('../src/company/preflight.ts');
const { deployKeysOn, ensureComputer, placeDeployKeys, placeFile, placeNetrc, syncCompany } =
  await import('../src/company/sync.ts');
const { CLOUDFLARE_KEYS, cloudflareTokenActive, deployEnvFile } = await import(
  '../src/company/cloudflare.ts'
);
const { DEPLOY_KEYS_STEPS, verifyDeployKeys } = await import('../src/company/verify.ts');
const { CONTROL_PLANE, bindCeo } = await import('../src/company/control-plane.ts');
const { CONTROL_PLANE_TOOLS } = await import('../src/company/control-plane-tools.ts');
const { SONNET_SESSION_FLOOR } = await import('../src/definitions/company/common.ts');
const { company, DEPLOY_KEYS, NETRC } = await import('../src/definitions/company/index.ts');
const { ENV_FILE, readSecret, scrub } = await import('../src/naive/client.ts');

type Naive = import('../src/naive/client.ts').Naive;
type GithubReport = import('../src/company/preflight.ts').GithubReport;

afterAll(() => {
  if (env.previous === undefined) delete process.env.BOILER_ROOM_ENV;
  else process.env.BOILER_ROOM_ENV = env.previous;
  rmSync(env.dir, { recursive: true, force: true });
});

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const HOME = '/home/br-test-home';
const definitionOf = (name: string) => {
  const definition = company.find((agent) => agent.name === name);
  if (!definition) throw new Error(name);
  return definition;
};

/** A fake Naive client with one computer per agent, which records every command and file write. */
function fakeClient(
  options: {
    computers?: 'existing' | 'none';
    netrcContent?: string | null;
    badHash?: boolean;
    /** Computers, by agent id, that already hold ~/.boiler-room.env. */
    deployFileOn?: string[];
    /** The organization's CEO before the sync. */
    ceo?: string | null;
    /** Drops every control-plane tool from br-ceo's stored toolset. */
    storedWithoutLockdown?: boolean;
    /** Agents that other branches define, already in the organization. */
    others?: { name: string; configs: Record<string, unknown> }[];
  } = {},
) {
  const org = { id: 'org_1', ceo_agent_id: options.ceo ?? null };
  const stored = new Map<string, { tools: { configs: Record<string, unknown> } }>();
  const vaults: { id: string; display_name: string }[] = [];
  const credentials: Record<string, unknown>[] = [];
  /** File content by `<computer> <file>`, such as `cmp_agt_x .netrc`. */
  const files = new Map<string, string | null>();
  for (const agentId of options.deployFileOn ?? []) {
    files.set(`cmp_${agentId} .boiler-room.env`, 'CLOUDFLARE_API_TOKEN=someone-else');
  }
  const computers = new Map<string, { id: string; status: string }>();
  const execs: string[] = [];
  const writes: { computer: string; path: string; content: string }[] = [];
  const sessions: Record<string, unknown>[] = [];
  const listed: { id: string; name: string; current_version: number }[] = [];
  for (const other of options.others ?? []) {
    stored.set(`agt_${other.name}`, { tools: { configs: other.configs } });
    listed.push({ id: `agt_${other.name}`, name: other.name, current_version: 6 });
  }
  const computerFor = (agentId: string) => `cmp_${agentId}`;
  const exec = vi.fn(async (computerId: string, command: string) => {
    execs.push(command);
    const file = /~\/(\.[A-Za-z0-9._-]+)/.exec(command)?.[1] ?? '';
    const content =
      files.get(`${computerId} ${file}`) ??
      (file === '.netrc' ? options.netrcContent : null) ??
      null;
    const hash = options.badHash ? sha256('something else') : content ? sha256(content) : null;
    if (command.startsWith('test -e ~/')) {
      return { exit_code: 0, stdout: content ? 'present\n' : 'absent\n' };
    }
    if (command.startsWith('test -f ~/')) {
      return { exit_code: 0, stdout: hash ? `${hash}  ${HOME}/${file}\n` : 'none\n' };
    }
    if (command.startsWith('chmod 600')) {
      return { exit_code: 0, stdout: `naive:naive 600\n${hash}  ${HOME}/${file}\n` };
    }
    return { exit_code: 1, stdout: '' };
  });
  const client = {
    skills: { push: vi.fn(async ({ slug }: { slug: string }) => ({ slug, version: 1 })) },
    agents: {
      list: vi.fn(async () => ({ data: [...listed], has_more: false, next_cursor: null })),
      create: vi.fn(async (body: { name: string; tools: { configs: Record<string, unknown> } }) => {
        const configs = { ...body.tools.configs };
        if (options.storedWithoutLockdown) {
          for (const name of Object.keys(configs)) {
            if (name.startsWith('vetta.')) delete configs[name];
          }
        }
        stored.set(`agt_${body.name}`, { tools: { configs } });
        listed.push({ id: `agt_${body.name}`, name: body.name, current_version: 1 });
        return { id: `agt_${body.name}`, name: body.name, current_version: 1 };
      }),
      get: vi.fn(async (id: string) => ({
        id,
        current_version: listed.find((agent) => agent.id === id)?.current_version ?? 1,
        name: listed.find((agent) => agent.id === id)?.name ?? id,
        ...stored.get(id),
      })),
      update: vi.fn(),
      computer: vi.fn(async (agentId: string) => {
        if (options.computers !== 'none') return { id: computerFor(agentId), status: 'paused' };
        return computers.get(agentId) ?? null;
      }),
    },
    sessions: {
      create: vi.fn(async (body: { agent_id: string } & Record<string, unknown>) => {
        sessions.push(body);
        computers.set(body.agent_id, { id: computerFor(body.agent_id), status: 'running' });
        return { id: `ses_boot_${sessions.length}` };
      }),
      get: vi.fn(async () => ({ status: 'idle' })),
      interrupt: vi.fn(async () => undefined),
    },
    computers: {
      exec,
      inspect: vi.fn(async () => ({ home: HOME })),
      fs: vi.fn(async (computerId: string, op: string, body: { path: string; content: string }) => {
        expect(op).toBe('write');
        writes.push({ computer: computerId, ...body });
        files.set(`${computerId} ${body.path.slice(HOME.length + 1)}`, body.content);
        return {};
      }),
    },
    board: {
      get: vi.fn(async () => {
        throw new Error('no board');
      }),
      create: vi.fn(async (agentId: string) => ({ id: `brd_${agentId}`, cards: {} })),
    },
    deployments: {
      list: vi.fn(async () => ({ data: [], has_more: false, next_cursor: null })),
      create: vi.fn(async (body: Record<string, unknown>) => ({
        ...body,
        id: 'dep_1',
        schedule_status: 'paused',
      })),
      update: vi.fn(),
    },
    orgs: { list: vi.fn(async () => ({ data: [{ ...org }], has_more: false, next_cursor: null })) },
    vaults: {
      list: vi.fn(async () => ({ data: [...vaults], has_more: false, next_cursor: null })),
      create: vi.fn(async (body: { display_name: string }) => {
        const vault = { id: `vlt_${vaults.length + 1}`, ...body };
        vaults.push(vault);
        return vault;
      }),
      credentials: {
        list: vi.fn(async (vaultId: string) => ({
          data: credentials.filter((item) => item.vault_id === vaultId),
          has_more: false,
          next_cursor: null,
        })),
        create: vi.fn(async (vaultId: string, body: Record<string, unknown>) => {
          const { value: _value, ...meta } = body;
          const credential = { id: `vcr_${credentials.length + 1}`, vault_id: vaultId, ...meta };
          credentials.push(credential);
          const vault = vaults.find((item) => item.id === vaultId);
          if (
            vault?.display_name === CONTROL_PLANE.vault &&
            body.mcp_server_url === CONTROL_PLANE.url &&
            body.key === `ceo_${body.agent_id}`
          ) {
            org.ceo_agent_id = body.agent_id as string;
          }
          return credential;
        }),
      },
    },
  };
  return {
    client,
    naive: client as unknown as Naive,
    execs,
    writes,
    sessions,
    org,
    vaults,
    credentials,
  };
}

const allTokens = () => [env.tokens.eng, env.tokens.design, env.cloudflare.token];

describe('placeNetrc', () => {
  it('writes the token by file write only, to ~/.netrc in the home inspect names', async () => {
    const fake = fakeClient();
    const result = await placeNetrc(
      fake.naive,
      'agt_x',
      definitionOf('br-engineer-1'),
      'engineering',
    );
    expect(result).toMatchObject({ action: 'written', computer_action: 'existing' });
    expect(fake.writes).toEqual([
      { computer: 'cmp_agt_x', path: `${HOME}/.netrc`, content: netrc(env.tokens.eng) },
    ]);
    expect(fake.execs.length).toBeGreaterThan(0);
    for (const command of fake.execs) {
      for (const token of allTokens()) expect(command).not.toContain(token);
      expect(command).not.toMatch(/password|machine /);
    }
  });

  it('gives each role its own token', async () => {
    for (const [name, token] of Object.entries(NETRC)) {
      const fake = fakeClient();
      await placeNetrc(fake.naive, `agt_${name}`, definitionOf(name), token);
      const expected = token === 'engineering' ? env.tokens.eng : env.tokens.design;
      expect(fake.writes[0]?.content, name).toBe(netrc(expected));
    }
  });

  it('leaves a file whose SHA-256 already matches alone', async () => {
    const fake = fakeClient({ netrcContent: netrc(env.tokens.design) });
    const result = await placeNetrc(fake.naive, 'agt_x', definitionOf('br-design'), 'design');
    expect(result.action).toBe('unchanged');
    expect(fake.client.computers.fs).not.toHaveBeenCalled();
  });

  it('refuses a file that does not match after the write', async () => {
    const fake = fakeClient({ badHash: true });
    await expect(
      placeNetrc(fake.naive, 'agt_x', definitionOf('br-product'), 'design'),
    ).rejects.toThrow(/does not match/);
  });
});

describe('ensureComputer', () => {
  it('keeps an existing computer and starts no session', async () => {
    const fake = fakeClient();
    const result = await ensureComputer(fake.naive, 'agt_x', definitionOf('br-eng-lead'));
    expect(result).toEqual({ id: 'cmp_agt_x', action: 'existing', session: null });
    expect(fake.sessions).toEqual([]);
  });

  it.each(Object.keys(NETRC))(
    'boots %s with a session budget at the Sonnet floor, and no token in the message',
    async (name) => {
      const fake = fakeClient({ computers: 'none' });
      const definition = definitionOf(name);
      const result = await ensureComputer(fake.naive, 'agt_x', definition);
      expect(result).toMatchObject({ id: 'cmp_agt_x', action: 'booted' });
      const boot = fake.sessions[0] as { budget_micro_usd: number; message: string };
      expect(boot.budget_micro_usd).toBe(definition.session.budget_micro_usd);
      expect(boot.budget_micro_usd).toBeGreaterThanOrEqual(SONNET_SESSION_FLOOR);
      for (const token of allTokens()) expect(boot.message).not.toContain(token);
    },
  );
});

const served = async () => [...CONTROL_PLANE_TOOLS];

describe('syncCompany', () => {
  const clean: GithubReport = { reach: [], rules: [], gaps: [], accepted: [], unknown: [] };

  it("binds br-ceo as the organization's CEO, after its stored toolset names every control-plane tool off", async () => {
    const fake = fakeClient();
    const lines: string[] = [];
    const report = await syncCompany(fake.naive, (line) => lines.push(line), {
      preflight: async () => clean,
      catalogue: served,
    });
    expect(report.ceo).toMatchObject({ action: 'bound', ceo_agent_id: 'agt_br-ceo' });
    expect(fake.org.ceo_agent_id).toBe('agt_br-ceo');
    expect(fake.vaults).toEqual([{ id: 'vlt_1', display_name: 'Orchestrator control plane' }]);
    expect(fake.credentials).toEqual([
      {
        id: 'vcr_1',
        vault_id: 'vlt_1',
        kind: 'static_bearer',
        key: 'ceo_agt_br-ceo',
        mcp_server_url: 'https://api.vetta.sh/v1/mcp',
        agent_id: 'agt_br-ceo',
      },
    ]);
    const createOrder = fake.client.agents.create.mock.invocationCallOrder.at(-1) ?? 0;
    const bindOrder = fake.client.vaults.credentials.create.mock.invocationCallOrder[0] ?? 0;
    expect(bindOrder).toBeGreaterThan(createOrder);
    expect(lines).toContain(
      'control   368 control-plane tools served, every one named off on br-ceo',
    );
  });

  it('stops before changing anything while the control plane serves a tool br-ceo does not name', async () => {
    const fake = fakeClient();
    await expect(
      syncCompany(fake.naive, () => undefined, {
        preflight: async () => clean,
        catalogue: async () => [...CONTROL_PLANE_TOOLS, 'agents_clone'],
      }),
    ).rejects.toThrow(/does not name.*agents_clone.*Nothing was changed/);
    expect(fake.client.skills.push).not.toHaveBeenCalled();
    expect(fake.client.agents.create).not.toHaveBeenCalled();
    expect(fake.client.vaults.create).not.toHaveBeenCalled();
  });

  it('does not bind a br-ceo whose stored toolset lost the lockdown', async () => {
    const fake = fakeClient({ storedWithoutLockdown: true });
    await expect(
      syncCompany(fake.naive, () => undefined, { preflight: async () => clean, catalogue: served }),
    ).rejects.toThrow(/does not name 368 control-plane tool\(s\) off.*not bound/);
    expect(fake.client.vaults.credentials.create).not.toHaveBeenCalled();
    expect(fake.org.ceo_agent_id).toBeNull();
  });

  it('creates the agents, ensures the board on br-ceo, creates the sweep paused, and writes four netrc files', async () => {
    const fake = fakeClient();
    const lines: string[] = [];
    const report = await syncCompany(fake.naive, (line) => lines.push(line), {
      preflight: async () => clean,
      catalogue: served,
    });
    expect(fake.client.board.create).toHaveBeenCalledWith('agt_br-ceo');
    expect(report.board).toMatchObject({ id: 'brd_agt_br-ceo', action: 'created' });
    expect(fake.client.deployments.create).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'agt_br-ceo', enabled: false }),
    );
    expect(report.netrc.map((item) => [item.agent, item.token, item.action])).toEqual(
      Object.entries(NETRC).map(([name, token]) => [name, token, 'written']),
    );
    expect(fake.writes.map((write) => [write.computer, write.path])).toEqual([
      ...Object.keys(NETRC).map((name) => [`cmp_agt_${name}`, `${HOME}/.netrc`]),
      ['cmp_agt_br-eng-lead', `${HOME}/.boiler-room.env`],
    ]);
    for (const text of [...fake.execs, ...lines]) {
      for (const token of allTokens()) expect(text).not.toContain(token);
      expect(text).not.toContain(env.cloudflare.account);
    }
  });

  it('writes the Cloudflare keys to the engineering lead only, and checks every other computer has none', async () => {
    const fake = fakeClient();
    const lines: string[] = [];
    const report = await syncCompany(fake.naive, (line) => lines.push(line), {
      preflight: async () => clean,
      catalogue: served,
    });
    expect(report.deploy_keys.placed.map((item) => [item.agent, item.file, item.action])).toEqual([
      ['br-eng-lead', '.boiler-room.env', 'written'],
    ]);
    expect(report.deploy_keys.elsewhere).toEqual([
      { agent: 'br-engineer-1', computer_id: 'cmp_agt_br-engineer-1', present: false },
      { agent: 'br-product', computer_id: 'cmp_agt_br-product', present: false },
      { agent: 'br-design', computer_id: 'cmp_agt_br-design', present: false },
    ]);
    const deployWrites = fake.writes.filter((write) => write.path.endsWith('.boiler-room.env'));
    expect(deployWrites.map((write) => write.computer)).toEqual(['cmp_agt_br-eng-lead']);
    expect(lines).toContain('deploy    absent br-engineer-1 ~/.boiler-room.env');
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^deploy {4}written br-eng-lead ~\/\.boiler-room\.env \(CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID\) on cmp_agt_br-eng-lead \(existing\) naive:naive 600$/,
      ),
    );
  });

  it('warns about a Cloudflare file on a computer that must not have one, and deletes nothing', async () => {
    const fake = fakeClient({ deployFileOn: ['agt_br-engineer-1'] });
    const lines: string[] = [];
    const report = await syncCompany(fake.naive, (line) => lines.push(line), {
      preflight: async () => clean,
      catalogue: served,
    });
    expect(report.deploy_keys.elsewhere[0]).toMatchObject({
      agent: 'br-engineer-1',
      present: true,
    });
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^deploy {4}WARNING br-engineer-1 has ~\/\.boiler-room\.env.*remove it by hand/,
      ),
    );
    expect(fake.execs.filter((command) => /\brm\b/.test(command))).toEqual([]);
  });

  it('prints an accepted risk without telling anyone to keep the sweep paused for it', async () => {
    const fake = fakeClient();
    const lines: string[] = [];
    const accepted = [
      'BR_GITHUB_TOKEN_DESIGN can push to boiler-room as well as boiler-room-design',
    ];
    await syncCompany(fake.naive, (line) => lines.push(line), {
      preflight: async () => ({ ...clean, accepted }),
      catalogue: served,
    });
    expect(lines).toContain(`github    ACCEPTED ${accepted[0]}`);
    expect(lines.join('\n')).not.toMatch(/Keep the sweep paused/);
    expect(lines).toContain(
      'github    each token reaches its own repo (and the other, accepted above); main and dev have their rules',
    );
  });

  it('warns about every agent the company board offers a board tool it should not have, and patches none', async () => {
    const fake = fakeClient({
      others: [
        { name: 'br-director', configs: { bash: { enabled: true, permission: 'allow' } } },
        {
          name: 'br-researcher',
          configs: {
            board_read: { enabled: false, permission: 'deny' },
            board_write: { enabled: false, permission: 'deny' },
          },
        },
      ],
    });
    const lines: string[] = [];
    const report = await syncCompany(fake.naive, (line) => lines.push(line), {
      preflight: async () => clean,
      catalogue: served,
    });
    expect(report.exposure.map((item) => [item.name, item.offered])).toEqual([
      ['br-director', ['board_read', 'board_write']],
    ]);
    expect(lines).toContain(
      'board     WARNING br-director agt_br-director v6 is seated on the company board and offered board_read and board_write. Its definition must name both off (toolset() in src/define.ts names both), then sync it.',
    );
    expect(lines.at(-1)).toMatch(/1 agent\(s\) above can read or write company cards/);
    expect(fake.client.agents.update).not.toHaveBeenCalled();
    expect(fake.client.agents.create.mock.calls.map(([body]) => body.name)).not.toContain(
      'br-director',
    );
  });

  it('warns about every GitHub gap the preflight finds, and changes nothing on GitHub', async () => {
    const fake = fakeClient();
    const lines: string[] = [];
    const gaps = ['BR_GITHUB_TOKEN_DESIGN can push to boiler-room', 'boiler-room main has no rule'];
    const report = await syncCompany(fake.naive, (line) => lines.push(line), {
      preflight: async () => ({ ...clean, gaps }),
      catalogue: served,
    });
    expect(report.github.gaps).toEqual(gaps);
    for (const gap of gaps) expect(lines).toContain(`github    WARNING ${gap}`);
    expect(lines.at(-1)).toMatch(/Keep the sweep paused/);
  });
});

describe('bindCeo', () => {
  it('leaves an existing binding alone', async () => {
    const fake = fakeClient();
    const first = await bindCeo(fake.naive, 'agt_ceo', () => 'not-a-secret');
    const second = await bindCeo(fake.naive, 'agt_ceo', () => 'not-a-secret');
    expect(first.action).toBe('bound');
    expect(second).toMatchObject({ action: 'unchanged', credential_id: first.credential_id });
    expect(fake.vaults).toHaveLength(1);
    expect(fake.credentials).toHaveLength(1);
  });

  it('binds again when the vault is gone but the organization still names br-ceo', async () => {
    const fake = fakeClient({ ceo: 'agt_ceo' });
    expect((await bindCeo(fake.naive, 'agt_ceo', () => 'x')).action).toBe('bound');
    expect(fake.credentials).toHaveLength(1);
  });

  it('never replaces another CEO', async () => {
    const fake = fakeClient({ ceo: 'agt_default_ceo' });
    await expect(bindCeo(fake.naive, 'agt_ceo', () => 'x')).rejects.toThrow(
      /CEO is agt_default_ceo, not br-ceo.*founder's call/,
    );
    expect(fake.client.vaults.create).not.toHaveBeenCalled();
  });

  it('never stores the value it is given anywhere but the write, and never a key from the env file', async () => {
    const fake = fakeClient();
    await bindCeo(fake.naive, 'agt_ceo');
    const body = fake.client.vaults.credentials.create.mock.calls[0]?.[1] as { value: string };
    expect(body.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    for (const token of allTokens()) expect(body.value).not.toBe(token);
    expect(JSON.stringify(fake.credentials)).not.toContain(body.value);
  });
});

describe('scrub', () => {
  it('removes every secret read so far, not only the last', () => {
    expect(ENV_FILE).toBe(process.env.BOILER_ROOM_ENV);
    const eng = readSecret('BR_GITHUB_TOKEN_ENG');
    const design = readSecret('BR_GITHUB_TOKEN_DESIGN');
    expect([eng, design]).toEqual([env.tokens.eng, env.tokens.design]);
    expect(scrub(`a ${eng} b ${design} c ${eng}`)).toBe('a [REDACTED] b [REDACTED] c [REDACTED]');
    const cloudflare = readSecret('CLOUDFLARE_API_TOKEN');
    expect(scrub(`token ${cloudflare}`)).toBe('token [REDACTED]');
  });
});

describe('the GitHub preflight', () => {
  /**
   * A fake GitHub: `grants` maps a token to the repos it can push to, `rules` a repo/branch to its
   * rule types, and `approvals` a repo/branch to what its `pull_request` rule requires (1 on `main`
   * and 0 on `dev` unless given).
   */
  function fakeGithub(
    grants: Record<string, string[]>,
    rules: Record<string, string[]>,
    approvals: Record<string, number> = {},
  ) {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization');
      seen.push({ url, auth });
      const pack = /github\.com\/[^/]+\/([^/]+)\.git\/info\/refs\?service=git-receive-pack$/.exec(
        url,
      );
      if (pack) {
        const [user, token] = Buffer.from((auth ?? '').replace(/^Basic /, ''), 'base64')
          .toString()
          .split(':');
        const ok = user === GITHUB_OWNER && (grants[token ?? ''] ?? []).includes(pack[1] ?? '');
        return new Response(ok ? '001f# service=git-receive-pack\n report-status' : '', {
          status: ok ? 200 : 403,
        });
      }
      const branch = /repos\/[^/]+\/([^/]+)\/rules\/branches\/([^/]+)$/.exec(url);
      if (branch) {
        const key = `${branch[1]}/${branch[2]}`;
        const count = approvals[key] ?? (branch[2] === 'main' ? 1 : 0);
        return Response.json(
          (rules[key] ?? []).map((type) =>
            type === 'pull_request'
              ? { type, parameters: { required_approving_review_count: count } }
              : { type },
          ),
        );
      }
      return new Response('', { status: 500 });
    });
    return { fetchFn, seen };
  }
  const read = (name: string) =>
    name === 'BR_GITHUB_TOKEN_ENG' ? env.tokens.eng : env.tokens.design;
  const allRules = ['deletion', 'non_fast_forward', 'pull_request', 'required_signatures'];
  const fullRules = Object.fromEntries(
    ['boiler-room', 'boiler-room-design'].flatMap((repo) =>
      ['main', 'dev'].map((branch) => [`${repo}/${branch}`, allRules]),
    ),
  );

  it('passes single-repo tokens and protected branches', async () => {
    const github = fakeGithub(
      { [env.tokens.eng]: ['boiler-room'], [env.tokens.design]: ['boiler-room-design'] },
      fullRules,
    );
    const report = await githubPreflight(read, github.fetchFn);
    expect(report.gaps).toEqual([]);
    expect(
      report.reach.filter((item) => item.can_push).map((item) => [item.token, item.repo]),
    ).toEqual([
      ['engineering', 'boiler-room'],
      ['design', 'boiler-room-design'],
    ]);
  });

  it('reports a token that reaches both repos as an accepted risk, not a gap', async () => {
    const both = ['boiler-room', 'boiler-room-design'];
    const github = fakeGithub({ [env.tokens.eng]: both, [env.tokens.design]: both }, fullRules);
    const report = await githubPreflight(read, github.fetchFn);
    expect(OTHER_REPO_REACH_ACCEPTED).toBe(true);
    expect(report.gaps).toEqual([]);
    expect(report.accepted).toEqual([
      "BR_GITHUB_TOKEN_ENG can push to boiler-room-design as well as boiler-room: an accepted risk, by the founder's decision. Prompts keep it off boiler-room-design.",
      "BR_GITHUB_TOKEN_DESIGN can push to boiler-room as well as boiler-room-design: an accepted risk, by the founder's decision. Prompts keep it off boiler-room.",
    ]);
  });

  it('still flags a token that cannot reach its own repo, or whose reach is unknown', async () => {
    const github = fakeGithub({ [env.tokens.eng]: ['boiler-room-design'] }, fullRules);
    const report = await githubPreflight(read, github.fetchFn);
    expect(report.gaps).toEqual([
      'BR_GITHUB_TOKEN_ENG cannot push to boiler-room',
      'BR_GITHUB_TOKEN_DESIGN cannot push to boiler-room-design',
    ]);
    expect(report.accepted).toEqual([
      expect.stringMatching(/^BR_GITHUB_TOKEN_ENG can push to boiler-room-design/),
    ]);
    const unknown = await githubPreflight(read, async (url: string) =>
      url.includes('info/refs') ? new Response('', { status: 500 }) : Response.json([]),
    );
    expect(unknown.gaps).toContain(
      'could not tell whether BR_GITHUB_TOKEN_ENG can push to boiler-room',
    );
  });

  it('flags branches with no rules', async () => {
    const github = fakeGithub(
      { [env.tokens.eng]: ['boiler-room'], [env.tokens.design]: ['boiler-room-design'] },
      {},
    );
    const report = await githubPreflight(read, github.fetchFn);
    expect(report.gaps).toEqual([
      'boiler-room main has no deletion, non_fast_forward, pull_request rule. Add the protect-main ruleset.',
      'boiler-room dev has no deletion, non_fast_forward, pull_request rule. Add the protect-dev ruleset.',
      'boiler-room-design main has no deletion, non_fast_forward, pull_request rule. Add the protect-main ruleset.',
      'boiler-room-design dev has no deletion, non_fast_forward, pull_request rule. Add the protect-dev ruleset.',
    ]);
  });

  it('accepts a main that merges a pull request with no approval, since releases are autonomous', async () => {
    const github = fakeGithub(
      { [env.tokens.eng]: ['boiler-room'], [env.tokens.design]: ['boiler-room-design'] },
      fullRules,
      { 'boiler-room/main': 0, 'boiler-room-design/main': 0 },
    );
    const report = await githubPreflight(read, github.fetchFn);
    expect(report.gaps).toEqual([]);
    expect(report.rules.map((item) => [item.repo, item.branch, item.approvals])).toEqual([
      ['boiler-room', 'main', 0],
      ['boiler-room', 'dev', 0],
      ['boiler-room-design', 'main', 0],
      ['boiler-room-design', 'dev', 0],
    ]);
  });

  it('takes the highest approval count when several rulesets apply, and none without a rule', async () => {
    const rules = (body: unknown) => async () => Response.json(body);
    expect(
      await branchRules(
        'boiler-room',
        'main',
        rules([
          { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
          { type: 'pull_request', parameters: { required_approving_review_count: 2 } },
          { type: 'deletion' },
        ]),
      ),
    ).toEqual({ missing: ['non_fast_forward'], approvals: 2 });
    expect(await branchRules('boiler-room', 'main', rules([{ type: 'deletion' }]))).toEqual({
      missing: ['non_fast_forward', 'pull_request'],
      approvals: null,
    });
  });

  it('sends the token only in a header, never in a URL', async () => {
    const github = fakeGithub({}, fullRules);
    await githubPreflight(read, github.fetchFn);
    for (const { url } of github.seen) {
      for (const token of allTokens()) expect(url).not.toContain(token);
    }
    const rulesCalls = github.seen.filter(({ url }) => url.includes('/rules/branches/'));
    expect(rulesCalls.every(({ auth }) => auth === null)).toBe(true);
  });

  it('reads 401, 403 and 404 as no push, and anything else as unknown', async () => {
    for (const [status, body, expected] of [
      [200, 'report-status', true],
      [200, 'no capabilities', null],
      [401, '', false],
      [403, '', false],
      [404, '', false],
      [500, '', null],
    ] as const) {
      const fetchFn = async () => new Response(body, { status });
      expect(await canPush('fake', 'boiler-room', fetchFn), `${status}`).toBe(expected);
    }
    expect(
      await missingRules('boiler-room', 'dev', async () => new Response('', { status: 403 }), []),
    ).toBe(null);
  });

  it('tries a failed rules read again with backoff, and keeps the rules it then reads', async () => {
    const answers: (() => Response)[] = [
      () => new Response('', { status: 502 }),
      () => {
        throw new Error('socket hang up');
      },
      () => Response.json(allRules.map((type) => ({ type }))),
    ];
    const fetchFn = vi.fn(async () => (answers.shift() as () => Response)());
    const slept: number[] = [];
    const read = await readBranchRules('boiler-room', 'main', fetchFn, [5, 10, 20], async (ms) => {
      slept.push(ms);
    });
    expect(read).toEqual({ ok: true, missing: [], approvals: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([5, 10]);
    expect(RULES_RETRY_MS.length).toBeGreaterThanOrEqual(2);
  });

  it('reports rules it could not read as UNKNOWN, never as a gap', async () => {
    const github = fakeGithub(
      { [env.tokens.eng]: ['boiler-room'], [env.tokens.design]: ['boiler-room-design'] },
      fullRules,
    );
    const reset = Math.floor(Date.UTC(2026, 10, 8, 13, 0, 0) / 1000);
    const flaky = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/boiler-room/rules/branches/dev')) {
        return new Response('', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
        });
      }
      return github.fetchFn(url, init);
    });
    const report = await githubPreflight(read, flaky, [0, 0, 0]);
    expect(report.gaps).toEqual([]);
    expect(report.unknown).toEqual([
      "UNKNOWN: the rules on boiler-room dev could not be read after 4 tries (HTTP 403, GitHub's rate limit for unauthenticated reads is used up until 2026-11-08T13:00:00.000Z). Not a gap: run it again.",
    ]);
    expect(
      report.rules.find((item) => item.branch === 'dev' && item.repo === 'boiler-room'),
    ).toEqual({
      repo: 'boiler-room',
      branch: 'dev',
      missing: null,
      approvals: null,
    });
    expect(
      flaky.mock.calls.filter(([url]) => url.endsWith('/boiler-room/rules/branches/dev')),
    ).toHaveLength(4);
  });
});

describe('the Cloudflare keys', () => {
  it('writes exactly the two Cloudflare keys, by file write only, to ~/.boiler-room.env', async () => {
    const fake = fakeClient();
    const result = await placeDeployKeys(fake.naive, 'agt_x', definitionOf('br-eng-lead'));
    expect(result).toMatchObject({
      file: '.boiler-room.env',
      action: 'written',
      stat: 'naive:naive 600',
    });
    expect(fake.writes).toHaveLength(1);
    const write = fake.writes[0] as { path: string; content: string };
    expect(write.path).toBe(`${HOME}/.boiler-room.env`);
    expect(
      write.content
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => line.split('=')[0]),
    ).toEqual([...CLOUDFLARE_KEYS]);
    expect(write.content).toContain(`CLOUDFLARE_API_TOKEN=${env.cloudflare.token}\n`);
    expect(write.content).not.toMatch(/CLERK|GITHUB|NAIVE/);
    for (const command of fake.execs) {
      expect(command).not.toContain(env.cloudflare.token);
      expect(command).not.toContain(env.cloudflare.account);
    }
    expect(fake.execs).toContain(
      'chmod 600 ~/.boiler-room.env && stat -c "%U:%G %a" ~/.boiler-room.env && sha256sum ~/.boiler-room.env',
    );
  });

  it('leaves a matching file alone', async () => {
    const fake = fakeClient();
    await placeDeployKeys(fake.naive, 'agt_x', definitionOf('br-eng-lead'));
    const again = await placeDeployKeys(fake.naive, 'agt_x', definitionOf('br-eng-lead'));
    expect(again.action).toBe('unchanged');
    expect(fake.writes).toHaveLength(1);
  });

  it('refuses a key with an unexpected shape, by name only', () => {
    const read = (name: string) =>
      name === 'CLOUDFLARE_ACCOUNT_ID' ? 'not hex' : env.cloudflare.token;
    expect(() => deployEnvFile(read)).toThrow(/^CLOUDFLARE_ACCOUNT_ID has an unexpected format\.$/);
  });

  it('places a file only in the home folder', async () => {
    const fake = fakeClient();
    await expect(
      placeFile(fake.naive, 'agt_x', definitionOf('br-eng-lead'), '../etc/passwd', 'x'),
    ).rejects.toThrow(/Not a home dotfile/);
    expect(fake.writes).toEqual([]);
  });

  it('goes to the engineering lead alone', () => {
    expect(DEPLOY_KEYS).toEqual(['br-eng-lead']);
    for (const name of DEPLOY_KEYS) expect(Object.keys(NETRC)).toContain(name);
  });

  it('reads a computer with no file, or no computer, as absent', async () => {
    const fake = fakeClient();
    expect(await deployKeysOn(fake.naive, 'agt_y', 'br-design')).toEqual({
      agent: 'br-design',
      computer_id: 'cmp_agt_y',
      present: false,
    });
    const none = fakeClient({ computers: 'none' });
    expect(await deployKeysOn(none.naive, 'agt_y', 'br-design')).toMatchObject({
      computer_id: null,
      present: false,
    });
    expect(none.sessions).toEqual([]);
  });

  it('asks Cloudflare whether the token is active with the token in a header only', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const read = (name: string) =>
      name === 'CLOUDFLARE_ACCOUNT_ID' ? env.cloudflare.account : env.cloudflare.token;
    const active = await cloudflareTokenActive(read, async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: new Headers(init?.headers).get('Authorization') });
      return Response.json({ success: true, result: { status: 'active' } });
    });
    expect(active).toBe(true);
    expect(seen[0]?.auth).toBe(`Bearer ${env.cloudflare.token}`);
    for (const { url } of seen) expect(url).not.toContain(env.cloudflare.token);
    const refused = await cloudflareTokenActive(read, async () =>
      Response.json({ success: false }, { status: 401 }),
    );
    expect(refused).toBe(false);
    const unknown = await cloudflareTokenActive(
      read,
      async () => new Response('', { status: 502 }),
    );
    expect(unknown).toBeNull();
  });
});

describe('company:verify, the Cloudflare part', () => {
  /** A fake Naive where `files` names the computers holding ~/.boiler-room.env, with its mode. */
  function verifyClient(files: Record<string, { mode: string; names: string }>) {
    const execs: string[] = [];
    const names = Object.keys(NETRC);
    const client = {
      agents: {
        list: vi.fn(async () => ({
          data: names.map((name) => ({ id: `agt_${name}`, name, current_version: 1 })),
          has_more: false,
          next_cursor: null,
        })),
        computer: vi.fn(async (agentId: string) => ({ id: `cmp_${agentId}`, status: 'paused' })),
      },
      computers: {
        exec: vi.fn(async (computerId: string, command: string) => {
          execs.push(command);
          const file = files[computerId.replace(/^cmp_agt_/, '')];
          if (!file) return { exit_code: 0, stdout: 'absent\n' };
          if (command === DEPLOY_KEYS_STEPS[0]) {
            return { exit_code: 0, stdout: `mode ${file.mode} size 211\n` };
          }
          return { exit_code: 0, stdout: file.names };
        }),
      },
    };
    return { naive: client as unknown as Naive, execs };
  }
  const both = 'CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN ';

  it('passes when only the lead holds the file, with mode 600 and the two keys, and the token is active', async () => {
    const fake = verifyClient({ 'br-eng-lead': { mode: '600', names: both } });
    const result = await verifyDeployKeys(fake.naive, async () => true);
    expect(result.verdict).toEqual({ ok: true, failures: [] });
    expect(result.computers.map((item) => [item.agent, item.wanted, item.verdict.ok])).toEqual([
      ['br-eng-lead', true, true],
      ['br-engineer-1', false, true],
      ['br-product', false, true],
      ['br-design', false, true],
    ]);
    expect(new Set(fake.execs)).toEqual(new Set(DEPLOY_KEYS_STEPS));
  });

  it('fails when an engineer holds the file too', async () => {
    const fake = verifyClient({
      'br-eng-lead': { mode: '600', names: both },
      'br-engineer-1': { mode: '600', names: both },
    });
    const result = await verifyDeployKeys(fake.naive, async () => true);
    expect(result.verdict.failures).toEqual([
      'br-engineer-1: ~/.boiler-room.env is there, and only br-eng-lead may hold it',
    ]);
  });

  it('fails when the lead has no file, a loose mode, or an inactive token', async () => {
    expect(
      (await verifyDeployKeys(verifyClient({}).naive, async () => true)).verdict.failures,
    ).toEqual(['br-eng-lead: ~/.boiler-room.env is missing']);
    const loose = verifyClient({ 'br-eng-lead': { mode: '644', names: both } });
    expect((await verifyDeployKeys(loose.naive, async () => true)).verdict.ok).toBe(false);
    const fine = verifyClient({ 'br-eng-lead': { mode: '600', names: both } });
    expect((await verifyDeployKeys(fine.naive, async () => false)).verdict.failures).toEqual([
      'Cloudflare says CLOUDFLARE_API_TOKEN is not active',
    ]);
    expect((await verifyDeployKeys(fine.naive, async () => null)).verdict.failures).toEqual([
      'could not tell whether CLOUDFLARE_API_TOKEN is active',
    ]);
  });
});
