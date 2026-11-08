/**
 * PROVISIONAL, for the transitions and the scene clocks around them: `duration`, `easing`,
 * `spring`, `stagger`, `transition` and `travel` are a first pass that `docs/motion/transitions.md`
 * will replace. Change motion here, not in a template, so that the spec has one file to replace.
 *
 * The scene values below them are not provisional. They are the measured values of
 * `docs/motion/reference-spec.md` and the scene files in `docs/motion/scenes`, in pixels at a short
 * side of 1080 and in frames at 30 fps, as the spec writes them. `core/curves.ts` has the curves.
 *
 * Times in the provisional tokens are seconds, because a campaign sets its own fps. Convert them
 * with `framesFor`.
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
} as const;

/** Seconds between neighbours. `maxSpread` caps a whole run, so long copy cannot overrun a scene. */
export const stagger = {
  word: 0.05,
  item: 0.1,
  maxSpread: 0.7,
} as const;

/** How far an entering element travels, in stage units. */
export const travel = {
  text: 2.4,
  container: 7,
} as const;

/** Typography rules. */
export const type = {
  weight: { display: 700, strong: 600, body: 400 },
  lineHeight: { display: 1.06, body: 1.32, label: 1.2 },
  tracking: { display: '-0.022em', label: '0.08em' },
} as const;

/** Used only when a brand leaves `radius` out, as the scene files give it. */
export const fallbackRadius = 16;

/**
 * Type of the scene library, from cap height, never from font size: `capS` is the cap height of a
 * sentence, 7.2% of the short side, and `capD` of a display word, 2.7 times that. A line of copy
 * is at most `lineBox` of the frame's width. [M] at 16:9; the other formats are [N].
 */
export const specType = {
  capS: 78,
  capD: 211,
  lineHeight: 1.1,
  tracking: '-0.01em',
  lineBox: { landscape: 0.65, portrait: 0.86, square: 0.8 },
} as const;

/** `arriveN` constants: `k` is the travel left after each frame, and `D` the frame it settles. */
export const arrival = {
  slam: { k: 0.3, D: 6 },
  snap: { k: 0.5, D: 8 },
  fast: { k: 0.72, D: 14 },
  slow: { k: 0.82, D: 23 },
  long: { k: 0.88, D: 35 },
} as const;

/** `depart` constants: speed multiplies by `r` each frame over `n` frames, ending at peak speed. */
export const departure = {
  whip: { r: 1.2, n: 9 },
  long: { r: 1.4, n: 11 },
  short: { r: 2, n: 6 },
  drag: { r: 1.11, n: 26 },
  slowBuild: { r: 1.037, n: 55 },
} as const;

/**
 * The in-out and camera curves of the reference spec, section 3, as cubic beziers for
 * `Easing.bezier`, with the frames each runs over. [M] `step`, `step.short`, `hop`; [F] the rest.
 */
export const inOut = {
  step: { curve: [0.85, 0, 0.15, 1], frames: 30 },
  stepShort: { curve: [0.76, 0, 0.24, 1], frames: 21 },
  hop: { curve: [0.9, 0, 0.1, 1], frames: 11 },
  lift: { curve: [0.68, -0.06, 0.34, 1.06], frames: 11 },
  collapse: { curve: [0.94, 0.12, 0.34, 0.82], frames: 13 },
  cameraSkew: { curve: [0.66, 0.25, 0.04, 0.98], frames: 26 },
  cameraGrow: { curve: [0.56, 0.33, 0.21, 0.89], frames: 20 },
  linear: { curve: [0, 0, 1, 1], frames: 1 },
} as const satisfies Record<string, { curve: CubicBezier; frames: number }>;

/**
 * The catalog transitions this package draws, in spec frames, from `docs/motion/transitions.md`.
 * T1 is `depart.long` out and `arrive.fast` in, with `k` 0.70 on the x axis [N, from the [M]
 * lateral fit]. T5 blanks 2 frames, or 5 for the chapter blink into a pivot card [M].
 */
export const seams = {
  t1: { n: 11, r: 1.4, k: 0.72, kX: 0.7, D: 14, speedRatio: 1.5, carryFrames: 11 },
  t3: { settle: 13 },
  t5: { blank: 2, chapterBlank: 5, rack: 4 },
} as const;

/** The default velocity anchors of `docs/motion/transitions.md`, T1, in spec px per frame. [N] */
export const anchorVelocity = {
  x: { axis: 'x', sign: 1, v: 46 },
  y: { axis: 'y', sign: -1, v: 36 },
  scale: { axis: 'scale', sign: 1, v: 0.03 },
} as const;

/** `MorphBox`, T8: content leaves, the width moves, then the height, then content returns. */
export const morph = {
  exitFrames: 6,
  width: { from: 6, to: 18 },
  height: { from: 18, to: 45 },
  curve: [0.76, 0, 0.24, 1],
} as const satisfies { curve: CubicBezier } & Record<string, unknown>;

/** Word rises: `rise` px below rest on the first frame, closing by `k` a frame, 1 frame apart. */
export const rise = {
  long: { rise: 72, k: 0.75 },
  short: { rise: 26, k: 0.5 },
} as const;

/** Slow motion while a scene holds: type scales about the frame centre, a captured page pushes. */
export const drift = {
  type: 0.0013,
  push: 0.0015,
  /** px a frame that the nodes of a feature card move sideways. */
  node: 0.3,
} as const;

/** `word-slam`: the slam, the collapse to sentence size, and the sentence building around it. */
export const slam = {
  /** Scale over rest on frame 0, then `excess * decay ** (f - 1)`. */
  firstExcess: 4.4,
  excess: 1.5,
  decay: 0.7,
  /** The collapse starts from the scale of this frame. */
  collapseFrom: 9,
  collapseFrames: 13,
  collapseCurve: [0.94, 0.12, 0.34, 0.82],
  /** The second word pops in on this frame, and each word after it this many frames later. */
  appendAt: 23,
  appendStagger: 3,
  /** Each line re-centres on this arrival as words join it. */
  recentre: { k: 0.72, D: 14 },
  /** A second line pushes the first up on `arrive` with this `k`. */
  push: 0.4,
  /** The display word may fill this share of the frame's width. */
  displayWidth: 0.8,
  /** Blurred by this share of its cap height while its scale changes by more than the gate. */
  blurShare: 0.08,
  blurGate: 0.18,
} as const;

/** `site-hero`. */
export const hero = {
  /** Frame width and top edge, as shares of the frame. */
  frame: {
    landscape: { width: 0.78, top: 0.14 },
    portrait: { width: 0.92, top: 0.18 },
    square: { width: 0.86, top: 0.12 },
  },
  /** The browser bar's height. The address in it is set at half that, 22 px. */
  chrome: 44,
  /** The page rises this far into place on `arrival.slow`. */
  entryTravel: 200,
  /** With no focus box, the push centres on the top share of the crop. */
  defaultFocusTop: 0.4,
} as const;

/** `feature-card`. */
export const card = {
  /** Cap top of the headline slot, as a share of the height. */
  headlineTop: { landscape: 0.16, portrait: 0.14, square: 0.14 },
  /** The demo panel: width and height as shares of the frame, centred at `centreY` of the height. */
  panel: {
    landscape: { width: 0.56, height: 0.5, centreY: 0.62 },
    portrait: { width: 0.86, height: 0.46, centreY: 0.56 },
    square: { width: 0.8, height: 0.52, centreY: 0.62 },
  },
  panelTravel: 40,
  /** Node labels, as a share of the sentence cap height. */
  labelCap: 0.6,
  /** The frames the demo plays on, from the scene's first frame. */
  beats: {
    panel: 6,
    causeLight: 14,
    lightFrames: 12,
    connector: 20,
    effect: 26,
    causeLabel: 14,
    effectLabel: 30,
  },
} as const;

/** `end-card`: the lockup of logo, CTA and URL. */
export const lockup = {
  /** The logo box, and the baselines of the CTA and the URL, as shares of the frame. */
  layout: {
    landscape: { logo: { width: 0.36, height: 0.2, centreY: 0.4 }, cta: 0.66, url: 0.76 },
    portrait: { logo: { width: 0.7, height: 0.12, centreY: 0.4 }, cta: 0.58, url: 0.65 },
    square: { logo: { width: 0.6, height: 0.2, centreY: 0.38 }, cta: 0.64, url: 0.75 },
  },
  logoTravel: 200,
  /** The URL's cap height, as a share of the sentence cap height. */
  urlCap: 0.5,
  ctaAt: 4,
  urlAt: 6,
  /** Letters of a decoding URL start this many code points on, within their case. */
  decodeShift: 3,
  /** A typed URL shows this many characters every `typeFrames` frames. */
  typeChars: 18,
  typeFrames: 40,
  /** Nothing moves for this many frames at the end of the film. */
  hold: 69,
} as const;
