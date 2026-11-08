import { clerkMiddleware } from '@clerk/nextjs/server';

/**
 * Clerk on every request, so pages and routes can ask who is signed in. Protection lives on each
 * resource, as Clerk 7 recommends instead of path matching here: the app layout and every app page
 * send a signed-out visitor to sign in (src/server/next.ts), and every API route answers 401
 * (src/server/api/route.ts). The runner's routes under `/api/runner/` are left out: a film's
 * computer has no Clerk session, and each call is checked against its HMAC signature instead.
 * `worker.ts` serves them before Next ever sees the request (src/server/runner/worker-routes.ts).
 * The GTM executor's routes under `/api/gtm/` and the sample film pages under `/f/` are left out
 * for the same reason: the executor holds a bearer token, not a session, and `worker.ts` serves
 * both first (src/server/gtm/routes.ts).
 *
 * This is `middleware.ts`, not Next 16's `proxy.ts`, on purpose: proxy always runs on the Node.js
 * runtime, and the OpenNext Cloudflare adapter supports only Edge middleware. Keep it until the
 * adapter supports Node middleware.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Everything except Next internals, static files, and the runner's signed routes
    '/((?!_next|api/runner/|api/gtm/|f/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Every API route except the runner's and GTM's, which carry their own signature or token
    '/api/((?!runner/|gtm/).*)',
    '/trpc(.*)',
  ],
};
