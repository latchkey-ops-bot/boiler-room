import type { FilmRun } from '../../db/schema.ts';
import { type FilmStatus, STAGES, type Stage } from '../../lib/film.ts';

/**
 * Where a real film's run is. The computer's own state is tracked beside it, in `computer_state`.
 *
 * provisioning       the computer is being forked from the base snapshot
 * launching          bootstrap written and the runner started; waiting for its hello
 * script_running     the Researcher and the Director at work
 * script_ready       the campaign is stored; the runner is exiting
 * awaiting_approval  checkpoint taken, computer paused, waiting for the customer
 * render_queued      the customer approved; the computer is coming back
 * revise_queued      the customer sent the script back; the computer is coming back
 * render_running     the Art Director, the render, Quality Check and the uploads
 * delivering         every approved file is in; waiting for the runner to exit
 * done               delivered; the computer is being destroyed
 * stopping           a stop was asked for (cost cap, deadline, tripwire)
 * failed             the film failed; the computer is being destroyed
 * ended              nothing is left on Naive
 */
export const RUN_STATES = [
  'provisioning',
  'launching',
  'script_running',
  'script_ready',
  'awaiting_approval',
  'render_queued',
  'revise_queued',
  'render_running',
  'delivering',
  'done',
  'stopping',
  'failed',
  'ended',
] as const;
export type RunState = (typeof RUN_STATES)[number];

/** The runner is at work in these. */
export const RUNNING_STATES = ['script_running', 'render_running'] as const;

/** Nothing more will happen to the film, though Naive may still be cleaned up. */
export const TERMINAL_STATES = ['done', 'failed', 'ended'] as const;

export const isTerminal = (state: string) => (TERMINAL_STATES as readonly string[]).includes(state);

/** Which runner calls each state accepts. Anything else is `409 wrong_state`. */
export const ACCEPTS: Record<'hello' | 'instructions' | 'events', readonly RunState[]> = {
  hello: ['launching', 'script_running', 'render_running'],
  instructions: ['launching', 'script_running', 'render_running', 'stopping'],
  events: ['script_running', 'render_running', 'script_ready', 'delivering', 'stopping'],
};

/** How long each phase may run, from the runner's hello. */
export const PHASE_DEADLINE_MS = {
  script: 60 * 60_000,
  render: 45 * 60_000,
  all: 100 * 60_000,
} as const;

/**
 * The stage and status the film shows for a run. `syncFilm` writes whatever this returns into the
 * film, so every state is mapped.
 */
export function visibleStatus(run: FilmRun): { stage: Stage; status: FilmStatus } {
  const stage = asStage(run.stage);
  switch (run.state as RunState) {
    case 'provisioning':
      return { stage, status: 'queued' };
    case 'launching':
    case 'script_running':
    case 'render_queued':
    case 'revise_queued':
    case 'render_running':
    case 'stopping':
      return { stage, status: 'working' };
    case 'script_ready':
    case 'awaiting_approval':
      return { stage: 'approval', status: 'needs_you' };
    case 'delivering':
      return { stage: 'delivery', status: 'working' };
    case 'done':
      return { stage: 'delivery', status: 'done' };
    case 'failed':
      return { stage: asStage(run.failedStage ?? run.stage), status: 'failed' };
    case 'ended':
      return run.deliveredAt
        ? { stage: 'delivery', status: 'done' }
        : { stage: asStage(run.failedStage ?? run.stage), status: 'failed' };
    default:
      return { stage, status: 'failed' };
  }
}

export function asStage(value: string | null | undefined): Stage {
  return STAGES.includes(value as Stage) ? (value as Stage) : 'research';
}
