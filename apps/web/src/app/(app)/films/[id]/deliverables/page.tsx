import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DeliveryScreen } from '../../../../../components/delivery-screen.tsx';
import { Refresher } from '../../../../../components/refresher.tsx';
import { MAX_REVISIONS_PER_FILM } from '../../../../../server/api/films.ts';
import { simulatedEnvironment } from '../../../../../server/next.ts';
import { loadFilm } from '../../../../../server/pages.ts';
import '../../../../../styles/delivery.css';

export const metadata: Metadata = { title: 'Your video' };

/** The finished video, its files, the showcase choice and the way to ask for changes. */
export default async function DeliverablesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadFilm(id);
  if (!detail) notFound();
  const making = detail.film.status === 'queued' || detail.film.status === 'working';
  return (
    <>
      <Refresher active={making} />
      <DeliveryScreen
        detail={detail}
        maxRevisions={MAX_REVISIONS_PER_FILM}
        banner={simulatedEnvironment()}
      />
    </>
  );
}
