import { interpolate, spring } from 'remotion';
import { type CubicBezier, duration, easing, spring as springs } from '../tokens.ts';
import { bezier, framesFor } from './time.ts';

/** When something arrives and leaves, in frames from the start of its scene. */
export interface PresenceWindow {
  enterAt: number;
  enterFrames: number;
  exitAt: number;
  exitFrames: number;
}

export type Phase = 'before' | 'enter' | 'hold' | 'exit' | 'after';

export interface Presence {
  phase: Phase;
  /** 0 before it arrives, 1 once it has. */
  enter: number;
  /** 0 until it starts to leave, 1 once it has gone. */
  exit: number;
  /** `enter` less `exit`, which is what opacity wants. */
  visible: number;
}

interface PresenceCurves {
  enterCurve?: CubicBezier;
  exitCurve?: CubicBezier;
}

const progress = (frame: number, at: number, frames: number, curve: CubicBezier): number => {
  if (frames <= 0) return frame >= at ? 1 : 0;
  return interpolate(frame, [at, at + frames], [0, 1], {
    easing: bezier(curve),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
};

function phaseAt(frame: number, window: PresenceWindow): Phase {
  const { enterAt, enterFrames, exitAt, exitFrames } = window;
  if (frame < enterAt) return 'before';
  if (frame < enterAt + enterFrames) return 'enter';
  if (exitFrames <= 0 || frame < exitAt) return 'hold';
  return frame < exitAt + exitFrames ? 'exit' : 'after';
}

/** Where something is in its life at this frame. A window with `exitFrames: 0` never leaves. */
export function presence(
  frame: number,
  window: PresenceWindow,
  { enterCurve = easing.entrance, exitCurve = easing.exit }: PresenceCurves = {},
): Presence {
  const enter = progress(frame, window.enterAt, window.enterFrames, enterCurve);
  const exit =
    window.exitFrames > 0 ? progress(frame, window.exitAt, window.exitFrames, exitCurve) : 0;
  return { phase: phaseAt(frame, window), enter, exit, visible: enter * (1 - exit) };
}

/** A spring that starts at `at`. Remotion's `spring` restarts from a frame, so this is pure. */
export const springAt = (
  frame: number,
  fps: number,
  at: number,
  config: (typeof springs)[keyof typeof springs] = springs.settle,
): number => spring({ frame: Math.max(0, frame - at), fps, config });

/**
 * What happens as a scene ends. `hold` is for a move the transition makes itself, and for the last
 * scene, which stays readable. `text` clears the words for a carried element. `all` leaves on a cut.
 */
export type SceneExit = 'hold' | 'text' | 'all';

export interface SceneTiming {
  /**
   * The scene frame its own entry starts on, from which a scene of the library counts its spec
   * frames: 0 after a cut, the frame a carry lands, or for a scene pushed on whole the frame the
   * push starts, so that it builds as it slides in.
   */
  entryAt: number;
  /** Frames, cards and anything else that holds content. */
  container: PresenceWindow;
  /** The words. They arrive after their container and leave before it. */
  text: PresenceWindow;
}

export interface SceneTimingOptions {
  durationInFrames: number;
  fps: number;
  exit: SceneExit;
  /** Frames after the scene's first frame that an incoming transition still holds the stage. */
  enterAfter?: number;
  /** Frames before the scene's end that an outgoing transition takes the stage. */
  clearBefore?: number;
  /**
   * True when the scene is moved on screen whole, as a push does. Its containers are then already
   * at rest when it first appears, and only its words wait for the move to finish.
   */
  arrivesWhole?: boolean;
}

/**
 * Container and text run on separate clocks, which is what keeps a scene from reading as one layer.
 * Containers arrive first and words follow them. Every span scales down with the scene, so a very
 * short scene still finishes both moves, and a transition never covers a word.
 */
export function sceneTiming({
  durationInFrames,
  fps,
  exit,
  enterAfter = 0,
  clearBefore = 0,
  arrivesWhole = false,
}: SceneTimingOptions): SceneTiming {
  const share = (seconds: number, fraction: number) =>
    Math.min(framesFor(seconds, fps), Math.floor(durationInFrames * fraction));

  const containerEnter = share(duration.slow, 0.3);
  const textDelay = share(duration.fast, 0.12);
  const textEnter = share(duration.moderate, 0.2);
  const textExit = exit === 'hold' ? 0 : share(duration.fast, 0.12);
  const containerExit = exit === 'all' ? share(duration.fast, 0.12) : 0;
  const textLead = exit === 'all' ? Math.floor(containerExit / 2) : 0;

  const textExitAt = durationInFrames - clearBefore - textExit - textLead;
  const textEnterAt = Math.max(0, Math.min(enterAfter + textDelay, textExitAt - textEnter));
  // Far enough back that a spring started there has come to rest before the scene is first drawn.
  const settled = framesFor(duration.slower * 2, fps);
  return {
    entryAt: arrivesWhole ? -enterAfter : enterAfter,
    container: {
      enterAt: arrivesWhole ? -durationInFrames - settled : enterAfter,
      enterFrames: containerEnter,
      exitAt: durationInFrames - containerExit,
      exitFrames: containerExit,
    },
    text: {
      enterAt: textEnterAt,
      enterFrames: textEnter,
      exitAt: textExitAt,
      exitFrames: textExit,
    },
  };
}
