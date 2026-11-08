import { type FilmStatus, STATUS_LABELS } from '../lib/film.ts';

const BADGE: Record<FilmStatus, string> = {
  queued: 'badge-queued',
  working: 'badge-working',
  needs_you: 'badge-needs',
  done: 'badge-done',
  failed: 'badge-failed',
};

export function StatusBadge({ status }: { status: FilmStatus }) {
  return <span className={`badge ${BADGE[status]}`}>{STATUS_LABELS[status]}</span>;
}

/** On every simulated film, everywhere it appears. */
export function SimulatedBadge() {
  return (
    <span className="badge badge-plain badge-simulated" title="No crew is making this film">
      Simulated
    </span>
  );
}
