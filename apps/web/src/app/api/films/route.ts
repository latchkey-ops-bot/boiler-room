import { createFilm, createFilmInput, listFilms } from '../../../server/api/films.ts';
import { json, readJson } from '../../../server/api/http.ts';
import { route } from '../../../server/next.ts';

/** The caller's films, newest first. */
export const GET = route(async (ctx) => json(await listFilms(ctx)));

/** Starts a film from a website URL. Body: `{ "url": "yourstartup.com" }`. */
export const POST = route(async (ctx, request) => {
  const input = await readJson(request, createFilmInput);
  return json(await createFilm(ctx, input), { status: 201 });
});
