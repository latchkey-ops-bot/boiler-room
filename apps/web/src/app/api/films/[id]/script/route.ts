import { reviewScript, reviewScriptInput } from '../../../../../server/api/films.ts';
import { json, readJson } from '../../../../../server/api/http.ts';
import { route } from '../../../../../server/next.ts';

/**
 * Approves the script or sends it back.
 * `{ "decision": "approve", "version": 1, "hookId": null, "ctaId": "start-free", "formats": ["16:9"] }`
 * `{ "decision": "send_back", "version": 1, "note": "Make the opening punchier." }`
 */
export const POST = route<{ id: string }>(async (ctx, request, { id }) => {
  const input = await readJson(request, reviewScriptInput);
  return json(await reviewScript(ctx, id, input));
});
