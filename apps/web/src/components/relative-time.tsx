'use client';

import { useEffect, useState } from 'react';
import { relativeTime } from '../lib/relative-time.ts';
import { useMounted } from './use-mounted.ts';

/**
 * "12 min ago", kept current while the page is open, with the exact time in the tooltip. The
 * browser's render replaces the server's once the page loads.
 */
export function RelativeTime({
  iso,
  className,
  prefix,
}: {
  iso: string;
  className?: string;
  /** Words before the time, as "Started" in "Started just now". */
  prefix?: string;
}) {
  const mounted = useMounted();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const then = new Date(iso);
  const text = relativeTime(then, now);
  return (
    <time
      key={mounted ? 'local' : 'server'}
      className={className}
      dateTime={iso}
      title={
        mounted
          ? then.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
          : undefined
      }
      suppressHydrationWarning
    >
      {prefix ? `${prefix} ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text}
    </time>
  );
}
