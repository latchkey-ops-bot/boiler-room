/**
 * PROVISIONAL. Every value in this file is a first pass, and a reference-driven motion spec will
 * tune them. Change motion here, not in a template, so that the spec has one file to replace.
 *
 * Times are seconds, because a campaign sets its own fps. Convert them with `framesFor`.
 *
 * The easing curves are the values of IBM Carbon's motion tokens (`@carbon/motion`, Apache-2.0).
 * The duration scale follows Carbon's names, stretched for film, where a move has to be seen rather
 * than felt.
 */

export type CubicBezier = readonly [x1: number, y1: number, x2: number, y2: number];

export const duration = {
  instant: 0.07,
  fast: 0.24,
  moderate: 0.4,
  slow: 0.7,
  slower: 1.1,
} as const;

export const easing = {
  /** Moves within the frame. */
  standard: [0.2, 0, 0.38, 0.9],
  /** Large moves that deserve weight, such as a camera or a transition. */
  expressive: [0.4, 0.14, 0.3, 1],
  /** Things arriving. */
  entrance: [0, 0, 0.3, 1],
  /** Things leaving. */
  exit: [0.4, 0.14, 1, 1],
} as const satisfies Record<string, CubicBezier>;

/** Configs for Remotion's `spring`. */
export const spring = {
  /** A container coming to rest, with no overshoot to read as bounce. */
  settle: { damping: 26, mass: 1, stiffness: 120 },
  /** A word landing. */
  word: { damping: 22, mass: 0.7, stiffness: 170 },
  /** A pressed button, which is allowed a little overshoot. */
  press: { damping: 12, mass: 0.5, stiffness: 240 },
} as const;

/** Seconds between neighbours. `maxSpread` caps a whole run, so long copy cannot overrun a scene. */
export const stagger = {
  word: 0.05,
  item: 0.1,
  maxSpread: 0.7,
} as const;

/** How long each transition straddles its boundary. */
export const transition = {
  push: 0.6,
  carry: 0.8,
} as const;

/** How far an entering element travels, in stage units. */
export const travel = {
  text: 2.4,
  container: 7,
} as const;

/** Beats of the scenes, as fractions of the scene. */
export const beat = {
  cursorIn: 0.14,
  cursorArrives: 0.42,
  cameraSettled: 0.82,
  ctaCursorIn: 0.3,
  ctaPress: 0.56,
} as const;

/** How the interface camera opens. */
export const camera = {
  tiltDegrees: 13,
  startScale: 0.93,
  defaultZoom: 1.4,
  perspective: 2200,
} as const;

/** Typography rules. Sizes are in stage units, where one unit is 1% of the short side. */
export const type = {
  weight: { display: 700, strong: 600, body: 400 },
  lineHeight: { display: 1.06, body: 1.32, label: 1.2 },
  tracking: { display: '-0.022em', label: '0.08em' },
} as const;

/** Used only when a brand leaves `radius` out. */
export const fallbackRadius = 10;
