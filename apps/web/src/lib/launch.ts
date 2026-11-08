/**
 * The launch plan: the day a founder launches and where they will post the film. The founder
 * enters both on the film page; nothing here is guessed. Kept free of zod and of server code,
 * because the film page uses it in the browser.
 */
import type { Campaign } from '@boiler-room/schema';

/** The channels in DESIGN.md, in the order the landing page lists them. */
export const CHANNELS = ['x', 'linkedin', 'product_hunt', 'youtube', 'reels', 'tiktok'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  product_hunt: 'Product Hunt',
  youtube: 'YouTube',
  reels: 'Reels',
  tiktok: 'TikTok',
};

/** Reads a stored channel list, dropping anything unknown and keeping the order above. */
export function parseChannels(json: string | null | undefined): Channel[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return CHANNELS.filter((channel) => value.includes(channel));
  } catch {
    return [];
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A launch day is a calendar date, `YYYY-MM-DD`, with no time and no time zone. */
export function isLaunchDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative once `to` has passed. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / 86_400_000);
}

/** Today in the viewer's own calendar, as `YYYY-MM-DD`. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Today in UTC, as `YYYY-MM-DD`. The server's idea of today. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Adds whole days to a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  return new Date(utcDay(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** "Tuesday 18 November", or "Tue 18 Nov" when `short`. */
export function formatLaunchDate(date: string, short = false): string {
  return new Date(utcDay(date)).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: short ? 'short' : 'long',
    day: 'numeric',
    month: short ? 'short' : 'long',
  });
}

/** The countdown's words for `days` to launch. */
export function countdownWords(days: number): { score: string; words: string } {
  if (days > 1) return { score: String(days), words: 'days to launch' };
  if (days === 1) return { score: '1', words: 'day to launch' };
  if (days === 0) return { score: '0', words: 'Launch day is today' };
  const ago = -days;
  return { score: String(ago), words: ago === 1 ? 'day since launch' : 'days since launch' };
}

/**
 * The most films one approval can make: every shape, with the main opening or any alternate one,
 * and any call to action. The customer picks which of them to render.
 */
export function videosAtMost(campaign: Campaign): number {
  const openings = 1 + campaign.variants.hooks.length;
  const ctas = Math.max(1, campaign.variants.ctas.length);
  return campaign.variants.formats.length * openings * ctas;
}

function utcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}
