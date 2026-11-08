import { json, readJson } from '../../../../../server/api/http.ts';
import { launchPlanInput, setLaunchPlan } from '../../../../../server/api/launch.ts';
import { route } from '../../../../../server/next.ts';

/**
 * Sets the founder's launch day and channels, for the launch plan on the film page.
 * `{ "date": "2026-11-18", "channels": ["x", "linkedin"] }`. A null date clears it.
 */
export const PUT = route<{ id: string }>(async (ctx, request, { id }) => {
  const input = await readJson(request, launchPlanInput);
  return json({ film: await setLaunchPlan(ctx, id, input) });
});
