import { TIMEZONE } from './config.ts';

/** A moment read on the Pacific clock. Cloudflare cron and the CLI both run in UTC. */
export interface Pacific {
  /** `YYYY-MM-DD` in America/Los_Angeles. */
  date: string;
  /** Minutes after Pacific midnight. */
  minutes: number;
  weekday: string;
  /** `HH:MM`. */
  clock: string;
}

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'long',
});

/** Reads `now` on the Pacific clock with `Intl`, so summer time needs no change. */
export function pacific(now: Date): Pacific {
  const parts = Object.fromEntries(PARTS.formatToParts(now).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + minute,
    weekday: String(parts.weekday),
    clock: `${parts.hour}:${parts.minute}`,
  };
}

/** The Pacific weekday of an instant, such as "Tuesday". */
export const weekdayOf = (iso: string): string => pacific(new Date(iso)).weekday;

/** Whole days from `iso` to `now`. */
export const daysSince = (iso: string, now: Date): number =>
  (now.getTime() - new Date(iso).getTime()) / 86_400_000;

/** The `YYYY-MM` month of a Pacific date. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** The clock used by every phase. Tests pass a fixed one. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
