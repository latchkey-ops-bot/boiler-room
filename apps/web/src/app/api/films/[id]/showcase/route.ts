import { setShowcase, showcaseInput } from '../../../../../server/api/films.ts';
import { json, readJson } from '../../../../../server/api/http.ts';
import { route } from '../../../../../server/next.ts';

/** Shows a delivered film on the public showcase, or takes it off. `{ "optIn": true }` */
export const PUT = route<{ id: string }>(async (ctx, request, { id }) => {
  const input = await readJson(request, showcaseInput);
  return json({ film: await setShowcase(ctx, id, input) });
});
