import { workerRunnerDeps } from '../../../../../../../server/next.ts';
import { instructions, runnerRoute } from '../../../../../../../server/runner/routes.ts';

export const dynamic = 'force-dynamic';

/** What the runner is to do next: the phase, the URL, the approved cut, the budget left. */
export const GET = runnerRoute(workerRunnerDeps, { jsonLimit: null }, instructions);
