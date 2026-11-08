import { getDb } from '../../../../../db/client.ts';
import { workerBindings } from '../../../../../server/next.ts';
import { showcaseVideo } from '../../../../../server/showcase.ts';

export const dynamic = 'force-dynamic';

/** Public. Plays a film on the showcase wall, while its founder keeps it there. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const env = workerBindings();
  try {
    return await showcaseVideo(getDb(env.DB), env.FILMS, id, request);
  } catch (error) {
    console.error('Showcase: the film could not be served', error);
    return new Response('The film could not be loaded.', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}
