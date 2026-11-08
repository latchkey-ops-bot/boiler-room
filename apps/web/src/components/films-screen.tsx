'use client';

import Link from 'next/link';
import { filmsPollDelay } from '../lib/poll.ts';
import type { FilmView } from '../server/api/films.ts';
import { Boyle } from './boyle.tsx';
import { Icon } from './icon.tsx';
import { RelativeTime } from './relative-time.tsx';
import { SimulatedBadge, StatusBadge } from './status-badge.tsx';
import { usePolled } from './use-polled.ts';

type FilmList = { films: FilmView[] };

const listDelay = (list: FilmList) => filmsPollDelay(list.films.map((film) => film.status));

/** The app home, kept live while any film is being made. */
export function LiveFilms({ initial, banner }: { initial: FilmList; banner: boolean }) {
  const [list] = usePolled(initial, '/api/films', listDelay);
  return <FilmsScreen films={list.films} banner={banner} />;
}

/**
 * Every video, newest first, with the one waiting on the founder up top. `banner` is true when the
 * app's simulated banner already labels the screen, so the rows need no label of their own.
 */
export function FilmsScreen({ films, banner = false }: { films: FilmView[]; banner?: boolean }) {
  // The film that has waited longest goes first: the list is newest first.
  const waiting = films.filter((film) => film.status === 'needs_you').reverse();
  const first = waiting[0];
  return (
    <>
      <div className="page-head">
        <div className="row">
          <h1>Your videos</h1>
          {films.length > 0 ? (
            <Link className={first ? 'btn btn-sm' : 'btn btn-primary btn-sm'} href="/films/new">
              <Icon name="plus" />
              New video
            </Link>
          ) : null}
        </div>
      </div>

      {first ? (
        <div className="alert alert-needs callout">
          <Icon name="sparkle" />
          <div className="text">
            <h3>
              {waiting.length === 1
                ? `${first.title} needs you`
                : `${waiting.length} videos need you`}
            </h3>
            <p>
              {waiting.length === 1
                ? 'Your script is ready. Nothing renders until you say yes.'
                : `Scripts are ready. Start with ${first.title}, which has waited longest.`}
            </p>
          </div>
          <Link className="btn btn-primary" href={`/films/${first.id}/script`}>
            Review script <Icon name="arrow-right" />
          </Link>
        </div>
      ) : null}

      {films.length === 0 ? (
        <section className="card card-quiet empty">
          <Boyle size={96} />
          <h2>No videos yet</h2>
          <p>
            Paste your website and the crew gets to work. You approve the script before anything
            renders.
          </p>
          <Link className="btn btn-primary" href="/films/new">
            <Icon name="plus" />
            New video
          </Link>
        </section>
      ) : (
        <section className="card videos" aria-labelledby="videos-title">
          <h2 id="videos-title" className="card-title">
            All videos
          </h2>
          <div className="table-scroll">
            <table className="table films-table">
              <thead>
                <tr>
                  <th>Video</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>
                    <span className="sr-only">Next step</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {films.map((film) => (
                  <FilmRow key={film.id} film={film} labelled={banner} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function FilmRow({ film, labelled }: { film: FilmView; labelled: boolean }) {
  const next =
    film.status === 'needs_you'
      ? { href: `/films/${film.id}/script`, label: 'Review' }
      : film.status === 'done'
        ? { href: `/films/${film.id}/deliverables`, label: 'Get files' }
        : { href: `/films/${film.id}`, label: 'Open' };
  return (
    <tr>
      <td className="name">
        <Link className="film-link" href={`/films/${film.id}`}>
          {film.title}
        </Link>
        {film.simulated && !labelled ? <SimulatedBadge /> : null}
      </td>
      <td className="src">{film.host}</td>
      <td>
        <StatusBadge status={film.status} stage={film.stage} />
      </td>
      <td className="muted">
        <RelativeTime iso={film.updatedAt} />
      </td>
      <td className="next">
        <Link href={next.href} aria-label={`${next.label}: ${film.title}`}>
          {next.label}
        </Link>
      </td>
    </tr>
  );
}
