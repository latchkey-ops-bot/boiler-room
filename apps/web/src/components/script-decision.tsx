'use client';

import type { Campaign } from '@boiler-room/schema';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { sendJson } from '../lib/api-client.ts';
import type { Format } from '../lib/film.ts';
import { Icon } from './icon.tsx';

type Choices = Pick<Campaign, 'variants'> & { hookHeadlines: Record<string, string> };

/**
 * The one step a customer acts on. Approve is the primary action; sending the script back with a
 * note is the other way out.
 */
export function ScriptDecision({
  filmId,
  version,
  choices,
}: {
  filmId: string;
  version: number;
  choices: Choices;
}) {
  const router = useRouter();
  const { hooks, ctas, formats } = choices.variants;
  const [hookId, setHookId] = useState<string | null>(null);
  const [ctaId, setCtaId] = useState<string | null>(ctas[0]?.id ?? null);
  const [picked, setPicked] = useState<Format[]>([...formats]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'approve' | 'send_back' | null>(null);

  async function decide(body: Record<string, unknown>, kind: 'approve' | 'send_back') {
    setBusy(kind);
    setError(null);
    const result = await sendJson(`/api/films/${filmId}/script`, 'POST', { version, ...body });
    if (!result.ok) {
      setError(result.error.issues?.[0]?.message ?? result.error.message);
      setBusy(null);
      return;
    }
    router.push(`/films/${filmId}`);
    router.refresh();
  }

  function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void decide({ decision: 'approve', hookId, ctaId, formats: picked }, 'approve');
  }

  function sendBack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void decide({ decision: 'send_back', note }, 'send_back');
  }

  const toggle = (format: Format) =>
    setPicked((current) =>
      current.includes(format) ? current.filter((item) => item !== format) : [...current, format],
    );

  return (
    <div className="decide">
      <form className="card stack" onSubmit={approve}>
        <h2 style={{ fontSize: 24 }}>Approve version {version}</h2>
        {hooks.length > 0 ? (
          <fieldset>
            <legend className="label">Opening</legend>
            <label className="check">
              <input
                type="radio"
                name="hook"
                checked={hookId === null}
                onChange={() => setHookId(null)}
              />
              Main opening
            </label>
            {hooks.map((hook) => (
              <label key={hook.id} className="check">
                <input
                  type="radio"
                  name="hook"
                  checked={hookId === hook.id}
                  onChange={() => setHookId(hook.id)}
                />
                {choices.hookHeadlines[hook.id] ?? hook.id}
              </label>
            ))}
          </fieldset>
        ) : null}
        {ctas.length > 0 ? (
          <fieldset>
            <legend className="label">Call to action</legend>
            {ctas.map((cta) => (
              <label key={cta.id} className="check">
                <input
                  type="radio"
                  name="cta"
                  checked={ctaId === cta.id}
                  onChange={() => setCtaId(cta.id)}
                />
                {cta.label}
              </label>
            ))}
          </fieldset>
        ) : null}
        <fieldset>
          <legend className="label">Shapes</legend>
          <div className="choices">
            {formats.map((format) => (
              <label key={format} className="check">
                <input
                  type="checkbox"
                  checked={picked.includes(format)}
                  onChange={() => toggle(format)}
                />
                {format}
              </label>
            ))}
          </div>
        </fieldset>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="btn btn-primary btn-lg"
          type="submit"
          disabled={busy !== null || picked.length === 0}
        >
          <Icon name="check" />
          {busy === 'approve' ? 'Approving…' : 'Approve script'}
        </button>
        <p className="hint">The crew starts animating as soon as you approve.</p>
      </form>

      <form className="field" onSubmit={sendBack}>
        <label className="label" htmlFor="note">
          Or ask the Director for a change
        </label>
        <textarea
          className="input"
          id="note"
          maxLength={2000}
          placeholder="Make the opening punchier, and say 'teams' instead of 'customers'."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <span className="hint">
          The Director rewrites, the Validator checks it again, and you get a new version.
        </span>
        <div>
          <button
            className="btn btn-cream"
            type="submit"
            disabled={busy !== null || note.trim() === ''}
          >
            {busy === 'send_back' ? 'Sending…' : 'Send it back'}
          </button>
        </div>
      </form>
    </div>
  );
}
