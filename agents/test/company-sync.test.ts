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
  writeFileSync(
    file,
    `BR_GITHUB_TOKEN_ENG=${tokens.eng}\nexport BR_GITHUB_TOKEN_DESIGN="${tokens.design}"\n`,
  );
  const previous = process.env.BOILER_ROOM_ENV;
  process.env.BOILER_ROOM_ENV = file;
  return { dir, previous, tokens };
});

const { rmSync } = await import('node:fs');
const { GITHUB_OWNER, netrc } = await import('../src/company/github.ts');
const { canPush, githubPreflight, missingRules } = await import('../src/company/preflight.ts');
const { ensureComputer, placeNetrc, syncCompany } = await import('../src/company/sync.ts');
const { SONNET_SESSION_FLOOR } = await import('../src/definitions/company/common.ts');
const { company, NETRC } = await import('../src/definitions/company/index.ts');
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
  } = {},
) {
  const files = new Map<string, string | null>();
  const computers = new Map<string, { id: string; status: string }>();
  const execs: string[] = [];
  const writes: { computer: string; path: string; content: string }[] = [];
  const sessions: Record<string, unknown>[] = [];
  const computerFor = (agentId: string) => `cmp_${agentId}`;
  const exec = vi.fn(async (computerId: string, command: string) => {
    execs.push(command);
    const content = files.get(computerId) ?? options.netrcContent ?? null;
    const hash = options.badHash ? sha256('something else') : content ? sha256(content) : null;
    if (command.startsWith('test -f ~/.netrc')) {
      return { exit_code: 0, stdout: hash ? `${hash}  ${HOME}/.netrc\n` : 'none\n' };
    }
    if (command.startsWith('chmod 600')) {
      return { exit_code: 0, stdout: `naive:naive 600\n${hash}  ${HOME}/.netrc\n` };
    }
    return { exit_code: 1, stdout: '' };
  });
  const client = {
    skills: { push: vi.fn(async ({ slug }: { slug: string }) => ({ slug, version: 1 })) },
    agents: {
      list: vi.fn(async () => ({ data: [], has_more: false, next_cursor: null })),
      create: vi.fn(async (body: { name: string }) => ({
        id: `agt_${body.name}`,
        name: body.name,
        current_version: 1,
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
        files.set(computerId, body.content);
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
  };
  return { client, naive: client as unknown as Naive, execs, writes, sessions };
}

const allTokens = () => [env.tokens.eng, env.tokens.design];

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

describe('syncCompany', () => {
  const clean: GithubReport = { reach: [], rules: [], gaps: [] };

  it('creates the agents, ensures the board on br-ceo, creates the sweep paused, and writes four netrc files', async () => {
    const fake = fakeClient();
    const lines: string[] = [];
    const report = await syncCompany(fake.naive, (line) => lines.push(line), {
      preflight: async () => clean,
    });
    expect(fake.client.board.create).toHaveBeenCalledWith('agt_br-ceo');
    expect(report.board).toMatchObject({ id: 'brd_agt_br-ceo', action: 'created' });
    expect(fake.client.deployments.create).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'agt_br-ceo', enabled: false }),
    );
    expect(report.netrc.map((item) => [item.agent, item.token, item.action])).toEqual(
      Object.entries(NETRC).map(([name, token]) => [name, token, 'written']),
    );
    expect(fake.writes.map((write) => write.path)).toEqual(
      Object.keys(NETRC).map(() => `${HOME}/.netrc`),
    );
    for (const text of [...fake.execs, ...lines]) {
      for (const token of allTokens()) expect(text).not.toContain(token);
    }
  });

  it('warns about every GitHub gap the preflight finds, and changes nothing on GitHub', async () => {
    const fake = fakeClient();
    const lines: string[] = [];
    const gaps = ['BR_GITHUB_TOKEN_DESIGN can push to boiler-room', 'boiler-room main has no rule'];
    const report = await syncCompany(fake.naive, (line) => lines.push(line), {
      preflight: async () => ({ ...clean, gaps }),
    });
    expect(report.github.gaps).toEqual(gaps);
    for (const gap of gaps) expect(lines).toContain(`github    WARNING ${gap}`);
    expect(lines.at(-1)).toMatch(/Keep the sweep paused/);
  });
});

describe('scrub', () => {
  it('removes every secret read so far, not only the last', () => {
    expect(ENV_FILE).toBe(process.env.BOILER_ROOM_ENV);
    const eng = readSecret('BR_GITHUB_TOKEN_ENG');
    const design = readSecret('BR_GITHUB_TOKEN_DESIGN');
    expect([eng, design]).toEqual(allTokens());
    expect(scrub(`a ${eng} b ${design} c ${eng}`)).toBe('a [REDACTED] b [REDACTED] c [REDACTED]');
  });
});

describe('the GitHub preflight', () => {
  /** A fake GitHub: `grants` maps a token to the repos it can push to, `rules` a repo/branch to its rule types. */
  function fakeGithub(grants: Record<string, string[]>, rules: Record<string, string[]>) {
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
        const types = rules[`${branch[1]}/${branch[2]}`] ?? [];
        return Response.json(types.map((type) => ({ type })));
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

  it('flags a token that reaches both repos, and branches with no rules', async () => {
    const both = ['boiler-room', 'boiler-room-design'];
    const github = fakeGithub({ [env.tokens.eng]: both, [env.tokens.design]: both }, {});
    const report = await githubPreflight(read, github.fetchFn);
    expect(report.gaps).toEqual([
      expect.stringMatching(
        /^BR_GITHUB_TOKEN_ENG can push to boiler-room-design; it must reach boiler-room only/,
      ),
      expect.stringMatching(
        /^BR_GITHUB_TOKEN_DESIGN can push to boiler-room; it must reach boiler-room-design only/,
      ),
      'boiler-room main has no deletion, non_fast_forward, pull_request rule. Add the protect-main ruleset.',
      'boiler-room dev has no deletion, non_fast_forward, pull_request rule. Add the protect-dev ruleset.',
      'boiler-room-design main has no deletion, non_fast_forward, pull_request rule. Add the protect-main ruleset.',
      'boiler-room-design dev has no deletion, non_fast_forward, pull_request rule. Add the protect-dev ruleset.',
    ]);
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
      await missingRules('boiler-room', 'dev', async () => new Response('', { status: 403 })),
    ).toBe(null);
  });
});
