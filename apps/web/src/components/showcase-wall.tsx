import type { ShowcaseFilm } from '../server/showcase.ts';
import { Boyle } from './boyle.tsx';
import { ShowcasePlayer } from './showcase-player.tsx';

const DELIVERED = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * The launch wall: real films only, each shown because its founder chose to show it. Until the
 * first one is delivered it says so plainly, and never fills the space with made-up launches.
 */
export function ShowcaseWall({ launches }: { launches: ShowcaseFilm[] | null }) {
  if (launches === null) {
    return (
      <div className="card card-quiet wall-empty" role="status">
        <h3>The showcase didn't load</h3>
        <p>Something went wrong on our side. Try again in a minute.</p>
      </div>
    );
  }
  if (launches.length === 0) {
    return (
      <div className="card card-quiet wall-empty">
        <Boyle size={96} />
        <h3>The first launch videos are on their way</h3>
        <p>
          Boiler Room's own launch video goes up first. After that, founders add theirs here when
          their video is delivered.
        </p>
      </div>
    );
  }
  return (
    <ul className="wall">
      {launches.map((launch) => (
        <li key={launch.id} className="card launch">
          <ShowcasePlayer
            brand={launch.brand}
            headline={launch.headline}
            background={launch.background}
            foreground={launch.foreground}
            videoPath={launch.videoPath}
          />
          <div className="body">
            <h3>
              {launch.brand}
              {launch.house ? <span className="badge badge-plain">Our own</span> : null}
            </h3>
            <p>{launch.host}</p>
          </div>
          <div className="foot">
            <span className="label muted">
              Delivered{' '}
              <time dateTime={launch.deliveredAt}>
                {DELIVERED.format(new Date(launch.deliveredAt))}
              </time>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
