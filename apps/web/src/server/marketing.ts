import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client.ts';
import { films } from '../db/schema.ts';
import { createContext } from './api/context.ts';
import { currentPrincipal, workerBindings } from './next.ts';
import { hasShowcaseFilms, type ShowcaseFilm, showcaseFilms } from './showcase.ts';

/**
 * The launch wall for a marketing page, with Boiler Room's own film first: the newest film on the
 * wall from the account named by `BR_HOUSE_ACCOUNT_ID`. Null when the database does not answer, so
 * the page still renders and says the wall did not load, instead of pretending there are no films.
 */
export async function loadShowcase(limit: number): Promise<ShowcaseFilm[] | null> {
  try {
    const env = workerBindings();
    return await showcaseFilms(getDb(env.DB), {
      limit,
      houseAccountId: env.BR_HOUSE_ACCOUNT_ID || null,
    });
  } catch (error) {
    console.error('Showcase: the wall could not be loaded', error);
    return null;
  }
}

/**
 * True once the wall has a real film. Until then the nav and the landing page leave the showcase
 * out, rather than send visitors to an empty room. False when the database does not answer.
 */
export async function showcaseOpen(): Promise<boolean> {
  try {
    return await hasShowcaseFilms(getDb(workerBindings().DB));
  } catch (error) {
    console.error('Showcase: could not check for films', error);
    return false;
  }
}

/** The signed-in founder's own films that they chose to show, real and simulated. */
export interface MyShowcase {
  /** Delivered, real and opted in: on the wall now. */
  shown: number;
  /** Opted in, but simulated: these never appear. */
  simulated: number;
}

/**
 * What the signed-in founder has opted in, so the showcase page can say where their film is.
 * Null when signed out, when they have opted nothing in, or when the database does not answer.
 */
export async function loadMyShowcase(): Promise<MyShowcase | null> {
  const principal = await currentPrincipal();
  if (!principal) return null;
  try {
    const ctx = await createContext(principal, workerBindings());
    const mine = await ctx.db
      .select({ pipeline: films.pipeline, status: films.status })
      .from(films)
      .where(and(eq(films.accountId, ctx.account.id), eq(films.showcaseOptIn, true)));
    if (mine.length === 0) return null;
    return {
      shown: mine.filter((film) => film.pipeline !== 'simulated' && film.status === 'done').length,
      simulated: mine.filter((film) => film.pipeline === 'simulated').length,
    };
  } catch (error) {
    console.error('Showcase: could not read your films', error);
    return null;
  }
}
