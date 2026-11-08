'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { sendJson } from '../lib/api-client.ts';
import { MARKETING_CTA } from '../lib/cta.ts';
import type { FilmDetail } from '../server/api/films.ts';
import { Icon } from './icon.tsx';

/** Paste a URL, start a video. The only job on /films/new. */
export function NewFilmForm({ initialUrl }: { initialUrl: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await sendJson<FilmDetail>('/api/films', 'POST', { url });
    if (!result.ok) {
      setError(result.error.message);
      setBusy(false);
      return;
    }
    router.push(`/films/${result.data.film.id}`);
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="url-field px">
        <Icon name="globe" />
        <input
          type="text"
          name="url"
          inputMode="url"
          autoComplete="url"
          placeholder="yourstartup.com"
          aria-label="Your product's URL"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'url-error' : 'url-hint'}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
        />
        <button className="btn btn-primary" type="submit" disabled={busy || url.trim() === ''}>
          {busy ? 'Starting…' : MARKETING_CTA} <Icon name="arrow-right" />
        </button>
      </div>
      {error ? (
        <p className="field-error" id="url-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="hint" id="url-hint">
          Your public website, such as yourstartup.com. You'll see the script before anything
          renders.
        </p>
      )}
    </form>
  );
}
