import { auth } from '@clerk/nextjs/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { type ApiContext, type Bindings, createContext, type Principal } from './api/context.ts';
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

/** Route handlers: `export const GET = route(async (ctx, request, params) => …)`. */
export const route = makeRoute({ principal: currentPrincipal, bindings: workerBindings });

/** Sends a signed-out visitor to sign in, and back here afterwards. */
export async function requireSignedIn(): Promise<Principal> {
  const { userId, orgId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
  return { userId, orgId: orgId ?? null };
}

/** For server components on app pages: the caller's context, or a redirect to sign in. */
export async function pageContext(): Promise<ApiContext> {
  return createContext(await requireSignedIn(), workerBindings());
}

/**
 * True where this environment makes simulated films. The app layout then shows its banner on every
 * screen, and that banner is the one simulated label a screen carries.
 */
export function simulatedEnvironment(): boolean {
  return pipelineKindFrom(workerBindings().PIPELINE) === 'simulated';
}
