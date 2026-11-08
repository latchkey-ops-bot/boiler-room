'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { sendJson } from '../lib/api-client.ts';

/**
 * The way out when the film is not quite right: a note for the Account Manager. It is the quiet
 * action on the delivery screen, below the files.
 */
export function RevisionForm({
  filmId,
  version,
  left,
}: {
  filmId: string;
  version: number;
  /** Revisions this film has left. */
  left: number;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await sendJson(`/api/films/${filmId}/revision`, 'POST', { version, note });
    if (!result.ok) {
      setError(result.error.issues?.[0]?.message ?? result.error.message);
      setBusy(false);
      return;
    }
    router.push(`/films/${filmId}`);
    router.refresh();
  }

  return (
    <form className="field revision" onSubmit={submit}>
      <label className="label" htmlFor="revision-note">
        Want something changed?
      </label>
      <textarea
        className="input"
        id="revision-note"
        maxLength={2000}
        placeholder="Make the logo bigger in the last scene, and say 'teams' instead of 'customers'."
        value={note}
        aria-invalid={error ? true : undefined}
        aria-describedby="revision-hint"
        onChange={(event) => setNote(event.target.value)}
      />
      <span className="hint" id="revision-hint">
        The Account Manager takes it to the crew, and you approve the new script before anything
        renders. Your files stay here meanwhile.{' '}
        {left === 1 ? 'This video has 1 revision left.' : `This video has ${left} revisions left.`}
      </span>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <button className="btn btn-cream" type="submit" disabled={busy || note.trim() === ''}>
          {busy ? 'Sending…' : 'Ask for changes'}
        </button>
      </div>
    </form>
  );
}
