import {
  type FilmStatus,
  STAGE_ICONS,
  STAGE_LABELS,
  STAGES,
  type Stage,
  stageIndex,
} from '../lib/film.ts';
import { Icon } from './icon.tsx';

type StationState = 'done' | 'working' | 'needs' | 'failed' | 'queued';

const STATE_LABEL: Record<StationState, string> = {
  done: 'Done',
  working: 'Working',
  needs: 'Waiting for you',
  failed: 'Sent back',
  queued: 'Queued',
};

const STATION_CLASS: Record<StationState, string> = {
  done: 'station station-done',
  working: 'station station-working',
  needs: 'station station-active',
  failed: 'station station-failed',
  queued: 'station',
};

const CREW_CLASS: Record<StationState, string> = {
  done: 'crew crew-done',
  working: 'crew',
  needs: 'crew crew-active',
  failed: 'crew',
  queued: 'crew crew-waiting',
};

function stationState(station: Stage, stage: Stage, status: FilmStatus): StationState {
  const at = stageIndex(stage);
  const here = stageIndex(station);
  if (status === 'done') return 'done';
  if (here < at) return 'done';
  if (here > at) return 'queued';
  if (status === 'needs_you') return 'needs';
  if (status === 'failed') return 'failed';
  return status === 'queued' ? 'queued' : 'working';
}

/** Ten stations on one pipe. Done pipes are filled; pipes still to come are dashed. */
export function PipelineTracker({ stage, status }: { stage: Stage; status: FilmStatus }) {
  const step = stageIndex(stage) + 1;
  const summary =
    status === 'done'
      ? 'Delivered'
      : status === 'needs_you'
        ? `Step ${step} of ${STAGES.length} · paused for you`
        : `Step ${step} of ${STAGES.length}`;
  return (
    <section className="card pipeline-card" aria-label="Pipeline">
      <div className="pipeline-head">
        <h2 style={{ fontSize: 24 }}>Pipeline</h2>
        <span className="label muted">{summary}</span>
      </div>
      <div className="track-scroll">
        <ol className="track">
          {STAGES.map((station) => {
            const state = stationState(station, stage, status);
            return (
              <li
                key={station}
                className={STATION_CLASS[state]}
                aria-current={station === stage ? 'step' : undefined}
              >
                <span className={CREW_CLASS[state]}>
                  <Icon name={STAGE_ICONS[station]} />
                </span>
                <span className="name">{STAGE_LABELS[station]}</span>
                <span className="label state">{STATE_LABEL[state]}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
