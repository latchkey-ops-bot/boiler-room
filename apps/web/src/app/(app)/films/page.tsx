import type { Metadata } from 'next';
import { LiveFilms } from '../../../components/films-screen.tsx';
import { listFilms } from '../../../server/api/films.ts';
import { pageContext } from '../../../server/next.ts';

export const metadata: Metadata = { title: 'Your videos' };

/** The app home: every video, newest first, kept live while the crew is working. */
export default async function FilmsPage() {
  return <LiveFilms initial={await listFilms(await pageContext())} />;
}
