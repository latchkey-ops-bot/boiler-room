'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { EmptyState } from '../../components/empty-state.tsx';
import { Icon } from '../../components/icon.tsx';
import '../../styles/delivery.css';

/**
 * Any app page that fails to load. Production hides the error's message, so the words stay
 * general; the reference is the digest Next logs with the error, for finding it in the Worker logs.
 */
export default function AppError({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Next 16.4 also passes `retry`, which fetches the page again before it resets. */
  retry?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      heading="h1"
      tone="failed"
      title="This page didn't load"
      art={
        <span className="crew crew-failed">
          <Icon name="warning" />
        </span>
      }
      action={
        <>
          <button className="btn btn-primary" type="button" onClick={() => (retry ?? reset)()}>
            Try again
          </button>
          <Link className="btn" href="/films">
            Your videos
          </Link>
        </>
      }
    >
      <p>Something went wrong on our side. Your videos are safe. Try again in a moment.</p>
      {error.digest ? <p className="label muted">Reference {error.digest}</p> : null}
    </EmptyState>
  );
}
