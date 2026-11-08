'use client';

import type { Claim } from '@boiler-room/schema';
import { useState } from 'react';
import { splitClaims } from '../lib/claims.ts';
import { CREW_ICONS, CREW_LABELS } from '../lib/film.ts';
import type { FilmEventView } from '../server/api/films.ts';
import { Icon } from './icon.tsx';
import { LocalTime } from './local-time.tsx';

type Badge = [className: string, label: string];

/** The badge beside who decided, as in the dashboard sample. */
export function eventBadge(event: FilmEventView, current: boolean): Badge | null {
  switch (event.kind) {
    case 'sent_back':
      return ['badge badge-failed', 'Sent back'];
    case 'passed':
      return ['badge badge-done', 'Passed'];
    case 'delivered':
      return ['badge badge-done', 'Delivered'];
    case 'failed':
      return ['badge badge-failed', 'Failed'];
    // Only the pause the founder is in now needs them. An old one is history.
    case 'needs_you':
      return current ? ['badge badge-needs', 'Needs you'] : null;
    case 'decision':
      return event.agent === 'customer' ? ['badge badge-done', 'Approved'] : null;
    default:
      return null;
  }
}

/**
 * What the crew decided on this video, and why, oldest first. A figure the crew quotes from the
 * customer's site wears the claim highlight; clicking it shows the quote and the page it is from.
 */
export function DecisionsFeed({
  events,
  claims,
  waitingOnYou,
}: {
  events: FilmEventView[];
  claims: readonly Claim[];
  /** The film is paused for the founder now, so its latest pause is live. */
  waitingOnYou: boolean;
}) {
  const lastId = events[events.length - 1]?.id;
  return (
    <section className="card decisions" aria-labelledby="decisions-title">
      <h2 id="decisions-title" className="card-title">
        Decisions
      </h2>
      <p className="muted card-sub">What the crew decided on this video, and why.</p>
      {events.length === 0 ? (
        <p className="log-empty">The crew is getting started.</p>
      ) : (
        <ol className="log">
          {events.map((event) => (
            <Entry
              key={event.id}
              event={event}
              claims={claims}
              current={waitingOnYou && event.id === lastId}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function Entry({
  event,
  claims,
  current,
}: {
  event: FilmEventView;
  claims: readonly Claim[];
  current: boolean;
}) {
  const [open, setOpen] = useState<Claim | null>(null);
  const badge = eventBadge(event, current);
  const parts = splitClaims(event.message, claims);
  return (
    <li className="entry">
      <LocalTime iso={event.at} />
      <span className={current ? 'crew crew-active' : 'crew crew-done'}>
        <Icon name={CREW_ICONS[event.agent]} />
      </span>
      <div className="entry-body">
        <div className="who">
          <strong>{CREW_LABELS[event.agent]}</strong>
          {badge ? <span className={badge[0]}>{badge[1]}</span> : null}
        </div>
        <p>
          {parts.map((part, index) =>
            part.claim ? (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one message never reorder
                key={index}
                type="button"
                className="claim claim-button"
                aria-expanded={open?.id === part.claim.id}
                aria-label={`${part.text}: show where this number comes from`}
                onClick={() => setOpen(open?.id === part.claim.id ? null : part.claim)}
              >
                {part.text}
              </button>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one message never reorder
              <span key={index}>{part.text}</span>
            ),
          )}
        </p>
        {open ? (
          <div className="claim-card">
            <blockquote>"{open.quote}"</blockquote>
            <a className="source" href={open.sourceUrl} target="_blank" rel="noreferrer">
              {sourceLabel(open.sourceUrl)}
            </a>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function sourceLabel(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    return `${hostname.replace(/^www\./, '')}${pathname === '/' ? '' : pathname}`;
  } catch {
    return url;
  }
}
