// The Worker's entry: OpenNext's generated fetch handler, plus a cron for the real-film watchdog.
// All the watchdog's logic stays in the Next bundle, behind the signed route it calls here, so this
// file imports only the runner contract, which has no imports of its own.
// biome-ignore lint/suspicious/noTsIgnore: the file exists after a build and not before, so expect-error would fail one of the two
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from './.open-next/worker.js';
import { RUNNER_BASE_PATH, signWatchdog } from './src/server/runner/contract.ts';

interface CronEnv {
  WORKER_SELF_REFERENCE: { fetch(input: string, init: RequestInit): Promise<Response> };
  RUNNER_SIGNING_SECRET?: string;
  RUNNER_PUBLIC_URL?: string;
}

export default {
  fetch: handler.fetch,

  /** Every minute on staging (`triggers.crons`). Production has no cron until it is released. */
  async scheduled(
    controller: { scheduledTime: number },
    env: CronEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
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
