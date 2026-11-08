import type { ReactNode } from 'react';

/**
 * A screen with nothing to show yet, or one that went wrong: what happened in plain words, and the
 * one thing to do next. `tone="failed"` frames it in the failed red.
 */
export function EmptyState({
  title,
  children,
  art,
  action,
  tone = 'quiet',
  heading = 'h2',
}: {
  title: string;
  children: ReactNode;
  /** Boyle, or an icon tile, above the title. */
  art?: ReactNode;
  /** The next step. Put the primary button first. */
  action?: ReactNode;
  tone?: 'quiet' | 'failed';
  heading?: 'h1' | 'h2';
}) {
  const Heading = heading;
  return (
    <section className={tone === 'failed' ? 'card empty empty-failed' : 'card card-quiet empty'}>
      {art}
      <Heading className="empty-title">{title}</Heading>
      <div className="empty-text">{children}</div>
      {action ? <div className="empty-actions">{action}</div> : null}
    </section>
  );
}
