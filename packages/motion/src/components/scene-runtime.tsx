import type { Scene } from '@boiler-room/schema';
import { createContext, useContext } from 'react';
import type { SceneTiming } from '../core/presence.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import type { Anchor } from '../scenes/definition.ts';
import type { TransitionWindow } from '../transitions/timeline.ts';

export interface RuntimeImage {
  src: string;
  aspect: number;
  width: number;
  height: number;
}

/**
 * What a scene is told about itself each frame, on top of its campaign data. Frames come in two
 * units: `frame` and `durationInFrames` at the campaign's rate, and `f` and `dur` in spec frames,
 * frames at 30 fps, which is what every measured value in the spec is written in.
 */
export interface SceneRuntime {
  /** Frames from the scene's own start, at the campaign's rate. */
  frame: number;
  fps: number;
  durationInFrames: number;
  /** The film frame the scene starts on, from `sceneFrames`. */
  from: number;
  /** `frame` in spec frames: 0 on the scene's first frame, unclamped. */
  f: number;
  /** `durationInFrames` in spec frames. */
  dur: number;
  /** Spec frames of ground only at the start of the scene: 2 after a T5, 5 after a chapter T5. */
  b: number;
  stage: Stage;
  timing: SceneTiming;
  /** The images this scene shows, as URLs with their sizes, in the order of its `assetIds`. */
  images: RuntimeImage[];
  /** The first of them. */
  image: RuntimeImage | undefined;
  /** The transition into this scene and out of it, as the resolver chose them. */
  in: TransitionWindow | undefined;
  out: TransitionWindow | undefined;
  /** This scene's anchors, with boxes in frame pixels at a spec frame. */
  anchors: readonly Anchor[];
  /**
   * On a T1 that carries an anchor both scenes declare, where the outgoing scene left it: its box
   * on the outgoing scene's last frame.
   */
  carryFrom: Rect | undefined;
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

/**
 * The frame variables of `docs/motion/scenes/README.md`: `f`, `dur`, `abs`, `b`, and the resolved
 * transition ids `inT` and `outT`. `abs` is the film frame, for a clock shared across scenes.
 */
export function useSceneClock() {
  const { f, dur, b, frame, from, in: incoming, out } = useScene();
  return { f, dur, b, abs: from + frame, inT: incoming?.name, outT: out?.name };
}

/** What every scene component receives. Everything else comes from context. */
export interface SceneProps<Props> {
  scene: Scene;
  props: Props;
}
