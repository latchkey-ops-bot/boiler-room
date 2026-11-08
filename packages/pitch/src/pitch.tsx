import type { ComponentType } from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { C } from './brand.ts';
import type { Manifest } from './manifest.ts';
import { CloseLogo, CloseMontage } from './scenes/close.tsx';
import {
  CompanyCycle,
  CompanyGtm,
  CompanyIntro,
  CompanyOrg,
  CompanyPr,
} from './scenes/company.tsx';
import { DemoFilm, DemoTimelapse } from './scenes/demo.tsx';
import { ProblemAnswer, ProblemNeed, ProblemStudio } from './scenes/problem.tsx';
import { TrustCaps, TrustQuotes, TrustTripwire } from './scenes/trust.tsx';
import type { SceneProps } from './scenes/types.ts';
import { sceneFrames } from './time.ts';
import { allScenes, type Timeline } from './timeline.ts';

/** Scene id in timeline.json -> the component that draws it. */
export const SCENES: Record<string, ComponentType<SceneProps>> = {
  'problem-need': ProblemNeed,
  'problem-studio': ProblemStudio,
  'problem-answer': ProblemAnswer,
  'demo-timelapse': DemoTimelapse,
  'demo-film': DemoFilm,
  'company-intro': CompanyIntro,
  'company-org': CompanyOrg,
  'company-cycle': CompanyCycle,
  'company-pr': CompanyPr,
  'company-gtm': CompanyGtm,
  'trust-caps': TrustCaps,
  'trust-tripwire': TrustTripwire,
  'trust-quotes': TrustQuotes,
  'close-montage': CloseMontage,
  'close-logo': CloseLogo,
};

export function checkScenes(t: Timeline): void {
  for (const scene of allScenes(t)) {
    if (!SCENES[scene.id]) throw new Error(`timeline.json: no component for scene ${scene.id}`);
  }
}

export type PitchProps = { manifest: Manifest | null };

export function Pitch({ manifest }: PitchProps) {
  const staged: Manifest = manifest ?? { frames: [], events: [], films: [], narration: false };
  return (
    <AbsoluteFill style={{ backgroundColor: C.paper }}>
      {allScenes().map((scene) => {
        const Scene = SCENES[scene.id];
        if (!Scene) return null;
        const { from, durationInFrames } = sceneFrames(scene);
        return (
          <Sequence key={scene.id} name={scene.id} from={from} durationInFrames={durationInFrames}>
            <Scene duration={durationInFrames} manifest={staged} />
          </Sequence>
        );
      })}
      {staged.narration ? <Audio src={staticFile('narration.mp3')} /> : null}
    </AbsoluteFill>
  );
}
