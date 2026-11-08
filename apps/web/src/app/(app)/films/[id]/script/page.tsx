import type { Claim, Scene } from '@boiler-room/schema';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClaimText } from '../../../../../components/claim-text.tsx';
import { Icon } from '../../../../../components/icon.tsx';
import { ScriptDecision } from '../../../../../components/script-decision.tsx';
import { SimulatedNote } from '../../../../../components/simulated-note.tsx';
import { SimulatedBadge } from '../../../../../components/status-badge.tsx';
import { loadFilm } from '../../../../../server/pages.ts';

export const metadata: Metadata = { title: 'Script review' };

const ROLE_LABELS: Record<string, string> = {
  headline: 'Headline',
  subhead: 'Subhead',
  body: 'Body',
  cta: 'Call to action',
  label: 'Label',
};

/** The script, scene by scene, with the source of every number, and the one decision to make. */
export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadFilm(id);
  if (!detail) notFound();
  const { film, campaign } = detail;
  const waiting = film.status === 'needs_you' && film.stage === 'approval';

  if (!campaign) {
    return (
      <>
        <Back id={film.id} title={film.title} />
        <section className="card card-quiet empty">
          <h1>The script isn't written yet</h1>
          <p>The Director is still working. You'll see it here when it's ready.</p>
        </section>
      </>
    );
  }

  const claims = new Map(campaign.claims.map((claim) => [claim.id, claim]));
  const hookHeadlines = Object.fromEntries(
    campaign.variants.hooks.map((hook) => [hook.id, headlineOf(hook) ?? hook.id]),
  );

  return (
    <>
      <Back id={film.id} title={film.title} />
      <div className="page-head">
        <div className="row">
          <h1>Script review</h1>
          <span className="badge badge-plain">Version {film.scriptVersion}</span>
          {waiting ? <span className="badge badge-needs">Needs you</span> : null}
          {film.simulated ? <SimulatedBadge /> : null}
        </div>
        <p className="lede">
          Read each scene and the source behind every number. Nothing renders until you approve.
        </p>
      </div>
      {film.simulated ? <SimulatedNote /> : null}

      <div className="review">
        <ol className="scene-list" aria-label="Scenes">
          {campaign.scenes.map((scene, index) => (
            <li key={scene.id} className="card scene-card">
              <div className="top">
                <h2 style={{ fontSize: 20 }}>
                  Scene {index + 1} of {campaign.scenes.length}
                </h2>
                <span className="label muted">
                  {scene.type} · {scene.start.toFixed(1)}s to {scene.end.toFixed(1)}s
                </span>
              </div>
              {scene.text.map((item) => (
                <div key={item.id} className="copy-item">
                  <span className="label">{ROLE_LABELS[item.role] ?? item.role}</span>
                  <p className="value">
                    <ClaimText text={item.value} />
                  </p>
                  {item.claimIds.map((claimId) => {
                    const claim = claims.get(claimId);
                    return claim ? <ClaimCard key={claimId} claim={claim} /> : null;
                  })}
                </div>
              ))}
              {scene.voiceover ? (
                <div className="copy-item">
                  <span className="label">Voiceover</span>
                  <p className="value body">
                    <ClaimText text={scene.voiceover.text} />
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ol>

        {waiting ? (
          <ScriptDecision
            filmId={film.id}
            version={film.scriptVersion}
            choices={{ variants: campaign.variants, hookHeadlines }}
          />
        ) : (
          <aside className="decide">
            <div className="card card-quiet stack">
              <h2 style={{ fontSize: 22 }}>Nothing to decide right now</h2>
              <p className="muted">
                {film.status === 'done'
                  ? 'You approved this script and the video is delivered.'
                  : 'The crew is working on this script. You will be asked when it is ready.'}
              </p>
              <Link className="btn" href={`/films/${film.id}`}>
                Back to the video
              </Link>
            </div>
          </aside>
        )}
      </div>
    </>
  );
}

function Back({ id, title }: { id: string; title: string }) {
  return (
    <div className="crumbs label">
      <Link href="/films">Videos</Link>
      <span className="muted">/</span>
      <Link href={`/films/${id}`}>{title}</Link>
      <span className="muted">/</span>
      <span>Script</span>
    </div>
  );
}

function ClaimCard({ claim }: { claim: Claim }) {
  return (
    <div className="claim-card">
      <div className="stamp" style={{ justifyContent: 'space-between' }}>
        <span className="label">Source · {claim.id}</span>
        {claim.status === 'approved' ? (
          <span className="badge badge-done">Approved</span>
        ) : (
          <span className="badge badge-queued">Extracted</span>
        )}
      </div>
      <blockquote>
        "<ClaimText text={claim.quote} />"
      </blockquote>
      <a className="source" href={claim.sourceUrl} target="_blank" rel="noopener noreferrer">
        <Icon name="globe" size="sm" /> {claim.sourceUrl.replace(/^https?:\/\//, '')}
      </a>
    </div>
  );
}

function headlineOf(scene: Scene): string | null {
  return scene.text.find((item) => item.role === 'headline')?.value ?? null;
}
