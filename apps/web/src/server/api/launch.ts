import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { films } from '../../db/schema.ts';
import { addDays, CHANNELS, isLaunchDate, utcToday } from '../../lib/launch.ts';
import type { ApiContext } from './context.ts';
import { ApiError, notFound } from './errors.ts';
import { type FilmView, filmView, ownFilm } from './films.ts';

/** How far ahead a launch day can be. Further out is almost certainly a typo. */
export const MAX_LAUNCH_DAYS_AHEAD = 3 * 366;

/** Body of `PUT /api/films/[id]/launch`. A null date clears the launch day. */
export const launchPlanInput = z.strictObject({
  date: z
    .string()
    .refine(isLaunchDate, 'Pick a launch day as YYYY-MM-DD, such as 2026-11-18.')
    .nullable(),
  channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length),
});

export type LaunchPlanInput = z.infer<typeof launchPlanInput>;

/** Sets the day the founder launches and where they will post. The launch plan card shows both. */
export async function setLaunchPlan(
  ctx: ApiContext,
  id: string,
  input: LaunchPlanInput,
): Promise<FilmView> {
  await ownFilm(ctx, id);
  if (input.date !== null) {
    // A day either side of UTC's today covers every time zone's today.
    const today = utcToday(ctx.now());
    if (input.date < addDays(today, -1)) {
      throw new ApiError(400, 'launch_in_past', 'Pick a launch day from today on.', [
        { path: 'date', message: 'Pick a launch day from today on.' },
      ]);
    }
    if (input.date > addDays(today, MAX_LAUNCH_DAYS_AHEAD)) {
      throw new ApiError(400, 'launch_too_far', 'Pick a launch day in the next three years.', [
        { path: 'date', message: 'Pick a launch day in the next three years.' },
      ]);
    }
  }
  const channels = CHANNELS.filter((channel) => input.channels.includes(channel));
  const [updated] = await ctx.db
    .update(films)
    .set({
      launchDate: input.date,
      launchChannelsJson: JSON.stringify(channels),
      updatedAt: ctx.now(),
    })
    .where(and(eq(films.id, id), eq(films.accountId, ctx.account.id)))
    .returning();
  if (!updated) throw notFound();
  return filmView(updated);
}
