import type { Campaign } from '@boiler-room/schema';
import Link from 'next/link';
import { brandLook, brandScenes } from '../lib/brand-scene.ts';
import {
  type Cut,
  clock,
  cutsOf,
  deliveryState,
  fileSize,
  revisionsLeft,
  SHAPES,
  variantName,
} from '../lib/delivery.ts';
import type { DeliverableView, FilmDetail } from '../server/api/films.ts';
import { Boyle } from './boyle.tsx';
import { EmptyState } from './empty-state.tsx';
import {
  FilmPlayer,
  type PlayerFile,
  type PlayerPreview,
  type PlayerShape,
} from './film-player.tsx';
import { Icon } from './icon.tsx';
import { LocalTime } from './local-time.tsx';
import { RevisionForm } from './revision-form.tsx';
import { ShowcaseToggle } from './showcase-toggle.tsx';
import { SimulatedBadge, StatusBadge } from './status-badge.tsx';

/**
 * The delivery screen: the finished video in a large player, its files to download, the showcase
 * choice, and the way to ask for changes. One job, getting the video out; download is the one
 * primary action. It takes plain data, so tests render it without Clerk or a Worker.
 */
export function DeliveryScreen({
  detail,
  maxRevisions,
  banner = false,
}: {
  detail: FilmDetail;
  maxRevisions: number;
  /** The app's simulated banner is showing: then it is the screen's one simulated label. */
  banner?: boolean;
}) {
  const { film, campaign } = detail;
  const cuts = cutsOf(detail.deliverables);
  const state = deliveryState(film, cuts);
  const [current, ...earlier] = cuts;
  const next = film.scriptVersion > (current?.version ?? 0) ? film.scriptVersion : null;
  const left = revisionsLeft(detail.revisions, maxRevisions);

  return (
    <>
      <div className="page-head">
        <div className="crumbs label">
          <Link href="/films">Videos</Link>
          <span className="muted">/</span>
          <Link href={`/films/${film.id}`}>{film.title}</Link>
          <span className="muted">/</span>
          <span>Your video</span>
        </div>
        <div className="row">
          <h1>{state === 'delivered' ? 'Your video is ready' : 'Your video'}</h1>
          <StatusBadge status={film.status} />
          {film.simulated && !banner ? <SimulatedBadge /> : null}
        </div>
        <div className="meta">
          <span>
            <Icon name="globe" />
            {film.host}
          </span>
          {current ? (
            <span>
              <Icon name="film" />
              {[
                current.version > 0 ? `Version ${current.version}` : null,
                campaign ? `${clock(campaign.durationSeconds)} long` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          ) : null}
          {state === 'delivered' ? (
            <span>
              <Icon name="check" />
              Delivered <LocalTime iso={film.updatedAt} withDate />
            </span>
          ) : null}
        </div>
      </div>

      {state === 'failed' ? <Failed url={film.url} /> : null}
      {state === 'waiting' ? (
        <Waiting filmId={film.id} needsYou={film.status === 'needs_you'} />
      ) : null}
      {state === 'revising' && current ? (
        <Revising
          filmId={film.id}
          needsYou={film.status === 'needs_you'}
          next={next}
          shown={current.version}
        />
      ) : null}

      {current && (state === 'delivered' || state === 'revising') ? (
        <div className="delivery">
          <div className="delivery-player">
            <FilmPlayer
              shapes={playerShapes(current)}
              preview={campaign ? playerPreview(campaign, current) : null}
              durationSeconds={
                current.files[0]?.durationSeconds ?? campaign?.durationSeconds ?? null
              }
              files={downloads(current)}
              primary={!(state === 'revising' && film.status === 'needs_you')}
            />
          </div>
          <aside className="delivery-side">
            <Files cut={current} earlier={earlier} campaign={campaign} />
            {state === 'delivered' ? (
              <section className="card card-quiet showcase-card" aria-labelledby="showcase-title">
                <h2 id="showcase-title" className="card-title">
                  Showcase
                </h2>
                <ShowcaseToggle
                  filmId={film.id}
                  initial={film.showcaseOptIn}
                  simulated={film.simulated}
                />
              </section>
            ) : null}
          </aside>
          {state === 'delivered' ? (
            <div className="delivery-change">
              {left > 0 ? (
                <RevisionForm
                  filmId={film.id}
                  version={film.scriptVersion}
                  left={left}
                  max={maxRevisions}
                />
              ) : (
                <p className="hint">
                  This video has had {maxRevisions} revisions, the most one video can have. For a
                  fresh take,{' '}
                  <Link href={`/films/new?url=${encodeURIComponent(film.url)}`}>
                    start a new video
                  </Link>
                  .
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** The files of one cut, a row per shape and variant, and the earlier cuts tucked away. */
function Files({
  cut,
  earlier,
  campaign,
}: {
  cut: Cut;
  earlier: Cut[];
  campaign: Campaign | null;
}) {
  const formats = cut.files.map((file) => file.format);
  const variants = new Set(formats).size < formats.length;
  return (
    <section className="card files-card" aria-labelledby="files-title">
      <div className="files-head">
        <h2 id="files-title" className="card-title">
          Your files
        </h2>
        <span className="label muted">
          {cut.files.length === 1 ? '1 file' : `${cut.files.length} files`}
          {cut.version > 0 ? ` · version ${cut.version}` : null}
        </span>
      </div>
      <ul className="files" aria-label={`Files of ${cutName(cut.version)}`}>
        {cut.files.map((file) => (
          <FileRow key={file.id} file={file} campaign={campaign} showVariant={variants} />
        ))}
      </ul>
      {earlier.length > 0 ? (
        <details className="earlier">
          <summary>
            Earlier {earlier.length === 1 ? 'cut' : 'cuts'} ({earlier.length})
          </summary>
          {earlier.map((older) => (
            <ul
              key={older.version}
              className="files"
              aria-label={`Files of ${cutName(older.version)}`}
            >
              {older.files.map((file) => (
                <FileRow key={file.id} file={file} campaign={campaign} showVariant compact />
              ))}
            </ul>
          ))}
        </details>
      ) : null}
    </section>
  );
}

function FileRow({
  file,
  campaign,
  showVariant,
  compact = false,
}: {
  file: DeliverableView;
  campaign: Campaign | null;
  showVariant: boolean;
  compact?: boolean;
}) {
  const shape = SHAPES[file.format];
  const size = fileSize(file.bytes);
  return (
    <li className={compact ? 'file file-compact' : 'file'}>
      <span className="score shape-score">{file.format}</span>
      <div className="what">
        <strong>
          {shape.name}
          {compact && file.scriptVersion > 0 ? ` · version ${file.scriptVersion}` : null}
        </strong>
        {compact ? null : <span className="use">{shape.use}</span>}
        {showVariant ? <span className="use">{variantName(file, campaign)}</span> : null}
        <span className="name">
          {file.fileName}
          {size ? <span className="size"> · {size}</span> : null}
        </span>
      </div>
      {file.downloadUrl ? (
        <a
          className="btn btn-sm"
          href={file.downloadUrl}
          download={file.fileName}
          aria-label={`Download ${file.fileName}`}
        >
          <Icon name="download" />
          Download
        </a>
      ) : null}
    </li>
  );
}

function Waiting({ filmId, needsYou }: { filmId: string; needsYou: boolean }) {
  return needsYou ? (
    <EmptyState
      title="Your script is waiting for you"
      art={<Boyle size={96} />}
      action={
        <Link className="btn btn-primary" href={`/films/${filmId}/script`}>
          Review script <Icon name="arrow-right" />
        </Link>
      }
    >
      <p>Approve it, and the crew animates, renders and delivers your video here.</p>
    </EmptyState>
  ) : (
    <EmptyState
      title="Your video is on its way"
      art={<Boyle size={96} steaming />}
      action={
        <Link className="btn" href={`/films/${filmId}`}>
          See where it is
        </Link>
      }
    >
      <p>The crew is still making it. Your files appear here once Quality Check has passed them.</p>
    </EmptyState>
  );
}

function Revising({
  filmId,
  needsYou,
  next,
  shown,
}: {
  filmId: string;
  needsYou: boolean;
  next: number | null;
  shown: number;
}) {
  const version = next ? `version ${next}` : 'the next version';
  return needsYou ? (
    <div className="alert alert-needs callout">
      <Icon name="sparkle" />
      <div className="text">
        <h3>Your new script is ready</h3>
        <p>
          Approve {version} and the crew makes the new cut. The files below are from{' '}
          {cutName(shown)}.
        </p>
      </div>
      <Link className="btn btn-primary" href={`/films/${filmId}/script`}>
        Review script <Icon name="arrow-right" />
      </Link>
    </div>
  ) : (
    <div className="alert callout">
      <Boyle size={48} steaming />
      <div className="text">
        <h3>The crew is working on your changes</h3>
        <p>
          You'll approve the new script before anything renders. The files below are from{' '}
          {cutName(shown)}, and they stay here until the new cut is ready.
        </p>
      </div>
      <Link className="btn" href={`/films/${filmId}`}>
        See progress
      </Link>
    </div>
  );
}

function Failed({ url }: { url: string }) {
  return (
    <EmptyState
      tone="failed"
      title="The crew couldn't finish this video"
      art={
        <span className="crew crew-failed">
          <Icon name="warning" />
        </span>
      }
      action={
        <Link className="btn btn-primary" href={`/films/new?url=${encodeURIComponent(url)}`}>
          Try again with a new video
        </Link>
      }
    >
      <p>
        Nothing was delivered, so there are no files. The decisions on the video say what went
        wrong.
      </p>
    </EmptyState>
  );
}

/**
 * "version 2". Files delivered before versions were kept carry 0, and are named by when they came.
 */
function cutName(version: number): string {
  return version > 0 ? `version ${version}` : 'your last delivery';
}

/** One shape per format for the player: the first variant of each. */
function playerShapes(cut: Cut): PlayerShape[] {
  const seen = new Set<string>();
  const shapes: PlayerShape[] = [];
  for (const file of cut.files) {
    if (seen.has(file.format)) continue;
    seen.add(file.format);
    shapes.push({
      format: file.format,
      fileName: file.fileName,
      playUrl: file.playUrl,
      downloadUrl: file.downloadUrl,
    });
  }
  return shapes;
}

function playerPreview(campaign: Campaign, cut: Cut): PlayerPreview {
  const first = cut.files[0];
  return {
    look: brandLook(campaign),
    scenes: brandScenes(campaign, { hookId: first?.hookId ?? null, ctaId: first?.ctaId ?? null }),
  };
}

/** The cut's files that exist, for "Download all". A simulated cut has none. */
function downloads(cut: Cut): PlayerFile[] {
  return cut.files.flatMap((file) =>
    file.downloadUrl ? [{ fileName: file.fileName, downloadUrl: file.downloadUrl }] : [],
  );
}
