/**
 * The transition catalog of `docs/motion/transitions.md`: ids `t1` to `t17`, which of them this
 * package draws, where each is legal, and the frames Quality Check looks at for each. Every frame
 * here is a spec frame, a frame at 30 fps relative to the seam `S`, the incoming scene's first
 * frame: `-1` is the last outgoing frame.
 */
import { seams } from '../tokens.ts';

export const TRANSITION_IDS = [
  't1',
  't2',
  't3',
  't4',
  't5',
  't6',
  't7',
  't8',
  't9',
  't10',
  't11',
  't12',
  't13',
  't14',
  't15',
  't16',
  't17',
] as const;

export type TransitionId = (typeof TRANSITION_IDS)[number];

/**
 * The ids this package draws: every id the Short and Standard beat templates and their seam plans
 * write, and both fallbacks of the resolver. Register a new transition here once it is built.
 */
export const TRANSITIONS = ['t1', 't3', 't5'] as const satisfies readonly TransitionId[];

export type TransitionName = (typeof TRANSITIONS)[number];

export const TRANSITION_NAMES: Record<TransitionId, string> = {
  t1: 'Matched-velocity seam',
  t2: 'Hero-to-slot collapse',
  t3: 'Dead-stop cut into word rise',
  t4: 'Word slam over a held ground',
  t5: 'Blink and rack',
  t6: 'Object becomes world',
  t7: 'Tile flood with a persistent hero',
  t8: 'Container morph',
  t9: 'Long ramp into cut',
  t10: 'Vertical conveyor',
  t11: 'Soft-mask baton wipe',
  t12: 'Door split with a surviving centre',
  t13: 'Iris to dot and bloom',
  t14: 'Ring wipe from a point',
  t15: 'Two-beat colour hit',
  t16: 'Dip to black',
  t17: 'Tension hold, colour slam',
};

export const isCatalogId = (name: string): name is TransitionId =>
  (TRANSITION_IDS as readonly string[]).includes(name);

/** True for a catalog id this package draws. */
export const isTransition = (name: string): name is TransitionName =>
  (TRANSITIONS as readonly string[]).includes(name);

/** Rule 16: the ids a boundary may take on one ground, and where the ground changes. [D] */
export const SAME_GROUND: readonly TransitionId[] = ['t1', 't3', 't4', 't5'];
export const GROUND_CHANGE: readonly TransitionId[] = ['t6', 't7', 't16', 't3'];

/** Ids never written on a boundary: they run inside a scene, or wait for a template pin. */
export const NEVER_ON_A_BOUNDARY: readonly TransitionId[] = ['t2', 't8', 't10'];
export const TEMPLATE_PINNED: readonly TransitionId[] = [
  't9',
  't11',
  't12',
  't13',
  't14',
  't15',
  't17',
];

/**
 * How far a built transition's motion reaches either side of the seam, in spec frames. `before`
 * is how many outgoing frames it moves, `after` the incoming frame it is at rest on. The render
 * service takes its before, during and after stills from this, so they are the spec's first and
 * last QC frames: `S - 12` and `S + 14` for T1, `S - 1` and `S + 13` for T3, `S - 1` and
 * `S + blank + 4` for T5.
 */
export function reach(name: TransitionName, blank: number): { before: number; after: number } {
  if (name === 't1') return { before: seams.t1.n, after: seams.t1.D };
  if (name === 't5') return { before: 0, after: blank + seams.t5.rack };
  return { before: 0, after: seams.t3.settle };
}

/**
 * The frames Quality Check renders for a built transition, from its "QC frames" in
 * `docs/motion/transitions.md`, relative to the seam.
 */
export function qcFrames(name: TransitionName, blank: number): number[] {
  if (name === 't1') return [-12, -1, 0, 1, 14];
  if (name === 't3') return [-1, 0, 13];
  if (blank > seams.t5.blank) return [-1, 0, 4, 5, 8, 9];
  return [-1, 0, 1, 2, 5, 6];
}

/**
 * Frames a transition mounts a scene beyond its own span: PRE on the incoming scene and POST on
 * the outgoing one. Only T12 and T14 reach past the seam, and neither is built, so every built
 * transition is drawn inside the two scenes' own frames.
 */
export const mountReach = (_name: TransitionName): { pre: number; post: number } => ({
  pre: 0,
  post: 0,
});
