import { listDeliverables } from '../../../../../server/api/films.ts';
import { json } from '../../../../../server/api/http.ts';
import { route } from '../../../../../server/next.ts';

/** The finished files for a film. Empty until it is delivered. */
export const GET = route<{ id: string }>(async (ctx, _request, { id }) =>
  json(await listDeliverables(ctx, id)),
);
