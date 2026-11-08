import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  CARD_ID,
  liveVersionId,
  migrationsPending,
  productionDecision,
  RELEASE_ACTIONS,
  releaseCardArg,
  scriptArgs,
  settleRelease,
} from '../scripts/lib/env.mjs';

/**
 * The production guard. A person types "production" at a terminal; the release agent, which has
 * none, names its RELEASE card with --release-card. Every way the release path can be refused is
 * here, because each one stands between an agent and production.
 */
const CARD = 'crd_3vf7s37y06waz86md8eza6qdwb';
const MAIN = 'a'.repeat(40);
const clean = { dirty: false, head: MAIN, mainTip: MAIN };
const argv = (...args: string[]) => ['node', 'scripts/deploy.mjs', ...args];
const release = (overrides: Record<string, unknown> = {}) =>
  productionDecision({
    env: 'production',
    step: 'deploy',
    card: CARD,
    tree: clean,
    isTTY: false,
    ...overrides,
  });

describe('script arguments', () => {
  it('reads positionals and flags, a value flag with a space or an equals sign', () => {
    expect(scriptArgs(argv('production', '--release-card', CARD, '--any-commit'))).toEqual({
      positionals: ['production'],
      flags: { 'release-card': CARD, 'any-commit': true },
    });
    expect(scriptArgs(argv('production', `--release-card=${CARD}`)).flags['release-card']).toBe(
      CARD,
    );
  });

  it('keeps a rollback version id positional when a card follows it or comes first', () => {
    expect(
      scriptArgs(['node', 'rollback.mjs', 'production', 'ver-1', '--release-card', CARD])
        .positionals,
    ).toEqual(['production', 'ver-1']);
    expect(
      scriptArgs(['node', 'rollback.mjs', 'production', '--release-card', CARD, 'ver-1'])
        .positionals,
    ).toEqual(['production', 'ver-1']);
  });

  it('gives a value flag with nothing after it an empty value, never the next flag', () => {
    expect(scriptArgs(argv('production', '--release-card', '--any-commit')).flags).toEqual({
      'release-card': '',
      'any-commit': true,
    });
  });
});

describe('the release card', () => {
  it('is absent unless the flag is given', () => {
    expect(releaseCardArg(argv('production'))).toEqual({ card: null });
  });

  it('accepts a board card id', () => {
    expect(releaseCardArg(argv('production', '--release-card', CARD))).toEqual({ card: CARD });
    expect(CARD_ID.test(CARD)).toBe(true);
  });

  it.each([
    ['no value', []],
    ['an empty value', ['']],
    ['a board id', ['brd_cnhxa0xec3x849vqyv9awe1da2']],
    ['a deployment id', ['dep_3vf7s37y06waz86md8eza6qdwb']],
    ['upper case', ['crd_ABCDEFGHIJ']],
    ['a shell word', ['crd_abcdefgh;rm']],
    ['a prefix alone', ['crd_']],
    ['the word yes', ['yes']],
  ])('refuses %s', (_name, value) => {
    const result = releaseCardArg(argv('production', '--release-card', ...value));
    expect(result.card).toBeNull();
    expect(result.refusal).toMatch(/--release-card needs the RELEASE card's id/);
  });
});

describe('productionDecision', () => {
  it('asks nothing outside production', () => {
    expect(productionDecision({ env: 'staging', step: 'deploy', isTTY: false })).toEqual({
      mode: 'none',
    });
  });

  it('keeps the terminal confirmation for a person', () => {
    expect(productionDecision({ env: 'production', step: 'deploy', isTTY: true })).toEqual({
      mode: 'confirm',
    });
  });

  it('lets the release agent deploy from a clean tree at origin/main, with no terminal', () => {
    expect(release()).toEqual({ mode: 'release', card: CARD });
    expect(release({ step: 'migrate' })).toEqual({ mode: 'release', card: CARD });
  });

  it('lets the release agent roll back without checking the tree, so a rollback is never stuck', () => {
    expect(release({ step: 'rollback', tree: undefined })).toEqual({ mode: 'release', card: CARD });
    expect(RELEASE_ACTIONS).toEqual({ deploy: true, migrate: true, rollback: false });
  });

  it('refuses production with no terminal and no card', () => {
    expect(productionDecision({ env: 'production', step: 'deploy', isTTY: false })).toMatchObject({
      mode: 'refuse',
      reason: expect.stringMatching(/no terminal and no card/),
    });
  });

  it('refuses a malformed card before anything else', () => {
    const refusal = releaseCardArg(argv('production', '--release-card', 'nope')).refusal;
    expect(release({ card: null, refusal })).toMatchObject({
      mode: 'refuse',
      reason: expect.stringMatching(/needs the RELEASE card's id/),
    });
    // A person at a terminal does not get past a bad card either.
    expect(release({ card: null, refusal, isTTY: true }).mode).toBe('refuse');
  });

  it('refuses a card outside production', () => {
    expect(release({ env: 'staging' })).toMatchObject({
      mode: 'refuse',
      reason: expect.stringMatching(/production only/),
    });
  });

  it.each(['provision', 'secrets', 'toString', undefined])(
    "refuses a card for %s, which stays the founder's at a terminal",
    (step) => {
      expect(release({ step })).toMatchObject({
        mode: 'refuse',
        reason: expect.stringMatching(/covers deploy, migrate, rollback only/),
      });
    },
  );

  it.each(['deploy', 'migrate'])('refuses %s from a dirty tree', (step) => {
    expect(release({ step, tree: { ...clean, dirty: true } })).toMatchObject({
      mode: 'refuse',
      reason: expect.stringMatching(/clean tree/),
    });
  });

  it.each(['deploy', 'migrate'])('refuses %s when HEAD is not origin/main', (step) => {
    expect(release({ step, tree: { ...clean, head: 'b'.repeat(40) } })).toMatchObject({
      mode: 'refuse',
      reason: expect.stringMatching(/is not origin\/main/),
    });
  });

  it('refuses when origin/main cannot be read', () => {
    expect(release({ tree: { ...clean, mainTip: null } })).toMatchObject({
      mode: 'refuse',
      reason: expect.stringMatching(/origin\/main could not be read/),
    });
  });

  it('refuses when the tree was not read at all', () => {
    expect(release({ tree: undefined })).toMatchObject({ mode: 'refuse' });
  });

  it('turns on only with the flag: no environment variable skips the guard', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../scripts/lib/env.mjs', import.meta.url),
      'utf8',
    );
    const guard = source.slice(source.indexOf('export function productionDecision'));
    expect(guard.slice(0, guard.indexOf('export function migrationsPending'))).not.toMatch(
      /process\.env/,
    );
  });
});

describe('migrations first', () => {
  it('refuses a deploy while wrangler lists migrations to apply', () => {
    expect(migrationsPending('Migrations to be applied:\n│ 0003_films.sql │')).toBe(true);
    expect(migrationsPending('')).toBe(true);
    expect(migrationsPending('✅ No migrations to apply!')).toBe(false);
  });
});

describe('the version a release rolls back to', () => {
  it('is the one serving traffic before the deploy', () => {
    const status = JSON.stringify({
      id: 'e47341a1',
      versions: [{ version_id: '4722096b-6084-4f6d-9cb2-a82931d9a445', percentage: 100 }],
    });
    expect(liveVersionId(status)).toBe('4722096b-6084-4f6d-9cb2-a82931d9a445');
  });

  it('is the larger share of a split deployment', () => {
    const status = JSON.stringify({
      versions: [
        { version_id: 'small', percentage: 10 },
        { version_id: 'large', percentage: 90 },
      ],
    });
    expect(liveVersionId(status)).toBe('large');
  });

  it('is null when there is no deployment yet or the output is not JSON', () => {
    expect(liveVersionId('')).toBeNull();
    expect(liveVersionId('✘ [ERROR] This Worker does not exist on your account.')).toBeNull();
    expect(liveVersionId('{"versions":[]}')).toBeNull();
  });
});

describe('settleRelease', () => {
  const url = 'https://boiler-room-web-production.boilerroom.workers.dev';

  it('ends a release whose smoke check passed, and rolls nothing back', async () => {
    const rollBack = vi.fn();
    const outcome = await settleRelease({
      smokeOk: true,
      url,
      previous: 'v1',
      rollBack,
      smokeAgain: vi.fn(),
    });
    expect(outcome).toMatchObject({ ok: true, rolledBack: false });
    expect(rollBack).not.toHaveBeenCalled();
  });

  it('rolls back to the version live before, checks it, and still fails the release', async () => {
    const rollBack = vi.fn(async () => true);
    const smokeAgain = vi.fn(async () => true);
    const outcome = await settleRelease({
      smokeOk: false,
      url,
      previous: 'v1',
      rollBack,
      smokeAgain,
    });
    expect(rollBack).toHaveBeenCalledWith('v1');
    expect(smokeAgain).toHaveBeenCalledOnce();
    expect(outcome).toMatchObject({ ok: false, rolledBack: true });
    expect(outcome.message).toMatch(/Rolled production back to v1, whose smoke check passed/);
  });

  it('says when the version it rolled back to fails its smoke check too', async () => {
    const outcome = await settleRelease({
      smokeOk: false,
      url,
      previous: 'v1',
      rollBack: async () => true,
      smokeAgain: async () => false,
    });
    expect(outcome.message).toMatch(/also failed/);
  });

  it('rolls back when there was no URL to smoke check', async () => {
    const rollBack = vi.fn(async () => true);
    const outcome = await settleRelease({
      smokeOk: true,
      url: undefined,
      previous: 'v1',
      rollBack,
      smokeAgain: vi.fn(),
    });
    expect(rollBack).toHaveBeenCalledWith('v1');
    expect(outcome).toMatchObject({ ok: false, rolledBack: true });
    expect(outcome.message).toMatch(/no URL was found/);
  });

  it('fails loudly when production had no earlier version to go back to', async () => {
    const rollBack = vi.fn();
    const outcome = await settleRelease({
      smokeOk: false,
      url,
      previous: null,
      rollBack,
      smokeAgain: vi.fn(),
    });
    expect(rollBack).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: false, rolledBack: false });
    expect(outcome.message).toMatch(/no earlier version to roll back to/);
  });

  it('fails loudly, naming the command, when the rollback itself fails', async () => {
    const outcome = await settleRelease({
      smokeOk: false,
      url,
      previous: 'v1',
      rollBack: async () => false,
      smokeAgain: vi.fn(),
    });
    expect(outcome).toMatchObject({ ok: false, rolledBack: false });
    expect(outcome.message).toMatch(/rollback to v1 failed.*pnpm web:rollback:production v1/);
  });
});

describe('guardProduction, run as the scripts run it', () => {
  /** Runs guardProduction in a child process with no terminal, as an agent's bash does. */
  const guard = (env: string, step: string, ...args: string[]) => {
    const code = `const { guardProduction } = await import('./scripts/lib/env.mjs');
      const card = await guardProduction(${JSON.stringify(env)}, 'test', { step: ${JSON.stringify(step)}, argv: ${JSON.stringify(argv(env, ...args))} });
      console.log('WENT_ON', card);`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  };

  it('stops production with no terminal and no card, and changes nothing', () => {
    const result = guard('production', 'deploy');
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/no terminal and no card/);
    expect(result.out).not.toContain('WENT_ON');
  });

  it('stops a malformed card', () => {
    const result = guard('production', 'rollback', '--release-card', 'RELEASE');
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/needs the RELEASE card's id/);
  });

  it('stops a card on provisioning', () => {
    const result = guard('production', 'provision', '--release-card', CARD);
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/founder's, at a terminal/);
  });

  it('lets a rollback on a card go on with no terminal', () => {
    const result = guard('production', 'rollback', '--release-card', CARD);
    expect(result.status).toBe(0);
    expect(result.out).toContain(`WENT_ON ${CARD}`);
  });

  it('lets staging go on with no terminal', () => {
    expect(guard('staging', 'deploy').out).toContain('WENT_ON null');
  });
});
