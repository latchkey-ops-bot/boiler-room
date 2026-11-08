'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { sendJson } from '../lib/api-client.ts';
import type { Format } from '../lib/film.ts';
import type {
  ReviewClaim,
  ReviewModel,
  ReviewScene,
  ReviewState,
  ReviewText,
  UnconfirmedUse,
} from '../server/script-review.ts';
import { BrandStage } from './brand-scene.tsx';
import { ASK_FOR_CHANGES, ChangesDialog } from './changes-dialog.tsx';
import { ClaimText } from './claim-text.tsx';
import { Icon } from './icon.tsx';
import { SimulatedBadge } from './status-badge.tsx';

const SHAPE_NAMES: Record<Format, string> = { '16:9': 'Wide', '9:16': 'Tall', '1:1': 'Square' };

/**
 * The one step a customer acts on. The whole script reads top to bottom, scene by scene, with the
 * source of every number under it; the preview beside it shows any scene in the customer's brand.
 * Then one decision: approve, or ask for changes. Approve's choices (opening, call to action and
 * shapes) are the ones shown in the script, confirmed in a dialog.
 *
 * `banner` is true when the app's simulated banner is showing, which is then the screen's one
 * simulated label.
 */
export function ScriptReview({ model, banner = false }: { model: ReviewModel; banner?: boolean }) {
  const router = useRouter();
  const { film, scenes, hooks } = model;
  const waiting = model.state === 'waiting';

  const [sceneIndex, setSceneIndex] = useState(0);
  const [opening, setOpening] = useState<string | null>(model.approved?.hookId ?? null);
  const [shape, setShape] = useState<Format>(
    model.approved?.formats[0] ?? model.formats[0] ?? '16:9',
  );
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set());
  const [approveOpen, setApproveOpen] = useState(false);
  const [changes, setChanges] = useState<{ open: boolean; note: string }>({
    open: false,
    note: '',
  });

  const hook = hooks.find((item) => item.id === opening) ?? null;
  const shown = sceneIndex === 0 && hook ? hook.scene : (scenes[sceneIndex] ?? scenes[0]);
  if (!shown) return null;
  const claims = new Map(model.claims.map((claim) => [claim.id, claim]));

  function confirm(id: string, yes: boolean) {
    setConfirmed((current) => {
      const next = new Set(current);
      if (yes) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function removeClaim(use: UnconfirmedUse) {
    setChanges({
      open: true,
      note: `Please take out "${use.says}" in scene ${use.sceneNumber}. Nobody has confirmed that number.`,
    });
  }

  function decided() {
    router.push(`/films/${film.id}`);
    router.refresh();
  }

  return (
    <div className="script-review">
      <Link className="back-link" href={`/films/${film.id}`}>
        <Icon name="arrow-right" />
        {film.title}
      </Link>
      <header className="review-head">
        <div className="title-row">
          <h1>Script review</h1>
          <StateBadge state={model.state} />
          {film.simulated && !banner ? <SimulatedBadge /> : null}
        </div>
        <p className="meta">
          {film.scriptVersion > 0 ? `Version ${film.scriptVersion}` : 'Draft'} ·{' '}
          {model.durationSeconds} seconds · {scenes.length} scenes
        </p>
        {waiting ? (
          <p className="lede">
            Read the {scenes.length} scenes and the source behind each number, then approve. Nothing
            renders until you do.
          </p>
        ) : null}
      </header>

      <StateNote model={model} claims={claims} />

      <div className="review-layout">
        <div className="review-preview">
          <section className="card player" aria-label="Preview">
            <div className="stage-box">
              <BrandStage
                look={model.look}
                scene={shown.frame}
                format={shape}
                tag={`Preview · ${model.look.name}'s brand · not rendered yet`}
              />
            </div>
            <div className="controls">
              <div className="stepper">
                <button
                  className="btn btn-sm"
                  type="button"
                  aria-label="Previous scene"
                  disabled={sceneIndex === 0}
                  onClick={() => setSceneIndex(sceneIndex - 1)}
                >
                  <Icon name="arrow-right" className="flip" />
                </button>
                <p className="where" aria-live="polite">
                  <span className="label">
                    Scene {shown.number} of {scenes.length}
                  </span>
                  <span className="name">{sceneIndex === 0 && hook ? hook.label : shown.name}</span>
                  <span className="time">
                    {clock(shown.start)} to {clock(shown.end)}
                  </span>
                </p>
                <button
                  className="btn btn-sm"
                  type="button"
                  aria-label="Next scene"
                  disabled={sceneIndex === scenes.length - 1}
                  onClick={() => setSceneIndex(sceneIndex + 1)}
                >
                  <Icon name="arrow-right" />
                </button>
              </div>
              {model.formats.length > 1 || hooks.length > 0 ? (
                <div className="preview-as">
                  <span className="label muted">Preview as</span>
                  {model.formats.length > 1 ? (
                    <Seg
                      label="Shape"
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
                      onChange={(id) => {
                        setOpening(id || null);
                        setSceneIndex(0);
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
              <p className="hint">
                These only change the preview. You choose the opening, the call to action and the
                shapes when you approve.
              </p>
            </div>
          </section>
        </div>

        <div className="review-script">
          {waiting && model.unconfirmed.length > 0 ? (
            <ConfirmClaims
              uses={model.unconfirmed}
              claims={claims}
              hooks={hooks}
              confirmed={confirmed}
              onConfirm={confirm}
              onRemove={removeClaim}
            />
          ) : null}

          <ol className="scenes" aria-label="The script">
            {scenes.map((scene, index) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                total={scenes.length}
                claims={claims}
                confirmed={confirmed}
                selected={index === sceneIndex && !(index === 0 && hook)}
                onShow={() => {
                  setSceneIndex(index);
                  if (index === 0) setOpening(null);
                }}
                extra={
                  index === 0 && hooks.length > 0 ? (
                    <div className="choice-note">
                      <span className="label">
                        {hooks.length === 1 ? 'Another opening' : 'Other openings'} you can pick
                      </span>
                      {hooks.map((item) => (
                        <p key={item.id}>
                          <strong>{item.label}:</strong> "{item.headline}"{' '}
                          <button
                            className="link-button"
                            type="button"
                            onClick={() => {
                              setOpening(item.id);
                              setSceneIndex(0);
                            }}
                          >
                            Preview it
                          </button>
                        </p>
                      ))}
                    </div>
                  ) : index === scenes.length - 1 && model.ctas.length > 0 ? (
                    <div className="choice-note">
                      <span className="label">
                        {model.ctas.length === 1
                          ? 'The call to action'
                          : 'Calls to action you can pick'}
                      </span>
                      <ul>
                        {model.ctas.map((cta) => (
                          <li key={cta.id}>
                            <strong>{cta.label}</strong>{' '}
                            <span className="muted mono">
                              {cta.href.replace(/^https?:\/\//, '')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null
                }
              />
            ))}
          </ol>

          {waiting ? (
            <Decide
              open={openClaims(model, confirmed, opening).length}
              scenes={scenes.length}
              onApprove={() => setApproveOpen(true)}
              onChanges={() => setChanges({ open: true, note: '' })}
            />
          ) : (
            <Link className="btn" href={`/films/${film.id}`}>
              Back to the video
            </Link>
          )}
        </div>
      </div>

      {waiting ? (
        <>
          <ApproveDialog
            model={model}
            open={approveOpen}
            opening={opening}
            confirmed={confirmed}
            onConfirm={confirm}
            onClose={() => setApproveOpen(false)}
            onDone={decided}
          />
          <ChangesDialog
            open={changes.open}
            initialNote={changes.note}
            intro="The Director rewrites the script, the Validator checks it again, and you get a new version to approve. Nothing renders meanwhile."
            placeholder="Make the opening punchier, and say 'teams' instead of 'customers'."
            send={async (note) => {
              const result = await sendJson(`/api/films/${film.id}/script`, 'POST', {
                decision: 'send_back',
                version: film.scriptVersion,
                note,
              });
              return result.ok ? null : (result.error.issues?.[0]?.message ?? result.error.message);
            }}
            onClose={() => setChanges((current) => ({ ...current, open: false }))}
            onSent={decided}
          />
        </>
      ) : null}
    </div>
  );
}

/** Claims that block approval of the cut with `opening`: unconfirmed, and not confirmed here. */
function openClaims(
  model: ReviewModel,
  confirmed: Set<string>,
  opening: string | null,
): UnconfirmedUse[] {
  return model.unconfirmed.filter(
    (use) => (use.hookId === null || use.hookId === opening) && !confirmed.has(use.claimId),
  );
}

// ---------- The header ----------

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
function StateNote({ model, claims }: { model: ReviewModel; claims: Map<string, ReviewClaim> }) {
  const { state, film } = model;
  if (state === 'waiting') return null;
  if (state === 'approved') {
    const choice = model.approved;
    const hook = model.hooks.find((item) => item.id === choice?.hookId);
    const cta = model.ctas.find((item) => item.id === choice?.ctaId);
    const vouched = (choice?.confirmedClaimIds ?? [])
      .map((id) => claims.get(id)?.text)
      .filter(Boolean);
    return (
      <div className="alert alert-done" role="status">
        <Icon name="check" />
        <p>
          <strong>You approved version {film.scriptVersion}.</strong> Opening:{' '}
          {hook ? hook.label : 'Main'}
          {cta ? `. Call to action: ${cta.label}` : ''}
          {choice ? `. Shapes: ${choice.formats.join(', ')}.` : '.'}
          {vouched.length > 0 ? ` You confirmed: ${vouched.join('; ')}.` : ''} The script can't
          change now.
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

// ---------- The script, top to bottom ----------

function SceneCard({
  scene,
  total,
  claims,
  confirmed,
  selected,
  onShow,
  extra,
}: {
  scene: ReviewScene;
  total: number;
  claims: Map<string, ReviewClaim>;
  confirmed: Set<string>;
  selected: boolean;
  onShow: () => void;
  extra: ReactNode;
}) {
  // The model puts the line the scene leads with first: its headline, or its first line.
  const [lead, ...rest] = scene.lines;
  const sources = scene.claimIds
    .map((id) => claims.get(id))
    .filter((claim): claim is ReviewClaim => claim !== undefined);
  return (
    <li className={selected ? 'card scene-card is-shown' : 'card scene-card'}>
      <div className="scene-top">
        <span className="label">
          Scene {scene.number} of {total} · {seconds(scene.start)} to {seconds(scene.end)}
        </span>
        <button className="link-button" type="button" onClick={onShow} aria-pressed={selected}>
          {selected ? 'In the preview' : 'Show in preview'}
        </button>
      </div>
      {lead ? (
        <h3>
          <OnScreen line={lead} />
        </h3>
      ) : null}
      {rest.length > 0 ? (
        <ul className="on-screen" aria-label="Also on screen">
          {rest.map((line) => (
            <li key={line.id} className={line.role === 'cta' ? 'is-cta' : undefined}>
              <OnScreen line={line} />
            </li>
          ))}
        </ul>
      ) : null}
      {scene.voiceover ? (
        <p className="vo">
          <span className="label">Voiceover</span>
          <span>
            "<ClaimText text={scene.voiceover.text} />"
          </span>
        </p>
      ) : null}
      {sources.length > 0 ? (
        <div className="sources">
          {sources.map((claim) => (
            <ClaimSource key={claim.id} claim={claim} confirmed={confirmed.has(claim.id)} />
          ))}
        </div>
      ) : null}
      {extra}
    </li>
  );
}

/** One line of on-screen copy. A button says it is one. */
function OnScreen({ line }: { line: ReviewText }) {
  return (
    <>
      {line.role === 'cta' ? <span className="label muted">Button </span> : null}
      <ClaimText text={line.value} />
    </>
  );
}

function ClaimSource({ claim, confirmed }: { claim: ReviewClaim; confirmed: boolean }) {
  return (
    <div className="claim-card">
      <div className="top">
        <span className="label">Source</span>
        {claim.checked ? (
          <span className="badge badge-done">Checked on the site</span>
        ) : claim.confirmedByYou || confirmed ? (
          <span className="badge badge-done">You confirmed</span>
        ) : (
          <span className="badge badge-needs">Needs you</span>
        )}
      </div>
      <blockquote>
        "<ClaimText text={claim.quote} />"
      </blockquote>
      <a className="source" href={claim.sourceUrl} target="_blank" rel="noopener noreferrer">
        {claim.sourceLabel}
      </a>
    </div>
  );
}

/** The numbers nobody has confirmed: say yes, or ask for them to come out. Pink: it needs you. */
function ConfirmClaims({
  uses,
  claims,
  hooks,
  confirmed,
  onConfirm,
  onRemove,
}: {
  uses: UnconfirmedUse[];
  claims: Map<string, ReviewClaim>;
  hooks: ReviewModel['hooks'];
  confirmed: Set<string>;
  onConfirm: (id: string, yes: boolean) => void;
  onRemove: (use: UnconfirmedUse) => void;
}) {
  const left = uses.filter((use) => !confirmed.has(use.claimId)).length;
  return (
    <section
      className={left > 0 ? 'card confirm confirm-needs' : 'card confirm confirm-done'}
      aria-labelledby="confirm-title"
    >
      <div className="row">
        <h2 id="confirm-title">
          {uses.length === 1 ? 'One number to confirm' : `${uses.length} numbers to confirm`}
        </h2>
        {left > 0 ? (
          <span className="badge badge-needs">Needs you</span>
        ) : (
          <span className="badge badge-done">Confirmed</span>
        )}
      </div>
      {uses.map((use) => {
        const claim = claims.get(use.claimId);
        if (!claim) return null;
        const yes = confirmed.has(use.claimId);
        const where = use.hookId
          ? `${hooks.find((item) => item.id === use.hookId)?.label ?? 'The other opening'} says`
          : `Scene ${use.sceneNumber} says`;
        return (
          <div key={use.claimId} className="confirm-item">
            <p>
              {where} "<ClaimText text={use.says} />
              ". The crew copied it from {claim.sourceLabel}, but nobody has confirmed it is still
              right.
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
            {yes ? (
              <p className="confirmed-line">
                <Icon name="check" />
                You confirmed {use.figure ?? 'it'}. It goes in with your approval.{' '}
                <button
                  className="link-button"
                  type="button"
                  onClick={() => onConfirm(use.claimId, false)}
                >
                  Undo
                </button>
              </p>
            ) : (
              <div className="confirm-actions">
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={() => onConfirm(use.claimId, true)}
                >
                  <Icon name="check" />
                  {use.figure ? `Yes, ${use.figure} is right` : "Yes, it's right"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => onRemove(use)}
                >
                  Remove it
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * The decision, after the script. On a phone it becomes a bar stuck to the bottom of the screen,
 * but only once the founder has scrolled down to it: never before they have read the script.
 */
function Decide({
  open,
  scenes,
  onApprove,
  onChanges,
}: {
  open: number;
  scenes: number;
  onApprove: () => void;
  onChanges: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return (
    <section
      ref={ref}
      className={seen ? 'decide is-sticky' : 'decide'}
      aria-label="Your decision"
      data-seen={seen ? 'true' : undefined}
    >
      <p>
        {open > 0
          ? open === 1
            ? 'Confirm the number above or ask for it to come out, then approve.'
            : `Confirm the ${open} numbers above or ask for them to come out, then approve.`
          : `That's all ${scenes} scenes. Approve, and the crew starts animating.`}
      </p>
      <div className="decide-actions">
        <button className="btn btn-primary" type="button" onClick={onApprove}>
          <Icon name="check" />
          Approve script
        </button>
        <button className="btn" type="button" onClick={onChanges}>
          {ASK_FOR_CHANGES}
        </button>
      </div>
    </section>
  );
}

// ---------- Approve ----------

function ApproveDialog({
  model,
  open,
  opening,
  confirmed,
  onConfirm,
  onClose,
  onDone,
}: {
  model: ReviewModel;
  open: boolean;
  opening: string | null;
  confirmed: Set<string>;
  onConfirm: (id: string, yes: boolean) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const { hooks, ctas, formats, film } = model;
  const dialog = useRef<HTMLDialogElement>(null);
  const [hookId, setHookId] = useState<string | null>(opening);
  const [ctaId, setCtaId] = useState<string | null>(ctas[0]?.id ?? null);
  const [picked, setPicked] = useState<Format[]>([...formats]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Each time the dialog opens, start from the opening being previewed.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setHookId(opening);
      setError(null);
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open, opening]);

  const blocking = openClaims(model, confirmed, hookId);
  const inCut = model.unconfirmed.filter((use) => use.hookId === null || use.hookId === hookId);
  const claimText = new Map(model.claims.map((claim) => [claim.id, claim]));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (picked.length === 0) {
      setError('Pick at least one shape.');
      return;
    }
    if (blocking.length > 0) {
      setError('Confirm every number first, or ask for changes.');
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
      confirmedClaimIds: [...confirmed],
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
      ref={dialog}
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
            <legend className="label">Opening, pick one</legend>
            <label className="radio">
              <input
                type="radio"
                name="hook"
                checked={hookId === null}
                onChange={() => setHookId(null)}
              />
              <span className="choice">
                <strong>Main</strong>
                <span className="muted">"{model.scenes[0]?.lines[0]?.value}"</span>
              </span>
            </label>
            {hooks.map((hook) => (
              <label key={hook.id} className="radio">
                <input
                  type="radio"
                  name="hook"
                  checked={hookId === hook.id}
                  onChange={() => setHookId(hook.id)}
                />
                <span className="choice">
                  <strong>{hook.label}</strong>
                  <span className="muted">"{hook.headline}"</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {ctas.length > 0 ? (
          <fieldset>
            <legend className="label">Call to action, pick one</legend>
            {ctas.map((cta) => (
              <label key={cta.id} className="radio">
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
          <legend className="label">Shapes, pick any</legend>
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
          <p className="hint">
            You get one video in each shape you pick:{' '}
            {picked.length === 1 ? '1 video' : `${picked.length} videos`}.
          </p>
        </fieldset>
        {inCut.length > 0 ? (
          <div
            className={blocking.length > 0 ? 'alert alert-needs' : 'alert alert-done'}
            role={blocking.length > 0 ? 'alert' : 'status'}
          >
            <Icon name={blocking.length > 0 ? 'warning' : 'check'} />
            <div className="stack-sm">
              <p>
                <strong>
                  {blocking.length === 0
                    ? inCut.length === 1
                      ? 'You confirmed the one unchecked number.'
                      : `You confirmed the ${inCut.length} unchecked numbers.`
                    : blocking.length === 1
                      ? 'One number still needs you.'
                      : `${blocking.length} numbers still need you.`}
                </strong>{' '}
                {blocking.length > 0
                  ? "Nobody has confirmed it yet, so it can't go in the video until you do."
                  : 'They go in the video as you confirmed them.'}
              </p>
              {inCut.map((use) => (
                <label key={use.claimId} className="check">
                  <input
                    type="checkbox"
                    checked={confirmed.has(use.claimId)}
                    onChange={(event) => onConfirm(use.claimId, event.target.checked)}
                  />
                  <span>Yes, "{claimText.get(use.claimId)?.text ?? use.says}" is right</span>
                </label>
              ))}
              {blocking.length > 0 ? (
                <p className="hint">If it's wrong, close this and ask for changes instead.</p>
              ) : null}
            </div>
          </div>
        ) : null}
        <p className="hint">
          Once it's delivered, you can still ask for changes up to {model.maxRevisions} times.
        </p>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>
            Not yet
          </button>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || picked.length === 0 || blocking.length > 0}
          >
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
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; text: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="seg-field">
      <span className="label muted">{label}</span>
      {/* biome-ignore lint/a11y/useSemanticElements: the design system's segmented control is a group of pressed buttons */}
      <div className="seg" role="group" aria-label={`Preview as: ${label.toLowerCase()}`}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === value}
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
