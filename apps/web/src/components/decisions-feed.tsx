'use client';

import type { Claim } from '@boiler-room/schema';
import { useState } from 'react';
import { splitClaims } from '../lib/claims.ts';
import { CREW_ICONS, CREW_LABELS } from '../lib/film.ts';
import type { FilmEventView } from '../server/api/films.ts';
import { Icon } from './icon.tsx';
import { RelativeTime } from './relative-time.tsx';

type Badge = [className: string, label: string];

/** How many entries show before "Show all". */
export const LOG_PREVIEW = 3;

/**
 * The badge beside who did it. A number the Validator caught is the system working, so it reads
 * as caught, not as a red failure. What the founder must do is said once, in the banner above.
 */
export function eventBadge(event: FilmEventView): Badge | null {
  switch (event.kind) {
    case 'sent_back':
      return event.agent === 'customer'
        ? ['badge badge-plain', 'Changes asked']
        : ['badge badge-plain', 'Caught'];
    case 'passed':
      return ['badge badge-done', 'Passed'];
    case 'delivered':
      return ['badge badge-done', 'Delivered'];
    case 'failed':
      return ['badge badge-failed', 'Failed'];
    case 'decision':
      return event.agent === 'customer' ? ['badge badge-done', 'Approved'] : null;
    default:
      return null;
  }
}

/** Newest first, and only the latest few unless the founder asks for all of them. */
export function visibleEntries(events: FilmEventView[], all: boolean): FilmEventView[] {
  const newest = [...events].reverse();
  return all ? newest : newest.slice(0, LOG_PREVIEW);
}

/**
 * What the crew did on this video, newest first: the latest three, and the rest behind "Show all".
 * A figure the crew quotes from the customer's site wears the claim highlight; clicking it shows
 * the quote and the page it is from.
 */
export function CrewLog({ events, claims }: { events: FilmEventView[]; claims: readonly Claim[] }) {
  const [all, setAll] = useState(false);
  const shown = visibleEntries(events, all);
  return (
    <section className="card decisions" aria-labelledby="decisions-title">
      <div className="log-head">
        <h2 id="decisions-title" className="card-title">
          What the crew did
        </h2>
        {events.length > LOG_PREVIEW ? (
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            aria-expanded={all}
            aria-controls="crew-log"
            onClick={() => setAll(!all)}
          >
            {all ? 'Show the latest' : `Show all ${events.length}`}
          </button>
        ) : null}
      </div>
      {events.length === 0 ? (
        <p className="log-empty">The crew is getting started.</p>
      ) : (
        <ol className="log" id="crew-log">
          {shown.map((event) => (
            <Entry key={event.id} event={event} claims={claims} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Entry({ event, claims }: { event: FilmEventView; claims: readonly Claim[] }) {
  const [open, setOpen] = useState<Claim | null>(null);
  const badge = eventBadge(event);
  const parts = splitClaims(event.message, claims);
  return (
    <li className="entry">
      <span className="crew crew-done">
        <Icon name={CREW_ICONS[event.agent]} />
      </span>
      <div className="entry-body">
        <div className="who">
          <strong>{CREW_LABELS[event.agent]}</strong>
          {badge ? <span className={badge[0]}>{badge[1]}</span> : null}
          <RelativeTime iso={event.at} className="when" />
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
