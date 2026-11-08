import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LiveFilm } from '../../../../components/film-screen.tsx';
import { simulatedForCaller } from '../../../../server/next.ts';
import { loadFilm } from '../../../../server/pages.ts';

export const metadata: Metadata = { title: 'Video' };

/** One video, kept live while the crew is working. */
export default async function FilmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadFilm(id);
  if (!detail) notFound();
  return <LiveFilm key={detail.film.id} initial={detail} banner={await simulatedForCaller()} />;
}
