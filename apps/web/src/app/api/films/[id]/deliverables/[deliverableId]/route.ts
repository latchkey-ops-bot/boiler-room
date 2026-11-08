import { downloadDeliverable } from '../../../../../../server/api/films.ts';
import { route } from '../../../../../../server/next.ts';

/** Downloads one finished file. `?inline=1` serves it to the player, which asks for byte ranges. */
export const GET = route<{ id: string; deliverableId: string }>(
  async (ctx, request, { id, deliverableId }) =>
    downloadDeliverable(ctx, id, deliverableId, {
      inline: new URL(request.url).searchParams.get('inline') === '1',
      range: request.headers.get('range'),
    }),
);
