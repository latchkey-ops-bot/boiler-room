import { workerRunnerDeps } from '../../../../../server/next.ts';
import { watchdogRoute } from '../../../../../server/runner/routes.ts';

export const dynamic = 'force-dynamic';

/** The cron's tick, from `worker.ts`. Signed with the watchdog key, which only this Worker holds. */
export const POST = watchdogRoute(workerRunnerDeps);
