import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHILD_ENV_KEYS,
  CLERK_DEVELOPMENT,
  childEnv,
  developmentKeyRefusal,
  developmentKeysIn,
  parseEnvFile,
  run,
  valueFor,
} from '../scripts/lib/env.mjs';
import {
  newSigningSecret,
  PROBE_CALLS,
  RUNNER_KEY_SCOPES,
  upsertEnvLine,
  WEB_KEY_SCOPES,
} from '../scripts/lib/runner-keys.mjs';
import {
  checkRunnerKey,
  checkWebKey,
  contractDrift,
  runnerSecretsFor,
  scopesMatch,
} from '../scripts/lib/runner-secrets.mjs';
import {
  environmentConfig,
  readWranglerConfig,
  replaceDatabaseId,
  stripJsonc,
} from '../scripts/lib/wrangler-config.mjs';

describe('env file', () => {
  it('reads KEY=VALUE lines, with quotes, comments and blanks', () => {
    const vars = parseEnvFile(
      ['# a comment', '', 'A=1', 'B="two words"', "export C='three'", 'D=', 'not a line'].join(
        '\n',
      ),
    );
    expect(Object.fromEntries(vars)).toEqual({ A: '1', B: 'two words', C: 'three', D: '' });
  });

  it('prefers the environment-scoped value, and treats empty as missing', () => {
    const vars = parseEnvFile('CLERK_SECRET_KEY=dev\nSTAGING_CLERK_SECRET_KEY=stage\nEMPTY=');
    expect(valueFor(vars, 'CLERK_SECRET_KEY', 'staging')).toBe('stage');
    expect(valueFor(vars, 'CLERK_SECRET_KEY', 'development')).toBe('dev');
    expect(valueFor(vars, 'EMPTY', 'staging')).toBeNull();
  });

  it('gives production only PRODUCTION_ values, never the unscoped development keys', () => {
    const unscoped = parseEnvFile(
      'CLERK_SECRET_KEY=sk_test_FAKE\nNEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_FAKE',
    );
    expect(valueFor(unscoped, 'CLERK_SECRET_KEY', 'production')).toBeNull();
    expect(valueFor(unscoped, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'production')).toBeNull();
    const scoped = parseEnvFile(
      'CLERK_SECRET_KEY=sk_test_FAKE\nPRODUCTION_CLERK_SECRET_KEY=sk_live_FAKE',
    );
    expect(valueFor(scoped, 'CLERK_SECRET_KEY', 'production')).toBe('sk_live_FAKE');
  });

  it('names production values that are Clerk development keys, by prefix only', () => {
    expect(
      developmentKeysIn([
        ['CLERK_SECRET_KEY', 'sk_test_FAKE'],
        ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_FAKE'],
      ]),
    ).toEqual(['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY']);
    expect(
      developmentKeysIn([
        ['CLERK_SECRET_KEY', 'sk_live_FAKE'],
        ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_live_FAKE'],
      ]),
    ).toEqual([]);
  });
});

describe('Clerk development keys in production', () => {
  const dev: [string, string | null][] = [
    ['CLERK_SECRET_KEY', 'sk_test_FAKE'],
    ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_FAKE'],
  ];
  const live: [string, string | null][] = [
    ['CLERK_SECRET_KEY', 'sk_live_FAKE'],
    ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_live_FAKE'],
  ];

  it('are refused unless wrangler.jsonc sets CLERK_INSTANCE to "development"', () => {
    for (const instance of [undefined, '', 'production', 'Development', true]) {
      expect(developmentKeyRefusal('production', dev, instance), String(instance)).toBe(
        'PRODUCTION_CLERK_SECRET_KEY, PRODUCTION_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY are Clerk development keys (sk_test_ or pk_test_). Production needs the production instance\'s keys, unless env.production.vars.CLERK_INSTANCE in wrangler.jsonc is "development".',
      );
    }
    expect(developmentKeyRefusal('production', [dev[1] as [string, string]], 'production')).toMatch(
      /^PRODUCTION_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is a Clerk development key/,
    );
  });

  it('are allowed when it does, and production keys always are', () => {
    expect(CLERK_DEVELOPMENT).toBe('development');
    expect(developmentKeyRefusal('production', dev, 'development')).toBeNull();
    expect(developmentKeyRefusal('production', live, undefined)).toBeNull();
    expect(developmentKeyRefusal('production', live, 'development')).toBeNull();
    // Staging and a local build never refuse: they use the development instance anyway.
    expect(developmentKeyRefusal('staging', dev, undefined)).toBeNull();
    expect(developmentKeyRefusal(undefined, dev, undefined)).toBeNull();
  });

  it("are what production is set to, by the founder's decision, and only production", () => {
    const config = readWranglerConfig();
    expect(config.env.production.vars.CLERK_INSTANCE).toBe('development');
    expect(environmentConfig('production').vars.CLERK_INSTANCE).toBe(CLERK_DEVELOPMENT);
    expect(config.env.staging.vars.CLERK_INSTANCE).toBeUndefined();
    // Production stays on workers.dev, with no custom domain.
    expect(config.env.production.name).toBe('boiler-room-web-production');
    expect(config.env.production.routes).toBeUndefined();
    expect(config.workers_dev).toBe(true);
  });

  it('get a production secret sync past the key check to the production guard, reading only PRODUCTION_ keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-clerk-'));
    const file = join(dir, 'env');
    try {
      const sync = (lines: string[]) => {
        writeFileSync(file, `${lines.join('\n')}\n`);
        const result = spawnSync(process.execPath, ['scripts/secrets-sync.mjs', 'production'], {
          cwd: new URL('..', import.meta.url),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { PATH: process.env.PATH ?? '', HOME: dir, BR_ENV_FILE: file } as Record<
            string,
            string
          > as NodeJS.ProcessEnv,
        });
        return { status: result.status, out: `${result.stdout}${result.stderr}` };
      };
      const cloudflare = [
        'CLOUDFLARE_API_TOKEN=cf_FAKE_TOKEN',
        'CLOUDFLARE_ACCOUNT_ID=0'.padEnd(54, '0'),
      ];
      // Development keys as PRODUCTION_ keys pass the Clerk check, and the guard stops a run with
      // no terminal before wrangler is ever called.
      const allowed = sync([
        ...cloudflare,
        'PRODUCTION_CLERK_SECRET_KEY=sk_test_FAKE',
        'PRODUCTION_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_FAKE',
      ]);
      expect(allowed.status).toBe(1);
      expect(allowed.out).toMatch(/no terminal and no card/);
      expect(allowed.out).not.toMatch(/Clerk development key/);
      // The unscoped keys are never read for production.
      const unscoped = sync([
        ...cloudflare,
        'CLERK_SECRET_KEY=sk_test_FAKE',
        'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_FAKE',
      ]);
      expect(unscoped.status).toBe(1);
      expect(unscoped.out).toMatch(
        /PRODUCTION_CLERK_SECRET_KEY, PRODUCTION_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY missing/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the scripts' children", () => {
  it('get PATH, HOME and a few terminal settings from this shell, then what the script hands them', () => {
    const from = {
      PATH: '/usr/bin',
      HOME: '/home/founder',
      LANG: 'C.UTF-8',
      OPENAI_API_KEY: 'sk-planted',
      STRIPE_SECRET_KEY: 'sk_live_planted',
      GITHUB_TOKEN: 'ghp_planted',
      SSH_AUTH_SOCK: '/run/agent.sock',
    };
    expect(childEnv({ CLOUDFLARE_API_TOKEN: 'cf' }, from)).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/founder',
      LANG: 'C.UTF-8',
      CLOUDFLARE_API_TOKEN: 'cf',
    });
    expect(CHILD_ENV_KEYS).not.toContain('SSH_AUTH_SOCK');
    for (const key of CHILD_ENV_KEYS) expect(key).not.toMatch(/KEY|TOKEN|SECRET|PASS|AUTH/);
  });

  it('see no other variable of this process when a script runs them', () => {
    process.env.BR_PLANTED_SECRET = 'sk_live_planted';
    try {
      const { stdout } = run(
        'node',
        ['-e', 'console.log(JSON.stringify(Object.keys(process.env)))'],
        {
          env: { BR_HANDED: '1' },
          capture: true,
        },
      );
      const keys: string[] = JSON.parse(stdout);
      expect(keys).toContain('BR_HANDED');
      expect(keys).toContain('PATH');
      expect(keys).not.toContain('BR_PLANTED_SECRET');
      expect(keys.every((key) => key === 'BR_HANDED' || CHILD_ENV_KEYS.includes(key))).toBe(true);
    } finally {
      delete process.env.BR_PLANTED_SECRET;
    }
  });
});

describe('wrangler.jsonc', () => {
  it('strips comments but keeps strings that look like comments', () => {
    expect(JSON.parse(stripJsonc('{ "a": "http://x", // c\n /* d */ "b": [1,], }'))).toEqual({
      a: 'http://x',
      b: [1],
    });
  });

  it('states every binding in both deployed environments', () => {
    const config = readWranglerConfig();
    for (const env of ['staging', 'production']) {
      const section = config.env[env];
      expect(section.name).toBe(`boiler-room-web-${env}`);
      expect(section.services).toEqual([
        { binding: 'WORKER_SELF_REFERENCE', service: `boiler-room-web-${env}` },
      ]);
      expect(section.vars.APP_ENV).toBe(env);
      // The showcase's house film is chosen by owner: every environment states the account.
      expect(typeof section.vars.BR_HOUSE_ACCOUNT_ID).toBe('string');
      expect(environmentConfig(env)).toMatchObject({
        databaseName: `boiler-room-${env}`,
        bucketName: `boiler-room-films-${env}`,
      });
    }
  });

  it('never makes simulated films in production', () => {
    expect(readWranglerConfig().env.production.vars.PIPELINE).toBe('naive');
  });

  it('runs the real-film watchdog on staging only, through the custom worker', () => {
    const config = readWranglerConfig();
    expect(config.main).toBe('worker.ts');
    expect(config.env.staging.triggers).toEqual({ crons: ['* * * * *'] });
    expect(config.env.production.triggers).toBeUndefined();
    expect(config.triggers).toBeUndefined();
    expect(config.env.staging.vars.RUNNER_PUBLIC_URL).toBe(
      'https://boiler-room-web-staging.boilerroom.workers.dev',
    );
    // Production has no real-film settings, so it keeps answering 503.
    expect(config.env.production.vars.RUNNER_SNAPSHOT_ID).toBeUndefined();
  });

  it('writes a database id into the right environment only', () => {
    const text = readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8');
    const next = replaceDatabaseId(
      text,
      'boiler-room-staging',
      '11111111-2222-4333-8444-555555555555',
    );
    const config = JSON.parse(stripJsonc(next));
    expect(config.env.staging.d1_databases[0].database_id).toBe(
      '11111111-2222-4333-8444-555555555555',
    );
    expect(config.env.production.d1_databases[0].database_id).toBe(
      readWranglerConfig().env.production.d1_databases[0].database_id,
    );
    expect(next).toContain('// Written by `pnpm web:provision:staging`');
  });
});

describe('real-film secrets', () => {
  const file = (lines: string[]) => parseEnvFile(lines.join('\n'));
  const signing = 's'.repeat(43);

  it('takes each from its STAGING_ name only, never the admin key', () => {
    const vars = file([
      'NAIVE_API_KEY=admin-FAKE',
      'STAGING_NAIVE_WEB_KEY=web-FAKE',
      `STAGING_RUNNER_SIGNING_SECRET=${signing}`,
      'STAGING_REAL_FILM_USERS=user_a,user_b',
    ]);
    expect(runnerSecretsFor(vars, 'staging')).toEqual({
      values: [
        ['NAIVE_WEB_KEY', 'web-FAKE'],
        ['RUNNER_SIGNING_SECRET', signing],
        ['REAL_FILM_USERS', 'user_a,user_b'],
      ],
      // The film command's key waits for the real film command; the stand-in needs none.
      skipped: ['STAGING_NAIVE_RUNNER_KEY'],
      problems: [],
    });
    // The unscoped admin key never stands in for the website's key.
    const onlyAdmin = runnerSecretsFor(
      file(['NAIVE_API_KEY=admin-FAKE', `STAGING_RUNNER_SIGNING_SECRET=${signing}`]),
      'staging',
    );
    expect(onlyAdmin.problems).toEqual(['STAGING_NAIVE_WEB_KEY is missing']);
    const same = runnerSecretsFor(
      file([
        'NAIVE_API_KEY=same-FAKE',
        'STAGING_NAIVE_WEB_KEY=same-FAKE',
        `STAGING_RUNNER_SIGNING_SECRET=${signing}`,
      ]),
      'staging',
    );
    expect(same.problems[0]).toContain('is the admin key');
  });

  it('leaves real films off when none is set, and sets none in production', () => {
    expect(runnerSecretsFor(file(['NAIVE_API_KEY=admin-FAKE']), 'staging')).toMatchObject({
      values: [],
      problems: [],
    });
    const everything = file([
      'STAGING_NAIVE_WEB_KEY=web-FAKE',
      `STAGING_RUNNER_SIGNING_SECRET=${signing}`,
    ]);
    expect(runnerSecretsFor(everything, 'production')).toEqual({
      values: [],
      skipped: [],
      problems: [],
    });
    // The founders list may wait; the key and the signing secret may not.
    expect(runnerSecretsFor(everything, 'staging')).toMatchObject({
      skipped: ['STAGING_REAL_FILM_USERS', 'STAGING_NAIVE_RUNNER_KEY'],
      problems: [],
    });
    expect(
      runnerSecretsFor(
        file(['STAGING_NAIVE_WEB_KEY=web-FAKE', 'STAGING_RUNNER_SIGNING_SECRET=short']),
        'staging',
      ).problems,
    ).toEqual(['STAGING_RUNNER_SIGNING_SECRET is shorter than 32 characters.']);
  });

  it('accepts only a website key with exactly computers:write and billing:read', async () => {
    expect(scopesMatch(['computers:write', 'billing:read'])).toBe(true);
    expect(scopesMatch(['computers:write'])).toBe(false);
    expect(scopesMatch(['computers:write', 'billing:read', 'admin'])).toBe(false);
    const answer = (scopes: string[], status = 200) =>
      (async () => new Response(JSON.stringify({ scopes }), { status })) as unknown as typeof fetch;
    expect(
      await checkWebKey('k', { fetch: answer(['billing:read', 'computers:write']) }),
    ).toBeNull();
    expect(await checkWebKey('k', { fetch: answer(['admin']) })).toContain('exactly');
    expect(await checkWebKey('k', { fetch: answer([], 401) })).toContain('refused');
  });
});

describe('minting the real-film keys', () => {
  it('sets a line where it is, or appends it, and keeps every other line', () => {
    const text = '# keys\nNAIVE_API_KEY=admin\nSTAGING_NAIVE_WEB_KEY=old\nOTHER=1';
    expect(upsertEnvLine(text, 'STAGING_NAIVE_WEB_KEY', 'new')).toBe(
      '# keys\nNAIVE_API_KEY=admin\nSTAGING_NAIVE_WEB_KEY=new\nOTHER=1',
    );
    expect(upsertEnvLine(text, 'STAGING_RUNNER_SIGNING_SECRET', 'abc')).toBe(
      `${text}\nSTAGING_RUNNER_SIGNING_SECRET=abc\n`,
    );
    expect(() => upsertEnvLine(text, 'X', 'has space')).toThrow();
  });

  it('makes a signing secret long enough for the website and the runner', () => {
    const secret = newSigningSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(newSigningSecret()).not.toBe(secret);
  });

  it('mints the website exactly the scopes the sync checks for, and the runner no computers', () => {
    expect(scopesMatch(WEB_KEY_SCOPES)).toBe(true);
    expect(RUNNER_KEY_SCOPES).not.toContain('computers:write');
    expect(RUNNER_KEY_SCOPES).not.toContain('agents:write');
    expect(RUNNER_KEY_SCOPES).not.toContain('admin');
  });

  it('probes every Naive call the website makes for a film', () => {
    const source = readFileSync(join(__dirname, '../src/server/runner/naive-api.ts'), 'utf8');
    const iface = source.slice(source.indexOf('export interface NaiveApi'));
    const calls = [...iface.slice(0, iface.indexOf('\n}')).matchAll(/^ {2}(\w+)\(/gm)].map(
      (match) => match[1],
    );
    expect([...PROBE_CALLS].sort()).toEqual(calls.sort());
  });

  it('refuses a runner key that is the admin or the website key, or holds computers', async () => {
    const vars = parseEnvFile(
      [
        'NAIVE_API_KEY=admin',
        'STAGING_NAIVE_WEB_KEY=web',
        `STAGING_RUNNER_SIGNING_SECRET=${'s'.repeat(40)}`,
        'STAGING_NAIVE_RUNNER_KEY=admin',
      ].join('\n'),
    );
    expect(runnerSecretsFor(vars, 'staging').problems.join(' ')).toContain('admin key');
    vars.set('STAGING_NAIVE_RUNNER_KEY', 'web');
    expect(runnerSecretsFor(vars, 'staging').problems.join(' ')).toContain('website key');
    vars.set('STAGING_NAIVE_RUNNER_KEY', 'runner');
    expect(runnerSecretsFor(vars, 'staging')).toMatchObject({ problems: [] });
    const answer = (scopes: string[]) => async () =>
      new Response(JSON.stringify({ scopes }), { status: 200 });
    expect(
      await checkRunnerKey('k', { fetch: answer(['sessions:write', 'computers:write']) }),
    ).toContain('computers:write');
    expect(await checkRunnerKey('k', { fetch: answer(['sessions:write']) })).toBeNull();
  });
});

describe('the deploy check on the runner contract', () => {
  const contract = 'export const CONTRACT_VERSION = 1;\n';
  const vars = { RUNNER_SNAPSHOT_ID: 'snp_abc', RUNNER_COMMIT: 'a'.repeat(40) };

  it('passes when the snapshot’s runner was built with the contract being deployed', () => {
    expect(contractDrift(vars, contract, () => contract.trimEnd())).toBeNull();
    expect(contractDrift({}, contract, () => null)).toBeNull();
  });

  it('refuses a contract the snapshot’s runner does not have, or a snapshot with no commit', () => {
    expect(contractDrift(vars, contract, () => 'export const CONTRACT_VERSION = 2;')).toContain(
      'Rebuild the snapshot',
    );
    expect(contractDrift({ RUNNER_SNAPSHOT_ID: 'snp_abc' }, contract, () => contract)).toContain(
      'RUNNER_COMMIT',
    );
    expect(contractDrift(vars, contract, () => null)).toContain('git fetch');
  });
});
