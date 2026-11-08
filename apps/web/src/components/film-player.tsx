'use client';

import { useEffect, useRef, useState } from 'react';
import type { BrandLook, BrandSceneData } from '../lib/brand-scene.ts';
import { clock, SHAPES } from '../lib/delivery.ts';
import type { Format } from '../lib/film.ts';
import { BrandStage } from './brand-scene.tsx';
import { Icon } from './icon.tsx';

/** One shape the player can show: its file, if there is one. */
export interface PlayerShape {
  format: Format;
  fileName: string;
  playUrl: string | null;
  downloadUrl: string | null;
}

/** The customer's brand and the approved script, for a film that has no file to play. */
export interface PlayerPreview {
  look: BrandLook;
  scenes: BrandSceneData[];
}

/** A file the founder can take away. */
export interface PlayerFile {
  fileName: string;
  downloadUrl: string;
}

const ASPECT: Record<Format, string> = { '16:9': '16 / 9', '9:16': '9 / 16', '1:1': '1 / 1' };

/**
 * The finished film, large, and the screen's one primary action: download all of it. A real film
 * plays from its file with the browser's own controls. A simulated film has no file, so the player
 * plays the approved script scene by scene in the customer's brand, through the same renderer the
 * script review used, with play and pause and the time.
 */
export function FilmPlayer({
  shapes,
  preview,
  durationSeconds,
  files,
  primary = true,
}: {
  shapes: PlayerShape[];
  preview: PlayerPreview | null;
  durationSeconds: number | null;
  /** Every file of the current cut, for "Download all". */
  files: PlayerFile[];
  primary?: boolean;
}) {
  const [format, setFormat] = useState<Format | undefined>(shapes[0]?.format);
  const shape = shapes.find((item) => item.format === format) ?? shapes[0];
  const length = durationSeconds ?? preview?.scenes.at(-1)?.end ?? 0;
  const playback = usePlayback(length);
  if (!shape) return null;
  const sceneIndex = preview ? sceneAt(preview.scenes, playback.time) : 0;
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
          <BrandStage
            look={preview.look}
            scene={scene}
            format={shape.format}
            tag={`Preview of your approved script · ${preview.look.name}'s brand`}
          />
        ) : (
          <div className="shape stage-none" style={{ aspectRatio: ASPECT[shape.format] }}>
            <p>No preview for this video.</p>
          </div>
        )}
      </div>

      <div className="controls">
        {!shape.playUrl && preview && scene ? (
          <>
            <button
              className="btn btn-sm play"
              type="button"
              aria-label={playback.playing ? 'Pause' : 'Play'}
              aria-pressed={playback.playing}
              onClick={playback.toggle}
            >
              {playback.playing ? <PauseMark /> : <Icon name="play" />}
              {playback.playing ? 'Pause' : 'Play'}
            </button>
            <span className="time" aria-live="off">
              {clock(playback.time)}
              <span className="muted"> / {clock(length)}</span>
            </span>
            {preview.scenes.length > 1 ? (
              <fieldset className="seg">
                <legend className="sr-only">Scene</legend>
                {preview.scenes.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={index === sceneIndex}
                    aria-label={`Scene ${index + 1}: ${item.name}`}
                    onClick={() => playback.seek(item.start)}
                  >
                    {index + 1}
                  </button>
                ))}
              </fieldset>
            ) : null}
          </>
        ) : durationSeconds !== null ? (
          <span className="time">{clock(durationSeconds)}</span>
        ) : null}

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

        <DownloadAll files={files} primary={primary} />
      </div>
    </section>
  );
}

/** Every file of the cut, one after another. One file is just "Download". */
function DownloadAll({ files, primary }: { files: PlayerFile[]; primary: boolean }) {
  const className = primary ? 'btn btn-primary download' : 'btn download';
  if (files.length === 0) {
    return (
      <button className="btn download" type="button" disabled>
        <Icon name="download" />
        No file
      </button>
    );
  }
  const only = files.length === 1 ? files[0] : undefined;
  if (only) {
    return (
      <a className={className} href={only.downloadUrl} download={only.fileName}>
        <Icon name="download" />
        Download
      </a>
    );
  }
  return (
    <button
      className={className}
      type="button"
      onClick={() => {
        // One link per file. The browser may ask once whether this site can download several.
        for (const file of files) {
          const link = document.createElement('a');
          link.href = file.downloadUrl;
          link.download = file.fileName;
          document.body.appendChild(link);
          link.click();
          link.remove();
        }
      }}
    >
      <Icon name="download" />
      Download all {files.length}
    </button>
  );
}

/** Two pixel bars, the pause sign, drawn like the design's icons. */
function PauseMark() {
  return (
    <i className="icon">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 12 12"
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
      >
        <path fill="currentColor" d="M3 2h2v8H3zM7 2h2v8H7z" />
      </svg>
    </i>
  );
}

/** The scene showing at `time`: the last one that has started. */
export function sceneAt(scenes: BrandSceneData[], time: number): number {
  let index = 0;
  scenes.forEach((scene, at) => {
    if (scene.start <= time) index = at;
  });
  return index;
}

/**
 * Plays a preview through its length. The time comes from the animation frame's own clock, so a
 * paused tab or a slow frame never drifts the scenes; at the end it stops and rewinds.
 */
function usePlayback(length: number) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const origin = useRef(0);
  const timeRef = useRef(0);
  timeRef.current = time;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    origin.current = performance.now() - timeRef.current * 1000;
    const step = (now: number) => {
      const next = (now - origin.current) / 1000;
      if (next >= length) {
        setTime(0);
        setPlaying(false);
        return;
      }
      setTime(next);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, length]);

  return {
    playing,
    time,
    toggle: () => setPlaying((current) => !current),
    seek: (seconds: number) => {
      setPlaying(false);
      setTime(Math.max(0, Math.min(seconds, length)));
    },
  };
}
