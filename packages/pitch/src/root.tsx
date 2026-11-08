import { Composition, staticFile } from 'remotion';
import './fonts.ts';
import raw from '../timeline.json';
import { EMPTY_MANIFEST, type Manifest } from './manifest.ts';
import { checkScenes, Pitch, type PitchProps } from './pitch.tsx';
import { toFrame } from './time.ts';
import { checkTimeline, timeline, totalSeconds } from './timeline.ts';

async function readManifest(): Promise<Manifest> {
  try {
    const response = await fetch(staticFile('manifest.json'));
    return response.ok ? ((await response.json()) as Manifest) : EMPTY_MANIFEST;
  } catch {
    return EMPTY_MANIFEST;
  }
}

export function Root() {
  return (
    <Composition
      id="Pitch"
      component={Pitch}
      durationInFrames={toFrame(totalSeconds())}
      fps={timeline.fps}
      width={timeline.width}
      height={timeline.height}
      defaultProps={{ manifest: null } satisfies PitchProps}
      calculateMetadata={async ({ props }) => {
        // Retiming is editing timeline.json: a broken strip or an unknown scene stops the render.
        const checked = checkTimeline(raw);
        checkScenes(checked);
        return {
          durationInFrames: toFrame(totalSeconds(checked), checked.fps),
          fps: checked.fps,
          props: { ...props, manifest: props.manifest ?? (await readManifest()) },
        };
      }}
    />
  );
}
