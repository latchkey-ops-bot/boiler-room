'use client';

import type { Campaign } from '@boiler-room/schema';
import { type FormEvent, useState } from 'react';
import { sendJson } from '../lib/api-client.ts';
import {
  CHANNEL_LABELS,
  CHANNELS,
  type Channel,
  countdownWords,
  daysBetween,
  formatLaunchDate,
  localToday,
  utcToday,
  videosAtMost,
} from '../lib/launch.ts';
import type { FilmView } from '../server/api/films.ts';
import { useMounted } from './use-mounted.ts';

/**
 * The launch plan, as in the dashboard sample: days to launch and where the founder will post,
 * then what the crew is making and the brand it found. The founder sets the day and channels here;
 * the rest comes from the campaign the crew wrote.
 */
export function LaunchPlan({
  film,
  campaign,
  onFilm,
}: {
  film: FilmView;
  campaign: Campaign | null;
  onFilm: (film: FilmView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const planned = film.launchDate !== null;
  return (
    <section className="card card-cream launch-plan" aria-labelledby="launch-title">
      <div className="launch-head">
        <h2 id="launch-title" className="card-title">
          Launch plan
        </h2>
        {planned && !editing ? (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(true)}>
            Change
          </button>
        ) : null}
      </div>
      {film.launchDate && !editing ? (
        <Countdown date={film.launchDate} channels={film.launchChannels} />
      ) : (
        <LaunchForm
          film={film}
          onSaved={(saved) => {
            onFilm(saved);
            setEditing(false);
          }}
          onCancel={planned ? () => setEditing(false) : undefined}
        />
      )}
      {campaign ? (
        <CampaignFacts campaign={campaign} />
      ) : (
        <p className="plan-later">
          Length, scenes and claims show up here once the Director has written your script.
        </p>
      )}
    </section>
  );
}

/** "11 days to launch", in scoreboard numbers, counted in the viewer's own calendar. */
export function Countdown({ date, channels }: { date: string; channels: Channel[] }) {
  const mounted = useMounted();
  const today = mounted ? localToday() : utcToday();
  const { score, words } = countdownWords(daysBetween(today, date));
  return (
    <div className="countdown px px-flat" key={mounted ? 'local' : 'server'}>
      <span className="score" suppressHydrationWarning>
        {score}
      </span>
      <div className="countdown-text">
        <strong suppressHydrationWarning>{words}</strong>
        <span className="muted">{formatLaunchDate(date)}</span>
        {channels.length > 0 ? (
          <ul className="post-to" aria-label="Posting to">
            {channels.map((channel) => (
              <li key={channel} className="badge badge-plain">
                {CHANNEL_LABELS[channel]}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function LaunchForm({
  film,
  onSaved,
  onCancel,
}: {
  film: FilmView;
  onSaved: (film: FilmView) => void;
  onCancel?: () => void;
}) {
  const [date, setDate] = useState(film.launchDate ?? '');
  const [channels, setChannels] = useState<Channel[]>(film.launchChannels);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = `launch-error-${film.id}`;

  function toggle(channel: Channel, on: boolean) {
    setChannels((current) =>
      CHANNELS.filter((item) => (item === channel ? on : current.includes(item))),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date) {
      setError('Pick the day you launch.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await sendJson<{ film: FilmView }>(`/api/films/${film.id}/launch`, 'PUT', {
      date,
      channels,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.issues?.[0]?.message ?? result.error.message);
      return;
    }
    onSaved(result.data.film);
  }

  return (
    <form className="launch-form px px-flat" onSubmit={submit} noValidate>
      <div className="field">
        <label className="label" htmlFor={`launch-date-${film.id}`}>
          When do you launch?
        </label>
        <input
          className="input"
          id={`launch-date-${film.id}`}
          type="date"
          value={date}
          min={utcToday()}
          onChange={(event) => setDate(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      <fieldset className="field">
        <legend className="label">Where will you post it?</legend>
        <div className="channel-choices">
          {CHANNELS.map((channel) => (
            <label key={channel} className="check">
              <input
                type="checkbox"
                checked={channels.includes(channel)}
                onChange={(event) => toggle(channel, event.target.checked)}
              />
              {CHANNEL_LABELS[channel]}
            </label>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
      <div className="launch-actions">
        <button className="btn btn-sm" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save launch day'}
        </button>
        {onCancel ? (
          <button className="btn btn-ghost btn-sm" type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** Length, scenes, claims and the most videos, then the brand the Researcher found. */
export function CampaignFacts({ campaign }: { campaign: Campaign }) {
  const approved = campaign.claims.filter((claim) => claim.status === 'approved').length;
  const colors = Object.entries(campaign.brand.colors).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  const { display, body } = campaign.brand.fonts;
  return (
    <>
      <dl className="facts">
        <div className="fact">
          <dt className="label muted">Length</dt>
          <dd className="score">{campaign.durationSeconds}s</dd>
        </div>
        <div className="fact">
          <dt className="label muted">Scenes</dt>
          <dd className="score">{campaign.scenes.length}</dd>
        </div>
        <div className="fact">
          <dt className="label muted">Claims · {approved} approved</dt>
          <dd className="score">{campaign.claims.length}</dd>
        </div>
        <div className="fact">
          <dt className="label muted">Videos, at most</dt>
          <dd className="score">{videosAtMost(campaign)}</dd>
        </div>
      </dl>
      <div className="kit">
        <span className="label">Brand found on {hostOf(campaign.sourceUrl)}</span>
        <ul className="swatches" aria-label="Brand colours">
          {colors.map(([role, color]) => (
            <li key={role} className="swatch" style={{ background: color }} title={color}>
              <span className="sr-only">
                {role} {color}
              </span>
            </li>
          ))}
        </ul>
        <p className="kit-fonts">
          {display.family === body.family
            ? `${display.family} for everything.`
            : `${display.family} for headlines, ${body.family} for text.`}
        </p>
      </div>
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
