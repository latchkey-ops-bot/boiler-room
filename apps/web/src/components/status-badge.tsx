import { type FilmStatus, STATUS_LABELS, type Stage, WORKING_LABELS } from '../lib/film.ts';

const BADGE: Record<FilmStatus, string> = {
  queued: 'badge-queued',
  working: 'badge-working',
  needs_you: 'badge-needs',
  done: 'badge-done',
  failed: 'badge-failed',
};

/** A film's state. Given the stage, a working film says what the crew is doing, as "Rendering". */
export function StatusBadge({ status, stage }: { status: FilmStatus; stage?: Stage }) {
  const label = status === 'working' && stage ? WORKING_LABELS[stage] : STATUS_LABELS[status];
  return <span className={`badge ${BADGE[status]}`}>{label}</span>;
}

/** On every simulated film, everywhere it appears. */
export function SimulatedBadge() {
  return (
    <span className="badge badge-plain badge-simulated" title="No crew is making this film">
      Simulated
    </span>
  );
}
