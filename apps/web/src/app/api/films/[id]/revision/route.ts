import { requestRevision, revisionInput } from '../../../../../server/api/films.ts';
import { json, readJson } from '../../../../../server/api/http.ts';
import { route } from '../../../../../server/next.ts';

/**
 * Asks for changes to the delivered film. The next version of the script comes back for approval.
 * `{ "version": 1, "note": "Make the logo bigger in the last scene." }`
 */
export const POST = route<{ id: string }>(async (ctx, request, { id }) => {
  const input = await readJson(request, revisionInput);
  return json(await requestRevision(ctx, id, input));
});
