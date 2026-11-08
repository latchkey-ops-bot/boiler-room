import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Bootstrap, deriveRunKey, type Instructions } from '../src/contract.ts';
import type { RunnerConfig } from '../src/film-command.ts';

export const MASTER = 'test-master-secret-0123456789abcdefghijklmnop';
export const FILM_ID = 'flm_4k8d2m7q9x1z3c5v6b8n';
export const RUN_ID = 'run_7w2e4r6t8y1u3i5o7p9a';

export function tempDir(prefix = 'film-runner-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export async function writeBootstrapFile(
  runDir: string,
  callbackBase: string,
  overrides: Partial<Bootstrap> = {},
  master = MASTER,
): Promise<Bootstrap> {
  mkdirSync(runDir, { recursive: true });
  const bootstrap: Bootstrap = {
    v: 1,
    filmId: FILM_ID,
    runId: RUN_ID,
    callbackBase,
    key: await deriveRunKey(master, FILM_ID, RUN_ID),
    issuedAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  writeFileSync(join(runDir, 'bootstrap.json'), JSON.stringify(bootstrap));
  return bootstrap;
}

export function standinConfig(dir: string, overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    adapter: 'standin',
    runnerCommit: 'a'.repeat(40),
    filmCommit: 'b'.repeat(40),
    filmDir: dir,
    swapfile: null,
    envFile: join(dir, 'no-such.env'),
    standinPaceMs: 0,
    ...overrides,
  };
}

export function instructionsFor(
  phase: Instructions['phase'],
  overrides: Partial<Instructions> = {},
): Instructions {
  return {
    phase,
    mode: phase === 'all' ? 'sample' : 'customer',
    url: 'https://linear.app/',
    scriptVersion: phase === 'render' ? 1 : 0,
    approval:
      phase === 'render'
        ? {
            version: 1,
            hookId: null,
            ctaId: 'start-free',
            formats: ['16:9', '9:16'],
            confirmedClaimIds: ['pricing'],
          }
        : null,
    revise: null,
    maxCrewUsd: 2,
    spentCrewUsd: 0,
    deadlineAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    stop: false,
    ...overrides,
  };
}
