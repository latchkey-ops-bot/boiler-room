import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Boyle } from '../../../../components/boyle.tsx';
import { DecisionsFeed } from '../../../../components/decisions-feed.tsx';
import { Icon } from '../../../../components/icon.tsx';
import { LocalTime } from '../../../../components/local-time.tsx';
import { PipelineTracker } from '../../../../components/pipeline-tracker.tsx';
import { Refresher } from '../../../../components/refresher.tsx';
import { SimulatedNote } from '../../../../components/simulated-note.tsx';
import { SimulatedBadge, StatusBadge } from '../../../../components/status-badge.tsx';
import { loadFilm } from '../../../../server/pages.ts';

export const metadata: Metadata = { title: 'Video' };

/** One video: where it is on the pipe, what the crew decided, and the one thing to do next. */
export default async function FilmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadFilm(id);
  if (!detail) notFound();
  const { film, campaign, events } = detail;
  const making = film.status === 'queued' || film.status === 'working';

  return (
    <>
      <Refresher active={making} />
      <div className="page-head">
        <div className="crumbs label">
          <Link href="/films">Videos</Link>
          <span className="muted">/</span>
          <span>{film.title}</span>
        </div>
        <div className="row">
          <h1>{film.title}</h1>
          <StatusBadge status={film.status} />
          {film.simulated ? <SimulatedBadge /> : null}
        </div>
        <div className="meta">
          <span>
            <Icon name="globe" />
            {film.host}
          </span>
          <span>
            <Icon name="clock" />
            Started <LocalTime iso={film.createdAt} withDate />
          </span>
          {campaign ? (
            <span>
              <Icon name="film" />
              {campaign.durationSeconds} seconds · {campaign.scenes.length} scenes
            </span>
          ) : null}
        </div>
      </div>

      {film.simulated ? <SimulatedNote /> : null}

      {film.status === 'needs_you' ? (
        <div className="alert alert-needs callout">
          <Icon name="sparkle" />
          <div className="text">
            <h3>Your script is ready</h3>
            <p>Read it and approve it. Nothing renders until you say yes.</p>
          </div>
          <Link className="btn btn-primary" href={`/films/${film.id}/script`}>
            Review script <Icon name="arrow-right" />
          </Link>
        </div>
      ) : null}
      {film.status === 'done' ? (
        <div className="alert alert-done callout">
          <Icon name="check" />
          <div className="text">
            <h3>Your video is ready</h3>
            <p>Download the files for each channel.</p>
          </div>
          <Link className="btn btn-primary" href={`/films/${film.id}/deliverables`}>
            Get your files <Icon name="arrow-right" />
          </Link>
        </div>
      ) : null}
      {making ? (
        <div className="alert callout">
          <Boyle size={48} steaming />
          <div className="text">
            <h3>The crew is on it</h3>
            <p>This page updates by itself. You'll be asked to approve the script.</p>
          </div>
        </div>
      ) : null}

      <PipelineTracker stage={film.stage} status={film.status} />
      <DecisionsFeed events={events} />
    </>
  );
}
