import { getCloudflareContext } from '@opennextjs/cloudflare';
import { pipelineKindFrom } from '../../../server/pipeline/index.ts';

export const dynamic = 'force-dynamic';

/**
 * Public. The smoke check calls it after every deploy: 200 when the Worker runs and D1 answers,
 * 503 when D1 does not. `version` is the git commit the Worker was built from.
 */
export async function GET() {
  const { env } = getCloudflareContext();
  const body = {
    ok: true,
    env: env.APP_ENV ?? 'unknown',
    version: process.env.BR_BUILD_SHA ?? 'dev',
    pipeline: pipelineKindFrom(env.PIPELINE),
    db: 'ok' as 'ok' | 'error',
  };
  try {
    await env.DB.prepare('select 1').first();
  } catch (error) {
    console.error('Health: D1 did not answer', error);
    body.ok = false;
    body.db = 'error';
  }
  return Response.json(body, {
    status: body.ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
