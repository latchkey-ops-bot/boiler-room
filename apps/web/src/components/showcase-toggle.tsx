'use client';

import Link from 'next/link';
import { useState } from 'react';
import { sendJson } from '../lib/api-client.ts';

/** Opt in to the public showcase. Only offered once a video is delivered. */
export function ShowcaseToggle({
  filmId,
  initial,
  simulated,
}: {
  filmId: string;
  initial: boolean;
  simulated: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(next: boolean) {
    setBusy(true);
    setError(null);
    const result = await sendJson(`/api/films/${filmId}/showcase`, 'PUT', { optIn: next });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setOn(next);
  }

  return (
    <div className="stack">
      <label className="toggle">
        <input
          type="checkbox"
          role="switch"
          aria-checked={on}
          checked={on}
          disabled={busy}
          onChange={(event) => void change(event.target.checked)}
        />
        <span>Show my video on the Boiler Room showcase</span>
      </label>
      <p className="hint">
        {simulated
          ? 'Simulated videos never appear on the showcase, even with this on.'
          : 'Anyone can see your video, your product name and your website there. Turn it off at any time.'}
      </p>
      {on && !simulated ? (
        <p className="hint">
          <Link href="/showcase">See the showcase</Link>
        </p>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
