import { Img, OffthreadVideo, Sequence, staticFile } from 'remotion';
import { C } from '../brand.ts';
import { toFrame } from '../time.ts';
import { timeline } from '../timeline.ts';
import { body, display, Pill, Rise, SceneShell } from '../ui.tsx';
import type { SceneProps } from './types.ts';

export function CloseMontage({ duration, manifest }: SceneProps) {
  const clips = timeline.montage.filter((clip) => manifest.films.includes(clip.file));
  const each = clips.length > 0 ? Math.floor(duration / clips.length) : duration;
  return (
    <SceneShell duration={duration} background={C.ink}>
      {clips.map((clip, i) => (
        <Sequence
          key={`${clip.file}-${clip.from}`}
          from={i * each}
          durationInFrames={i === clips.length - 1 ? duration - i * each : each}
        >
          <OffthreadVideo
            src={staticFile(`films/${clip.file}`)}
            trimBefore={toFrame(clip.from)}
            muted
            style={{ width: '100%', height: '100%' }}
          />
          <div style={{ position: 'absolute', left: 64, bottom: 56 }}>
            <Pill fill={C.paper}>{clip.site}</Pill>
          </div>
        </Sequence>
      ))}
    </SceneShell>
  );
}

export function CloseLogo({ duration }: SceneProps) {
  return (
    <SceneShell duration={duration}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Rise>
          <Img
            src={staticFile('logo.svg')}
            style={{ width: 288, height: 288, imageRendering: 'pixelated' }}
          />
        </Rise>
        <Rise delay={8} style={{ marginTop: 40 }}>
          <p style={display(148)}>Boiler Room</p>
        </Rise>
        <Rise delay={20} style={{ marginTop: 28 }}>
          <p style={body(60, C.ink, 700)}>Give it a URL. Get a launch video.</p>
        </Rise>
      </div>
    </SceneShell>
  );
}
