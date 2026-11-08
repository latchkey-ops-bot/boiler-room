'use client';

import { type FormEvent, useId, useState } from 'react';
import { MARKETING_CTA } from '../lib/cta.ts';
import { parseFilmUrl } from '../lib/film-url.ts';
import { Icon } from './icon.tsx';

/**
 * The one field that matters on the marketing site: paste a URL, get a video. It is a plain GET
 * form to /start, so it works before sign-in and without JavaScript: /start sends a new visitor
 * through sign-up and on to the new video with the URL filled in. With JavaScript, a URL that is
 * not a public website is caught here, before the visitor leaves the page.
 */
export function UrlField({
  steam = false,
  label = MARKETING_CTA,
  initialUrl = '',
  initialProblem = null,
}: {
  /** The sky button, for the call to action on Pipe blue. */
  steam?: boolean;
  label?: string;
  initialUrl?: string;
  /** Why `initialUrl` cannot be used, from the server, when /start sent the visitor back. */
  initialProblem?: string | null;
}) {
  const errorId = useId();
  const [url, setUrl] = useState(initialUrl);
  const [problem, setProblem] = useState<string | null>(initialProblem);

  function submit(event: FormEvent<HTMLFormElement>) {
    const parsed = parseFilmUrl(url);
    if (parsed.ok) return;
    event.preventDefault();
    setProblem(parsed.reason);
  }

  return (
    <div className="url-start">
      <form className="url-field px" action="/start" method="get" onSubmit={submit} noValidate>
        <Icon name="globe" />
        <input
          type="text"
          name="url"
          inputMode="url"
          autoComplete="url"
          placeholder="yourstartup.com"
          aria-label="Your product's URL"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errorId : undefined}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            if (problem) setProblem(null);
          }}
        />
        <button className={`btn ${steam ? 'btn-steam' : 'btn-primary'}`} type="submit">
          {label} <Icon name="arrow-right" />
        </button>
      </form>
      {problem ? (
        <p className="field-error" id={errorId} role="alert">
          <Icon name="warning" size="sm" />
          {problem}
        </p>
      ) : null}
    </div>
  );
}
