import { workerRunnerDeps } from '../../../../../../../server/next.ts';
import {
  events,
  RUNNER_BODY_LIMITS,
  runnerRoute,
} from '../../../../../../../server/runner/routes.ts';

export const dynamic = 'force-dynamic';

/** A batch of the crew's events: stages, decisions, costs, the script, the delivery, errors. */
export const POST = runnerRoute(workerRunnerDeps, { jsonLimit: RUNNER_BODY_LIMITS.events }, events);
