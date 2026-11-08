'use client';

import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icon.tsx';

/** The one phrase for a change request, everywhere on the site. */
export const ASK_FOR_CHANGES = 'Ask for changes';

/**
 * The one way to ask for changes, on the script and on a delivered video: a note in a dialog. The
 * button that opens it and the dialog's title say the same thing, so a founder never wonders
 * whether two buttons do different things.
 */
export function ChangesDialog({
  open,
  initialNote = '',
  intro,
  placeholder,
  send,
  onClose,
  onSent,
}: {
  open: boolean;
  /** A note to start from, such as the one "Remove it" writes. */
  initialNote?: string;
  /** What happens after sending, in a sentence. */
  intro: string;
  placeholder: string;
  /** Sends the note. Resolves with an error message, or null when it went. */
  send: (note: string) => Promise<string | null>;
  onClose: () => void;
  onSent: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setNote(initialNote);
      setError(null);
      element.showModal();
      field.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open, initialNote]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (note.trim() === '') {
      setError('Write what you would like changed, then send it.');
      field.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await send(note);
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    onSent();
  }

  return (
    <dialog
      ref={dialog}
      className="card changes-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <form className="stack" onSubmit={submit} noValidate>
        <h2 id={titleId}>{ASK_FOR_CHANGES}</h2>
        <p className="muted">{intro}</p>
        <label className="label" htmlFor={`${titleId}-note`}>
          What should change?
        </label>
        <textarea
          ref={field}
          className="input"
          id={`${titleId}-note`}
          maxLength={2000}
          placeholder={placeholder}
          value={note}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${titleId}-error` : undefined}
          onChange={(event) => {
            setNote(event.target.value);
            if (error) setError(null);
          }}
        />
        {error ? (
          <p id={`${titleId}-error`} className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>
            Not yet
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            <Icon name="mail" />
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
