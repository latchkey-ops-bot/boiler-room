import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { developmentKeysIn, parseEnvFile, valueFor } from '../scripts/lib/env.mjs';
import {
  newSigningSecret,
  PROBE_CALLS,
  RUNNER_KEY_SCOPES,
  upsertEnvLine,
  WEB_KEY_SCOPES,
} from '../scripts/lib/runner-keys.mjs';
import { IMAGE_CALL, probeRunnerKey, RUNNER_PROBE_CALLS } from '../scripts/lib/runner-probe.mjs';
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

  it('lets a founder make two real films a day on staging, and one more film run beside them', () => {
    const vars = readWranglerConfig().env.staging.vars;
    const film = Number(vars.FILM_CAP_USD);
    const account = Number(vars.ACCOUNT_DAILY_CAP_USD);
    const global = Number(vars.GLOBAL_DAILY_CAP_USD);
    // A 16:9 film: about $1.30 for the script, $1.00 for the render, Opus rounds on top.
    expect(film).toBeGreaterThanOrEqual(2.3 * 2);
    expect(Number(vars.FILM_COMPUTE_RESERVE_USD)).toBeLessThan(film);
    // A film at work counts at its whole cap (caps.ts): two fit the founder's day, three staging's.
    expect(2 * film).toBeLessThanOrEqual(account);
    expect(3 * film).toBeLessThanOrEqual(global);
    expect(global).toBeGreaterThanOrEqual(account);
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
      // The film command's key waits for the real film command; the stand-in needs none. The GTM
      // token waits for GTM.
      skipped: ['STAGING_NAIVE_RUNNER_KEY', 'STAGING_GTM_SERVICE_TOKEN'],
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
      skipped: ['STAGING_REAL_FILM_USERS', 'STAGING_NAIVE_RUNNER_KEY', 'STAGING_GTM_SERVICE_TOKEN'],
      problems: [],
    });
    expect(
      runnerSecretsFor(
        file(['STAGING_NAIVE_WEB_KEY=web-FAKE', 'STAGING_RUNNER_SIGNING_SECRET=short']),
        'staging',
      ).problems,
    ).toEqual(['STAGING_RUNNER_SIGNING_SECRET is shorter than 32 characters.']);
  });

  it('syncs the GTM service token from its STAGING_ name, long and not shared with another secret', () => {
    const gtm = 'g'.repeat(64);
    const base = ['STAGING_NAIVE_WEB_KEY=web-FAKE', `STAGING_RUNNER_SIGNING_SECRET=${signing}`];
    expect(
      runnerSecretsFor(file([...base, `STAGING_GTM_SERVICE_TOKEN=${gtm}`]), 'staging').values,
    ).toContainEqual(['GTM_SERVICE_TOKEN', gtm]);
    // The executor's own copy, GTM_SERVICE_TOKEN, is never what the sync reads.
    expect(
      runnerSecretsFor(file([...base, `GTM_SERVICE_TOKEN=${gtm}`]), 'staging').values,
    ).not.toContainEqual(['GTM_SERVICE_TOKEN', gtm]);
    expect(
      runnerSecretsFor(file([...base, 'STAGING_GTM_SERVICE_TOKEN=short']), 'staging').problems,
    ).toEqual(['STAGING_GTM_SERVICE_TOKEN is shorter than 32 characters.']);
    expect(
      runnerSecretsFor(file([...base, `STAGING_GTM_SERVICE_TOKEN=${signing}`]), 'staging').problems,
    ).toEqual(['STAGING_GTM_SERVICE_TOKEN reuses another secret. It is its own.']);
    expect(
      runnerSecretsFor(file([`STAGING_GTM_SERVICE_TOKEN=${gtm}`]), 'production').values,
    ).toEqual([]);
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

  it('mints the website and the runner exactly the scopes the sync checks for', () => {
    expect(scopesMatch(WEB_KEY_SCOPES)).toBe(true);
    expect([...RUNNER_KEY_SCOPES].sort()).toEqual([
      'agents:read',
      'billing:read',
      'computers:write',
      'files:read',
      'files:write',
      'sessions:read',
      'sessions:write',
    ]);
    expect(scopesMatch(RUNNER_KEY_SCOPES, RUNNER_KEY_SCOPES)).toBe(true);
    // The film command runs --no-sync, and image generation needing agents:write is non-fatal.
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

  it('refuses a runner key that is the admin or the website key, or not exactly its scopes', async () => {
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
      await checkRunnerKey('k', { fetch: answer([...RUNNER_KEY_SCOPES].reverse()) }),
    ).toBeNull();
    // One more scope is refused, and so is one fewer: the film would stop part way.
    expect(
      await checkRunnerKey('k', { fetch: answer([...RUNNER_KEY_SCOPES, 'agents:write']) }),
    ).toContain('also holds agents:write');
    expect(
      await checkRunnerKey('k', {
        fetch: answer(RUNNER_KEY_SCOPES.filter((scope) => scope !== 'files:write')),
      }),
    ).toContain('lacks files:write');
    expect(await checkRunnerKey('k', { fetch: answer(['admin']) })).toContain('exactly');
  });
});

describe('the runner key probe', () => {
  const RESEARCHER_COMPUTER = 'cmp_researcher';

  /** Naive as the probe sees it: br-researcher with a paused computer, and a key's scopes. */
  function fakeNaive({
    live = [] as string[],
    refuse = [] as string[],
    pauseRefusals = 1,
    images = 403,
  } = {}) {
    let computer = 'paused';
    let uploaded = '';
    let pauses = 0;
    const calls: string[] = [];
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const notFound = () => json({ error: { type: 'not_found', message: 'no such thing' } }, 404);
    const fetch = (async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? 'GET';
      const path = url.pathname;
      const route = `${method} ${path}`;
      calls.push(`${route}${url.search}`);
      if (refuse.some((prefix) => route.startsWith(prefix)))
        return json({ error: { type: 'permission', message: 'missing a scope' } }, 403);
      if (route === 'GET /v1/me') return json({ scopes: [...RUNNER_KEY_SCOPES] });
      if (route === 'GET /v1/credits/balance') return json({ balance_micro_usd: 5_000_000 });
      if (route === 'GET /v1/agents')
        return json({
          data: [{ id: 'agt_r', name: 'br-researcher', skills: ['site-research@10'] }],
        });
      if (route === 'GET /v1/skills/site-research/versions') return json({ data: [] });
      if (route === 'GET /v1/agents/agt_r/computer')
        return json({ id: RESEARCHER_COMPUTER, status: computer });
      if (route === 'GET /v1/agents/agt_r/spend') return json({ spent_micro_usd: 0 });
      if (route === 'GET /v1/sessions') {
        const status = url.searchParams.get('status');
        if (status) return json({ data: status === 'running' ? live.map((id) => ({ id })) : [] });
        return json({ data: [{ id: 'ses_last' }] });
      }
      if (route === 'GET /v1/sessions/ses_last') return json({ id: 'ses_last', last_seq: 9 });
      if (route === 'GET /v1/sessions/ses_last/stream')
        return new Response('data: {"seq":9,"type":"session.idle"}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        });
      if (route === 'GET /v1/computers') return json({ data: [] });
      if (route === `GET /v1/computers/${RESEARCHER_COMPUTER}`)
        return json({ id: RESEARCHER_COMPUTER, status: computer });
      if (route === 'GET /v1/files') return json({ data: [] });
      if (route === 'POST /v1/files') {
        uploaded = await ((init.body as FormData).get('file') as Blob).text();
        return json({ id: 'fil_probe' });
      }
      if (route === 'GET /v1/files/fil_probe')
        return url.searchParams.get('download')
          ? new Response(uploaded)
          : json({ id: 'fil_probe' });
      if (route === 'DELETE /v1/files/fil_probe') return json({ deleted: true });
      if (route === `POST /v1/computers/${RESEARCHER_COMPUTER}/resume`) {
        computer = 'running';
        return json({ status: computer });
      }
      if (route === `POST /v1/computers/${RESEARCHER_COMPUTER}/exec`)
        return json({ stdout: 'keyprobe\n', stderr: '', exit_code: 0 });
      if (route === `POST /v1/computers/${RESEARCHER_COMPUTER}/pause`) {
        pauses += 1;
        if (pauses <= pauseRefusals)
          return json({ error: { message: 'try again when it rests' } }, 409);
        computer = 'paused';
        return json({ status: computer });
      }
      if (route === 'POST /v1/media/images')
        return images === 403
          ? json({ error: { type: 'permission', message: 'missing `agents:write`' } }, 403)
          : json({ error: { message: 'no image model' } }, 400);
      return notFound();
    }) as unknown as typeof globalThis.fetch;
    return { fetch, calls, computer: () => computer };
  }

  const probe = (naive: ReturnType<typeof fakeNaive>) =>
    probeRunnerKey('k', { fetch: naive.fetch, sleep: async () => {} });

  it('makes every call the film command makes, and leaves the computer paused', async () => {
    const naive = fakeNaive();
    const result = await probe(naive);
    expect(result.missing).toEqual([]);
    expect(result.left).toEqual([]);
    expect(result.results.map((each) => each.call).sort()).toEqual(
      RUNNER_PROBE_CALLS.map((each) => each.call).sort(),
    );
    expect(result.results.find((each) => each.call === 'computers.exec')?.how).toBe('real');
    expect(naive.computer()).toBe('paused');
    // Image generation refused: reported, not a failure.
    expect(result.images).toMatchObject({ call: 'media.images', status: 403, available: false });
    // Nothing that spends is made for real: no session, and the image model does not exist.
    expect(naive.calls).toContain('POST /v1/sessions');
    expect(result.results.find((each) => each.call === 'sessions.create')?.how).toBe('scope');
  });

  it('says when the key may generate images', async () => {
    const result = await probe(fakeNaive({ images: 400 }));
    expect(result.images).toMatchObject({ status: 400, available: true });
  });

  it('never touches the Researcher computer while one of its sessions is live', async () => {
    const naive = fakeNaive({ live: ['ses_busy'] });
    const result = await probe(naive);
    expect(result.missing).toEqual([]);
    expect(naive.calls.some((call) => call.includes(`/v1/computers/${RESEARCHER_COMPUTER}/`))).toBe(
      false,
    );
    expect(result.results.find((each) => each.call === 'computers.resume')).toMatchObject({
      ok: true,
      how: 'scope',
    });
  });

  it('names each call the key may not make', async () => {
    const result = await probe(fakeNaive({ refuse: ['POST /v1/sessions', 'DELETE /v1/files'] }));
    expect(result.missing).toEqual([
      'sessions.create',
      'sessions.send',
      'sessions.interrupt',
      'sessions.cancel',
      'files.delete',
    ]);
    // The file it could not delete is named, to be deleted by hand.
    expect(result.left).toEqual(['file fil_probe']);
  });

  it('covers every scope the runner key holds, and image generation needs one it does not', () => {
    const scopes = new Set(RUNNER_PROBE_CALLS.map((each) => each.scope).filter(Boolean));
    expect([...scopes].sort()).toEqual([...RUNNER_KEY_SCOPES].sort());
    expect(RUNNER_KEY_SCOPES).not.toContain(IMAGE_CALL.scope);
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
