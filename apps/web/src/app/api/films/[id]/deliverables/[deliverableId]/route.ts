import { downloadDeliverable } from '../../../../../../server/api/films.ts';
import { route } from '../../../../../../server/next.ts';

/** Downloads one finished file. */
export const GET = route<{ id: string; deliverableId: string }>(
  async (ctx, _request, { id, deliverableId }) => downloadDeliverable(ctx, id, deliverableId),
);
