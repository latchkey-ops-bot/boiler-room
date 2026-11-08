'use client';

import { useEffect, useRef } from 'react';
import {
  type FilmStatus,
  STAGE_ICONS,
  STAGE_LABELS,
  STAGES,
  type Stage,
  stageIndex,
  WORKING_LABELS,
} from '../lib/film.ts';
import { Icon } from './icon.tsx';

export type StationState = 'done' | 'working' | 'needs' | 'failed' | 'queued';

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

/** Where one station is, given where the film is. */
export function stationState(station: Stage, stage: Stage, status: FilmStatus): StationState {
  const at = stageIndex(stage);
  const here = stageIndex(station);
  if (status === 'done' || here < at) return 'done';
  if (here > at) return 'queued';
  if (status === 'needs_you') return 'needs';
  if (status === 'failed') return 'failed';
  return status === 'queued' ? 'queued' : 'working';
}

/** The word under a station, as in the dashboard sample: Done, Passed, Waiting, Queued. */
export function stationWord(station: Stage, state: StationState): string {
  if (state === 'done') {
    if (station === 'checks') return 'Passed';
    if (station === 'approval') return 'Approved';
    return 'Done';
  }
  if (state === 'needs') return 'Waiting';
  if (state === 'failed') return 'Stopped';
  if (state === 'working') return 'Working';
  return 'Queued';
}

/** The line beside the tracker's title: "Step 4 of 10 · paused for you". */
export function trackerSummary(stage: Stage, status: FilmStatus): string {
  const step = `Step ${stageIndex(stage) + 1} of ${STAGES.length}`;
  if (status === 'done') return 'Delivered';
  if (status === 'queued') return `${step} · queued`;
  if (status === 'needs_you') return `${step} · paused for you`;
  if (status === 'failed') return `${step} · stopped`;
  return `${step} · ${WORKING_LABELS[stage].toLowerCase()}`;
}

/** Ten stations on one pipe. Done pipes are filled; pipes still to come are dashed. */
export function PipelineTracker({ stage, status }: { stage: Stage; status: FilmStatus }) {
  const scroller = useRef<HTMLDivElement>(null);
  const current = status === 'done' ? null : stage;
  // On a phone the pipe scrolls inside its frame. Keep the station the film is at in view, also as
  // the film moves on while the page is open.
  useEffect(() => {
    const frame = scroller.current;
    const station = current && frame?.querySelector<HTMLElement>(`[data-stage="${current}"]`);
    if (!frame || !station || frame.scrollWidth <= frame.clientWidth) return;
    frame.scrollLeft = station.offsetLeft - (frame.clientWidth - station.offsetWidth) / 2;
  }, [current]);
  return (
    <section className="card pipeline-card" aria-labelledby="pipeline-title">
      <div className="pipeline-head">
        <h2 id="pipeline-title" className="card-title">
          Pipeline
        </h2>
        <span className="label muted">{trackerSummary(stage, status)}</span>
      </div>
      <div className="track-scroll" ref={scroller}>
        <ol className="track">
          {STAGES.map((station) => {
            const state = stationState(station, stage, status);
            return (
              <li
                key={station}
                className={STATION_CLASS[state]}
                data-stage={station}
                aria-current={station === current ? 'step' : undefined}
              >
                <span className={CREW_CLASS[state]}>
                  <Icon name={STAGE_ICONS[station]} />
                </span>
                <span className="name">{STAGE_LABELS[station]}</span>
                <span className="label state">{stationWord(station, state)}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
