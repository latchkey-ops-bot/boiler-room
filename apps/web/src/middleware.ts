import { clerkMiddleware } from '@clerk/nextjs/server';

/**
 * Clerk on every request, so pages and routes can ask who is signed in. Protection lives on each
 * resource, as Clerk 7 recommends instead of path matching here: the app layout and every app page
 * send a signed-out visitor to sign in (src/server/next.ts), and every API route answers 401
 * (src/server/api/route.ts).
 *
 * This is `middleware.ts`, not Next 16's `proxy.ts`, on purpose: proxy always runs on the Node.js
 * runtime, and the OpenNext Cloudflare adapter supports only Edge middleware. Keep it until the
 * adapter supports Node middleware.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Everything except Next internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
