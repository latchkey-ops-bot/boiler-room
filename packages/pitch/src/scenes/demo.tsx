import { Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F } from '../brand.ts';
import { frameFile } from '../manifest.ts';
import { captionAt, formatClock, frameAt, planTimelapse, realMsAt } from '../timelapse.ts';
import { timeline } from '../timeline.ts';
import { display, Pill, PixelBox, SceneShell } from '../ui.tsx';
import type { SceneProps } from './types.ts';

/** The screen: 16:9, framed like the site's figures, under a row of words. */
const SCREEN = { left: 224, top: 214, width: 1472, height: 828 } as const;

function TopRow({ caption, right }: { caption: string; right: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: SCREEN.left,
        width: SCREEN.width,
        top: 72,
        height: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <p style={display(64)}>{caption}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>{right}</div>
    </div>
  );
}

export function DemoTimelapse({ duration, manifest }: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { frames, events } = manifest;
  const points = planTimelapse(frames, events, duration, fps);
  const real = realMsAt(points, frame);
  const shot = frameAt(frames, real);
  return (
    <SceneShell duration={duration}>
      <TopRow
        caption={captionAt(events, real)}
        right={
          <>
            <Pill>Real run · sped up</Pill>
            <span
              style={{
                fontFamily: F.mono,
                fontWeight: 700,
                fontSize: 56,
                color: C.deep,
                minWidth: 150,
                textAlign: 'right',
              }}
            >
              {formatClock(real)}
            </span>
          </>
        }
      />
      <PixelBox style={{ position: 'absolute', ...SCREEN, overflow: 'hidden' }}>
        {shot === undefined ? (
          <div
            style={{
              ...display(56, C.muted),
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            The recording is not staged yet.
          </div>
        ) : (
          <Img src={staticFile(frameFile(shot))} style={{ width: '100%', height: '100%' }} />
        )}
      </PixelBox>
    </SceneShell>
  );
}

export function DemoFilm({ duration, manifest }: SceneProps) {
  const film = timeline.finishedFilm;
  const staged = manifest.films.includes(film.file);
  return (
    <SceneShell duration={duration}>
      <TopRow caption="The finished film." right={<Pill>{film.site}</Pill>} />
      <PixelBox style={{ position: 'absolute', ...SCREEN, overflow: 'hidden' }} fill={C.ink}>
        {staged ? (
          <OffthreadVideo
            src={staticFile(`films/${film.file}`)}
            muted
            style={{ width: '100%', height: '100%' }}
          />
        ) : null}
      </PixelBox>
    </SceneShell>
  );
}
