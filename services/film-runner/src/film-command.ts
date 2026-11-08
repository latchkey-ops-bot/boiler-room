/**
 * Which film command the runner starts, and how. The runner only knows the contract
 * (`filmCommandArgs`); this file maps it onto a program:
 *
 * - `film`: `pnpm run film <args>` in the crew checkout at the pinned commit. The real crew.
 * - `standin`: `node standin/film.ts <args>` from this package. It takes the same arguments, writes
 *   the same events and files, and makes no film: see `standin/film.ts`. It exists until the film
 *   command on `feat/crew-agents` has the `--phase` split and the events hook.
 *
 * The adapter is fixed when the base snapshot is built (`~/.film-runner.json`), never chosen by a
 * request, and the runner names it in `runner.hello` so the website can label a stand-in film.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS, type Adapter, type FilmCommandInput, filmCommandArgs } from './contract.ts';

export interface RunnerConfig {
  adapter: Adapter;
  /** The commit of this package's checkout on the computer. */
  runnerCommit: string;
  /** The commit of the crew checkout the film command runs from. */
  filmCommit: string;
  /** The crew checkout. */
  filmDir: string;
  /** Turned on at every start, in case a fork booted with swap off. */
  swapfile: string | null;
  /**
   * The env file the film command reads its Naive key from (`BOILER_ROOM_ENV`). The base snapshot
   * holds none: the runner points this at the launch's own key file, `<runDir>/naive.env`.
   */
  envFile: string;
  /** The stand-in's pause between steps. */
  standinPaceMs?: number;
}

export const STANDIN_PATH = fileURLToPath(new URL('../standin/film.ts', import.meta.url));
export const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

export function defaultConfigPath(): string {
  return process.env.FILM_RUNNER_CONFIG ?? join(homedir(), '.film-runner.json');
}

export function readConfig(path = defaultConfigPath()): RunnerConfig {
  if (!existsSync(path)) throw new Error(`${path} is missing. The base snapshot writes it.`);
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<RunnerConfig>;
  const problems: string[] = [];
  if (!ADAPTERS.includes(value.adapter as Adapter)) problems.push('adapter');
  if (typeof value.runnerCommit !== 'string') problems.push('runnerCommit');
  if (typeof value.filmCommit !== 'string') problems.push('filmCommit');
  if (typeof value.filmDir !== 'string' || !value.filmDir.startsWith('/')) problems.push('filmDir');
  if (value.swapfile !== null && typeof value.swapfile !== 'string') problems.push('swapfile');
  if (typeof value.envFile !== 'string') problems.push('envFile');
  if (problems.length > 0) throw new Error(`${path} is not valid: ${problems.join(', ')}`);
  return value as RunnerConfig;
}

export interface FilmCommandSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export function filmCommandSpec(config: RunnerConfig, input: FilmCommandInput): FilmCommandSpec {
  const args = filmCommandArgs(input);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? homedir(),
    LANG: process.env.LANG ?? 'C.UTF-8',
    BOILER_ROOM_ENV: config.envFile,
    CI: '1',
    NODE_ENV: 'production',
    INIT_CWD: config.filmDir,
  };
  if (config.adapter === 'film') {
    return {
      command: 'pnpm',
      args: ['run', '--silent', 'film', ...args],
      cwd: config.filmDir,
      env,
    };
  }
  return {
    command: process.execPath,
    args: [STANDIN_PATH, ...args],
    cwd: PACKAGE_DIR,
    env: { ...env, STANDIN_PACE_MS: String(config.standinPaceMs ?? 2000) },
  };
}
