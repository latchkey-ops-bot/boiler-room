import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { developmentKeysIn, parseEnvFile, valueFor } from '../scripts/lib/env.mjs';
import { checkWebKey, runnerSecretsFor, scopesMatch } from '../scripts/lib/runner-secrets.mjs';
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
      skipped: [],
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
      skipped: ['STAGING_REAL_FILM_USERS'],
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
