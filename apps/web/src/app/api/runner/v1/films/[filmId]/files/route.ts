import { workerRunnerDeps } from '../../../../../../../server/next.ts';
import { files, runnerRoute } from '../../../../../../../server/runner/routes.ts';

export const dynamic = 'force-dynamic';

/** One file from the film's computer, streamed into R2 under a key the website picks. */
export const PUT = runnerRoute(workerRunnerDeps, { jsonLimit: null }, files);
