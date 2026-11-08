'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { sendJson } from '../lib/api-client.ts';
import { ASK_FOR_CHANGES, ChangesDialog } from './changes-dialog.tsx';

/**
 * The way out when the film is not quite right: the same "Ask for changes" as on the script, here
 * a note for the Account Manager. It is the quiet action on the delivery screen, below the files.
 */
export function RevisionForm({
  filmId,
  version,
  left,
  max,
}: {
  filmId: string;
  version: number;
  /** Revisions this film has left. */
  left: number;
  /** Revisions any film can have. */
  max: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <section className="revision" aria-labelledby="revision-title">
      <h2 id="revision-title" className="card-title">
        Not quite right?
      </h2>
      <p className="hint">
        The Account Manager takes your note to the crew, and you approve the new script before
        anything renders. Your files stay here meanwhile. Each video can be changed {max} times;
        this one has {left === 1 ? '1 change' : `${left} changes`} left.
      </p>
      <div>
        <button className="btn btn-cream" type="button" onClick={() => setOpen(true)}>
          {ASK_FOR_CHANGES}
        </button>
      </div>
      <ChangesDialog
        open={open}
        intro="The Account Manager takes your note to the crew. You approve the new script before anything renders, and your files stay here meanwhile."
        placeholder="Make the logo bigger in the last scene, and say 'teams' instead of 'customers'."
        send={async (note) => {
          const result = await sendJson(`/api/films/${filmId}/revision`, 'POST', { version, note });
          return result.ok ? null : (result.error.issues?.[0]?.message ?? result.error.message);
        }}
        onClose={() => setOpen(false)}
        onSent={() => {
          router.push(`/films/${filmId}`);
          router.refresh();
        }}
      />
    </section>
  );
}
