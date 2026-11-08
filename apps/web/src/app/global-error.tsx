'use client';

import { useEffect } from 'react';
import { EmptyState } from '../components/empty-state.tsx';
import { fontVariables } from './fonts.ts';
import '../styles/tokens.css';
import '../styles/components.css';
import '../styles/app.css';
import '../styles/delivery.css';

/**
 * The last resort, when the root layout itself fails. It replaces the whole document, so it brings
 * its own html, body and styles.
 */
export default function GlobalError({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  retry?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className={fontVariables}>
      <body>
        <main className="surface-app global-error">
          <EmptyState
            heading="h1"
            title="Boiler Room didn't load"
            art={
              <img className="pixel" src="/brand/boiler-mark.svg" width={96} height={96} alt="" />
            }
            action={
              <>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => (retry ?? reset)()}
                >
                  Try again
                </button>
                {/* A full page load, not the router: the router is what failed. */}
                <a className="btn" href="/">
                  Go home
                </a>
              </>
            }
          >
            <p>Something went wrong on our side. Try again in a moment.</p>
            {error.digest ? <p className="label muted">Reference {error.digest}</p> : null}
          </EmptyState>
        </main>
      </body>
    </html>
  );
}
