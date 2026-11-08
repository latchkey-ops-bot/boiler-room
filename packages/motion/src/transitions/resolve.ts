/**
 * The seam resolver of `docs/motion/transitions.md`: the transition each boundary plays, in this
 * order. A pin wins: a boundary into a pivot `type-card` is the T5 chapter blink. Otherwise the
 * `transitionOut` the Director wrote, if it is legal for the boundary and built. Otherwise the
 * fallback: on one ground T1 when the two anchors' velocities match and T3 when they do not, and T3
 * where the ground changes. Every boundary where the written id is not the one used says why, so
 * the gate can report it.
 *
 * It is pure, and works on `SeamScene`s, so it can be tested without a scene template.
 */
import { type Seam, seamBetween } from '../core/curves.ts';
import type { Ground, Velocity } from '../scenes/definition.ts';
import { seams } from '../tokens.ts';
import {
  GROUND_CHANGE,
  isCatalogId,
  isTransition,
  NEVER_ON_A_BOUNDARY,
  SAME_GROUND,
  TEMPLATE_PINNED,
  type TransitionName,
} from './catalog.ts';

/** What the resolver needs to know about one scene. */
export interface SeamScene {
  id: string;
  type: string;
  ground: Ground;
  /** A `type-card` with `props.variant: 'pivot'`, which every boundary into is pinned to T5. */
  pivot: boolean;
  /** The anchor that enters on a velocity, for a T1 into the scene. */
  entry: { anchor: string; velocity: Velocity } | undefined;
  /** The anchor that leaves on a velocity, for a T1 out of the scene. */
  exit: { anchor: string; velocity: Velocity } | undefined;
  /** Every anchor id the scene declares, for the anchor carry inside T1. */
  anchors: readonly string[];
  /** The scene's `transitionOut`, as written. */
  written: string | undefined;
}

export type SeamReason = 'pinned' | 'written' | 'fallback';

export interface ResolvedSeam {
  /** The outgoing scene's index: the seam joins `scenes[index]` and `scenes[index + 1]`. */
  index: number;
  from: string;
  to: string;
  written: string | undefined;
  used: TransitionName;
  reason: SeamReason;
  /** Why the written id was not used, when it was not. */
  note: string | undefined;
  /** T1 only: the seam both scenes move on. */
  seam: Seam | undefined;
  /** T1 only: the anchor both scenes declare, which the incoming scene carries from the outgoing. */
  carry: string | undefined;
  /** Spec frames of ground only at the start of the incoming scene: 2 after T5, 5 for a chapter. */
  blank: number;
}

/**
 * True when both velocities are on one axis with one sign, and the outgoing speed is within 1.5
 * times the incoming one either way.
 */
export function velocitiesMatch(out: Velocity | undefined, into: Velocity | undefined): boolean {
  if (!out || !into || out.axis !== into.axis || out.sign !== into.sign) return false;
  if (out.v <= 0 || into.v <= 0) return false;
  const ratio = out.v / into.v;
  return ratio >= 1 / seams.t1.speedRatio && ratio <= seams.t1.speedRatio;
}

/** Why `name` may not join these two scenes, or undefined when it may. */
function illegality(
  name: string,
  before: SeamScene,
  after: SeamScene,
  sameGround: boolean,
): string | undefined {
  if (!isCatalogId(name)) return `"${name}" is not a catalog id, t1 to t17`;
  if (NEVER_ON_A_BOUNDARY.includes(name)) return `${name} runs inside a scene, never on a boundary`;
  if (TEMPLATE_PINNED.includes(name)) return `${name} plays only where a template pins it`;
  const legal = sameGround ? SAME_GROUND : GROUND_CHANGE;
  if (!legal.includes(name)) {
    return sameGround
      ? `${name} is for a change of ground, and both scenes are on the ${before.ground} ground`
      : `${name} keeps one ground, and the ground changes from ${before.ground} to ${after.ground}`;
  }
  if (name === 't1' && !velocitiesMatch(before.exit?.velocity, after.entry?.velocity)) {
    return `t1 needs ${before.type}'s exit and ${after.type}'s entry to move on one axis with one sign, within 1.5x of each other`;
  }
  if (name === 't5' && before.type !== after.type && !after.pivot) {
    return 't5 joins two scenes of one type, or leads into a pivot type-card';
  }
  if (!isTransition(name)) return `${name} is not built yet`;
  return undefined;
}

/** The first anchor id the incoming scene declares that the outgoing scene declares too. */
const sharedAnchor = (before: SeamScene, after: SeamScene): string | undefined =>
  after.anchors.find((id) => before.anchors.includes(id));

function resolved(
  index: number,
  before: SeamScene,
  after: SeamScene,
  used: TransitionName,
  reason: SeamReason,
  note: string | undefined,
): ResolvedSeam {
  const exit = before.exit?.velocity;
  const entry = after.entry?.velocity;
  return {
    index,
    from: before.id,
    to: after.id,
    written: before.written,
    used,
    reason,
    note,
    seam: used === 't1' && exit && entry ? seamBetween(exit, entry) : undefined,
    carry: used === 't1' ? sharedAnchor(before, after) : undefined,
    blank: used === 't5' ? (after.pivot ? seams.t5.chapterBlank : seams.t5.blank) : 0,
  };
}

/** The transition of the seam between two scenes. */
export function resolveSeam(index: number, before: SeamScene, after: SeamScene): ResolvedSeam {
  if (after.pivot) return resolved(index, before, after, 't5', 'pinned', pinNote(before.written));
  const sameGround = before.ground === after.ground;
  const written = before.written;
  const problem =
    written === undefined
      ? 'no transitionOut was written'
      : illegality(written, before, after, sameGround);
  if (written !== undefined && problem === undefined && isTransition(written)) {
    return resolved(index, before, after, written, 'written', undefined);
  }
  const fallback: TransitionName =
    sameGround && velocitiesMatch(before.exit?.velocity, after.entry?.velocity) ? 't1' : 't3';
  return resolved(index, before, after, fallback, 'fallback', problem);
}

const pinNote = (written: string | undefined) =>
  written === 't5'
    ? undefined
    : 'a boundary into a pivot type-card is pinned to the t5 chapter blink';

/** Every seam of a film, in order. */
export const resolveSeams = (scenes: readonly SeamScene[]): ResolvedSeam[] =>
  scenes.slice(1).map((after, offset) => resolveSeam(offset, scenes[offset] as SeamScene, after));
