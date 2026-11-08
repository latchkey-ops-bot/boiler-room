import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '../../../../../components/icon.tsx';
import { Refresher } from '../../../../../components/refresher.tsx';
import { ScriptReview } from '../../../../../components/script-review.tsx';
import { SimulatedNote } from '../../../../../components/simulated-note.tsx';
import { loadFilm } from '../../../../../server/pages.ts';
import { buildReviewModel } from '../../../../../server/script-review.ts';
import '../../../../../styles/script-review.css';

export const metadata: Metadata = { title: 'Script review' };

/** The script, scene by scene, with the source of every number, and the one decision to make. */
export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadFilm(id);
  if (!detail) notFound();
  const { film, campaign } = detail;
  const working = film.status === 'queued' || film.status === 'working';

  if (!campaign) {
    return (
      <>
        <Refresher active={working} />
        <Link className="back-link" href={`/films/${film.id}`}>
          <Icon name="arrow-right" />
          {film.title}
        </Link>
        {film.simulated ? <SimulatedNote /> : null}
        <section className="card card-quiet empty">
          <h1>The script isn't written yet</h1>
          <p>
            The Researcher and the Director are still working. You'll see the script here when the
            Validator has checked it.
          </p>
        </section>
      </>
    );
  }

  const model = buildReviewModel({ ...detail, campaign });
  return (
    <>
      <Refresher active={model.state === 'checking' || model.state === 'rewriting'} />
      <ScriptReview model={model} />
    </>
  );
}
