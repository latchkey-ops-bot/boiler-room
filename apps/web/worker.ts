// The Worker's entry: the runner's signed routes, then OpenNext's generated fetch handler for
// everything else, plus a cron for the real-film watchdog.
//
// The runner's routes are served here, before OpenNext, because OpenNext's converter reads every
// non-GET body whole into memory before routing: an upload must stream into R2 instead
// (src/server/runner/worker-routes.ts). Every other request with a body is bounded first, for the
// same reason.
// biome-ignore lint/suspicious/noTsIgnore: the file exists after a build and not before, so expect-error would fail one of the two
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from './.open-next/worker.js';
import { RUNNER_BASE_PATH, signWatchdog } from './src/server/runner/contract.ts';
import type { RunnerEnv } from './src/server/runner/deps.ts';
import { boundAppRequest, isRunnerPath, runnerFetch } from './src/server/runner/worker-routes.ts';

interface Env extends RunnerEnv {
  WORKER_SELF_REFERENCE: { fetch(input: string, init: RequestInit): Promise<Response> };
  RUNNER_SIGNING_SECRET?: string;
  RUNNER_PUBLIC_URL?: string;
}

interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> | Response {
    if (isRunnerPath(new URL(request.url).pathname)) return runnerFetch(request, env, ctx);
    const bounded = boundAppRequest(request);
    if (bounded instanceof Response) return bounded;
    return handler.fetch(bounded, env, ctx);
  },

  /** Every minute on staging (`triggers.crons`). Production has no cron until it is released. */
  async scheduled(controller: { scheduledTime: number }, env: Env, ctx: Ctx) {
    const base = env.RUNNER_PUBLIC_URL?.replace(/\/+$/, '');
    if (!env.RUNNER_SIGNING_SECRET || !base) return;
    const url = `${base}${RUNNER_BASE_PATH}/watchdog`;
    const body = JSON.stringify({ tick: controller.scheduledTime });
    const headers = await signWatchdog(env.RUNNER_SIGNING_SECRET, url, body);
    ctx.waitUntil(
      env.WORKER_SELF_REFERENCE.fetch(url, { method: 'POST', headers, body }).then((response) => {
        if (!response.ok) console.error(`watchdog: the tick answered ${response.status}`);
      }),
    );
  },
};
