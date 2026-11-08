/**
 * `rail-words`, as `docs/motion/scenes/rail-words.md` specifies it: the layout in each format, the
 * fit-or-fail check on the two rail words, and the clock of the rails and the centre element.
 * Everything here is a pure function of the scene's text, the stage, the fonts and the spec frame
 * `f`, so the component and the anchor boxes draw from one computation, on any frame, in any
 * order. No component and no registry entry yet.
 *
 * Values are spec pixels at a short side of 1080 and spec frames at 30 fps. Tags are the scene
 * file's: [M] measured, [E] estimated, [D] decided, [N] a build default of the scene file. Values
 * this build adds where the scene file is silent are marked [N, build].
 */
import { type SpecFit, type SpecTypeStyle, specPx } from '../components/type.tsx';
import { arriveN, seamBetween, seamOut } from '../core/curves.ts';
import type { Rect } from '../layout/rect.ts';
import type { Orientation, Stage } from '../layout/stage.ts';
import {
  anchorVelocity,
  arrival,
  fallbackRadius,
  specType,
  type as typography,
} from '../tokens.ts';
import type { Fitter, ProofIssue, ProofText } from './proof-bars-layout.ts';

export type RailText = ProofText;
export type RailIssue = ProofIssue;

/** The scene's layout values, per orientation. */
export const railGeometry = {
  /** The widest a rail word is set, as a share of W: [D] 0.8 at 16:9, the table's own at the rest. */
  railWidth: { landscape: 0.8, portrait: 0.86, square: 0.8 },
  /** Top and bottom rail centre y as shares of H [N]. */
  topY: { landscape: 0.22, portrait: 0.26, square: 0.2 },
  bottomY: { landscape: 0.78, portrait: 0.74, square: 0.8 },
  /** The centre band's height as a share of H [N]. */
  bandHeight: { landscape: 0.28, portrait: 0.24, square: 0.24 },
  /** A rail is 1 or 2 words of at most 14 characters [N]. */
  words: { min: 1, max: 2 },
  maxChars: 14,
  /** [N, build] The greeked panel's width over its height, when no crop gives an aspect. */
  panelAspect: 16 / 9,
  /** [N, build] Greeked bars' share of the panel's inner width, by bar. No numerals, no copy. */
  greekShares: [0.8, 0.55, 0.7, 0.4],
  /** [N, build] The panel's padding as a share of its height, and a bar's height likewise. */
  panelPadding: 0.12,
  barHeight: 0.09,
} as const satisfies Record<string, unknown>;

/** The clock of every `rail-words` card, in spec frames and spec px per frame. */
export const railClock = {
  /** [N] The cruise: rail speed settles to this, px/f. */
  cruise: 6,
  /** [M] `arrive.fast`: the entry speed is `cruise + 40` = 46 px/f, decaying by `k` a frame. */
  boost: 40,
  k: arrival.fast.k,
  /** Both rail words' centres cross the frame centre here [N]. */
  crossAt: 22,
  /** [M] The centre element arrives over `arrive.fast`'s 14 frames, then drifts [N]. */
  arriveFrames: arrival.fast.D,
  /** [E] The centre element starts this far to the right, as a share of W. */
  enterShare: 0.3,
  /** [E] 1.3 x cruise: parallax 1.2 to 1.5. */
  driftSpeed: 7.8,
  /** T1 exit, the first and last frame of the ramp [M]. */
  exitFrom: 52,
  exitTo: 62,
  /** Blur while a rail is faster than this, px/f [N]; radius `0.08 capD` [E]. */
  blurAbove: 30,
  blurShare: 0.08,
} as const;

/** The rail words' style: `capD`, shrunk to fit its width but never below `capS` [D]. */
export const railStyle: SpecTypeStyle = {
  font: 'display',
  weight: typography.weight.display,
  cap: specType.capD,
};
const floorStyle: SpecTypeStyle = { ...railStyle, cap: specType.capS };

const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------------------------------------
// Timing

/** Rail speed `v(f) = 6 + 40 * 0.72 ** f`, px/f: 46 on the first frame, decaying to the cruise. */
export const railSpeed = (f: number): number =>
  railClock.cruise + railClock.boost * railClock.k ** Math.max(0, f);

/** Distance `D(f) = 6 f + 40 (1 - 0.72 ** f) / 0.28`, so that `D(f + 1) - D(f) = v(f)`. */
export const railDistance = (f: number): number => {
  const g = Math.max(0, f);
  return railClock.cruise * g + (railClock.boost * (1 - railClock.k ** g)) / (1 - railClock.k);
};

/** The T1 seam of the exit: 46 px/f at the last frame, `depart.long`, `top -1`, `bottom +1`. */
const exitSeam = (sign: 1 | -1) =>
  seamBetween({ ...anchorVelocity.x, sign }, { v: anchorVelocity.x.v });

/** Frame `f` as the seam reads it: `f = 62` is the last outgoing frame, `-1`. */
const exitFrame = (f: number): number => f - (railClock.exitTo + 1);

/** The exit's offset on a rail in spec px, on top of the cruise: 0 before `f = 52`. */
// `+ 0` turns the seam's -0 into 0 before the ramp.
export const railExit = (f: number, rail: 'top' | 'bottom'): number =>
  seamOut(exitFrame(f), exitSeam(rail === 'top' ? -1 : 1)) + 0;

/** A rail's signed offset from its crossing position, spec px: `top` moves left, `bottom` right. */
export const railOffset = (f: number, rail: 'top' | 'bottom'): number => {
  const run = railDistance(f) - railDistance(railClock.crossAt);
  return (rail === 'top' ? -run : run) + railExit(f, rail);
};

/**
 * The rail's speed in px/f on frame `f`: the cruise decay `v(f)`, plus the exit's own speed, the
 * step of the seam on frame `f`, which is 46 px/f on the last outgoing frame. This is the gate of
 * the blur.
 */
export const railVelocity = (f: number, rail: 'top' | 'bottom'): number =>
  railSpeed(f) + Math.abs(railExit(f, rail) - railExit(f - 1, rail));

/** Horizontal blur radius in spec px: `0.08 capD` while a rail moves faster than 30 px/f, else 0. */
export const railBlur = (f: number): number =>
  Math.max(railVelocity(f, 'top'), railVelocity(f, 'bottom')) > railClock.blurAbove
    ? railClock.blurShare * specType.capD
    : 0;

/** The centre element's x offset from the frame centre, spec px: from `+0.3 W`, then drifting. */
export const centreOffset = (f: number, stage: Pick<Stage, 'width' | 'height'>): number => {
  const start = railClock.enterShare * stage.width;
  const arrive = start * (1 - arriveN(f, railClock.k, railClock.arriveFrames));
  const drift = railClock.driftSpeed * Math.max(0, f - railClock.arriveFrames);
  return arrive - specPx(stage, drift);
};

/** The centre element has finished its entry: in the band, from `f = 14`. */
export const centreArrived = (f: number): boolean => f >= railClock.arriveFrames;

/** `light.rim` on the centre element: exactly one rim is lit on every frame, and no other light. */
export const rimLitCount = (_f: number): number => 1;

// ---------------------------------------------------------------------------------------------
// Layout

export interface RailWord {
  textId: string;
  text: string;
  fit: SpecFit;
  /** The word's centre y at every frame, and its ink (cap height) box when centred at x = W/2. */
  centreY: number;
  width: number;
  capHeight: number;
  baseline: number;
}

export interface RailBand {
  /** The element's box at rest, centred on the frame centre. */
  rect: Rect;
  radius: number;
  /** For a greeked panel: each bar's share of the inner width. No numerals, no copy. */
  greek?: { shares: number[]; padding: number; barHeight: number };
}

export interface RailLayout {
  top: RailWord;
  bottom: RailWord;
  band: RailBand;
}

export type RailLayoutResult =
  | { ok: true; layout: RailLayout }
  | { ok: false; issues: RailIssue[] };

/** The options of a layout: the crop's aspect, when the element is one, and the brand's radius. */
export interface RailOptions {
  /** The centre element's width over height. Absent: the greeked panel. */
  elementAspect?: number;
  radius?: number;
}

const px = (value: number) => `${Math.round(value)} px`;

/**
 * Lays a card out, or says which copy does not fit. Fit or fail: each rail word is set at the
 * smaller of `capD` and the size that fits the rail's width on one line, and copy that would need
 * a size below `capS` is refused naming its text id. Type is never shrunk below that.
 */
export function railLayout(
  text: readonly RailText[],
  stage: Stage,
  fitCopy: Fitter,
  options: RailOptions = {},
): RailLayoutResult {
  const issues: RailIssue[] = [];
  const o: Orientation = stage.orientation;
  const limit = stage.width * railGeometry.railWidth[o];
  const { min, max } = railGeometry.words;

  const place = (role: 'headline' | 'subhead', cy: number): RailWord | undefined => {
    const item = text.find((t) => t.role === role);
    if (!item) {
      issues.push({ textId: role, message: `The scene has no ${role}.`, fix: 'Add one.' });
      return undefined;
    }
    const count = words(item.value).length;
    if (count < min || count > max || [...item.value.trim()].length > railGeometry.maxChars) {
      issues.push({
        textId: item.id,
        message: `The rail "${item.value}" is ${count} word(s) of ${[...item.value.trim()].length} characters, and a rail takes ${min} or ${max} words of at most ${railGeometry.maxChars} characters.`,
        fix: 'Shorten the rail.',
      });
    }
    const box = { width: limit, maxLines: 1 };
    const fit = fitCopy(item.value, railStyle, box);
    const floor = fitCopy(item.value, floorStyle, box).targetSize;
    if (fit.lines.length !== 1 || fit.fontSize < Math.floor(floor)) {
      issues.push({
        textId: item.id,
        message: `The rail "${item.value}" does not fit on one line of ${px(limit)} at its smallest size, the cap height of ${px(specPx(stage, specType.capS))}.`,
        fix: 'Shorten the rail.',
      });
    }
    const capHeight = fit.metrics.cap * fit.fontSize;
    return {
      textId: item.id,
      text: item.value,
      fit,
      centreY: cy,
      width: fit.width,
      capHeight,
      baseline: cy + capHeight / 2,
    };
  };

  const top = place('headline', stage.height * railGeometry.topY[o]);
  const bottom = place('subhead', stage.height * railGeometry.bottomY[o]);
  if (issues.length > 0 || !top || !bottom) return { ok: false, issues };

  const height = stage.height * railGeometry.bandHeight[o];
  const width = height * (options.elementAspect ?? railGeometry.panelAspect);
  const band: RailBand = {
    rect: { x: (stage.width - width) / 2, y: (stage.height - height) / 2, width, height },
    radius: specPx(stage, options.radius ?? fallbackRadius),
    greek:
      options.elementAspect === undefined
        ? {
            shares: [...railGeometry.greekShares],
            padding: railGeometry.panelPadding,
            barHeight: railGeometry.barHeight,
          }
        : undefined,
  };
  return { ok: true, layout: { top, bottom, band } };
}

/** The error a scene that cannot be laid out stops the render with, naming each text id. */
export function railErrorMessage(
  where: string,
  stage: Pick<Stage, 'width' | 'height'>,
  issues: readonly RailIssue[],
): string {
  const lines = issues.map(({ textId, message, fix }) => `- text "${textId}": ${message} ${fix}`);
  return `Layout error in rail-words ${where} at ${stage.width}x${stage.height}: ${issues.length} item(s) do not fit, and type is never shrunk to fit.\n${lines.join('\n')}`;
}

/** The layout, or the layout error that stops the render. */
export function railLayoutOrThrow(
  where: string,
  text: readonly RailText[],
  stage: Stage,
  fitCopy: Fitter,
  options: RailOptions = {},
): RailLayout {
  const result = railLayout(text, stage, fitCopy, options);
  if (!result.ok) throw new Error(railErrorMessage(where, stage, result.issues));
  return result.layout;
}

// ---------------------------------------------------------------------------------------------
// State

export interface RailWordState {
  /** The word's centre x and its ink box in frame pixels. */
  x: number;
  rect: Rect;
  /** Spec px a frame. */
  velocity: number;
  /** Horizontal blur radius in frame pixels: 0 unless the rail is faster than 30 px/f. */
  blur: number;
  /** Glyph scale: 1 on every frame. */
  scale: 1;
}

export interface RailState {
  top: RailWordState;
  bottom: RailWordState;
  centre: { rect: Rect; arrived: boolean; rimLit: number };
  /** True from `f = 63`: the last state holds, the cruise still running. */
  holding: boolean;
}

/**
 * Everything the scene draws at spec frame `f`: a pure function of the layout and `f`. From
 * `f = 63` the exit is over and held where it ended, while the cruise keeps running [N].
 */
export function railState(layout: RailLayout, stage: Stage, f: number): RailState {
  const frame = Math.max(0, f);
  const blur = specPx(stage, railBlur(frame));
  const word = (w: RailWord, rail: 'top' | 'bottom'): RailWordState => {
    const x = stage.width / 2 + specPx(stage, railOffset(frame, rail));
    return {
      x,
      rect: {
        x: x - w.width / 2,
        y: w.centreY - w.capHeight / 2,
        width: w.width,
        height: w.capHeight,
      },
      velocity: railVelocity(frame, rail),
      blur,
      scale: 1,
    };
  };
  const dx = centreOffset(frame, stage);
  return {
    top: word(layout.top, 'top'),
    bottom: word(layout.bottom, 'bottom'),
    centre: {
      rect: { ...layout.band.rect, x: layout.band.rect.x + dx },
      arrived: centreArrived(frame),
      rimLit: rimLitCount(frame),
    },
    holding: frame > railClock.exitTo,
  };
}

/** A rail word's ink box lies wholly inside the stage's safe area. */
export const insideSafe = (stage: Stage, rect: Rect): boolean =>
  rect.x >= stage.safe.x &&
  rect.y >= stage.safe.y &&
  rect.x + rect.width <= stage.safe.x + stage.safe.width &&
  rect.y + rect.height <= stage.safe.y + stage.safe.height;

/** The anchor `rails`: the top rail's box, at the crossing. */
export const railsBox = (layout: RailLayout, stage: Pick<Stage, 'width'>): Rect => ({
  x: (stage.width - layout.top.width) / 2,
  y: layout.top.centreY - layout.top.capHeight / 2,
  width: layout.top.width,
  height: layout.top.capHeight,
});
