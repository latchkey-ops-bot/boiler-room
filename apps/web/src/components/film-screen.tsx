'use client';

import Link from 'next/link';
import { type FilmStatus, STATUS_LABELS, type Stage, WORKING_LABELS } from '../lib/film.ts';
import { formatLaunchDate } from '../lib/launch.ts';
import { filmPollDelay } from '../lib/poll.ts';
import type { FilmDetail } from '../server/api/films.ts';
import { CrewLog } from './decisions-feed.tsx';
import { FilmProgress } from './film-progress.tsx';
import { Icon } from './icon.tsx';
import { RelativeTime } from './relative-time.tsx';
import { SimulatedBadge, StatusBadge } from './status-badge.tsx';
import { usePolled } from './use-polled.ts';

const detailDelay = (detail: FilmDetail) => filmPollDelay(detail.film.status);

/**
 * The film page, kept live: it asks the API again every few seconds while the crew works, so the
 * progress, the crew's log and the next step move on without a reload.
 */
export function LiveFilm({ initial, banner }: { initial: FilmDetail; banner: boolean }) {
  const [detail] = usePolled(initial, `/api/films/${initial.film.id}`, detailDelay);
  return <FilmScreen detail={detail} banner={banner} />;
}

/**
 * One video, with one job: the next step when there is one, then where the film is, then what the
 * crew did. `banner` is true when the app's simulated banner is showing, which is then the one
 * simulated label on the screen.
 */
export function FilmScreen({ detail, banner = false }: { detail: FilmDetail; banner?: boolean }) {
  const { film, campaign, events } = detail;
  return (
    <>
      <div className="title">
        <div className="crumbs label">
          <Link href="/films">Videos</Link>
          <span className="muted">/</span>
          <span>{film.title}</span>
        </div>
        <div className="title-row">
          <h1>{film.title}</h1>
          <StatusBadge status={film.status} stage={film.stage} />
          {film.simulated && !banner ? <SimulatedBadge /> : null}
        </div>
        <div className="meta">
          <span>
            <Icon name="clock" />
            <RelativeTime iso={film.createdAt} prefix="Started" />
          </span>
          {campaign ? (
            <span>
              <Icon name="film" />
              {campaign.durationSeconds} seconds · {campaign.scenes.length} scenes
            </span>
          ) : null}
          {film.launchDate ? (
            <span>
              <Icon name="sparkle" />
              Launching {formatLaunchDate(film.launchDate, true)}
            </span>
          ) : null}
        </div>
      </div>

      <NextStep detail={detail} />

      <FilmProgress film={film} />

      <CrewLog events={events} claims={campaign?.claims ?? []} />

      <p className="sr-only" aria-live="polite">
        {announce(film.status, film.stage)}
      </p>
    </>
  );
}

/**
 * The one thing for the founder to do, straight under the title. While the crew works there is
 * nothing to do, and the progress card says what is happening instead.
 */
export function NextStep({ detail }: { detail: FilmDetail }) {
  const { film, events } = detail;
  if (film.status === 'needs_you') {
    return (
      <div className="alert alert-needs callout">
        <Icon name="sparkle" />
        <div className="text">
          <h3>
            {film.scriptVersion > 1
              ? `Version ${film.scriptVersion} is ready`
              : 'Your script is ready'}
          </h3>
          <p>Read it and approve it. Nothing renders until you say yes.</p>
        </div>
        <Link className="btn btn-primary" href={`/films/${film.id}/script`}>
          Review script <Icon name="arrow-right" />
        </Link>
      </div>
    );
  }
  if (film.status === 'done') {
    const files = detail.deliverables.filter(
      (file) => file.scriptVersion === film.scriptVersion,
    ).length;
    return (
      <div className="alert alert-done callout">
        <Icon name="check" />
        <div className="text">
          <h3>Your video is ready</h3>
          <p>
            {files === 1 ? '1 file is' : `${files} files are`} waiting, one for each shape you
            picked.
          </p>
        </div>
        <Link className="btn btn-primary" href={`/films/${film.id}/deliverables`}>
          Get your files <Icon name="arrow-right" />
        </Link>
      </div>
    );
  }
  if (film.status === 'failed') {
    const reason = [...events].reverse().find((event) => event.kind === 'failed');
    return (
      <div className="alert alert-failed callout">
        <Icon name="warning" />
        <div className="text">
          <h3>The crew had to stop</h3>
          <p>{reason?.message ?? 'Something went wrong while making this video.'}</p>
        </div>
      </div>
    );
  }
  return null;
}

function announce(status: FilmStatus, stage: Stage): string {
  if (status === 'working') return `${WORKING_LABELS[stage]}.`;
  return `${STATUS_LABELS[status]}.`;
}
