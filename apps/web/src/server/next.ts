import { auth } from '@clerk/nextjs/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  type ApiContext,
  type Bindings,
  createContext,
  type Principal,
  pipelineKindFor,
  type Runtime,
} from './api/context.ts';
import { makeRoute } from './api/route.ts';
import { pipelineKindFrom } from './pipeline/index.ts';

/** The Clerk caller, or null when signed out. */
export async function currentPrincipal(): Promise<Principal | null> {
  const { userId, orgId } = await auth();
  return userId ? { userId, orgId: orgId ?? null } : null;
}

/** The Worker's bindings: D1, R2 and the vars in wrangler.jsonc. */
export function workerBindings(): Bindings {
  return getCloudflareContext().env;
}

/** Work that goes on after the response: a real film's next step on Naive. */
export function workerRuntime(): Runtime {
  const { ctx } = getCloudflareContext();
  return { waitUntil: (promise) => ctx.waitUntil(promise) };
}

/** Route handlers: `export const GET = route(async (ctx, request, params) => …)`. */
export const route = makeRoute({
  principal: currentPrincipal,
  bindings: workerBindings,
  runtime: workerRuntime,
});

/** Sends a signed-out visitor to sign in, and back here afterwards. */
export async function requireSignedIn(): Promise<Principal> {
  const { userId, orgId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
  return { userId, orgId: orgId ?? null };
}

/** For server components on app pages: the caller's context, or a redirect to sign in. */
export async function pageContext(): Promise<ApiContext> {
  return createContext(await requireSignedIn(), workerBindings(), undefined, workerRuntime());
}

/**
 * True where this caller's new films are simulated. The app layout then shows its banner on every
 * screen, and that banner is the one simulated label a screen carries. A founder who gets real
 * films sees no banner; any simulated film of theirs keeps its own badge.
 */
export async function simulatedForCaller(): Promise<boolean> {
  const principal = await currentPrincipal();
  const bindings = workerBindings();
  return principal
    ? pipelineKindFor(bindings, principal) === 'simulated'
    : pipelineKindFrom(bindings.PIPELINE) === 'simulated';
}
