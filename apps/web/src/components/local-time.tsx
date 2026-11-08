'use client';

import { useMounted } from './use-mounted.ts';

/**
 * A time in the viewer's own clock. The server renders it in UTC, and the browser replaces it with
 * the local time once the page loads.
 */
export function LocalTime({ iso, withDate = false }: { iso: string; withDate?: boolean }) {
  const mounted = useMounted();
  const date = new Date(iso);
  const timeZone = mounted ? undefined : 'UTC';
  const text = withDate
    ? date.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
      })
    : // A 24-hour clock, as in the dashboard sample, so a time fits its column: 12:41.
      date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone,
      });
  return (
    <time
      key={mounted ? 'local' : 'server'}
      className="mono"
      dateTime={iso}
      suppressHydrationWarning
    >
      {text}
    </time>
  );
}
