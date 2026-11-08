import { auth } from '@clerk/nextjs/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { redirect } from 'next/navigation';
import { type ApiContext, type Bindings, createContext, type Principal } from './api/context.ts';
import { makeRoute } from './api/route.ts';

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

/** For server components on app pages. The middleware already sent signed-out visitors away. */
export async function pageContext(): Promise<ApiContext> {
  const principal = await currentPrincipal();
  if (!principal) redirect('/sign-in');
  return createContext(principal, workerBindings());
}
