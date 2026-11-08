import type { Db } from '../../db/client.ts';
import { type RunnerBindings, runnerConfig } from './config.ts';
import { HttpNaiveApi, type NaiveApi } from './naive-api.ts';
import type { RunnerDeps } from './runs.ts';

/** The bindings the runner code reads: D1, R2 and the real-film vars and secrets. */
export interface RunnerEnv extends RunnerBindings {
  DB: D1Database;
  FILMS: R2Bucket;
}

/** What a request runs in, beyond the bindings. Tests pass a fake Naive and collect `waitUntil`. */
export interface RunnerRuntime {
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Overrides the Naive client built from `NAIVE_WEB_KEY`. */
  naive?: NaiveApi | null;
  log?: (line: string) => void;
}

/** The runner's deps from the bindings: the Naive client is built only when the key is set. */
export function runnerDeps(
  bindings: RunnerEnv,
  db: Db,
  clock: () => Date,
  runtime: RunnerRuntime = {},
): RunnerDeps {
  const config = runnerConfig(bindings);
  const naive =
    runtime.naive !== undefined
      ? runtime.naive
      : config.naiveKey
        ? new HttpNaiveApi({ key: config.naiveKey, baseUrl: config.naiveApiUrl })
        : null;
  return {
    db,
    films: bindings.FILMS,
    naive,
    config,
    now: clock,
    waitUntil:
      runtime.waitUntil ??
      ((promise) => {
        promise.catch((error: unknown) => console.error('Background step failed', error));
      }),
    log: runtime.log,
  };
}
