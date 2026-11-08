/**
 * `proof-bars`, as `docs/motion/scenes/proof-bars.md` specifies it: the bars read from the labels,
 * the clock, the layout in each format, and the fit-or-fail check. Everything here is a pure
 * function of the scene's text, the stage and the brand fonts, so the component and the anchor
 * boxes draw from one computation, on any frame, in any order.
 *
 * Values are spec pixels at a short side of 1080 and spec frames at 30 fps. Tags are the scene
 * file's: [M] measured, [F] fitted, [D] decided, [N] a build default of the scene file. Values this
 * build adds where the scene file is silent are marked [N, build].
 */
import { extractNumericTokens, type NumericToken, type TextRole } from '@boiler-room/schema';
import { Easing } from 'remotion';
import {
  baselineOffset,
  lineBox,
  type SpecFit,
  type SpecTypeStyle,
  specPx,
} from '../components/type.tsx';
import { liftAt, typeDrift } from '../core/curves.ts';
import { clamp, lerp } from '../core/time.ts';
import type { Rect } from '../layout/rect.ts';
import type { Orientation, Stage } from '../layout/stage.ts';
import { arrival, specType, type as typography } from '../tokens.ts';

/** The clock of every `proof-bars` card, in spec frames. One clock for the whole card group. */
export const proofClock = {
  /** `hold.hero`: the hero holds to `f = 22`, and the lift starts on 23 [M]. */
  liftFrom: 23,
  /** The lift is `inOut.lift` over 11 frames, so the headline is at the slot from 34 [M]. */
  slotAt: 34,
  /** Bar `j` starts on `30 + offsets[j]`: the first row enters at frame 7 of the lift [M]. */
  barsFrom: 30,
  barOffsets: [0, 4, 6],
  /** Each bar fills over 24 frames on `Easing.out(Easing.poly(4))` [M]. */
  fillFrames: 24,
  /** The verdict stamps when the last bar is full, and never later than this [M]. */
  verdictLatest: 60,
  /** `arrive.slam`: the verdict pops at `1 + 0.26 * 0.3 ** (f - v0)` [M]. */
  verdictExcess: 0.26,
  verdictDecay: arrival.slam.k,
} as const;

/** The scene file's layout values, per orientation [N] unless tagged otherwise. */
export const proofGeometry = {
  /** The headline at the slot is this scale of the hero, so the hero's cap is `capS / 0.77` [M]. */
  slotScale: 0.77,
  /** At 16:9 the slot is 402 px above the hero's centre [M]; the other formats are shares of H. */
  landscapeLift: 402,
  heroY: { landscape: 0.5, portrait: 0.42, square: 0.5 },
  slotY: { portrait: 0.16, square: 0.13 },
  /** The track's width as a share of W, centred: 0.19 W to 0.81 W at 16:9. */
  trackWidth: { landscape: 0.62, portrait: 0.86, square: 0.8 },
  trackHeight: 54,
  trackRadius: 27,
  trackAlpha: 0.25,
  rows: {
    landscape: [0.36, 0.5, 0.64],
    portrait: [0.32, 0.42, 0.52],
    square: [0.38, 0.52, 0.66],
  },
  /** The bar name's cap height. The number is set at `capS`. */
  nameCap: 47,
  verdictBaseline: { landscape: 0.86, portrait: 0.66, square: 0.86 },
  /**
   * [N, build] The name and number sit on one baseline this far above the bar. At 16:9 and 1:1 the
   * rows are 151 px apart, so a 54 px bar and a 78 px number leave 19 px to share: 8 below the
   * number keeps it nearer its own bar than the bar above.
   */
  labelGap: 8,
  /** [N, build] The least space between a bar's name and its number. */
  nameNumberGap: 24,
  /** [N, build] The least space between a line of type and anything above or below it. */
  clearance: 8,
  /** [N, build] Lines a hero headline and a verdict may take: at most 2 lines a card [M]. */
  headlineLines: 2,
  verdictLines: 2,
} as const satisfies Record<string, unknown>;

export const headlineStyle: SpecTypeStyle = {
  font: 'display',
  weight: typography.weight.display,
  cap: specType.capS / proofGeometry.slotScale,
};
export const verdictStyle: SpecTypeStyle = {
  font: 'display',
  weight: typography.weight.display,
  cap: specType.capS,
};
export const numberStyle: SpecTypeStyle = {
  font: 'display',
  weight: typography.weight.display,
  cap: specType.capS,
};
export const nameStyle: SpecTypeStyle = {
  font: 'body',
  weight: typography.weight.strong,
  cap: proofGeometry.nameCap,
};

export interface ProofText {
  id: string;
  role: TextRole;
  value: string;
}

/** Why a card cannot be laid out, for the text item the Director must change. */
export interface ProofIssue {
  textId: string;
  message: string;
  fix: string;
}

/** One bar as its label states it. Every character shown comes from the label. */
export interface BarDatum {
  textId: string;
  /** The label without its number, trimmed of whitespace and a trailing colon. */
  name: string;
  /** The number as the label writes it: the token, with its unit word when one follows it. */
  number: string;
  /** Where the name's words and the number's words sit among the label's words, for an accent. */
  nameWords: number[];
  numberWords: number[];
  token: NumericToken;
  /** The bar's length as a share of the track. */
  share: number;
}

const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

/**
 * The number of a label as the label writes it. `extractNumericTokens` reads "41 min" as the
 * token "41" with the unit "min", so the unit word after it goes with the number, not the name,
 * when the validator's own reader takes that word for the token's unit.
 */
function numberSpan(
  value: string,
  token: NumericToken,
): { start: number; end: number } | undefined {
  const start = value.indexOf(token.raw);
  if (start === -1) return undefined;
  const end = start + token.raw.length;
  if (token.unit === undefined || extractNumericTokens(token.raw)[0]?.unit !== undefined) {
    return { start, end };
  }
  const next = /^\s*\p{L}+/u.exec(value.slice(end));
  if (!next) return { start, end };
  const widened = value.slice(start, end + next[0].length);
  const [read] = extractNumericTokens(widened);
  return read?.unit === token.unit ? { start, end: end + next[0].length } : { start, end };
}

/** Word indices of `value` that a character range covers. */
function wordIndicesIn(value: string, from: number, to: number): number[] {
  const indices: number[] = [];
  let index = 0;
  for (const match of value.matchAll(/\S+/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (start < to && end > from) indices.push(index);
    index += 1;
  }
  return indices;
}

const kindName = (token: NumericToken) =>
  token.unit === undefined ? token.kind : `${token.kind} in ${token.unit}`;

/**
 * The bars, read from the labels with `extractNumericTokens`, the validator's own reader, so a bar
 * is drawn only for a number `validateCampaign` checked against a cited quote. Each label needs a
 * name and exactly one number written in digits. All bars share one kind and unit. Percent bars
 * run on a 100% track; any other kind needs 2 or 3 bars, scaled to the largest.
 */
export function readBars(labels: readonly ProofText[]): { bars: BarDatum[]; issues: ProofIssue[] } {
  const issues: ProofIssue[] = [];
  const read: Omit<BarDatum, 'share'>[] = [];
  for (const { id, value } of labels) {
    const tokens = extractNumericTokens(value);
    if (tokens.length !== 1) {
      issues.push({
        textId: id,
        message: `Bar label "${value}" states ${tokens.length === 0 ? 'no number' : `${tokens.length} numbers (${tokens.map(({ raw }) => raw).join(', ')})`}, but a bar is drawn for exactly one.`,
        fix: 'Write the label as a name and one number, such as "With review: 35%".',
      });
      continue;
    }
    const token = tokens[0] as NumericToken;
    const span = numberSpan(value, token);
    if (!span) {
      issues.push({
        textId: id,
        message: `Bar label "${value}" states ${token.raw} in words, and the bar shows its number as the label writes it.`,
        fix: `Write the number in digits, such as "${token.raw}".`,
      });
      continue;
    }
    const name = `${value.slice(0, span.start)} ${value.slice(span.end)}`
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/:$/, '')
      .trim();
    if (name === '') {
      issues.push({
        textId: id,
        message: `Bar label "${value}" is a number with no name, so the bar would not say what it measures.`,
        fix: `Add what it measures, such as "With review: ${value.trim()}".`,
      });
      continue;
    }
    const numberWords = wordIndicesIn(value, span.start, span.end);
    const nameWords = words(value)
      .map((_, index) => index)
      .filter((index) => !numberWords.includes(index));
    read.push({
      textId: id,
      name,
      number: value.slice(span.start, span.end),
      nameWords,
      numberWords,
      token,
    });
  }
  if (issues.length > 0 || read.length === 0) return { bars: [], issues };

  const first = (read[0] as Omit<BarDatum, 'share'>).token;
  const mixed = read.find(({ token }) => token.kind !== first.kind || token.unit !== first.unit);
  if (mixed) {
    return {
      bars: [],
      issues: [
        {
          textId: mixed.textId,
          message: `The bars mix kinds: ${read.map(({ number, token }) => `${number} is a ${kindName(token)}`).join(', ')}. One card compares one kind and unit.`,
          fix: `Give every bar label of this card a ${kindName(first)}, or move the others to a card of their own.`,
        },
      ],
    };
  }
  if (first.kind === 'percent') {
    const over = read.find(({ token }) => token.value > 100);
    if (over) {
      return {
        bars: [],
        issues: [
          {
            textId: over.textId,
            message: `Bar label states ${over.number}, and percent bars run on a 100% track.`,
            fix: 'Use a percent of at most 100%, or compare this value with another kind of number.',
          },
        ],
      };
    }
    return { bars: read.map((bar) => ({ ...bar, share: bar.token.value / 100 })), issues: [] };
  }
  if (read.length < 2) {
    return {
      bars: [],
      issues: [
        {
          textId: (read[0] as Omit<BarDatum, 'share'>).textId,
          message: `A single bar of ${read[0]?.number} has nothing to be measured against: only a percent may stand alone, on its 100% track.`,
          fix: 'Add a second bar label of the same kind, from a cited quote, or use stat-counter for one number.',
        },
      ],
    };
  }
  const max = Math.max(...read.map(({ token }) => token.value));
  if (max <= 0) {
    return {
      bars: [],
      issues: [
        {
          textId: (read[0] as Omit<BarDatum, 'share'>).textId,
          message: 'Every bar is zero, so there is no largest value to scale them to.',
          fix: 'Compare values of which at least one is above zero.',
        },
      ],
    };
  }
  return { bars: read.map((bar) => ({ ...bar, share: bar.token.value / max })), issues: [] };
}

/** The frame bar `j` starts on. */
export const barStart = (j: number): number =>
  proofClock.barsFrom + (proofClock.barOffsets[j] ?? 0);

/** `v0`: the last bar is full, and the verdict stamps. */
export const verdictAt = (bars: number): number =>
  Math.min(proofClock.verdictLatest, barStart(Math.max(0, bars - 1)) + proofClock.fillFrames);

const fillCurve = Easing.out(Easing.poly(4));

/** How much of its length bar `j` shows at a frame, 0 to 1. */
export const fillShare = (f: number, j: number): number =>
  fillCurve(clamp((f - barStart(j)) / proofClock.fillFrames, 0, 1));

/** A bar's number pops in at full value once its fill is complete. There is no count-up. */
export const numberShown = (f: number, j: number): boolean =>
  f >= barStart(j) + proofClock.fillFrames;

/** The verdict's scale about its centre: the slam pop, then drift only. 0 before it stamps. */
export const verdictScale = (f: number, v0: number): number =>
  f < v0
    ? 0
    : (1 + proofClock.verdictExcess * proofClock.verdictDecay ** (f - v0)) * typeDrift(f - v0);

/**
 * The headline's pose: how far it has moved up from the hero's centre (negative is up), and its
 * scale about its own centre, relative to the hero's size. It drifts while the hero holds, lifts to
 * the slot on `inOut.lift` from the pose it reached on frame 23, and drifts again at the slot, so
 * the slot's cap height is exactly 0.77 of the hero's on frame 34.
 */
export function headlinePose(f: number, lift: number): { dy: number; scale: number } {
  const { liftFrom, slotAt } = proofClock;
  const { slotScale } = proofGeometry;
  if (f < liftFrom) return { dy: 0, scale: typeDrift(f) };
  if (f >= slotAt) return { dy: -lift, scale: slotScale * typeDrift(f - slotAt) };
  const t = liftAt(f - liftFrom);
  return { dy: -lift * t, scale: lerp(typeDrift(liftFrom), slotScale, t) };
}

/** Where the card's parts sit in a frame, in frame pixels. */
export interface ProofFrame {
  heroY: number;
  slotY: number;
  track: { x: number; width: number; height: number; radius: number };
  rows: readonly number[];
  verdictBaseline: number;
  /** The widest the hero headline may be: the slot's line is then no wider than `lineBox`. */
  heroWidth: number;
}

export function proofFrame(stage: Stage, brandRadius: number): ProofFrame {
  const { width: W, height: H, orientation, safe } = stage;
  const o: Orientation = orientation;
  const heroY = H * proofGeometry.heroY[o];
  const slotY =
    o === 'landscape'
      ? heroY - specPx(stage, proofGeometry.landscapeLift)
      : H * proofGeometry.slotY[o];
  const trackWidth = W * proofGeometry.trackWidth[o];
  const height = specPx(stage, proofGeometry.trackHeight);
  return {
    heroY,
    slotY,
    track: {
      x: (W - trackWidth) / 2,
      width: trackWidth,
      height,
      radius: Math.min(brandRadius, specPx(stage, proofGeometry.trackRadius)),
    },
    rows: proofGeometry.rows[o].map((share) => H * share),
    verdictBaseline: H * proofGeometry.verdictBaseline[o],
    heroWidth: Math.min(lineBox(stage) / proofGeometry.slotScale, safe.width),
  };
}

/** Fits copy at a style's cap height into a box: `specFit` with the stage and brand fonts. */
export type Fitter = (
  text: string,
  style: SpecTypeStyle,
  box: { width: number; maxLines: number },
) => SpecFit;

/** A block of fitted lines placed by its cap band: from the first cap top to the last baseline. */
export interface TypeBlock {
  textId: string;
  fit: SpecFit;
  /** The top of the first line box. */
  top: number;
  /** The centre of the cap band, which the block scales about. */
  centreY: number;
  width: number;
  height: number;
}

const capOf = (fit: SpecFit) => fit.metrics.cap * fit.fontSize;
const pitchOf = (fit: SpecFit) => fit.lineHeight * fit.fontSize;

/** The cap band's height: from the first line's cap top to the last line's baseline. */
const capBand = (fit: SpecFit) => capOf(fit) + (fit.lines.length - 1) * pitchOf(fit);

/** A block whose cap band is centred on `centreY`. */
function centredBlock(textId: string, fit: SpecFit, centreY: number): TypeBlock {
  const capTop = centreY - capBand(fit) / 2;
  return blockFromCapTop(textId, fit, capTop);
}

/** A block whose first baseline is on `baseline`. */
function blockOnBaseline(textId: string, fit: SpecFit, baseline: number): TypeBlock {
  return blockFromCapTop(textId, fit, baseline - capOf(fit));
}

function blockFromCapTop(textId: string, fit: SpecFit, capTop: number): TypeBlock {
  const top = capTop + capOf(fit) - baselineOffset(fit);
  return {
    textId,
    fit,
    top,
    centreY: capTop + capBand(fit) / 2,
    width: fit.width,
    height: fit.lines.length * pitchOf(fit),
  };
}

/** The block's ink from its first cap top to its last descent, at a scale about its centre. */
function inkSpan(block: TypeBlock, centreY = block.centreY, scale = 1) {
  const { fit } = block;
  const band = capBand(fit);
  const descent = fit.metrics.descent * fit.fontSize;
  return {
    top: centreY - (band / 2) * scale,
    bottom: centreY + (band / 2 + descent) * scale,
  };
}

/** True when the copy was set at its full cap height, on no more lines than allowed. */
const setInFull = (fit: SpecFit, maxLines: number) =>
  fit.lines.length > 0 &&
  fit.lines.length <= maxLines &&
  fit.fontSize >= Math.floor(fit.targetSize);

export interface ProofBar extends BarDatum {
  index: number;
  /** The track's rect. The fill runs from its left end. */
  track: Rect;
  /** The fill's full length, `share * track.width`. */
  length: number;
  start: number;
  name: string;
  nameFit: SpecFit;
  numberFit: SpecFit;
  /** The baseline the name and number share, above the bar. */
  baseline: number;
  /** The number's left edge: right-aligned to the fill's end, never over the name. */
  numberX: number;
}

export interface ProofLayout {
  frame: ProofFrame;
  headline: TypeBlock;
  /** How far the headline lifts from the hero's centre to the slot. */
  lift: number;
  bars: ProofBar[];
  verdict: TypeBlock | undefined;
  /** `v0`. */
  verdictAt: number;
}

export type ProofLayoutResult =
  | { ok: true; layout: ProofLayout }
  | { ok: false; issues: ProofIssue[] };

const px = (value: number) => `${Math.round(value)} px`;

/**
 * Lays a card out, or says which copy does not fit. Fit or fail: every line is set at its stated
 * cap height, and copy that does not fit its box, or would leave the safe area or run into the
 * next row, is refused naming its text id, so the Director shortens it. Type is never shrunk.
 */
export function proofLayout(
  text: readonly ProofText[],
  stage: Stage,
  brandRadius: number,
  fitCopy: Fitter,
): ProofLayoutResult {
  const frame = proofFrame(stage, brandRadius);
  const { track: trackFrame } = frame;
  const at = (value: number) => specPx(stage, value);
  const headlineItem = text.find(({ role }) => role === 'headline');
  const labels = text.filter(({ role }) => role === 'label');
  const subhead = text.find(({ role }) => role === 'subhead');
  const issues: ProofIssue[] = [];
  if (!headlineItem) {
    return {
      ok: false,
      issues: [{ textId: 'headline', message: 'The card has no headline.', fix: 'Add one.' }],
    };
  }

  const read = readBars(labels);
  issues.push(...read.issues);

  // The hero headline, at `capS / 0.77`, and the same block at the slot.
  const headlineFit = fitCopy(headlineItem.value, headlineStyle, {
    width: frame.heroWidth,
    maxLines: proofGeometry.headlineLines,
  });
  if (!setInFull(headlineFit, proofGeometry.headlineLines)) {
    issues.push({
      textId: headlineItem.id,
      message: `The headline "${headlineItem.value}" does not fit on ${proofGeometry.headlineLines} lines of ${px(frame.heroWidth)} at its hero cap height of ${px(at(headlineStyle.cap))}.`,
      fix: 'Shorten the headline.',
    });
  }
  const headline = centredBlock(headlineItem.id, headlineFit, frame.heroY);
  const lift = frame.heroY - frame.slotY;
  const hero = inkSpan(headline);
  const slot = inkSpan(headline, frame.slotY, proofGeometry.slotScale);
  const { safe } = stage;
  const safeBottom = safe.y + safe.height;
  if (issues.length === 0 && (hero.top < safe.y || hero.bottom > safeBottom)) {
    issues.push({
      textId: headlineItem.id,
      message: `The headline "${headlineItem.value}" is ${headlineFit.lines.length} lines, too tall for the safe area as the hero.`,
      fix: 'Shorten the headline.',
    });
  }
  if (issues.length === 0 && slot.top < safe.y) {
    issues.push({
      textId: headlineItem.id,
      message: `The headline "${headlineItem.value}" sets on ${headlineFit.lines.length} lines, and at the slot it would rise ${px(safe.y - slot.top)} above the safe area.`,
      fix: 'Shorten the headline so it sets on one line.',
    });
  }

  // The bars, each on its row, with its name and number on one baseline above it.
  const bars: ProofBar[] = [];
  if (read.issues.length === 0) {
    let above = slot.bottom;
    let aboveId = headlineItem.id;
    for (const [index, datum] of read.bars.entries()) {
      const rowY = frame.rows[index] as number;
      const track = {
        x: trackFrame.x,
        y: rowY - trackFrame.height / 2,
        width: trackFrame.width,
        height: trackFrame.height,
      };
      const nameFit = fitCopy(datum.name, nameStyle, { width: track.width, maxLines: 1 });
      const numberFit = fitCopy(datum.number, numberStyle, { width: track.width, maxLines: 1 });
      const nameWidth = nameFit.width;
      const numberWidth = numberFit.width;
      const length = datum.share * track.width;
      const across = nameWidth + at(proofGeometry.nameNumberGap) + numberWidth;
      if (!setInFull(nameFit, 1) || !setInFull(numberFit, 1) || across > track.width) {
        issues.push({
          textId: datum.textId,
          message: `Bar label "${datum.name}" and its number ${datum.number} do not fit on one line across the ${px(track.width)} track.`,
          fix: 'Shorten the bar name.',
        });
        continue;
      }
      const baseline = track.y - at(proofGeometry.labelGap);
      const capTop = baseline - Math.max(capOf(nameFit), capOf(numberFit));
      if (capTop < above + at(proofGeometry.clearance)) {
        issues.push({
          textId: aboveId,
          message: `"${text.find(({ id }) => id === aboveId)?.value}" runs into the row of bar ${index + 1} below it.`,
          fix: 'Shorten it so it sets on fewer lines.',
        });
      }
      const fillEnd = track.x + length;
      const numberRight = clamp(fillEnd, track.x + across, track.x + track.width);
      bars.push({
        ...datum,
        index,
        track,
        length,
        start: barStart(index),
        nameFit,
        numberFit,
        baseline,
        numberX: numberRight - numberWidth,
      });
      above = track.y + track.height;
      aboveId = datum.textId;
    }
  }

  // The verdict, centred, its first baseline on the stated line.
  let verdict: TypeBlock | undefined;
  if (subhead) {
    const verdictFit = fitCopy(subhead.value, verdictStyle, {
      width: lineBox(stage),
      maxLines: proofGeometry.verdictLines,
    });
    verdict = blockOnBaseline(subhead.id, verdictFit, frame.verdictBaseline);
    const ink = inkSpan(verdict);
    const lastBar = bars.at(-1);
    if (!setInFull(verdictFit, proofGeometry.verdictLines)) {
      issues.push({
        textId: subhead.id,
        message: `The verdict "${subhead.value}" does not fit on ${proofGeometry.verdictLines} lines of ${px(lineBox(stage))} at cap height ${px(at(verdictStyle.cap))}.`,
        fix: 'Shorten the verdict.',
      });
    } else if (ink.bottom > safeBottom) {
      issues.push({
        textId: subhead.id,
        message: `The verdict "${subhead.value}" sets on ${verdictFit.lines.length} lines, and runs ${px(ink.bottom - safeBottom)} below the safe area.`,
        fix: 'Shorten the verdict so it sets on one line.',
      });
    } else if (
      lastBar &&
      ink.top < lastBar.track.y + lastBar.track.height + at(proofGeometry.clearance)
    ) {
      issues.push({
        textId: subhead.id,
        message: `The verdict "${subhead.value}" runs into the last bar.`,
        fix: 'Shorten the verdict.',
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    layout: {
      frame,
      headline,
      lift,
      bars,
      verdict,
      verdictAt: verdictAt(bars.length),
    },
  };
}

/** The headline anchor's box at a frame: the hero's line box, lifted and scaled as it is drawn. */
export function headlineBox(layout: ProofLayout, stage: Pick<Stage, 'width'>, f: number): Rect {
  const { headline, lift } = layout;
  const { dy, scale } = headlinePose(f, lift);
  const centreY = headline.centreY + dy;
  return {
    x: stage.width / 2 - (headline.width * scale) / 2,
    y: centreY - (headline.centreY - headline.top) * scale,
    width: headline.width * scale,
    height: headline.height * scale,
  };
}

/**
 * Bar `j`'s fill box at a frame, which T6 would grow into the ground. A bar the card does not have
 * is an empty box on its row.
 */
export function barBox(layout: ProofLayout, j: number, f: number): Rect {
  const bar = layout.bars[j];
  if (!bar) {
    const { track, rows } = layout.frame;
    const rowY = rows[j] ?? 0;
    return { x: track.x, y: rowY - track.height / 2, width: 0, height: track.height };
  }
  return { ...bar.track, width: bar.length * fillShare(f, j) };
}

/** The error a card that cannot be laid out stops the render with, naming each text id. */
export function layoutErrorMessage(
  where: string,
  stage: Pick<Stage, 'width' | 'height'>,
  issues: readonly ProofIssue[],
): string {
  const lines = issues.map(({ textId, message, fix }) => `- text "${textId}": ${message} ${fix}`);
  return `Layout error in proof-bars ${where} at ${stage.width}x${stage.height}: ${issues.length} item(s) do not fit, and type is never shrunk to fit.\n${lines.join('\n')}`;
}
