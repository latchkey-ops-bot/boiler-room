import { getFilmDetail } from '../../../../server/api/films.ts';
import { json } from '../../../../server/api/http.ts';
import { route } from '../../../../server/next.ts';

/** One film with the crew's events, the customer's decisions and the files. */
export const GET = route<{ id: string }>(async (ctx, _request, { id }) =>
  json(await getFilmDetail(ctx, id)),
);
