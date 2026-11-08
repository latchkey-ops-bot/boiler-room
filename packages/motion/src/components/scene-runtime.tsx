import type { Scene } from '@boiler-room/schema';
import { createContext, useContext } from 'react';
import type { SceneTiming } from '../core/presence.ts';
import type { Stage } from '../layout/stage.ts';

export type CarryElement = { kind: 'image'; assetId: string } | { kind: 'mark' };

export interface RuntimeImage {
  src: string;
  aspect: number;
  width: number;
  height: number;
}

/** What a scene is told about itself each frame, on top of its campaign data. */
export interface SceneRuntime {
  /** Frames from the scene's own start. Negative during a pre-roll, past its end during a post-roll. */
  frame: number;
  fps: number;
  durationInFrames: number;
  stage: Stage;
  timing: SceneTiming;
  /** The images this scene shows, as URLs with their sizes, in the order of its `assetIds`. */
  images: RuntimeImage[];
  /** The first of them, which is the one a carry moves. */
  image: RuntimeImage | undefined;
  /** What arrives from the scene before and what leaves for the scene after. */
  carriedIn: CarryElement['kind'] | undefined;
  carriedOut: CarryElement['kind'] | undefined;
  /** True while the shared overlay is drawing this element in the scene's place. */
  overlayHides: (element: CarryElement['kind']) => boolean;
}

const SceneContext = createContext<SceneRuntime | undefined>(undefined);
const StageContext = createContext<Stage | undefined>(undefined);

/** The composition, shared by the scenes and by anything drawn above them. */
export const StageProvider = StageContext.Provider;

export function useStage(): Stage {
  const stage = useContext(StageContext);
  if (!stage) throw new Error('useStage must be used inside <StageProvider>.');
  return stage;
}

export const SceneRuntimeProvider = SceneContext.Provider;

export function useScene(): SceneRuntime {
  const runtime = useContext(SceneContext);
  if (!runtime) throw new Error('useScene must be used inside a scene.');
  return runtime;
}

/** What every scene component receives. Everything else comes from context. */
export interface SceneProps<Props> {
  scene: Scene;
  props: Props;
}
