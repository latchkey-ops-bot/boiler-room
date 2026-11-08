'use client';

import Link from 'next/link';
import { type FilmStatus, STATUS_LABELS, type Stage, WORKING_LABELS } from '../lib/film.ts';
import { formatLaunchDate } from '../lib/launch.ts';
import { filmPollDelay } from '../lib/poll.ts';
import type { FilmDetail, FilmView } from '../server/api/films.ts';
import { Boyle } from './boyle.tsx';
import { DecisionsFeed } from './decisions-feed.tsx';
import { Icon } from './icon.tsx';
import { LaunchPlan } from './launch-plan.tsx';
import { PipelineTracker } from './pipeline-tracker.tsx';
import { RelativeTime } from './relative-time.tsx';
import { SimulatedNote } from './simulated-note.tsx';
import { SimulatedBadge, StatusBadge } from './status-badge.tsx';
import { usePolled } from './use-polled.ts';

const detailDelay = (detail: FilmDetail) => filmPollDelay(detail.film.status);

/**
 * The film page, kept live: it asks the API again every few seconds while the crew works, so the
 * stations, the decisions and the banner move on without a reload.
 */
export function LiveFilm({ initial }: { initial: FilmDetail }) {
  const [detail, setDetail] = usePolled(initial, `/api/films/${initial.film.id}`, detailDelay);
  return (
    <FilmScreen detail={detail} onFilm={(film) => setDetail((current) => ({ ...current, film }))} />
  );
}

/** One video: the one thing to do next, where it is on the pipe, the crew's decisions, the plan. */
export function FilmScreen({
  detail,
  onFilm,
}: {
  detail: FilmDetail;
  onFilm: (film: FilmView) => void;
}) {
  const { film, campaign, events } = detail;
  return (
    <>
      <div className="topbar">
        <div className="crumbs label">
          <Link href="/films">Videos</Link>
          <span className="muted">/</span>
          <span>{film.title}</span>
        </div>
        <Link className="btn btn-sm" href="/films/new">
          <Icon name="plus" />
          New video
        </Link>
      </div>

      <div className="title">
        <div className="title-row">
          <h1>{film.title}</h1>
          <StatusBadge status={film.status} stage={film.stage} />
          {film.simulated ? <SimulatedBadge /> : null}
        </div>
        <div className="meta">
          <span>
            <Icon name="globe" />
            {film.host}
          </span>
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

      {film.simulated ? <SimulatedNote /> : null}

      <NextStep detail={detail} />

      <PipelineTracker stage={film.stage} status={film.status} />

      <div className="split">
        <DecisionsFeed
          events={events}
          claims={campaign?.claims ?? []}
          waitingOnYou={film.status === 'needs_you'}
        />
        <LaunchPlan film={film} campaign={campaign} onFilm={onFilm} />
      </div>

      <p className="sr-only" aria-live="polite">
        {announce(film.status, film.stage)}
      </p>
    </>
  );
}

/** What the crew is doing at each station, in plain words. */
export const AT_WORK: Record<Stage, string> = {
  research: 'The Researcher is reading your site.',
  script: 'The Director is writing your script.',
  checks: 'The Validator is checking every number against your site.',
  approval: 'Your script is nearly ready.',
  art_direction: 'The Art Director is choosing the look of each scene.',
  motion: 'Motion is animating the scenes.',
  audio: 'Audio is adding the voiceover and music.',
  render: 'Render is cutting a file for each shape.',
  review: 'Quality Check is watching every frame.',
  delivery: 'The Account Manager is getting your files ready.',
};

/** The one thing to do next, or what the crew is doing while there is nothing to do. */
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
          <p>
            {film.launchDate
              ? "Approve it today and you're set for launch day. Nothing renders until you say yes."
              : 'Read it and approve it. Nothing renders until you say yes.'}
          </p>
        </div>
        <Link className="btn btn-primary" href={`/films/${film.id}/script`}>
          Review script <Icon name="arrow-right" />
        </Link>
      </div>
    );
  }
  if (film.status === 'done') {
    const files = detail.deliverables.length;
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
  return (
    <div className="alert callout callout-working">
      <Boyle size={48} steaming />
      <div className="text">
        <h3>{film.status === 'queued' ? 'Your video is next in line' : 'The crew is on it'}</h3>
        <p>
          {film.status === 'queued' ? 'The crew starts in a moment.' : AT_WORK[film.stage]} This
          page updates by itself.
        </p>
      </div>
    </div>
  );
}

function announce(status: FilmStatus, stage: Stage): string {
  if (status === 'working') return `${WORKING_LABELS[stage]}.`;
  return `${STATUS_LABELS[status]}.`;
}
