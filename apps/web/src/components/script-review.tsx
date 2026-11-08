'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useRef,
  useState,
} from 'react';
import { sendJson } from '../lib/api-client.ts';
import type { Format } from '../lib/film.ts';
import type {
  ReviewClaim,
  ReviewModel,
  ReviewScene,
  ReviewState,
  ReviewText,
} from '../server/script-review.ts';
import { ClaimText } from './claim-text.tsx';
import { Icon } from './icon.tsx';
import { SimulatedNote } from './simulated-note.tsx';
import { SimulatedBadge } from './status-badge.tsx';

const SHAPE_NAMES: Record<Format, string> = { '16:9': 'Wide', '9:16': 'Tall', '1:1': 'Square' };
const SHAPE_CLASS: Record<Format, string> = { '16:9': 'wide', '9:16': 'tall', '1:1': 'square' };
const NUMBER = /(\$?\d[\d,.]*(?:%|x\b)?)/g;

type Tab = 'scene' | 'claims' | 'json';
const TABS: Tab[] = ['scene', 'claims', 'json'];

/**
 * The one step a customer acts on: read the script scene by scene, check the source of every
 * number, then approve it or send it back with a note. Built from the script review sample in
 * boiler-room-design. Approve is the one primary action; its choices (opening, call to action and
 * shapes) are confirmed in a dialog, so the screen itself stays about reading.
 */
export function ScriptReview({ model }: { model: ReviewModel }) {
  const router = useRouter();
  const { film, scenes, hooks } = model;
  const waiting = model.state === 'waiting';

  const [sceneIndex, setSceneIndex] = useState(0);
  const [opening, setOpening] = useState<string | null>(model.approved?.hookId ?? null);
  const [shape, setShape] = useState<Format>(
    model.approved?.formats[0] ?? model.formats[0] ?? '16:9',
  );
  const [tab, setTab] = useState<Tab>('scene');
  const dialog = useRef<HTMLDialogElement>(null);
  const [approveOpen, setApproveOpen] = useState(false);

  const hook = hooks.find((item) => item.id === opening) ?? null;
  const shown = sceneIndex === 0 && hook ? hook.scene : (scenes[sceneIndex] ?? scenes[0]);
  if (!shown) return null;

  const claims = new Map(model.claims.map((claim) => [claim.id, claim]));

  function selectScene(index: number) {
    setSceneIndex(index);
    setTab('scene');
  }

  function chooseOpening(id: string | null) {
    setOpening(id);
    selectScene(0);
  }

  function openApprove() {
    setApproveOpen(true);
    dialog.current?.showModal();
  }

  function decided() {
    router.push(`/films/${film.id}`);
    router.refresh();
  }

  return (
    <div className="script-review">
      <nav className="review-crumb" aria-label="Back">
        <Link className="back-link" href={`/films/${film.id}`}>
          <Icon name="arrow-right" />
          {film.title}
        </Link>
      </nav>
      <header className="review-bar">
        <h1>Script review</h1>
        <div className="badges">
          <span className="badge badge-plain">
            {film.scriptVersion > 0 ? `Version ${film.scriptVersion}` : 'Draft'}
          </span>
          {model.validatorPassed ? (
            <span className="badge badge-done">Validator passed</span>
          ) : null}
          <StateBadge state={model.state} />
          {film.simulated ? <SimulatedBadge /> : null}
        </div>
        <div className="actions">
          {waiting ? (
            <>
              <button className="btn btn-cream" type="submit" form="changes">
                Request changes
              </button>
              <button className="btn btn-primary" type="button" onClick={openApprove}>
                <Icon name="check" />
                Approve script
              </button>
            </>
          ) : (
            <Link className="btn" href={`/films/${film.id}`}>
              Back to the video
            </Link>
          )}
        </div>
      </header>

      {film.simulated ? <SimulatedNote /> : null}
      <StateNote model={model} />

      <div className="review-layout">
        <div className="review-main">
          <section className="card player" aria-label="Preview">
            <Preview model={model} scene={shown} shape={shape} />
            <div className="controls">
              <p className="where">
                <span className="label">
                  Scene {shown.number} of {scenes.length}
                </span>
                <span className="time">
                  {clock(shown.start)} to {clock(shown.end)}
                </span>
              </p>
              {model.formats.length > 1 ? (
                <Seg
                  label="Shape"
                  description="Shape to preview"
                  options={model.formats.map((format) => ({ id: format, text: format }))}
                  value={shape}
                  onChange={(id) => setShape(id as Format)}
                />
              ) : null}
              {hooks.length > 0 ? (
                <Seg
                  label="Opening"
                  options={[
                    { id: '', text: 'Main' },
                    ...hooks.map((item) => ({ id: item.id, text: item.label })),
                  ]}
                  value={opening ?? ''}
                  onChange={(id) => chooseOpening(id || null)}
                  disabled={model.state === 'approved'}
                />
              ) : null}
            </div>
          </section>

          <Timeline
            model={model}
            selected={sceneIndex}
            onSelect={selectScene}
            openingLabel={hook?.label ?? null}
          />
        </div>

        <aside className="inspector" aria-label="Script details">
          <Tabs
            tab={tab}
            onChange={setTab}
            labels={{
              scene: `Scene ${shown.number}`,
              claims: `Claims · ${model.claims.length}`,
              json: 'campaign.json',
            }}
            panels={{
              scene: (
                <SceneDetail
                  scene={shown}
                  hookLabel={sceneIndex === 0 ? (hook?.label ?? null) : null}
                  claims={claims}
                />
              ),
              claims: <ClaimList claims={model.claims} />,
              json: <CampaignJson json={model.campaignJson} />,
            }}
          />

          {model.unconfirmed.length > 0 ? (
            <Unconfirmed model={model} claims={claims} waiting={waiting} />
          ) : null}

          {waiting ? (
            <ChangesForm filmId={film.id} version={film.scriptVersion} onDone={decided} />
          ) : null}
        </aside>
      </div>

      {waiting ? (
        <ApproveDialog
          ref={dialog}
          model={model}
          open={approveOpen}
          opening={opening}
          onCancel={() => dialog.current?.close()}
          onClose={() => setApproveOpen(false)}
          onDone={decided}
        />
      ) : null}
    </div>
  );
}

// ---------- Top bar ----------

function StateBadge({ state }: { state: ReviewState }) {
  switch (state) {
    case 'waiting':
      return <span className="badge badge-needs">Needs you</span>;
    case 'approved':
      return <span className="badge badge-done">Approved</span>;
    case 'rewriting':
      return <span className="badge badge-working">Rewriting</span>;
    case 'failed':
      return <span className="badge badge-failed">Needs a fix</span>;
    default:
      return <span className="badge badge-working">Checking</span>;
  }
}

/** One line on where the script is, when it is not waiting for the founder. */
function StateNote({ model }: { model: ReviewModel }) {
  const { state, film } = model;
  if (state === 'waiting') return null;
  if (state === 'approved') {
    const choice = model.approved;
    const hook = model.hooks.find((item) => item.id === choice?.hookId);
    const cta = model.ctas.find((item) => item.id === choice?.ctaId);
    return (
      <div className="alert alert-done" role="status">
        <Icon name="check" />
        <p>
          <strong>You approved version {film.scriptVersion}.</strong> Opening:{' '}
          {hook ? hook.label : 'Main'}
          {cta ? `. Call to action: ${cta.label}` : ''}
          {choice ? `. Shapes: ${choice.formats.join(', ')}.` : '.'} The script can't change now.
        </p>
      </div>
    );
  }
  if (state === 'rewriting') {
    return (
      <div className="alert" role="status">
        <Icon name="clapper" />
        <p>
          <strong>The Director is rewriting this script from your note.</strong>{' '}
          {model.rewriteNote ? `"${model.rewriteNote}" ` : ''}Version {film.scriptVersion + 1} shows
          here once the Validator has checked it. This page updates by itself.
        </p>
      </div>
    );
  }
  if (state === 'failed') {
    return (
      <div className="alert alert-failed" role="status">
        <Icon name="warning" />
        <p>
          <strong>The crew stopped on this film.</strong> The script below is the last one they
          wrote.
        </p>
      </div>
    );
  }
  return (
    <div className="alert" role="status">
      <Icon name="clock" />
      <p>
        <strong>The crew is still on this script.</strong> The Validator checks every number before
        you see it. This page updates by itself.
      </p>
    </div>
  );
}

// ---------- Preview: the scene in the customer's brand ----------

function Preview({
  model,
  scene,
  shape,
}: {
  model: ReviewModel;
  scene: ReviewScene;
  shape: Format;
}) {
  const { brand } = model;
  const style = {
    '--b-bg': brand.background,
    '--b-fg': brand.foreground,
    '--b-primary': brand.primary,
    '--b-muted': brand.muted,
    '--b-radius': `${brand.radius}px`,
    '--b-display': `${fontName(brand.displayFont)}, var(--br-font-body)`,
    '--b-body': `${fontName(brand.bodyFont)}, var(--br-font-body)`,
  } as CSSProperties;
  const center = scene.props.some((prop) => prop.key === 'Align' && prop.value === 'center');
  const classes = ['frame', `frame-${SHAPE_CLASS[shape]}`, scene.showsProduct ? 'with-shot' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="stage" style={style}>
      <span className="tag">Preview · {brand.name}'s brand · no render yet</span>
      <div className={classes}>
        <div className={center && !scene.showsProduct ? 'copy copy-center' : 'copy'}>
          {scene.text.map((item) => (
            <PreviewLine key={item.id} item={item} />
          ))}
        </div>
        {scene.showsProduct ? (
          <div className="shot" aria-hidden="true">
            <div className="dots">
              <i />
              <i />
              <i />
            </div>
            <div className="bars">
              {[40, 62, 48, 80, 66, 96].map((height) => (
                <i key={height} style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>
        ) : null}
        <div className="safe" aria-hidden="true" />
      </div>
    </div>
  );
}

function PreviewLine({ item }: { item: ReviewText }) {
  if (item.role === 'cta') return <span className="cta">{item.value}</span>;
  const className = item.role === 'headline' ? 'big' : item.role === 'label' ? 'small' : 'mid';
  const parts = item.value.split(NUMBER);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one string never reorder
        index % 2 === 1 ? <em key={index}>{part}</em> : <span key={index}>{part}</span>,
      )}
    </span>
  );
}

/** A family name, quoted and stripped to safe characters, for a CSS font-family list. */
function fontName(family: string): string {
  return `'${family.replace(/[^\w -]/g, '')}'`;
}

// ---------- Timeline ----------

function Timeline({
  model,
  selected,
  onSelect,
  openingLabel,
}: {
  model: ReviewModel;
  selected: number;
  onSelect: (index: number) => void;
  openingLabel: string | null;
}) {
  const total = model.durationSeconds;
  const at = (seconds: number) => `${(seconds / total) * 100}%`;
  const span = (scene: ReviewScene) => ({
    left: at(scene.start),
    width: `calc(${((scene.end - scene.start) / total) * 100}% - 4px)`,
  });
  return (
    <section className="timeline" aria-label="Timeline">
      <div className="lane">
        <span className="spacer" aria-hidden="true" />
        <div className="ruler label" aria-hidden="true">
          {model.ticks.map((tick) => (
            <span key={tick} style={{ left: at(tick) }}>
              {seconds(tick)}
            </span>
          ))}
        </div>
      </div>
      <div className="lane">
        <span className="label">Scenes</span>
        <div className="lane-track scenes">
          {model.scenes.map((scene, index) => {
            const name = index === 0 && openingLabel ? openingLabel : scene.name;
            return (
              <button
                key={scene.id}
                type="button"
                className="scene"
                style={span(scene)}
                aria-pressed={index === selected}
                aria-label={`Scene ${scene.number}, ${name}, ${seconds(scene.start)} to ${seconds(scene.end)}`}
                onClick={() => onSelect(index)}
              >
                <strong>{name}</strong>
                <span className="label">
                  {scene.type} · {seconds(scene.end - scene.start)}
                </span>
              </button>
            );
          })}
          {model.scenes.slice(0, -1).map((scene) =>
            scene.transitionOut ? (
              <span
                key={scene.id}
                className="transition"
                style={{ left: at(scene.end) }}
                title={`${scene.transitionOut} into scene ${scene.number + 1}`}
              >
                <span className="sr-only">
                  {scene.transitionOut} into scene {scene.number + 1}
                </span>
              </span>
            ) : null,
          )}
        </div>
      </div>
      <div className="lane">
        <span className="label">Voice</span>
        <div className="lane-track voice" aria-hidden="true">
          {model.scenes.map((scene) =>
            scene.voiceover ? (
              <span key={scene.id} style={span(scene)} title={scene.voiceover.text} />
            ) : null,
          )}
        </div>
      </div>
      {model.music ? (
        <div className="lane">
          <span className="label">Music</span>
          <div className="lane-track music" title={model.music} />
        </div>
      ) : null}
      {model.sfx.length > 0 ? (
        <div className="lane">
          <span className="label">Sound</span>
          <div className="lane-track sfx">
            {model.sfx.map((effect) => (
              <span
                key={`${effect.assetId}-${effect.at}`}
                style={{ left: at(effect.at) }}
                title={`${effect.assetId} at ${seconds(effect.at)}`}
              >
                <Icon name="sparkle" />
                <span className="sr-only">
                  {effect.assetId} at {seconds(effect.at)}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---------- Inspector ----------

function Tabs({
  tab,
  onChange,
  labels,
  panels,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
  labels: Record<Tab, string>;
  panels: Record<Tab, ReactNode>;
}) {
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length] ?? 'scene';
    onChange(next);
    refs.current[next]?.focus();
  }
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Script details" onKeyDown={onKeyDown}>
        {TABS.map((id) => (
          <button
            key={id}
            ref={(element) => {
              refs.current[id] = element;
            }}
            id={`tab-${id}`}
            className="tab"
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => onChange(id)}
          >
            {labels[id]}
          </button>
        ))}
      </div>
      {/* Every panel is in the page, so every claim and its source is there without a click. */}
      {TABS.map((id) => (
        <div
          key={id}
          className="card panel"
          role="tabpanel"
          id={`panel-${id}`}
          aria-labelledby={`tab-${id}`}
          hidden={tab !== id}
        >
          {panels[id]}
        </div>
      ))}
    </>
  );
}

function SceneDetail({
  scene,
  hookLabel,
  claims,
}: {
  scene: ReviewScene;
  hookLabel: string | null;
  claims: Map<string, ReviewClaim>;
}) {
  // Each claim's source shows once, under the first line that cites it.
  const shown = new Set<string>();
  const firstUse = (ids: string[]) =>
    ids.flatMap((id) => {
      const claim = claims.get(id);
      if (!claim || shown.has(id)) return [];
      shown.add(id);
      return [claim];
    });
  return (
    <>
      <div className="scene-head">
        <h2>{hookLabel ?? scene.name}</h2>
        <span className="label muted">
          {seconds(scene.start)} to {seconds(scene.end)}
        </span>
      </div>
      {hookLabel ? (
        <p className="hint">An alternate opening. It replaces the main scene 1.</p>
      ) : null}
      <div className="props">
        <span className="badge badge-plain">Template · {scene.type}</span>
        {scene.props.map((prop) => (
          <span key={prop.key} className="badge badge-plain">
            {prop.key} · {prop.value}
          </span>
        ))}
        {scene.transitionOut ? (
          <span className="badge badge-plain">Out · {scene.transitionOut}</span>
        ) : null}
      </div>
      {scene.text.map((item) => (
        <div key={item.id} className="copy-item">
          <div className="top">
            <span className="label">{item.label}</span>
            <span className={item.length > item.limit ? 'label count over' : 'label count'}>
              {item.length} / {item.limit}
            </span>
          </div>
          <p className="value">
            <ClaimText text={item.value} />
          </p>
          {firstUse(item.claimIds).map((claim) => (
            <ClaimCard key={claim.id} claim={claim} />
          ))}
        </div>
      ))}
      {scene.voiceover ? (
        <div className="copy-item">
          <div className="top">
            <span className="label">Voiceover</span>
          </div>
          <p className="value body">
            <ClaimText text={scene.voiceover.text} />
          </p>
          {firstUse(scene.voiceover.claimIds).map((claim) => (
            <ClaimCard key={claim.id} claim={claim} />
          ))}
        </div>
      ) : (
        <p className="hint">No voiceover in this scene.</p>
      )}
    </>
  );
}

function ClaimCard({ claim, usage }: { claim: ReviewClaim; usage?: boolean }) {
  return (
    <div className="claim-card">
      <div className="top">
        <span className="label">Source · {claim.id}</span>
        {claim.approved ? (
          <span className="badge badge-done">Approved</span>
        ) : (
          <span className="badge badge-queued">Not confirmed</span>
        )}
      </div>
      <blockquote>
        "<ClaimText text={claim.quote} />"
      </blockquote>
      <a className="source" href={claim.sourceUrl} target="_blank" rel="noopener noreferrer">
        {claim.sourceLabel}
      </a>
      {usage ? <span className="label muted">{usedIn(claim.usedIn)}</span> : null}
    </div>
  );
}

function ClaimList({ claims }: { claims: ReviewClaim[] }) {
  return (
    <>
      <p className="intro">
        Every number in the video is copied word for word from one of these quotes, from the page it
        links to.
      </p>
      {claims.length === 0 ? <p className="hint">This script makes no claims.</p> : null}
      {claims.map((claim) => (
        <ClaimCard key={claim.id} claim={claim} usage />
      ))}
    </>
  );
}

function CampaignJson({ json }: { json: string }) {
  return (
    <>
      <p className="intro">The script as data, exactly what the crew renders from.</p>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region needs focus for keyboard users */}
      <section className="json" tabIndex={0} aria-label="campaign.json">
        <pre>{json}</pre>
      </section>
    </>
  );
}

function Unconfirmed({
  model,
  claims,
  waiting,
}: {
  model: ReviewModel;
  claims: Map<string, ReviewClaim>;
  waiting: boolean;
}) {
  const count = model.unconfirmed.length;
  return (
    <section className="card card-cream confirm" aria-labelledby="confirm-title">
      <div className="row">
        <h3 id="confirm-title">
          {count === 1 ? 'One claim' : `${count} claims`}{' '}
          {waiting ? 'to confirm' : 'nobody confirmed'}
        </h3>
        <span className="badge badge-queued">Not confirmed</span>
      </div>
      {model.unconfirmed.map((use) => {
        const claim = claims.get(use.claimId);
        if (!claim) return null;
        return (
          <div key={use.claimId} className="stack-sm">
            <p>
              Scene {use.sceneNumber} says "<ClaimText text={use.says} />
              ". The crew found it on {claim.sourceLabel}, but nobody has confirmed it yet.
            </p>
            <div className="claim-card">
              <blockquote>
                "<ClaimText text={claim.quote} />"
              </blockquote>
              <a
                className="source"
                href={claim.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {claim.sourceLabel}
              </a>
            </div>
          </div>
        );
      })}
      {waiting ? (
        <p className="hint">If it's wrong, ask the Director to change or remove it, below.</p>
      ) : null}
    </section>
  );
}

// ---------- Decisions ----------

function ChangesForm({
  filmId,
  version,
  onDone,
}: {
  filmId: string;
  version: number;
  onDone: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (note.trim() === '') {
      setError('Write what you would like changed, then send it.');
      field.current?.focus();
      field.current?.scrollIntoView({ block: 'center' });
      return;
    }
    setBusy(true);
    setError(null);
    const result = await sendJson(`/api/films/${filmId}/script`, 'POST', {
      decision: 'send_back',
      version,
      note,
    });
    if (!result.ok) {
      setError(result.error.issues?.[0]?.message ?? result.error.message);
      setBusy(false);
      return;
    }
    onDone();
  }

  return (
    <form id="changes" className="field changes" onSubmit={submit} noValidate>
      <label className="label" htmlFor="note">
        Ask the Director for a change
      </label>
      <textarea
        ref={field}
        className="input"
        id="note"
        maxLength={2000}
        placeholder="Make the opening punchier, and say 'teams' instead of 'customers'."
        value={note}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'note-error note-hint' : 'note-hint'}
        onChange={(event) => {
          setNote(event.target.value);
          if (error) setError(null);
        }}
      />
      {error ? (
        <p id="note-error" className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <span id="note-hint" className="hint">
        The Director rewrites, the Validator checks it again, and you get a new version.
      </span>
      <div>
        <button className="btn btn-cream" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send to the Director'}
        </button>
      </div>
    </form>
  );
}

function ApproveDialog({
  ref,
  model,
  open,
  opening,
  onCancel,
  onClose,
  onDone,
}: {
  ref: Ref<HTMLDialogElement>;
  model: ReviewModel;
  open: boolean;
  opening: string | null;
  onCancel: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const { hooks, ctas, formats, film } = model;
  const [hookId, setHookId] = useState<string | null>(opening);
  const [ctaId, setCtaId] = useState<string | null>(ctas[0]?.id ?? null);
  const [picked, setPicked] = useState<Format[]>([...formats]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);

  // Each time the dialog opens, start from the opening being previewed.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setHookId(opening);
      setError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (picked.length === 0) {
      setError('Pick at least one shape.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await sendJson(`/api/films/${film.id}/script`, 'POST', {
      decision: 'approve',
      version: film.scriptVersion,
      hookId,
      ctaId,
      formats: formats.filter((format) => picked.includes(format)),
    });
    if (!result.ok) {
      setError(result.error.issues?.[0]?.message ?? result.error.message);
      setBusy(false);
      return;
    }
    onDone();
  }

  const toggle = (format: Format) =>
    setPicked((current) =>
      current.includes(format) ? current.filter((item) => item !== format) : [...current, format],
    );

  return (
    <dialog
      ref={ref}
      className="card approve-dialog"
      aria-labelledby="approve-title"
      onClose={onClose}
    >
      <form className="stack" onSubmit={submit}>
        <h2 id="approve-title">Approve version {film.scriptVersion}</h2>
        <p className="muted">
          The crew starts animating as soon as you approve. After that, the script can't change.
        </p>
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
              <span className="choice">
                <strong>Main</strong>
                <span className="muted">{model.scenes[0]?.text[0]?.value}</span>
              </span>
            </label>
            {hooks.map((hook) => (
              <label key={hook.id} className="check">
                <input
                  type="radio"
                  name="hook"
                  checked={hookId === hook.id}
                  onChange={() => setHookId(hook.id)}
                />
                <span className="choice">
                  <strong>{hook.label}</strong>
                  <span className="muted">{hook.headline}</span>
                </span>
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
                <span className="choice">
                  <strong>{cta.label}</strong>
                  <span className="muted mono">{cta.href.replace(/^https?:\/\//, '')}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <fieldset>
          <legend className="label">Shapes</legend>
          <div className="shapes">
            {formats.map((format) => (
              <label key={format} className="check">
                <input
                  type="checkbox"
                  checked={picked.includes(format)}
                  onChange={() => toggle(format)}
                />
                <span>
                  <strong>{format}</strong> <span className="muted">{SHAPE_NAMES[format]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onCancel}>
            Not yet
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy || picked.length === 0}>
            <Icon name="check" />
            {busy ? 'Approving…' : 'Approve and start'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ---------- Small pieces ----------

function Seg({
  label,
  description,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  /** The group's accessible name, when the visible label is shorter. */
  description?: string;
  options: { id: string; text: string }[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg-field">
      <span className="label muted">{label}</span>
      {/* biome-ignore lint/a11y/useSemanticElements: the design system's segmented control is a group of pressed buttons */}
      <div className="seg" role="group" aria-label={description ?? label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === value}
            disabled={disabled && option.id !== value}
            onClick={() => onChange(option.id)}
          >
            {option.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** `[2]` reads "In scene 2", `[2, 3, 4]` reads "In scenes 2, 3 and 4". */
export function usedIn(scenes: number[]): string {
  if (scenes.length === 0) return 'Not in the video';
  if (scenes.length === 1) return `In scene ${scenes[0]}`;
  return `In scenes ${scenes.slice(0, -1).join(', ')} and ${scenes.at(-1)}`;
}

/** `4` reads "4s", `4.5` reads "4.5s". */
function seconds(value: number): string {
  return `${Number(value.toFixed(2))}s`;
}

/** `4` reads "0:04", `64.5` reads "1:04.5". */
function clock(value: number): string {
  const minutes = Math.floor(value / 60);
  const rest = Number((value - minutes * 60).toFixed(2));
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}
