'use client';

/** A time in the viewer's own clock. The server's render is replaced once the page loads. */
export function LocalTime({ iso, withDate = false }: { iso: string; withDate?: boolean }) {
  const date = new Date(iso);
  const text = withDate
    ? date.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return (
    <time className="mono" dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
