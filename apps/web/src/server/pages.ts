import { ApiError } from './api/errors.ts';
import { type FilmDetail, getFilmDetail } from './api/films.ts';
import { pageContext } from './next.ts';

/** A film for an app page, or null when it is not the caller's, so the page can 404. */
export async function loadFilm(id: string): Promise<FilmDetail | null> {
  try {
    return await getFilmDetail(await pageContext(), id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
