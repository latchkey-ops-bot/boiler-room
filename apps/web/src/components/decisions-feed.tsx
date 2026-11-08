import { CREW_ICONS, CREW_LABELS } from '../lib/film.ts';
import type { FilmEventView } from '../server/api/films.ts';
import { Icon } from './icon.tsx';
import { LocalTime } from './local-time.tsx';

const KIND_BADGE: Partial<Record<FilmEventView['kind'], [string, string]>> = {
  sent_back: ['badge badge-failed', 'Sent back'],
  passed: ['badge badge-done', 'Passed'],
  needs_you: ['badge badge-needs', 'Needs you'],
  delivered: ['badge badge-done', 'Delivered'],
  failed: ['badge badge-failed', 'Failed'],
};

/** What the crew decided on this video, and why, oldest first. */
export function DecisionsFeed({ events }: { events: FilmEventView[] }) {
  return (
    <section className="card" aria-label="Decisions">
      <h2 style={{ fontSize: 24 }}>Decisions</h2>
      <p className="muted" style={{ fontSize: 14 }}>
        What the crew decided on this video, and why.
      </p>
      {events.length === 0 ? (
        <p style={{ marginTop: 16 }}>The crew is getting started.</p>
      ) : (
        <ol className="log">
          {events.map((event) => {
            const badge = KIND_BADGE[event.kind];
            const tile =
              event.kind === 'needs_you'
                ? 'crew crew-active'
                : event.kind === 'sent_back' || event.kind === 'failed'
                  ? 'crew'
                  : 'crew crew-done';
            return (
              <li key={event.id} className="entry">
                <LocalTime iso={event.at} />
                <span className={tile}>
                  <Icon name={CREW_ICONS[event.agent]} />
                </span>
                <div>
                  <div className="who">
                    <strong>{CREW_LABELS[event.agent]}</strong>
                    {badge ? <span className={badge[0]}>{badge[1]}</span> : null}
                  </div>
                  <p>{event.message}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
