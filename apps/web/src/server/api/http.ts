import type { z } from 'zod';
import { PipelineConflictError, PipelineUnavailableError } from '../pipeline/types.ts';
import { ApiError } from './errors.ts';

/** Request bodies are small JSON objects. Anything bigger is refused before it is parsed. */
export const MAX_BODY_BYTES = 16 * 1024;

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

/** The one error shape: `{ error: { code, message, issues? } }`. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return json(
      { error: { code: error.code, message: error.message, issues: error.issues } },
      { status: error.status },
    );
  }
  if (error instanceof PipelineConflictError) {
    return json({ error: { code: 'pipeline_conflict', message: error.message } }, { status: 409 });
  }
  if (error instanceof PipelineUnavailableError) {
    return json(
      { error: { code: 'pipeline_unavailable', message: error.message } },
      { status: 503 },
    );
  }
  console.error('Unhandled API error', error);
  return json(
    { error: { code: 'internal', message: 'Something went wrong on our side.' } },
    { status: 500 },
  );
}

/** Reads and validates a JSON body. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send the body as application/json.');
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw tooLarge();
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw tooLarge();

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'invalid_json', 'The body is not valid JSON.');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      400,
      'invalid_body',
      'Some fields are missing or wrong.',
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '$',
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

/**
 * Refuses a write sent from another site. Clerk's session cookie is SameSite=Lax already; this is
 * the second lock.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  let sameHost = false;
  try {
    sameHost = new URL(origin).host === new URL(request.url).host;
  } catch {
    sameHost = false;
  }
  if (!sameHost) throw new ApiError(403, 'cross_origin', 'This request came from another site.');
}

function tooLarge(): ApiError {
  return new ApiError(413, 'body_too_large', 'The body is too large.');
}
