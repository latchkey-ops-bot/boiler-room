import { Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F } from '../brand.ts';
import { filmFile, frameFile } from '../manifest.ts';
import { toFrame } from '../time.ts';
import {
  captionAt,
  clockZero,
  formatClock,
  frameAt,
  planTimelapse,
  realMsAt,
} from '../timelapse.ts';
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
      <p style={{ ...display(56), whiteSpace: 'nowrap' }}>{caption}</p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 10,
          flexShrink: 0,
        }}
      >
        {right}
      </div>
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
            <Pill size={22}>Real run · sped up</Pill>
            <span
              style={{ display: 'flex', alignItems: 'baseline', gap: 14, whiteSpace: 'nowrap' }}
            >
              <span
                style={{
                  fontFamily: F.mono,
                  fontWeight: 600,
                  fontSize: 22,
                  letterSpacing: '0.14em',
                  color: C.muted,
                }}
              >
                ELAPSED
              </span>
              <span
                style={{
                  fontFamily: F.mono,
                  fontWeight: 700,
                  fontSize: 48,
                  lineHeight: 1,
                  color: C.deep,
                  minWidth: 210,
                  textAlign: 'right',
                }}
              >
                {formatClock(real - clockZero(events))}
              </span>
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
      <TopRow caption="A finished film." right={<Pill>{film.site}</Pill>} />
      <PixelBox style={{ position: 'absolute', ...SCREEN, overflow: 'hidden' }} fill={C.ink}>
        {staged ? (
          <OffthreadVideo
            src={staticFile(filmFile(film.file))}
            trimBefore={toFrame(film.from)}
            muted
            style={{ width: '100%', height: '100%' }}
          />
        ) : null}
      </PixelBox>
    </SceneShell>
  );
}
