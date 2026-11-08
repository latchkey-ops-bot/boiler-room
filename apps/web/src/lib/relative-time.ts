/**
 * "Just now", "12 min ago", "Yesterday": how long ago something happened, in the words the
 * dashboard sample uses. Countdowns over clocks, as DESIGN.md puts it.
 */
export function relativeTime(then: Date, now: Date): string {
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const days = calendarDaysBetween(then, now);
  if (days === 0) {
    const hours = Math.floor(minutes / 60);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Midnights crossed from `then` to `now`, in the viewer's own calendar. */
function calendarDaysBetween(then: Date, now: Date): number {
  const start = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((end - start) / 86_400_000);
}
