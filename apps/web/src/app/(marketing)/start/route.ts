import { auth } from '@clerk/nextjs/server';
import { startTarget } from '../../../lib/start.ts';

export const dynamic = 'force-dynamic';

/**
 * The marketing site's URL field submits here. A signed-in founder goes straight to the new video
 * with the URL filled in. Anyone else signs up first, and Clerk brings them back to the same place:
 * a first visit is a new account, and Clerk's sign-up card links to log in for everyone else.
 *
 * Every redirect names a path, never a host. The browser resolves a relative Location against the
 * page it is on, and Clerk resolves `returnBackUrl` against the host it read from the request, so
 * neither depends on the host the Worker thinks it has.
 */
export async function GET(request: Request) {
  const target = startTarget(new URL(request.url).searchParams.get('url'));
  if (!target.ok) return seeOther(target.back);
  const { userId, redirectToSignUp } = await auth();
  if (!userId) return redirectToSignUp({ returnBackUrl: target.next });
  return seeOther(target.next);
}

function seeOther(path: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location: path, 'cache-control': 'no-store' },
  });
}
