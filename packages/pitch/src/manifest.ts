/** One line of the recorder's events.jsonl. */
export interface RunEvent {
  ms: number;
  kind: string;
  status?: string;
  stage?: string;
}

/** What scripts/stage-assets.mjs copied into public/ for this render. */
export interface Manifest {
  /** Time-lapse frames, as ms since the recording started; the file is run/frames/<ms 8 digits>.jpg. */
  frames: number[];
  events: RunEvent[];
  /** File names staged in public/films. */
  films: string[];
  narration: boolean;
}

export const EMPTY_MANIFEST: Manifest = { frames: [], events: [], films: [], narration: false };

export const frameFile = (ms: number): string => `run/frames/${String(ms).padStart(8, '0')}.jpg`;
