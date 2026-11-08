import type { RunEvent } from './manifest.ts';

/** Moments when someone acts on screen. They play near real speed; waits between them race. */
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
/** Interactive moments play at this many times real speed, unless they would not fit. */
const INTERACTIVE_SPEED = 2;
/** The share of the scene that interactive moments may take at most. */
const INTERACTIVE_SHARE = 0.5;

export interface LapsePoint {
  /** ms since the recording started */
  real: number;
  /** output frame within the scene */
  out: number;
}

/**
 * Maps the whole recording onto `outFrames` frames: interactive windows at about 2x, every wait in
 * between at whatever speed fills the rest. Never slower than real time, so a short recording ends
 * early and holds its last frame.
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

  const segments: { a: number; b: number; interactive: boolean }[] = [];
  let cursor = 0;
  for (const [a, b] of windows) {
    if (a > cursor) segments.push({ a: cursor, b: a, interactive: false });
    segments.push({ a, b, interactive: true });
    cursor = b;
  }
  if (cursor < end) segments.push({ a: cursor, b: end, interactive: false });

  const outSeconds = outFrames / fps;
  const realInteractive = segments.filter((s) => s.interactive).reduce((n, s) => n + s.b - s.a, 0);
  const realWait = end - realInteractive;

  let slow = INTERACTIVE_SPEED;
  if (realInteractive / 1000 / slow > INTERACTIVE_SHARE * outSeconds) {
    slow = realInteractive / 1000 / (INTERACTIVE_SHARE * outSeconds);
  }
  const waitSeconds = outSeconds - realInteractive / 1000 / slow;
  let fast = realWait > 0 ? realWait / 1000 / Math.max(waitSeconds, 1e-6) : slow;
  if (realWait <= 0) slow = realInteractive / 1000 / outSeconds;
  slow = Math.max(1, slow);
  fast = Math.max(1, fast);

  const points: LapsePoint[] = [{ real: 0, out: 0 }];
  let out = 0;
  for (const s of segments) {
    out += ((s.b - s.a) / 1000 / (s.interactive ? slow : fast)) * fps;
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

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function captionFor(e: RunEvent): string | undefined {
  switch (e.kind) {
    case 'typing':
    case 'submitted':
    case 'film':
      return 'Paste a URL.';
    case 'script_open':
    case 'confirmed_number':
      return 'Every number is quoted from the site.';
    case 'approved':
      return 'You approve it.';
    case 'delivered_page':
    case 'done':
      return 'Delivered.';
    case 'status': {
      const stage = `${e.stage ?? ''}`.toLowerCase();
      if (e.status === 'done') return 'Delivered.';
      if (stage.includes('research')) return 'A researcher reads the site.';
      if (stage.includes('approval')) return 'The script waits for you.';
      if (stage.includes('script') || stage.includes('direct'))
        return 'A director writes the script.';
      if (stage.includes('art') || stage.includes('anim'))
        return 'An art director picks the shots.';
      if (stage.includes('render')) return 'The film renders.';
      if (stage.includes('qc') || stage.includes('quality') || stage.includes('check'))
        return 'A quality check watches every frame.';
      return undefined;
    }
    default:
      return undefined;
  }
}

/** What the time-lapse is showing at recording time `ms`, in plain words. */
export function captionAt(events: RunEvent[], ms: number): string {
  let caption = 'Paste a URL.';
  for (const e of events) {
    if (e.ms > ms) break;
    caption = captionFor(e) ?? caption;
  }
  return caption;
}
