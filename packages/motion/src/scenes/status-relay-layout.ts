/**
 * `status-relay`, as `docs/motion/scenes/status-relay.md` specifies it: the layout in each format,
 * the fit-or-fail check, and the clock of the line, the chips and the actor. Everything here is a
 * pure function of the scene's text, the stage, the fonts and the spec frame `f`, so the component
 * and the anchor boxes draw from one computation, on any frame, in any order. No component and no
 * registry entry yet.
 *
 * Values are spec pixels at a short side of 1080 and spec frames at 30 fps. Tags are the scene
 * file's: [M] measured, [E] estimated, [D] decided, [N] a build default of the scene file. Values
 * this build adds where the scene file is silent are marked [N, build].
 */
import { Easing } from 'remotion';
import {
  baselineOffset,
  lineBox,
  type SpecFit,
  type SpecTypeStyle,
  specPx,
} from '../components/type.tsx';
import { blink, inOutAt, type Seam, seamBetween, seamIn } from '../core/curves.ts';
import { clamp } from '../core/time.ts';
import type { Rect } from '../layout/rect.ts';
import type { Orientation, Stage } from '../layout/stage.ts';
import { anchorVelocity, inOut, seams, specType, type as typography } from '../tokens.ts';
import type { Fitter, ProofIssue, ProofText } from './proof-bars-layout.ts';

export type RelayText = ProofText;
export type RelayIssue = ProofIssue;

/** The scene's layout values, per orientation [N] unless tagged otherwise. */
export const relayGeometry = {
  /** The actor is a 151 px square, 0.14 H at 16:9 [N]. */
  actorSize: 151,
  /** The actor's centre as shares of W and H [N]. */
  actor: {
    landscape: { x: 0.3, y: 0.5 },
    portrait: { x: 0.5, y: 0.38 },
    square: { x: 0.5, y: 0.36 },
  },
  /** Landscape: the line starts at 0.38 W and is at most 0.57 W wide [N]; [M] 0.65 W cap holds. */
  landscapeLine: { left: 0.38, maxWidth: 0.57 },
  /** The baseline of the centred line at 9:16 and 1:1, as a share of H [N]. */
  lineBaseline: { portrait: 0.52, square: 0.6 },
  railThickness: 2,
  /** `muted` at 40% [N]. */
  chipAlpha: 0.4,
  chipWidth: 120,
  chipHeight: 40,
  /** The chip label's font size in spec px, in the body family [N]. */
  chipLabelSize: 22,
  /** [N, build] Space between the pill's edge and its label. */
  chipPadding: 4,
  /** [N, build] Greeked chips draw bars this share of the inner width, by chip. */
  greekShares: [0.7, 0.5, 0.6],
  /** The line is 2 to 6 words [D]. */
  words: { min: 2, max: 6 },
} as const satisfies Record<string, unknown>;

/** The clock of every `status-relay` card, in spec frames. */
export const relayClock = {
  /** The line develops from here on a later card [N]; from 0 on the first card. */
  developFrom: 6,
  /** Word `j` is one `clamp((f - start - 2 j) / 6, 0, 1)`: a leading edge 3 words wide [M, N]. */
  wordStagger: 2,
  wordFrames: 6,
  /** Shimmer: bands 313 px apart at 1920 W, a period of 19 frames [E]. */
  shimmerPitch: 313,
  shimmerReference: 1920,
  shimmerPeriod: 19,
  shimmerBase: 0.85,
  shimmerDepth: 0.15,
  /** Chip `c` starts on `16 + 4 c` and travels 30 frames on `step` [M, N]. */
  chipFrom: 16,
  chipStagger: 4,
  chipTravel: inOut.step.frames,
  /** A card takes at most 3 chips: the third is absorbed by `f = 59` [N]. */
  maxChips: 3,
  /** The chip scales to 0 over 6 frames, `arrival` to `arrival + 5` [N]. */
  absorbFrames: 6,
  /** The final state holds from here, with the shimmer and the drift still running [N]. */
  holdFrom: 60,
  /** The actor turns 0.04 degrees a frame [N]. */
  driftDegrees: 0.04,
} as const;

/** The status line's style: `capS`, never smaller [D]. */
export const lineStyle: SpecTypeStyle = {
  font: 'display',
  weight: typography.weight.display,
  cap: specType.capS,
};

const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------------------------------------
// Clock

/** The frame word `j` of the line starts developing, on this card. */
export const lineStart = (first: boolean): number => (first ? 0 : relayClock.developFrom);

/** Word `j`'s develop opacity: `clamp((f - start - 2 j) / 6, 0, 1)`. */
export const wordDevelop = (f: number, j: number, first: boolean): number =>
  clamp((f - lineStart(first) - relayClock.wordStagger * j) / relayClock.wordFrames, 0, 1);

/** The frame the whole line is developed: 16 on the first card and 22 after it, for 6 words. */
export const lineDoneAt = (wordCount: number, first: boolean): number =>
  lineStart(first) + relayClock.wordStagger * Math.max(0, wordCount - 1) + relayClock.wordFrames;

/** The shimmer's pitch on this stage: 313 px at 1920 W, scaled with the width. */
export const shimmerPitch = (stage: Pick<Stage, 'width'>): number =>
  (relayClock.shimmerPitch * stage.width) / relayClock.shimmerReference;

/** `0.85 + 0.15 * cos(2 PI ((x / 313) - (f / 19)))`, with `x` in frame pixels. */
export const shimmer = (f: number, x: number, stage: Pick<Stage, 'width'>): number =>
  relayClock.shimmerBase +
  relayClock.shimmerDepth *
    Math.cos(2 * Math.PI * (x / shimmerPitch(stage) - f / relayClock.shimmerPeriod));

/** The actor's turn, in degrees, on every frame. */
export const actorRotation = (f: number): number => relayClock.driftDegrees * f;

/** Chip `c`'s first frame. */
export const chipStart = (c: number): number => relayClock.chipFrom + relayClock.chipStagger * c;
/** The frame chip `c` reaches the actor: 46 + 4 c. */
export const chipArrival = (c: number): number => chipStart(c) + relayClock.chipTravel;

/** Chip `c`'s travel, 0 to 1, on `Easing.bezier(0.85, 0, 0.15, 1)` over 30 frames. */
export const chipTravel = (f: number, c: number): number => inOutAt(f - chipStart(c), inOut.step);

/** Chip `c`'s scale: 1 until it arrives, then 0 over 6 frames, 0 from `arrival + 5`. */
export const chipScale = (f: number, c: number): number =>
  f < chipArrival(c) ? 1 : clamp(1 - (f - chipArrival(c) + 1) / relayClock.absorbFrames, 0, 1);

/** The step curve itself, for a reader checking the token against the card. */
export const stepCurve = Easing.bezier(0.85, 0, 0.15, 1);

// ---------------------------------------------------------------------------------------------
// Layout

export interface RelayFrame {
  actor: Rect;
  /** The actor's centre. */
  centre: { x: number; y: number };
  /** The status line's slot: the box the line is set in, and the `status` anchor's rest box. */
  slot: Rect;
  /** The rail: 2 px, from the frame edge to the actor's near side, on the actor's centre line. */
  rail: Rect;
  /** Where a chip's centre is at the start of its travel and at its arrival. */
  chipFrom: { x: number; y: number };
  chipTo: { x: number; y: number };
  /** The widest the line may be. */
  lineWidth: number;
}

export function relayFrame(stage: Stage): RelayFrame {
  const { width: W, height: H, orientation } = stage;
  const o: Orientation = orientation;
  const size = specPx(stage, relayGeometry.actorSize);
  const centre = { x: W * relayGeometry.actor[o].x, y: H * relayGeometry.actor[o].y };
  const actor = { x: centre.x - size / 2, y: centre.y - size / 2, width: size, height: size };
  const thick = specPx(stage, relayGeometry.railThickness);
  const pillW = specPx(stage, relayGeometry.chipWidth);
  const pillH = specPx(stage, relayGeometry.chipHeight);
  const vertical = o === 'portrait';
  const rail: Rect = vertical
    ? { x: centre.x - thick / 2, y: 0, width: thick, height: actor.y }
    : { x: 0, y: centre.y - thick / 2, width: actor.x, height: thick };
  // A chip enters with its far edge on the frame edge and stops with its near edge on the actor.
  const chipFrom = vertical ? { x: centre.x, y: -pillH / 2 } : { x: -pillW / 2, y: centre.y };
  const chipTo = vertical
    ? { x: centre.x, y: actor.y - pillH / 2 }
    : { x: actor.x - pillW / 2, y: centre.y };
  const lineWidth = o === 'landscape' ? W * relayGeometry.landscapeLine.maxWidth : lineBox(stage);
  const slot: Rect =
    o === 'landscape'
      ? {
          x: W * relayGeometry.landscapeLine.left,
          y: centre.y - size / 2,
          width: lineWidth,
          height: size,
        }
      : {
          x: (W - lineWidth) / 2,
          y: H * relayGeometry.lineBaseline[o] - specPx(stage, specType.capS),
          width: lineWidth,
          height: specPx(stage, specType.capS),
        };
  return { actor, centre, slot, rail, chipFrom, chipTo, lineWidth };
}

export interface RelayWord {
  text: string;
  /** The word's centre across the line, in frame pixels: where its shimmer band is read. */
  x: number;
}

export interface RelayLine {
  textId: string;
  fit: SpecFit;
  words: RelayWord[];
  /** The line's left edge, in frame pixels. */
  left: number;
  width: number;
  /** The top of the line box, and the line's baseline. */
  top: number;
  baseline: number;
  height: number;
}

export interface RelayChip {
  index: number;
  /** The label's text id and value, or undefined for a greeked chip. */
  textId?: string;
  label?: string;
  labelFit?: SpecFit;
  /** For a greeked chip: the bar's share of the inner width. No numerals, no copy. */
  greek?: number;
  start: number;
  arrival: number;
  size: { width: number; height: number };
}

export interface RelayLayout {
  frame: RelayFrame;
  line: RelayLine;
  chips: RelayChip[];
}

export type RelayLayoutResult =
  | { ok: true; layout: RelayLayout }
  | { ok: false; issues: RelayIssue[] };

/** True when the copy was set at its full size, on no more lines than allowed. */
const setInFull = (fit: SpecFit, maxLines: number) =>
  fit.lines.length > 0 &&
  fit.lines.length <= maxLines &&
  fit.fontSize >= Math.floor(fit.targetSize);

const px = (value: number) => `${Math.round(value)} px`;

/**
 * Lays a card out, or says which copy does not fit. Fit or fail: the line is set at `capS` on one
 * line in its box, and a chip label at 22 px in its pill; copy that does not fit is refused naming
 * its text id, so the Director shortens it. Type is never shrunk.
 */
export function relayLayout(
  text: readonly RelayText[],
  stage: Stage,
  fitCopy: Fitter,
): RelayLayoutResult {
  const issues: RelayIssue[] = [];
  const headlineItem = text.find(({ role }) => role === 'headline');
  if (!headlineItem) {
    return {
      ok: false,
      issues: [{ textId: 'headline', message: 'The card has no headline.', fix: 'Add one.' }],
    };
  }
  const frame = relayFrame(stage);
  const headlineWords = words(headlineItem.value);
  const { min, max } = relayGeometry.words;
  if (headlineWords.length < min || headlineWords.length > max) {
    issues.push({
      textId: headlineItem.id,
      message: `The status line "${headlineItem.value}" is ${headlineWords.length} words, and it takes ${min} to ${max}.`,
      fix: `Write the line in ${min} to ${max} words.`,
    });
  }
  const box = { width: frame.lineWidth, maxLines: 1 };
  const fit = fitCopy(headlineItem.value, lineStyle, box);
  if (!setInFull(fit, 1)) {
    issues.push({
      textId: headlineItem.id,
      message: `The status line "${headlineItem.value}" does not fit on one line of ${px(frame.lineWidth)} at its cap height of ${px(specPx(stage, specType.capS))}.`,
      fix: 'Shorten the status line.',
    });
  }

  // Each word's centre: halfway between the ends of the line up to the word before and up to it.
  const ends = headlineWords.map(
    (_, j) => fitCopy(headlineWords.slice(0, j + 1).join(' '), lineStyle, box).width,
  );
  const left = stage.orientation === 'landscape' ? frame.slot.x : (stage.width - fit.width) / 2;
  const relayWords = headlineWords.map((word, j) => ({
    text: word,
    x: left + ((ends[j - 1] ?? 0) + (ends[j] as number)) / 2,
  }));
  const cap = fit.metrics.cap * fit.fontSize;
  const baseline =
    stage.orientation === 'landscape'
      ? frame.centre.y + cap / 2
      : stage.height * relayGeometry.lineBaseline[stage.orientation];
  const line: RelayLine = {
    textId: headlineItem.id,
    fit,
    words: relayWords,
    left,
    width: fit.width,
    top: baseline - baselineOffset(fit),
    baseline,
    height: fit.lines.length * fit.lineHeight * fit.fontSize,
  };

  // Chips: one per label, at most 3, or 3 greeked ones when no label is given.
  const labels = text.filter(({ role }) => role === 'label');
  const size = {
    width: specPx(stage, relayGeometry.chipWidth),
    height: specPx(stage, relayGeometry.chipHeight),
  };
  const inner = size.width - 2 * specPx(stage, relayGeometry.chipPadding);
  const chips: RelayChip[] = [];
  const timing = (index: number) => ({
    index,
    start: chipStart(index),
    arrival: chipArrival(index),
    size,
  });
  for (const [index, item] of labels.entries()) {
    if (index >= relayClock.maxChips) {
      issues.push({
        textId: item.id,
        message: `The card has ${labels.length} chip labels, and a card takes at most ${relayClock.maxChips}.`,
        fix: `Keep ${relayClock.maxChips} labels or fewer.`,
      });
      continue;
    }
    // The label is set at 22 px: the cap that gives that font size in the loaded face.
    const probe = fitCopy(
      item.value,
      { font: 'body', weight: typography.weight.body, cap: 1 },
      { width: inner, maxLines: 1 },
    );
    const style: SpecTypeStyle = {
      font: 'body',
      weight: typography.weight.body,
      cap: relayGeometry.chipLabelSize * probe.metrics.cap,
    };
    const labelFit = fitCopy(item.value, style, { width: inner, maxLines: 1 });
    if (!setInFull(labelFit, 1)) {
      issues.push({
        textId: item.id,
        message: `The chip label "${item.value}" does not fit on one line of ${px(inner)} in a ${px(size.width)} pill at ${relayGeometry.chipLabelSize} px.`,
        fix: 'Shorten the label.',
      });
      continue;
    }
    chips.push({ ...timing(index), textId: item.id, label: item.value, labelFit });
  }
  if (labels.length === 0) {
    for (let index = 0; index < relayClock.maxChips; index += 1) {
      chips.push({ ...timing(index), greek: relayGeometry.greekShares[index] });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, layout: { frame, line, chips } };
}

/** The error a card that cannot be laid out stops the render with, naming each text id. */
export function relayErrorMessage(
  where: string,
  stage: Pick<Stage, 'width' | 'height'>,
  issues: readonly RelayIssue[],
): string {
  const lines = issues.map(({ textId, message, fix }) => `- text "${textId}": ${message} ${fix}`);
  return `Layout error in status-relay ${where} at ${stage.width}x${stage.height}: ${issues.length} item(s) do not fit, and type is never shrunk to fit.\n${lines.join('\n')}`;
}

/** The layout, or the layout error that stops the render. */
export function relayLayoutOrThrow(
  where: string,
  text: readonly RelayText[],
  stage: Stage,
  fitCopy: Fitter,
): RelayLayout {
  const result = relayLayout(text, stage, fitCopy);
  if (!result.ok) throw new Error(relayErrorMessage(where, stage, result.issues));
  return result.layout;
}

// ---------------------------------------------------------------------------------------------
// Anchors and the frame

/** The `actor` anchor's box: identical on every card and every frame. */
export const actorBox = (layout: RelayLayout): Rect => layout.frame.actor;

/** The `status` anchor's box: the line's slot. */
export const statusBox = (layout: RelayLayout): Rect => layout.frame.slot;

/** How a card is entered: the first card on T1, on x, with the seam; a later card on T5. */
export interface RelayCard {
  first: boolean;
  /** The seam into the first card. Defaults to the anchors' own velocity, 46 px a frame. */
  seam?: Seam;
}

const defaultSeam = seamBetween(anchorVelocity.x, anchorVelocity.x);

/**
 * The entry of the actor and the line, in frame pixels. T1 (first card, `f` 0 to 13): `seamIn` on
 * x. T5 (later cards): ground only while `f < 2`, then the rack, so the actor is at rest in place
 * from `f = 6` [M].
 */
export function relayEntry(
  stage: Stage,
  f: number,
  card: RelayCard,
): { blank: boolean; blur: number; dx: number; dy: number } {
  if (card.first) {
    return { blank: false, blur: 0, dx: specPx(stage, seamIn(f, card.seam ?? defaultSeam)), dy: 0 };
  }
  const { blank, blur, y } = blink(f, seams.t5.blank);
  return { blank, blur, dx: 0, dy: specPx(stage, y) };
}

export interface WordState {
  text: string;
  /** The develop reveal alone, 0 to 1. */
  develop: number;
  /** The shimmer band at the word, 1 until the line is complete. */
  shimmer: number;
  opacity: number;
}

export interface ChipState {
  index: number;
  label?: string;
  greek?: number;
  /** On screen: started and not yet absorbed. */
  visible: boolean;
  /** 0 to 1 along the rail. */
  travel: number;
  scale: number;
  /** The pill's rect, drawn about its centre at `scale`. */
  rect: Rect;
  absorbing: boolean;
  absorbed: boolean;
}

export interface RelayState {
  entry: ReturnType<typeof relayEntry>;
  /** Nothing but ground is drawn: the first two frames of a T5 entry. */
  blank: boolean;
  actor: { box: Rect; rotation: number };
  words: WordState[];
  lineComplete: boolean;
  chips: ChipState[];
  /** From `f = 60`, when the final state holds. */
  holding: boolean;
}

/** Everything the scene draws at a spec frame: a pure function of the layout, `f` and the card. */
export function relayState(
  layout: RelayLayout,
  stage: Stage,
  f: number,
  card: RelayCard,
): RelayState {
  const entry = relayEntry(stage, f, card);
  const { frame, line, chips } = layout;
  const complete = f >= lineDoneAt(line.words.length, card.first);
  const wordStates = line.words.map(({ text, x }, j) => {
    const develop = wordDevelop(f, j, card.first);
    const band = complete ? shimmer(f, x, stage) : 1;
    return { text, develop, shimmer: band, opacity: develop * band };
  });
  const chipStates = chips.map((chip): ChipState => {
    const travel = chipTravel(f, chip.index);
    const scale = chipScale(f, chip.index);
    const cx = frame.chipFrom.x + (frame.chipTo.x - frame.chipFrom.x) * travel;
    const cy = frame.chipFrom.y + (frame.chipTo.y - frame.chipFrom.y) * travel;
    const { width, height } = chip.size;
    return {
      index: chip.index,
      label: chip.label,
      greek: chip.greek,
      visible: f >= chip.start && scale > 0,
      travel,
      scale,
      rect: { x: cx - width / 2, y: cy - height / 2, width, height },
      absorbing: f >= chip.arrival && scale > 0,
      absorbed: scale === 0,
    };
  });
  return {
    entry,
    blank: entry.blank,
    actor: {
      box: {
        ...frame.actor,
        x: frame.actor.x + entry.dx,
        y: frame.actor.y,
      },
      rotation: actorRotation(f),
    },
    words: wordStates,
    lineComplete: complete,
    chips: chipStates,
    holding: f >= relayClock.holdFrom,
  };
}
