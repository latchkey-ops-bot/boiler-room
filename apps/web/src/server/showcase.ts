import { and, desc, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { films } from '../db/schema.ts';
import { displayHost } from '../lib/film.ts';
import { parseCampaign } from './api/films.ts';

export interface ShowcaseFilm {
  id: string;
  host: string;
  brand: string;
  headline: string | null;
  background: string;
  foreground: string;
  deliveredAt: string;
}

/**
 * The public launch wall: delivered films whose founders opted in. Simulated films never appear,
 * because the showcase is for real films only.
 */
export async function showcaseFilms(db: Db, limit = 24): Promise<ShowcaseFilm[]> {
  const rows = await db
    .select()
    .from(films)
    .where(
      and(eq(films.showcaseOptIn, true), eq(films.status, 'done'), ne(films.pipeline, 'simulated')),
    )
    .orderBy(desc(films.updatedAt))
    .limit(limit);
  return rows.map((film) => {
    const campaign = parseCampaign(film.campaignJson);
    const headline =
      campaign?.scenes[0]?.text.find((item) => item.role === 'headline')?.value ?? null;
    return {
      id: film.id,
      host: displayHost(film.url),
      brand: campaign?.brand.name ?? displayHost(film.url),
      headline,
      background: campaign?.brand.colors.background ?? '#0B2E40',
      foreground: campaign?.brand.colors.foreground ?? '#FFFFFF',
      deliveredAt: film.updatedAt.toISOString(),
    };
  });
}
