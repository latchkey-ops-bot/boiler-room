import {
  type FilmStatus,
  SIMULATED_SECONDS,
  STAGE_LABELS,
  STAGES,
  STOP_LABELS,
  STOP_OF,
  STOPS,
  type Stage,
  type Stop,
  stopIndex,
} from '../lib/film.ts';
import type { FilmView } from '../server/api/films.ts';
import { Boyle } from './boyle.tsx';

/** What the crew is doing at each stage, in plain words. */
export const AT_WORK: Record<Stage, string> = {
  research: 'The Researcher is reading your site.',
  script: 'The Director is writing your script.',
  checks: 'The Validator is checking every number against your site.',
  approval: 'Your script is nearly ready.',
  art_direction: 'The Art Director is choosing the look of each scene.',
  motion: 'Motion is animating the scenes.',
  audio: 'Audio is adding the voiceover and music.',
  render: 'Render is cutting a file for each shape.',
  review: 'Quality Check is watching every frame.',
  delivery: 'The Account Manager is getting your files ready.',
};

export type StopState = 'done' | 'now' | 'needs' | 'failed' | 'next';

/** Where one of the four stops is, given where the film is. */
export function stopState(stop: Stop, stage: Stage, status: FilmStatus): StopState {
  const at = stopIndex(stage);
  const here = STOPS.indexOf(stop);
  if (status === 'done' || here < at) return 'done';
  if (here > at) return 'next';
  if (status === 'needs_you') return 'needs';
  if (status === 'failed') return 'failed';
  return 'now';
}

/** The one line on where the film is: "Step 3 of 4 · You approve: waiting for you". */
export function progressLine(stage: Stage, status: FilmStatus): string {
  const stop = STOP_OF[stage];
  const step = `Step ${stopIndex(stage) + 1} of ${STOPS.length} · ${STOP_LABELS[stop]}`;
  if (status === 'done') return `All ${STOPS.length} steps done · Delivered`;
  if (status === 'queued') return `${step}: next in line`;
  if (status === 'needs_you') return `${step}: waiting for you`;
  if (status === 'failed') return `${step}: stopped`;
  return step;
}

/**
 * How long the wait is, where it is known. A simulated film runs on a fixed clock, so its times
 * are real; a real film's times are not measured yet, so nothing is promised for it.
 */
export function waitLine(film: Pick<FilmView, 'simulated' | 'stage'>): string | null {
  if (!film.simulated) return null;
  return stopIndex(film.stage) < STOPS.indexOf('approve')
    ? `A simulated film reaches its script about ${SIMULATED_SECONDS.script} seconds after it starts.`
    : `A simulated film is delivered about ${SIMULATED_SECONDS.delivery} seconds after you approve.`;
}

/**
 * Where the film is, on the same four stops as the landing page. While the crew works this is the
 * status card too: who is on it, how long it takes, and that the page updates by itself.
 */
export function FilmProgress({ film }: { film: FilmView }) {
  const working = film.status === 'working' || film.status === 'queued';
  const stop = STOP_OF[film.stage];
  const wait = working ? waitLine(film) : null;
  return (
    <section className="card progress-card" aria-labelledby="progress-title">
      {working ? (
        <div className="progress-now">
          <Boyle size={48} steaming />
          <div className="text">
            <h2 id="progress-title">
              {film.status === 'queued' ? 'Your video is next in line' : 'The crew is on it'}
            </h2>
            <p>
              {film.status === 'queued' ? 'The crew starts in a moment.' : AT_WORK[film.stage]}{' '}
              {wait ? `${wait} ` : ''}This page updates by itself, so you can leave it open.
            </p>
          </div>
        </div>
      ) : (
        <h2 id="progress-title" className="sr-only">
          Progress
        </h2>
      )}
      <p className="label progress-line">{progressLine(film.stage, film.status)}</p>
      <ol className="stops">
        {STOPS.map((item) => {
          const state = stopState(item, film.stage, film.status);
          return (
            <li
              key={item}
              className={`stop stop-${state}`}
              aria-current={state === 'now' || state === 'needs' ? 'step' : undefined}
            >
              <span className="bar" aria-hidden="true" />
              <span className="name">{STOP_LABELS[item]}</span>
            </li>
          );
        })}
      </ol>
      {working && stop === 'make' ? <SubSteps stage={film.stage} /> : null}
    </section>
  );
}

/** Inside "Animate and deliver", the crew's own steps, the current one in bold. */
function SubSteps({ stage }: { stage: Stage }) {
  const steps = STAGES.filter((item) => STOP_OF[item] === 'make');
  return (
    <p className="substeps">
      {steps.map((item, index) => (
        <span key={item}>
          {index > 0 ? ' · ' : ''}
          {item === stage ? <strong>{STAGE_LABELS[item]}</strong> : STAGE_LABELS[item]}
        </span>
      ))}
    </p>
  );
}
