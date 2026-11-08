import {
  type ApiContext,
  type Bindings,
  createContext,
  type Principal,
  type Runtime,
} from './context.ts';
import { ApiError } from './errors.ts';
import { assertSameOrigin, errorResponse } from './http.ts';

/** Where a route gets the caller and the bindings. Production uses Clerk and the Worker env. */
export interface RouteDeps {
  principal(): Promise<Principal | null>;
  bindings(): Bindings;
  clock?: () => Date;
  runtime?: () => Runtime;
}

export type Handler<P> = (ctx: ApiContext, request: Request, params: P) => Promise<Response>;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Wraps a handler so it only runs for a signed-in caller, with every query scoped to the caller's
 * account, and so every failure becomes the API's error shape.
 */
export function makeRoute(deps: RouteDeps) {
  return <P = Record<string, never>>(handler: Handler<P>) =>
    async (request: Request, segment?: { params: Promise<P> }): Promise<Response> => {
      try {
        if (WRITE_METHODS.has(request.method)) assertSameOrigin(request);
        const principal = await deps.principal();
        if (!principal) throw new ApiError(401, 'unauthorized', 'Sign in first.');
        const ctx = await createContext(principal, deps.bindings(), deps.clock, deps.runtime?.());
        const params = (segment ? await segment.params : {}) as P;
        return await handler(ctx, request, params);
      } catch (error) {
        return errorResponse(error);
      }
    };
}
