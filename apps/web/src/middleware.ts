import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

/**
 * Clerk on every request. App pages send a signed-out visitor to /sign-in; API routes answer 401
 * themselves (src/server/api/route.ts), so they are not redirected here.
 *
 * This is `middleware.ts`, not Next 16's `proxy.ts`, on purpose: proxy always runs on the Node.js
 * runtime, and the OpenNext Cloudflare adapter supports only Edge middleware. Keep it until the
 * adapter supports Node middleware.
 */
const isAppPage = createRouteMatcher(['/films(.*)', '/settings(.*)']);

export default clerkMiddleware(async (auth, request) => {
  if (isAppPage(request)) await auth.protect();
});

export const config = {
  matcher: [
    // Everything except Next internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
