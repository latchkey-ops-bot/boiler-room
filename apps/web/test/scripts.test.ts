import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { developmentKeysIn, parseEnvFile, valueFor } from '../scripts/lib/env.mjs';
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
