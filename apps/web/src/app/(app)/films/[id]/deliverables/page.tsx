import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '../../../../../components/icon.tsx';
import { ShowcaseToggle } from '../../../../../components/showcase-toggle.tsx';
import { SimulatedNote } from '../../../../../components/simulated-note.tsx';
import { SimulatedBadge } from '../../../../../components/status-badge.tsx';
import { loadFilm } from '../../../../../server/pages.ts';

export const metadata: Metadata = { title: 'Files' };

const SHAPE_NAMES: Record<string, string> = {
  '16:9': 'Landscape, for your homepage, YouTube, X and Product Hunt',
  '9:16': 'Tall, for Reels, TikTok, Shorts and stories',
  '1:1': 'Square, for LinkedIn and the X feed',
};

/** The finished files, one per shape, and the showcase choice. */
export default async function DeliverablesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadFilm(id);
  if (!detail) notFound();
  const { film, deliverables } = detail;

  return (
    <>
      <div className="crumbs label">
        <Link href="/films">Videos</Link>
        <span className="muted">/</span>
        <Link href={`/films/${film.id}`}>{film.title}</Link>
        <span className="muted">/</span>
        <span>Files</span>
      </div>
      <div className="page-head">
        <div className="row">
          <h1>Your files</h1>
          {film.simulated ? <SimulatedBadge /> : null}
        </div>
        <p className="lede">One file for each shape you picked, ready to post on launch day.</p>
      </div>
      {film.simulated ? <SimulatedNote /> : null}

      {film.status !== 'done' ? (
        <section className="card card-quiet empty">
          <h2>Not delivered yet</h2>
          <p>The files appear here when Quality Check has passed the video.</p>
          <Link className="btn" href={`/films/${film.id}`}>
            Back to the video
          </Link>
        </section>
      ) : (
        <>
          <ul className="files" aria-label="Files">
            {deliverables.map((file) => (
              <li key={file.id} className="card file">
                <span className="score">{file.format}</span>
                <div className="what">
                  <strong>{file.fileName}</strong>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {SHAPE_NAMES[file.format]}
                  </span>
                </div>
                {file.downloadUrl ? (
                  <a className="btn btn-primary btn-sm" href={file.downloadUrl} download>
                    <Icon name="download" />
                    Download
                  </a>
                ) : (
                  <span className="badge badge-plain">No file: simulated</span>
                )}
              </li>
            ))}
          </ul>
          <section className="card">
            <h2 style={{ fontSize: 22, marginBottom: 12 }}>Showcase</h2>
            <ShowcaseToggle
              filmId={film.id}
              initial={film.showcaseOptIn}
              simulated={film.simulated}
            />
          </section>
        </>
      )}
    </>
  );
}
