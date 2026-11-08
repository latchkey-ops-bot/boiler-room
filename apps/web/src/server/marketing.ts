import { headers } from 'next/headers';
import { getDb } from '../db/client.ts';
import { workerBindings } from './next.ts';
import { type ShowcaseFilm, showcaseFilms } from './showcase.ts';

/**
 * The launch wall for a marketing page, with Boiler Room's own film first: the film of the host
 * this page is served from. Null when the database does not answer, so the page still renders and
 * says the wall did not load, instead of pretending there are no films.
 */
export async function loadShowcase(limit: number): Promise<ShowcaseFilm[] | null> {
  // Outside the try: Next signals a dynamic page by throwing from headers().
  const houseHost = (await headers()).get('host');
  try {
    return await showcaseFilms(getDb(workerBindings().DB), { limit, houseHost });
  } catch (error) {
    console.error('Showcase: the wall could not be loaded', error);
    return null;
  }
}
