import type { Campaign } from '@boiler-room/schema';
import type {
  CrewMember,
  EventKind,
  FilmStatus,
  Format,
  PipelineKind,
  Stage,
} from '../../lib/film.ts';

/**
 * The film pipeline as the app sees it. The crew runs on Naive; the app starts a film, reads where
 * it is and what the crew decided, passes on the customer's approval or note, and reads the files.
 *
 * `SimulatedPipeline` walks a film through every stage for development and demos.
 * `NaivePipeline` is the real one, still to be wired.
 */
export interface PipelineClient {
  readonly kind: PipelineKind;
  /** Starts making a film of `url`. `filmId` is the app's id, so a retried start is one run. */
  start(input: { filmId: string; url: string }): Promise<{ runId: string }>;
  /** Where the run is now. */
  status(runId: string): Promise<PipelineStatus>;
  /** The crew's events in order, after the event with id `after` when it is given. */
  events(runId: string, options?: { after?: string }): Promise<PipelineEvent[]>;
  /** The customer approved script `version` and chose an opening, a call to action and shapes. */
  approveScript(runId: string, input: ScriptApproval): Promise<void>;
  /** The customer sent script `version` back with a note for the Director. */
  sendBackScript(runId: string, input: { version: number; note: string }): Promise<void>;
  /** The finished files. Empty until the film is delivered. */
  deliverables(runId: string): Promise<PipelineDeliverable[]>;
}

export interface ScriptApproval {
  version: number;
  /** A hook scene id from the campaign, or null for the main opening. */
  hookId: string | null;
  /** A CTA id from the campaign, or null when the campaign has none. */
  ctaId: string | null;
  formats: Format[];
}

export interface PipelineStatus {
  runId: string;
  stage: Stage;
  status: FilmStatus;
  /** 0 until the first script is ready for the customer, then 1, 2, … for each version. */
  scriptVersion: number;
  /** The campaign the crew wrote. Null until the Director has written one. */
  campaign: Campaign | null;
}

export interface PipelineEvent {
  /** Unique within the run. */
  id: string;
  /** The event's position in the run, from 0. */
  seq: number;
  at: Date;
  agent: CrewMember;
  kind: EventKind;
  /** The stage and status the film is in once this event has happened. */
  stage: Stage;
  status: FilmStatus;
  message: string;
}

export interface PipelineDeliverable {
  /** format, hook and CTA, such as `16:9.main.start-free`. */
  variantKey: string;
  format: Format;
  hookId: string | null;
  ctaId: string | null;
  fileName: string;
  contentType: string;
  /** Where the file is in the FILMS bucket. Null when there is no file, as in a simulation. */
  r2Key: string | null;
  bytes: number | null;
  durationSeconds: number | null;
}

/** The pipeline refused a step because the run is not where the caller thought. */
export class PipelineConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineConflictError';
  }
}

/** The pipeline cannot be reached, or is not built yet. */
export class PipelineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineUnavailableError';
  }
}
