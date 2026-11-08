import { workerRunnerDeps } from '../../../../../../../server/next.ts';
import {
  hello,
  RUNNER_BODY_LIMITS,
  runnerRoute,
} from '../../../../../../../server/runner/routes.ts';

export const dynamic = 'force-dynamic';

/** The runner on a film's computer is up. Signed with the run's key; no Clerk session. */
export const POST = runnerRoute(workerRunnerDeps, { jsonLimit: RUNNER_BODY_LIMITS.hello }, hello);
