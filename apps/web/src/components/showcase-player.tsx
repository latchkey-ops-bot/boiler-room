'use client';

import { useState } from 'react';
import { Icon } from './icon.tsx';

/**
 * A film's frame on the launch wall, in the customer's own colours with its opening line. The play
 * button swaps in the film itself, so nothing downloads until a visitor asks for it.
 */
export function ShowcasePlayer({
  brand,
  headline,
  background,
  foreground,
  videoPath,
}: {
  brand: string;
  headline: string | null;
  background: string;
  foreground: string;
  videoPath: string | null;
}) {
  const [playing, setPlaying] = useState(false);
  if (playing && videoPath) {
    return (
      <div className="thumb thumb-playing">
        {/* biome-ignore lint/a11y/useMediaCaption: the pipeline delivers no caption track yet; add one here when it does */}
        <video src={videoPath} controls autoPlay playsInline preload="auto" />
      </div>
    );
  }
  return (
    <div className="thumb" style={{ background, color: foreground }}>
      {headline ?? brand}
      {videoPath ? (
        <button
          className="play"
          type="button"
          aria-label={`Play ${brand}'s launch video`}
          onClick={() => setPlaying(true)}
        >
          <Icon name="play" />
        </button>
      ) : null}
    </div>
  );
}
