import { type Campaign, sceneFrames } from '@boiler-room/schema';
import { filmFrames, type Seam } from '../core/curves.ts';
import { filmSeams } from '../film/seams.ts';
import {
  isCatalogId,
  mountReach,
  qcFrames,
  reach,
  TRANSITIONS,
  type TransitionName,
} from './catalog.ts';
import type { SeamReason } from './resolve.ts';

export { isTransition, TRANSITIONS, type TransitionName } from './catalog.ts';

/**
 * A transition on a scene boundary. Transitions take no timeline time: `boundary` is the incoming
 * scene's first frame, as `sceneFrames` gives it, and `from` up to but not including `to` is the
 * stretch around it where the transition moves anything, which is what Quality Check looks at. It
 * does not widen either scene's mount: each built transition is drawn inside the two scenes' own
 * frames.
 */
export interface TransitionWindow {
  /** The seam's index: it joins scene `index` and scene `index + 1`. */
  index: number;
  name: TransitionName;
  boundary: number;
  from: number;
  to: number;
  /** The `transitionOut` the campaign wrote, and why `name` was chosen. */
  written: string | undefined;
  reason: SeamReason;
  note: string | undefined;
  /** T1: the seam both scenes move on. */
  seam: Seam | undefined;
  /** T1: the anchor the incoming scene carries from the outgoing one. */
  carry: string | undefined;
  /** T5: spec frames of ground only at the start of the incoming scene. */
  blank: number;
  /** The film frames the spec's QC list names for this transition, in order. */
  qc: number[];
}

/**
 * A scene on the timeline. `from` and `durationInFrames` are the campaign's own times. The scene is
 * mounted for its own frames plus any a transition reaches past the seam into it, which for every
 * built transition is none.
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

/**
 * Lays scenes out with the transition the resolver chose on each boundary. Nothing here moves a
 * boundary, so the film stays exactly as long as `sceneFrames` says. A `transitionOut` outside
 * the catalog is refused by the render gate before a film is planned, so it is an error here too.
 */
export function buildTimeline(
  cut: Pick<Campaign, 'scenes' | 'fps' | 'durationSeconds' | 'brand'>,
): Timeline {
  for (const scene of cut.scenes) {
    const name = scene.transitionOut;
    if (name !== undefined && !isCatalogId(name)) {
      throw new Error(
        `Unknown transition "${name}". Use a catalog id: ${TRANSITIONS.join(', ')} are built.`,
      );
    }
  }
  const { fps, durationInFrames, scenes } = sceneFrames(cut);
  const clamp = (frame: number) => Math.min(durationInFrames, Math.max(0, frame));

  const windows = filmSeams(cut).map((seam): TransitionWindow => {
    const boundary = (scenes[seam.index + 1] as { from: number }).from;
    const extent = reach(seam.used, seam.blank);
    const qc = qcFrames(seam.used, seam.blank).map((offset) =>
      clamp(boundary + Math.sign(offset) * filmFrames(Math.abs(offset), fps)),
    );
    return {
      index: seam.index,
      name: seam.used,
      boundary,
      from: clamp(boundary - filmFrames(extent.before, fps)),
      to: clamp(boundary + filmFrames(extent.after, fps)),
      written: seam.written,
      reason: seam.reason,
      note: seam.note,
      seam: seam.seam,
      carry: seam.carry,
      blank: seam.blank,
      qc: [...new Set(qc.filter((frame) => frame < durationInFrames))],
    };
  });

  const spans = scenes.map(({ id, from, durationInFrames: length }, index): SceneSpan => {
    const incoming = windows[index - 1];
    const outgoing = windows[index];
    const preRoll = incoming ? mountReach(incoming.name).pre : 0;
    const postRoll = outgoing ? mountReach(outgoing.name).post : 0;
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

  return { fps, durationInFrames, spans, windows };
}
