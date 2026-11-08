/**
 * The runner's routes, served by `worker.ts` before OpenNext sees the request.
 *
 * OpenNext's converter reads the whole body of every non-GET request into memory, twice, before
 * any route runs. So no runner route can live behind it: an upload would be held whole, an MP4
 * near 90 MiB makes the Worker exceed its limits, and anyone could do the same with no signature.
 * Here the request is the Worker's own: the signed headers are checked before the body is touched,
 * a JSON body is read with a byte limit, and an upload streams straight into R2 with its signed
 * length and SHA-256.
 */
import { getDb } from '../../db/client.ts';
import { RUNNER_BASE_PATH } from './contract.ts';
import { type RunnerEnv, runnerDeps } from './deps.ts';
import {
  events,
  files,
  hello,
  instructions,
  RUNNER_BODY_LIMITS,
  runnerRoute,
  watchdogRoute,
} from './routes.ts';
import type { RunnerDeps } from './runs.ts';

const FILM_ROUTE = new RegExp(
  `^${RUNNER_BASE_PATH}/films/([^/]+)/(hello|instructions|events|files)$`,
);

const ROUTES = {
  hello: { method: 'POST', handler: hello, jsonLimit: RUNNER_BODY_LIMITS.hello },
  instructions: { method: 'GET', handler: instructions, jsonLimit: null },
  events: { method: 'POST', handler: events, jsonLimit: RUNNER_BODY_LIMITS.events },
  files: { method: 'PUT', handler: files, jsonLimit: null },
} as const;

const answer = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

/** True for a path the runner's router serves. */
export function isRunnerPath(pathname: string): boolean {
  return pathname === RUNNER_BASE_PATH || pathname.startsWith(`${RUNNER_BASE_PATH}/`);
}

export function runnerFetch(
  request: Request,
  env: RunnerEnv,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  /** Tests pass their own, with a fake Naive and a clock. */
  getDeps: () => RunnerDeps = () =>
    runnerDeps(env, getDb(env.DB), () => new Date(), {
      waitUntil: (promise) => ctx.waitUntil(promise),
    }),
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === `${RUNNER_BASE_PATH}/watchdog`) {
    if (request.method !== 'POST') {
      return Promise.resolve(answer(405, 'method_not_allowed', 'POST the watchdog tick.'));
    }
    return watchdogRoute(getDeps)(request);
  }
  const match = FILM_ROUTE.exec(pathname);
  const route = match ? ROUTES[match[2] as keyof typeof ROUTES] : undefined;
  if (!match || !route) return Promise.resolve(answer(404, 'not_found', 'There is no such route.'));
  if (request.method !== route.method) {
    return Promise.resolve(
      answer(405, 'method_not_allowed', `This route takes ${route.method} only.`),
    );
  }
  return runnerRoute(
    getDeps,
    { jsonLimit: route.jsonLimit },
    route.handler,
  )(request, {
    params: Promise.resolve({ filmId: match[1] as string }),
  });
}

/** The largest body any page or API route of the app takes. Only runner uploads are bigger. */
export const MAX_APP_BODY_BYTES = 1024 * 1024;

/**
 * A request for the app, refused or bounded before OpenNext reads its body whole: one that says it
 * is over the limit is answered 413 at once, and one with no length is cut off at the limit.
 */
export function boundAppRequest(request: Request): Request | Response {
  if (request.method === 'GET' || request.method === 'HEAD' || !request.body) return request;
  const length = request.headers.get('content-length');
  if (length !== null) {
    const bytes = Number(length);
    if (!Number.isFinite(bytes) || bytes > MAX_APP_BODY_BYTES) {
      return answer(413, 'body_too_large', 'The body is too large.');
    }
    return request;
  }
  let seen = 0;
  const limit = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > MAX_APP_BODY_BYTES) controller.error(new Error('The body is too large.'));
      else controller.enqueue(chunk);
    },
  });
  return new Request(request, {
    body: request.body.pipeThrough(limit),
    duplex: 'half',
  } as RequestInit);
}
