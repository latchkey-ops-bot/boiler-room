'use client';

import { type CSSProperties, useState } from 'react';
import { clock, type PreviewScene, SHAPES } from '../lib/delivery.ts';
import type { Format } from '../lib/film.ts';
import { Icon } from './icon.tsx';

/** One shape the player can show: its file, if there is one. */
export interface PlayerShape {
  format: Format;
  fileName: string;
  playUrl: string | null;
  downloadUrl: string | null;
}

/** The customer's brand and script, for a film that has no file to play. */
export interface PlayerPreview {
  brand: {
    name: string;
    background: string;
    foreground: string;
    primary: string;
    muted: string;
    radius: number;
    displayFont: string;
    bodyFont: string;
  };
  scenes: PreviewScene[];
  /** The call to action the founder chose, shown on the last scene. */
  cta: string | null;
}

const ASPECT: Record<Format, string> = { '16:9': '16 / 9', '9:16': '9 / 16', '1:1': '1 / 1' };

/**
 * The finished film, large. A real film plays from its file. A simulated film has no file, so the
 * player shows the approved script scene by scene in the customer's brand, and says so on screen.
 * The download under it is the screen's one primary action, unless something else needs the
 * founder first.
 */
export function FilmPlayer({
  shapes,
  preview,
  durationSeconds,
  simulated,
  primary = true,
}: {
  shapes: PlayerShape[];
  preview: PlayerPreview | null;
  durationSeconds: number | null;
  simulated: boolean;
  primary?: boolean;
}) {
  const [format, setFormat] = useState<Format | undefined>(shapes[0]?.format);
  const [sceneIndex, setSceneIndex] = useState(0);
  const shape = shapes.find((item) => item.format === format) ?? shapes[0];
  if (!shape) return null;
  const scene = preview?.scenes[sceneIndex];

  return (
    <section className="card player" aria-label="Your video">
      <div className="screen" data-shape={shape.format}>
        {shape.playUrl ? (
          // biome-ignore lint/a11y/useMediaCaption: the crew delivers no caption track yet
          <video
            key={shape.playUrl}
            className="shape"
            style={{ aspectRatio: ASPECT[shape.format] }}
            src={shape.playUrl}
            controls
            playsInline
            preload="metadata"
          />
        ) : preview && scene ? (
          <Stage
            preview={preview}
            scene={scene}
            index={sceneIndex}
            format={shape.format}
            simulated={simulated}
          />
        ) : (
          <div className="shape stage stage-none" style={{ aspectRatio: ASPECT[shape.format] }}>
            <p>No preview for this video.</p>
          </div>
        )}
      </div>

      <div className="controls">
        {shapes.length > 1 ? (
          <fieldset className="seg">
            <legend className="sr-only">Shape</legend>
            {shapes.map((item) => (
              <button
                key={item.format}
                type="button"
                aria-pressed={item.format === shape.format}
                title={SHAPES[item.format].name}
                onClick={() => setFormat(item.format)}
              >
                {item.format}
              </button>
            ))}
          </fieldset>
        ) : (
          <span className="badge badge-plain">{shape.format}</span>
        )}

        {!shape.playUrl && preview && preview.scenes.length > 1 ? (
          <fieldset className="seg">
            <legend className="sr-only">Scene</legend>
            {preview.scenes.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={index === sceneIndex}
                aria-label={`Scene ${index + 1}: ${item.name}`}
                onClick={() => setSceneIndex(index)}
              >
                {index + 1}
              </button>
            ))}
          </fieldset>
        ) : null}

        <span className="time">
          {scene && !shape.playUrl ? (
            <>
              {clock(scene.start)}
              <span className="muted"> / {clock(durationSeconds ?? scene.end)}</span>
            </>
          ) : durationSeconds !== null ? (
            clock(durationSeconds)
          ) : null}
        </span>

        {shape.downloadUrl ? (
          <a
            className={primary ? 'btn btn-primary download' : 'btn download'}
            href={shape.downloadUrl}
            download={shape.fileName}
          >
            <Icon name="download" />
            Download {shape.format}
          </a>
        ) : (
          <button className="btn download" type="button" disabled>
            <Icon name="download" />
            {simulated ? 'No file: simulated' : 'No file yet'}
          </button>
        )}
      </div>
    </section>
  );
}

function Stage({
  preview,
  scene,
  index,
  format,
  simulated,
}: {
  preview: PlayerPreview;
  scene: PreviewScene;
  index: number;
  format: Format;
  simulated: boolean;
}) {
  const { brand } = preview;
  const last = index === preview.scenes.length - 1;
  const style = {
    aspectRatio: ASPECT[format],
    background: brand.background,
    color: brand.foreground,
    '--brand-background': brand.background,
    '--brand-primary': brand.primary,
    '--brand-muted': brand.muted,
    '--brand-radius': `${brand.radius}px`,
    '--brand-display': `${fontName(brand.displayFont)}, var(--br-font-display)`,
    '--brand-body': `${fontName(brand.bodyFont)}, var(--br-font-body)`,
  } as CSSProperties;

  return (
    <div className={`shape stage stage-${format.replace(':', 'x')}`} style={style}>
      {/* The stage is the size container; everything on it is sized from it. */}
      <div className="stage-in">
        <span className="tag">
          {simulated ? 'Simulated preview' : 'Preview'} · {brand.name}'s brand
        </span>
        <div className="copy">
          {scene.headline ? <p className="big">{scene.headline}</p> : null}
          {scene.lines.map((line) => (
            <p key={line} className="small">
              {line}
            </p>
          ))}
          {last && preview.cta ? <span className="cta">{preview.cta}</span> : null}
        </div>
        <span className="sign">{brand.name}</span>
        <span className="where">
          Scene {index + 1} of {preview.scenes.length} · {scene.name}
        </span>
      </div>
    </div>
  );
}

/** A font family name from the campaign, quoted for CSS. */
function fontName(family: string): string {
  return `"${family.replace(/["\\;{}]/g, '')}"`;
}
