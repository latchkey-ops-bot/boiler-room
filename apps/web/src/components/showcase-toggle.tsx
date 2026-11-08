'use client';

import Link from 'next/link';
import { useState } from 'react';
import { sendJson } from '../lib/api-client.ts';

/**
 * Opt in to the public showcase. Only offered once a video is delivered. A switch that says On or
 * Off in words, and says so again once the choice is saved.
 */
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
  const [saved, setSaved] = useState(false);

  async function change(next: boolean) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await sendJson(`/api/films/${filmId}/showcase`, 'PUT', { optIn: next });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setOn(next);
    setSaved(true);
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
        <span className={on ? 'switch-state is-on' : 'switch-state'} aria-hidden="true">
          {on ? 'On' : 'Off'}
        </span>
        <span>Show my video on the Boiler Room showcase</span>
      </label>
      <p className={saved ? 'saved' : 'sr-only'} role="status">
        {saved ? savedWords(on, simulated) : ''}
      </p>
      <p className="hint">
        {simulated
          ? 'Simulated videos never appear on the showcase, even with this on.'
          : 'Anyone can see your video, your product name and your website there. Turn it off at any time.'}
      </p>
      {on && !simulated ? (
        <p className="hint">
          <Link href="/showcase">See it on the showcase</Link>
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

function savedWords(on: boolean, simulated: boolean): string {
  if (!on) return 'Saved. Your video is off the showcase.';
  return simulated
    ? 'Saved. This simulated video still stays off the showcase.'
    : 'Saved. Your video is on the showcase now.';
}
