import type { Metadata } from 'next';
import Link from 'next/link';
import { Boyle } from '../../../components/boyle.tsx';
import { Icon } from '../../../components/icon.tsx';
import { LocalTime } from '../../../components/local-time.tsx';
import { Refresher } from '../../../components/refresher.tsx';
import { SimulatedBadge, StatusBadge } from '../../../components/status-badge.tsx';
import { listFilms } from '../../../server/api/films.ts';
import { pageContext } from '../../../server/next.ts';

export const metadata: Metadata = { title: 'Your videos' };

/** Every video, newest first, with the one that needs you on top of mind. */
export default async function FilmsPage() {
  const { films } = await listFilms(await pageContext());
  const working = films.some((film) => film.status === 'queued' || film.status === 'working');
  return (
    <>
      <Refresher active={working} everyMs={5000} />
      <div className="page-head">
        <div className="row">
          <h1>Your videos</h1>
          <Link className="btn btn-primary btn-sm" href="/films/new">
            <Icon name="plus" />
            New video
          </Link>
        </div>
      </div>

      {films.length === 0 ? (
        <section className="card card-quiet empty">
          <Boyle size={96} />
          <h2>No videos yet</h2>
          <p>
            Paste your website and the crew gets to work. You approve the script before anything
            renders.
          </p>
          <Link className="btn btn-primary" href="/films/new">
            Make your first video <Icon name="arrow-right" />
          </Link>
        </section>
      ) : (
        <section className="card" aria-label="All videos">
          <div style={{ overflowX: 'auto' }}>
            <table className="table films-table">
              <thead>
                <tr>
                  <th>Video</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {films.map((film) => (
                  <tr key={film.id}>
                    <td className="name">
                      {film.title} {film.simulated ? <SimulatedBadge /> : null}
                    </td>
                    <td className="src">{film.host}</td>
                    <td>
                      <StatusBadge status={film.status} />
                    </td>
                    <td className="muted">
                      <LocalTime iso={film.updatedAt} withDate />
                    </td>
                    <td>
                      <Link
                        href={
                          film.status === 'needs_you'
                            ? `/films/${film.id}/script`
                            : `/films/${film.id}`
                        }
                      >
                        {film.status === 'needs_you' ? 'Review' : 'Open'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
