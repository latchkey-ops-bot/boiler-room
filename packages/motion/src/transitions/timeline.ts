import { type Campaign, sceneFrames } from '@boiler-room/schema';
import { interpolate } from 'remotion';
import { framesFor } from '../core/time.ts';
import { transition as lengths } from '../tokens.ts';

export const TRANSITIONS = ['push', 'carry'] as const;
export type TransitionName = (typeof TRANSITIONS)[number];

export const isTransition = (name: string): name is TransitionName =>
  (TRANSITIONS as readonly string[]).includes(name);

/** A transition straddling a scene boundary, from `from` up to but not including `to`. */
export interface TransitionWindow {
  name: TransitionName;
  /** The first frame of the incoming scene. Unchanged by the transition. */
  boundary: number;
  from: number;
  to: number;
}

/**
 * A scene on the timeline. `from` and `durationInFrames` are the campaign's own times. The scene is
 * mounted for a little longer on either side of them, which is how two scenes share a boundary
 * without either one starting early or the film losing any time.
 */
export interface SceneSpan {
  id: string;
  index: number;
  from: number;
  durationInFrames: number;
  mountFrom: number;
  mountFrames: number;
  /** Frames on screen before the scene's own first frame. */
  preRoll: number;
  /** Frames on screen after the scene's own last frame. */
  postRoll: number;
  in: TransitionWindow | undefined;
  out: TransitionWindow | undefined;
}

export interface Timeline {
  fps: number;
  durationInFrames: number;
  spans: SceneSpan[];
  windows: TransitionWindow[];
}

/** Half a transition, cut to fit: no scene gives more than half of itself to either boundary. */
function halfLength(name: TransitionName, fps: number, before: number, after: number): number {
  return Math.min(
    Math.floor(framesFor(lengths[name], fps) / 2),
    Math.floor(before / 2),
    Math.floor(after / 2),
  );
}

/**
 * Lays scenes out with their transitions overlaid on the boundaries. Nothing here moves a boundary,
 * so the film stays exactly as long as `sceneFrames` says. A boundary between scenes too short to
 * share frames is a cut. The names are checked before a film is planned, so an unknown one is
 * an error here too.
 */
export function buildTimeline(cut: Pick<Campaign, 'scenes' | 'fps' | 'durationSeconds'>): Timeline {
  const { fps, durationInFrames, scenes } = sceneFrames(cut);
  const windows = new Map<number, TransitionWindow>();

  for (const [index, scene] of scenes.entries()) {
    const name = cut.scenes[index]?.transitionOut;
    const next = scenes[index + 1];
    if (name === undefined || !next) continue;
    if (!isTransition(name)) throw new Error(`Unknown transition "${name}".`);
    const half = halfLength(name, fps, scene.durationInFrames, next.durationInFrames);
    if (half > 0) {
      windows.set(index, {
        name,
        boundary: next.from,
        from: next.from - half,
        to: next.from + half,
      });
    }
  }

  const spans = scenes.map(({ id, from, durationInFrames: length }, index): SceneSpan => {
    const incoming = windows.get(index - 1);
    const outgoing = windows.get(index);
    const preRoll = incoming ? from - incoming.from : 0;
    const postRoll = outgoing ? outgoing.to - (from + length) : 0;
    return {
      id,
      index,
      from,
      durationInFrames: length,
      mountFrom: from - preRoll,
      mountFrames: preRoll + length + postRoll,
      preRoll,
      postRoll,
      in: incoming,
      out: outgoing,
    };
  });

  return { fps, durationInFrames, spans, windows: [...windows.values()] };
}

/** 0 before a window and 1 after it. Every frame inside it falls strictly between the two. */
export const windowProgress = (frame: number, { from, to }: TransitionWindow): number =>
  interpolate(frame, [from - 1, to], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
