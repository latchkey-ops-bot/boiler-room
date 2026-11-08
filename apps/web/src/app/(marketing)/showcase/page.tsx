import type { Metadata } from 'next';
import Link from 'next/link';
import { Boyle } from '../../../components/boyle.tsx';
import { Icon } from '../../../components/icon.tsx';
import { getDb } from '../../../db/client.ts';
import { workerBindings } from '../../../server/next.ts';
import { showcaseFilms } from '../../../server/showcase.ts';

export const metadata: Metadata = { title: 'Showcase' };
export const dynamic = 'force-dynamic';

/** The launch wall: real films whose founders chose to show them. */
export default async function Showcase() {
  const launches = await showcaseFilms(getDb(workerBindings().DB));
  return (
    <section className="section bg-cream" style={{ minHeight: '60vh' }}>
      <div className="wrap">
        <div className="wall-head">
          <div className="section-head">
            <span className="label eyebrow">
              <b>BR</b> Showcase
            </span>
            <h1>Fresh out of the boiler room</h1>
            <p>
              Launch videos the crew made, shown by the founders who launched them. Every one is a
              real launch.
            </p>
          </div>
          <Link className="btn btn-primary" href="/films/new">
            <Icon name="plus" />
            Make yours
          </Link>
        </div>
        {launches.length === 0 ? (
          <div className="card card-quiet wall-empty">
            <Boyle size={96} />
            <h2>The first launches are on their way</h2>
            <p>
              Boiler Room's own launch video goes up first. After that, founders add theirs here
              when their video is delivered.
            </p>
          </div>
        ) : (
          <div className="wall">
            {launches.map((launch) => (
              <article key={launch.id} className="card launch">
                <div
                  className="thumb"
                  style={{ background: launch.background, color: launch.foreground }}
                >
                  {launch.headline ?? launch.brand}
                </div>
                <div className="body">
                  <h4>{launch.brand}</h4>
                  <p>{launch.host}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
