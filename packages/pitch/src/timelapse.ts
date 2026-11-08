import type { RunEvent } from './manifest.ts';

/** Moments when someone acts on screen. They play fastest-readable; the waits between them race. */
const INTERACTIVE = new Set([
  'typing',
  'submitted',
  'film',
  'script_open',
  'confirmed_number',
  'approved',
  'delivered_page',
  'done',
]);
const LEAD_MS = 1500;
const TAIL_MS = 3500;
/** A wait (research, script, a render) never takes more than this many seconds of the scene. */
const WAIT_CAP_S = 2.5;
/** Short waits still race at least this fast, so a 4-second page load is not a 2-second beat. */
const WAIT_MIN_SPEED = 6;
/** Interactive moments never play faster than this; past it the waits shrink instead. */
const INTERACTIVE_MAX_SPEED = 6;

export interface LapsePoint {
  /** ms since the recording started */
  real: number;
  /** output frame within the scene */
  out: number;
}

interface Segment {
  a: number;
  b: number;
  interactive: boolean;
}

/** A status the recorder could not read (the browser closed, say) is not a stage of the film. */
const isStage = (e: RunEvent) => e.kind === 'status' && e.status !== 'unknown';

/**
 * Maps the recording onto `outFrames` frames. It starts just before the first thing someone does
 * on screen (the sign-in is cut), splits the waits at every stage change, gives each wait at most
 * WAIT_CAP_S seconds, and lets the interactive moments fill the rest at one shared speed. Nothing
 * plays slower than real time, so a short recording ends early and holds its last frame.
 */
export function planTimelapse(
  frames: number[],
  events: RunEvent[],
  outFrames: number,
  fps: number,
): LapsePoint[] {
  const end = frames.at(-1) ?? 0;
  if (end <= 0 || outFrames <= 0) return [{ real: 0, out: 0 }];

  const windows: [number, number][] = [];
  for (const e of events) {
    if (!INTERACTIVE.has(e.kind)) continue;
    const a = Math.max(0, e.ms - LEAD_MS);
    const b = Math.min(end, e.ms + TAIL_MS);
    if (b <= a) continue;
    const last = windows.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else windows.push([a, b]);
  }
  const start = windows[0]?.[0] ?? 0;

  const segments: Segment[] = [];
  const cuts = events.filter(isStage).map((e) => e.ms);
  const pushWait = (a: number, b: number) => {
    let from = a;
    for (const cut of cuts) {
      if (cut > from && cut < b) {
        segments.push({ a: from, b: cut, interactive: false });
        from = cut;
      }
    }
    if (b > from) segments.push({ a: from, b, interactive: false });
  };
  let cursor = start;
  for (const [a, b] of windows) {
    if (a > cursor) pushWait(cursor, a);
    segments.push({ a, b, interactive: true });
    cursor = b;
  }
  if (cursor < end) pushWait(cursor, end);

  const outSeconds = outFrames / fps;
  const realS = (s: Segment) => (s.b - s.a) / 1000;
  const waits = segments.filter((s) => !s.interactive);
  const interactiveReal = segments.filter((s) => s.interactive).reduce((n, s) => n + realS(s), 0);

  // Each wait's share of the scene, in output seconds.
  const waitOut = new Map<Segment, number>(
    waits.map((s) => [s, Math.min(realS(s) / WAIT_MIN_SPEED, WAIT_CAP_S)]),
  );
  const waitTotal = () => [...waitOut.values()].reduce((n, v) => n + v, 0);

  let speed = 1;
  if (interactiveReal > 0) {
    const room = outSeconds - waitTotal();
    speed = room > 0 ? interactiveReal / room : Number.POSITIVE_INFINITY;
    if (speed > INTERACTIVE_MAX_SPEED) {
      // Too little room: hold interactive moments at the cap and shrink the waits to fit.
      speed = Math.max(INTERACTIVE_MAX_SPEED, interactiveReal / outSeconds);
      const left = Math.max(0, outSeconds - interactiveReal / speed);
      const k = waitTotal() > 0 ? left / waitTotal() : 0;
      for (const [s, v] of waitOut) waitOut.set(s, v * k);
    }
  }
  if (speed < 1) {
    // More room than the moments need at real time: let the waits run longer, up to real time.
    speed = 1;
    let spare = outSeconds - interactiveReal - waitTotal();
    for (const [s, v] of waitOut) {
      const grow = Math.min(spare, realS(s) - v);
      if (grow > 0) {
        waitOut.set(s, v + grow);
        spare -= grow;
      }
    }
  }

  const points: LapsePoint[] = [{ real: start, out: 0 }];
  let out = 0;
  for (const s of segments) {
    out += (s.interactive ? realS(s) / speed : (waitOut.get(s) ?? 0)) * fps;
    points.push({ real: s.b, out });
  }
  return points;
}

/** The recording time shown at an output frame. */
export function realMsAt(points: LapsePoint[], frame: number): number {
  let prev = points[0] ?? { real: 0, out: 0 };
  for (const p of points) {
    if (p.out >= frame) {
      const span = p.out - prev.out;
      return span <= 0 ? p.real : prev.real + ((frame - prev.out) / span) * (p.real - prev.real);
    }
    prev = p;
  }
  return prev.real;
}

/** The newest frame taken at or before `ms`. */
export function frameAt(frames: number[], ms: number): number | undefined {
  let lo = 0;
  let hi = frames.length - 1;
  let found = frames[0];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = frames[mid] ?? 0;
    if (value <= ms) {
      found = value;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** When the clock starts: the moment the URL was submitted, so it reads as the film's own time. */
export function clockZero(events: RunEvent[]): number {
  return events.find((e) => e.kind === 'submitted')?.ms ?? 0;
}

/** Elapsed time as "11m 36s", so it cannot be read as a time of day. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

/** The captions, in the order a film goes through them. A caption never steps back. */
const CAPTIONS = [
  'Paste a URL.',
  'A researcher reads the site.',
  'A director writes the script.',
  'The script waits for you.',
  'Every number, quoted from the site.',
  'You approve it.',
  'An art director picks the shots.',
  'The film renders.',
  'A quality check reviews it.',
  'Delivered.',
] as const;

/** The stage names the film API reports, each to its caption. */
const STAGE_CAPTION: Record<string, number> = {
  research: 1,
  script: 2,
  approval: 3,
  art_direction: 6,
  render: 7,
  review: 8,
  delivery: 9,
};

function captionIndex(e: RunEvent): number | undefined {
  switch (e.kind) {
    case 'typing':
    case 'submitted':
    case 'film':
      return 0;
    case 'script_open':
    case 'confirmed_number':
      return 4;
    case 'approved':
      return 5;
    case 'delivered_page':
    case 'done':
      return 9;
    case 'status':
      if (!isStage(e)) return undefined;
      if (e.status === 'done') return 9;
      return STAGE_CAPTION[`${e.stage ?? ''}`];
    default:
      return undefined;
  }
}

/** What the time-lapse is showing at recording time `ms`, in plain words. */
export function captionAt(events: RunEvent[], ms: number): string {
  let index = 0;
  for (const e of events) {
    if (e.ms > ms) break;
    index = Math.max(index, captionIndex(e) ?? index);
  }
  return CAPTIONS[index] ?? CAPTIONS[0];
}
