/**
 * `type-card`, built to `docs/motion/scenes/type-card.md`: one or two lines of sentence-size type.
 * Words pop in and rise, a second line pushes the first up, the block drifts larger about its slot,
 * and it leaves on a T1 exit ramp or a dead stop. The `name` variant sets the brand name at 1.5
 * times the sentence cap and enters as one unit, and the `pivot` variant is the film's one breath,
 * entered only by the pinned chapter T5.
 *
 * Everything that decides a frame is a pure function here: the layout from the copy and the
 * measured font, the frames each word arrives on, and each word's state at a spec frame. The
 * component only draws that state, and the anchor's `box` reads the same layout.
 *
 * On a T1 entry every word moves on the seam, as the scene file says, never on the shared-anchor
 * carry: a carry between two different headlines is a morph, not a seam. It draws the type at the
 * outgoing block's height, so a two-line block arriving from a one-line block starts at half its
 * size, below its cap height, and it starts from where the outgoing block would be without its
 * exit ramp, so the cut jumps back against the seam instead of continuing it.
 */
import type { TextRole } from '@boiler-room/schema';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import {
  type SceneProps,
  type SceneRuntime,
  useScene,
  useSceneClock,
} from '../components/scene-runtime.tsx';
import {
  baselineOffset,
  fontMetrics,
  lineBox,
  type SpecFit,
  specFit,
  specPx,
  widthAt,
} from '../components/type.tsx';
import {
  arriveN,
  blink,
  type Seam,
  seamIn,
  secondLinePush,
  typeDrift,
  wordGapGain,
  wordRise,
} from '../core/curves.ts';
import { textDirection, wordMarks } from '../layout/bidi.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import { anchorVelocity, arrival, rise, specType, type as typography } from '../tokens.ts';
import { SeamLayer } from '../transitions/seam-layer.tsx';
import { accentSchema, isAccented } from './accent.ts';
import { defineScene } from './definition.ts';

const propsSchema = z.strictObject({
  /** Absent for a value, problem or callback line. `name` sets the brand name, `pivot` the breath. */
  variant: z.enum(['name', 'pivot']).optional(),
  accent: accentSchema.optional(),
});

export type TypeCardProps = z.infer<typeof propsSchema>;

export type TypeCardVariant = 'default' | 'name' | 'pivot';

export const variantOf = (props: Pick<TypeCardProps, 'variant'>): TypeCardVariant =>
  props.variant ?? 'default';

/**
 * The scene file's values, in spec pixels and spec frames, with its evidence tags. They live here
 * rather than in `tokens.ts` so that this template is one file.
 */
export const typeCardTokens = {
  /** The name variant's cap height over `capS`: 117 px. [N] */
  nameCap: 1.5,
  /** The block centre as a share of the frame's height: 0.45 H at 9:16, the middle otherwise. [N] */
  slotY: { landscape: 0.5, portrait: 0.45, square: 0.5 },
  /** Line 2 of the headline starts on `n1 + 4`, `n1` the words on line 1. [N] */
  line2Gap: 4,
  /** The subhead's first word appears on `nH + 3`, `nH` the headline's words. [N] */
  subheadGap: 3,
  /** A headline word rises 72 px, closing by 0.75 a frame, 1 frame apart. [M] ref A */
  headlineRise: rise.long,
  /** A subhead word rises 26 px, closing by 0.5 a frame. [M] ref A short rise 24 to 28 px */
  subheadRise: { rise: 26, k: 0.5 },
  /** The name enters as one unit from 72 px below rest on `arriveN(f, 0.88, 35)`. [M] ref A */
  nameRise: rise.long.rise,
  nameArrival: arrival.long,
  /** The rest still: this many frames after the last word appears. */
  settle: 13,
} as const;

/** One text item of the scene, as `scene.text` holds it. */
export interface CardText {
  id: string;
  role: TextRole;
  value: string;
}

/**
 * Thrown when the copy cannot be set as the scene file says: at its cap height, in its line box, on
 * its lines. A type card never shrinks type to make copy fit. The Director shortens the copy.
 */
export class TypeCardLayoutError extends Error {
  readonly sceneId: string | undefined;
  readonly textId: string;

  constructor(sceneId: string | undefined, textId: string, problem: string, fix: string) {
    const where =
      sceneId === undefined ? `text "${textId}"` : `scene "${sceneId}", text "${textId}"`;
    super(`TYPE_CARD_LAYOUT at ${where}: ${problem} ${fix}`);
    this.name = 'TypeCardLayoutError';
    this.sceneId = sceneId;
    this.textId = textId;
  }
}

/** One line of the block, measured, before it is placed. */
export interface MeasuredLine {
  textId: string;
  role: 'headline' | 'subhead';
  words: string[];
  /** The index in its text item of the line's first word, for the accent. */
  first: number;
  fontSize: number;
  /** The line's width at its size. */
  width: number;
  /** The line box's height, `lineHeight * fontSize`. */
  height: number;
  /** From the top of the line box to the baseline. */
  baseline: number;
  /** Cap height in frame pixels. */
  cap: number;
}

/** A line of the block, placed on the frame. */
export interface PlacedLine extends MeasuredLine {
  /** The line's baseline at rest, in the final block. */
  restBaseline: number;
}

export interface TypeCardLayout {
  variant: TypeCardVariant;
  /** One or two lines: the headline's, then the subhead's. */
  lines: PlacedLine[];
  /** The block's centre, the fixed headline slot. The drift scales about it. */
  centre: { x: number; y: number };
  /** Line 1's baseline while it is alone on the slot, before line 2 arrives. */
  aloneBaseline: number;
  /** How far line 1 is pushed up when line 2 arrives: half the distance between their baselines. */
  travel: number;
  /** The text block at rest, before drift: the union of the line boxes. */
  block: Rect;
  /** The headline's word count, `nH`. */
  headlineWords: number;
  fontFamily: string;
  weight: number;
  letterSpacing: string;
  lineHeight: number;
}

/** The fixed headline slot: the middle of the frame, or 0.45 of its height at 9:16. */
export const slotCentre = (stage: Pick<Stage, 'width' | 'height' | 'orientation'>) => ({
  x: stage.width / 2,
  y: stage.height * typeCardTokens.slotY[stage.orientation],
});

/**
 * Places measured lines on the slot. Line 1 alone is centred on the slot from its cap top to its
 * baseline. Two lines stack as CSS stacks their line boxes, and the block, from line 1's cap top to
 * line 2's baseline, is centred on the slot, so line 1 rests half the distance between the
 * baselines above where it stood alone. With one size that is `lineHeight * fontSize / 2`, the
 * spec's push travel.
 */
export function placeLines(
  measured: readonly MeasuredLine[],
  centre: { x: number; y: number },
): Pick<TypeCardLayout, 'lines' | 'aloneBaseline' | 'travel' | 'block'> {
  const [one, two] = measured;
  if (!one) throw new Error('A type card lays out at least one line.');
  const aloneBaseline = centre.y + one.cap / 2;
  const distance = two ? one.height - one.baseline + two.baseline : 0;
  const travel = distance / 2;
  const lines = measured.map(
    (line, index): PlacedLine => ({
      ...line,
      restBaseline: aloneBaseline - travel + (index === 0 ? 0 : distance),
    }),
  );
  const top = (lines[0] as PlacedLine).restBaseline - one.baseline;
  const last = lines.at(-1) as PlacedLine;
  const bottom = last.restBaseline - last.baseline + last.height;
  const width = Math.max(...lines.map((line) => line.width));
  return {
    lines,
    aloneBaseline,
    travel,
    block: { x: centre.x - width / 2, y: top, width, height: bottom - top },
  };
}

/** A rect scaled by `s` about a point, as a CSS scale with that transform origin draws it. */
export const scaleAbout = (rect: Rect, s: number, origin: { x: number; y: number }): Rect => ({
  x: origin.x + (rect.x - origin.x) * s,
  y: origin.y + (rect.y - origin.y) * s,
  width: rect.width * s,
  height: rect.height * s,
});

/**
 * The headline anchor's box at a spec frame: the whole block at rest, as it drifts. The rise, the
 * push and the rack are entry moves inside it, not part of the box.
 */
export const typeCardBox = (layout: Pick<TypeCardLayout, 'block' | 'centre'>, f: number): Rect =>
  scaleAbout(layout.block, typeDrift(f), layout.centre);

const weight = typography.weight.display;

/**
 * Copy fitted at a cap height of at least `cap` spec px. `specFit` sets the largest whole size at
 * or under the size it is asked for, so it is asked for the whole size just over `cap`: a 78 px cap
 * is never drawn at 77.7. A fit at a smaller size than that did not fit.
 */
function fitAtCap(
  value: string,
  cap: number,
  maxLines: number,
  stage: Stage,
  fonts: { display: string; body: string },
): { fit: SpecFit; size: number; fits: boolean } {
  const metrics = fontMetrics(fonts.display, weight);
  const size = Math.ceil(specPx(stage, cap) / metrics.cap - 1e-9);
  const asked = ((size + 1e-6) * metrics.cap * 1080) / Math.min(stage.width, stage.height);
  const fit = specFit(
    value,
    { font: 'display', weight, cap: asked },
    stage,
    { width: lineBox(stage), maxLines },
    fonts,
  );
  const fits = fit.fontSize >= size && fit.lines.length > 0 && fit.lines.length <= maxLines;
  return { fit, size, fits };
}

const layoutCache = new Map<string, TypeCardLayout>();

/**
 * The card's layout, fit or fail as `docs/motion/scenes/README.md` says. The headline is set at
 * `capS`, or 1.5 times it for the name, on at most 2 lines, or 1 when a subhead follows it or the
 * card is a pivot. The subhead is one line at `capS` under it. Copy that does not fit at that size
 * in the line box throws a `TypeCardLayoutError` naming the scene and the text id. It is a pure
 * function of its arguments once the font is loaded, memoised in a module `Map`.
 */
export function typeCardLayout(
  text: readonly CardText[],
  variant: TypeCardVariant,
  stage: Stage,
  fonts: { display: string; body: string },
  sceneId?: string,
): TypeCardLayout {
  const headline = text.find(({ role }) => role === 'headline');
  const subhead = text.find(({ role }) => role === 'subhead');
  const key = JSON.stringify([
    headline?.id,
    headline?.value,
    subhead?.id,
    subhead?.value,
    variant,
    fonts.display,
    stage.width,
    stage.height,
  ]);
  const known = layoutCache.get(key);
  if (known) return known;
  if (!headline) {
    throw new TypeCardLayoutError(
      sceneId,
      '(none)',
      'a type card needs a headline.',
      'Add a text item with role "headline".',
    );
  }
  if (variant === 'pivot' && subhead) {
    throw new TypeCardLayoutError(
      sceneId,
      subhead.id,
      'a pivot card is one line, so it has no subhead.',
      `Remove "${subhead.id}", or fold it into the headline in 4 words or fewer.`,
    );
  }
  const box = Math.round(lineBox(stage));
  const measure = (
    item: CardText,
    cap: number,
    maxLines: number,
    role: MeasuredLine['role'],
  ): MeasuredLine[] => {
    const { fit, size, fits } = fitAtCap(item.value, cap, maxLines, stage, fonts);
    if (!fits) {
      const lines = maxLines === 1 ? 'one line' : `${maxLines} lines`;
      throw new TypeCardLayoutError(
        sceneId,
        item.id,
        `"${item.value}" does not fit on ${lines} of ${box} px at a cap height of ${Math.round(specPx(stage, cap))} px.`,
        'Shorten the copy: a type card never sets type below its cap height.',
      );
    }
    const height = specType.lineHeight * size;
    const baseline = baselineOffset({ ...fit, fontSize: size, lineHeight: specType.lineHeight });
    let first = 0;
    return fit.lines.map((line): MeasuredLine => {
      const words = line.split(' ').filter(Boolean);
      const measured: MeasuredLine = {
        textId: item.id,
        role,
        words,
        first,
        fontSize: size,
        width: widthAt(fit, line, size),
        height,
        baseline,
        cap: fit.metrics.cap * size,
      };
      first += words.length;
      return measured;
    });
  };
  const headCap = variant === 'name' ? specType.capS * typeCardTokens.nameCap : specType.capS;
  const measured = [
    ...measure(headline, headCap, subhead || variant === 'pivot' ? 1 : 2, 'headline'),
    ...(subhead ? measure(subhead, specType.capS, 1, 'subhead') : []),
  ];
  const centre = slotCentre(stage);
  const layout: TypeCardLayout = {
    variant,
    centre,
    headlineWords: measured
      .filter(({ role }) => role === 'headline')
      .reduce((sum, line) => sum + line.words.length, 0),
    fontFamily: fonts.display,
    weight,
    letterSpacing: specType.tracking,
    lineHeight: specType.lineHeight,
    ...placeLines(measured, centre),
  };
  layoutCache.set(key, layout);
  return layout;
}

export interface TypeCardBeats {
  /** The frame line 2 starts on, when line 2 arrives after line 1. */
  line2Start: number | undefined;
  /** `L`: the frame the last word becomes visible on the native entry. */
  lastWord: number;
  /** `rest = L + 13`, the acceptance still. */
  rest: number;
}

/**
 * The frames of the native entry. Headline word `i` of line 1 appears on `f = i`. A second headline
 * line starts on `n1 + 4` and a subhead on `nH + 3`, one word a frame. The name appears whole on
 * frame 0, so only its subhead arrives later.
 */
export function typeCardBeats(
  layout: Pick<TypeCardLayout, 'variant' | 'lines' | 'headlineWords'>,
): TypeCardBeats {
  const [one, two] = layout.lines;
  const n1 = one?.words.length ?? 0;
  const done = (lastWord: number, line2Start?: number) => ({
    line2Start,
    lastWord,
    rest: lastWord + typeCardTokens.settle,
  });
  const name = layout.variant === 'name';
  if (!two) return done(name ? 0 : n1 - 1);
  if (two.role === 'headline') {
    if (name) return done(0);
    const start = n1 + typeCardTokens.line2Gap;
    return done(start + two.words.length - 1, start);
  }
  const start = layout.headlineWords + typeCardTokens.subheadGap;
  return done(start + two.words.length - 1, start);
}

/** How the card is entered, from the transition the resolver chose. */
export type TypeCardEntry =
  | { kind: 'native' }
  | { kind: 't1'; seam: Seam | undefined }
  | { kind: 't5'; blank: number };

/**
 * T1 enters on the seam, T5 on the blink and rack, and everything else, T3 included, on the
 * native entry. A T1 enters on the seam even where the resolver names a carry.
 */
export function typeCardEntry(runtime: Pick<SceneRuntime, 'in' | 'b'>): TypeCardEntry {
  const incoming = runtime.in;
  if (incoming?.name === 't1') return { kind: 't1', seam: incoming.seam };
  if (incoming?.name === 't5') return { kind: 't5', blank: runtime.b };
  return { kind: 'native' };
}

/** A word at a frame. `x` and `y` are spec px from its place in the line. */
export interface WordState {
  visible: boolean;
  /** On T1, the word's move beyond its layer's: the layer takes `seamIn`, the word the rest. */
  x: number;
  y: number;
}

export interface TypeCardState {
  /** The drift scale about the slot, on the unclamped frame. */
  drift: number;
  /** The rack after a T5, on the whole block, in spec px. */
  blur: number;
  y: number;
  lines: { baseline: number; words: WordState[] }[];
}

const still = (visible: boolean): WordState => ({ visible, x: 0, y: 0 });

/**
 * Every word of the card at a spec frame, for an entry. Native: words pop in at full opacity and
 * rise on `wordRise`, the name rises as one unit, and line 2 pushes line 1 up. T1: every word at
 * rest and visible from frame 0, each word of a line moving `seamIn * gain(i)` with the word-gap
 * gain. T5: every word at full ink from the blank frames on, racked
 * into focus as one block. The drift runs on every frame.
 */
export function typeCardState(
  f: number,
  layout: Pick<TypeCardLayout, 'variant' | 'lines' | 'headlineWords' | 'aloneBaseline' | 'travel'>,
  entry: TypeCardEntry,
): TypeCardState {
  const drift = typeDrift(f);
  const atRest = (word: (line: PlacedLine, index: number) => WordState) =>
    layout.lines.map((line) => ({
      baseline: line.restBaseline,
      words: line.words.map((_, index) => word(line, index)),
    }));

  if (entry.kind === 't5') {
    const racked = blink(f, entry.blank);
    return { drift, blur: racked.blur, y: racked.y, lines: atRest(() => still(!racked.blank)) };
  }

  if (entry.kind === 't1') {
    const { seam } = entry;
    const offset = seam !== undefined && seam.axis === 'x' ? seamIn(f, seam) : 0;
    return {
      drift,
      blur: 0,
      y: 0,
      lines: atRest((line, index) => {
        const d = index - (line.words.length - 1) / 2;
        const x = offset * (wordGapGain(d) - 1);
        // `+ 0` turns a negative zero, from a still word, into a plain zero.
        return { visible: true, x: x + 0, y: 0 };
      }),
    };
  }

  const { line2Start } = typeCardBeats(layout);
  const { headlineRise, subheadRise, nameRise, nameArrival } = typeCardTokens;
  const name = layout.variant === 'name';
  const nameY = nameRise * (1 - arriveN(f, nameArrival.k, nameArrival.D));
  const lines = layout.lines.map((line, lineIndex) => {
    const pushed = lineIndex === 0 && line2Start !== undefined;
    const baseline = pushed
      ? layout.aloneBaseline - secondLinePush(f, line2Start, layout.travel)
      : line.restBaseline;
    const words = line.words.map((_, index): WordState => {
      if (name && line.role === 'headline') return { visible: f >= 0, x: 0, y: nameY };
      const start = lineIndex === 0 ? 0 : (line2Start ?? 0);
      const { rise: px, k } = line.role === 'subhead' ? subheadRise : headlineRise;
      const { visible, y } = wordRise(f - start, index, 1, px, k);
      return { visible, x: 0, y };
    });
    return { baseline, words };
  });
  return { drift, blur: 0, y: 0, lines };
}

const TypeCard = ({ scene, props }: SceneProps<TypeCardProps>) => {
  const runtime = useScene();
  const { stage } = runtime;
  const { f } = useSceneClock();
  const { colors, fonts } = useBrand();
  const layout = typeCardLayout(scene.text, variantOf(props), stage, fonts, scene.id);
  const state = typeCardState(f, layout, typeCardEntry(runtime));
  const { centre } = layout;
  // The block is a seam layer with no anchor id, so a T1 moves it on `seamIn` and never carries
  // it: see the note at the top of this file. The anchor is still declared below, for the
  // resolver's velocities and for a scene that carries from this one.
  return (
    <SeamLayer>
      <div
        style={{
          inset: 0,
          position: 'absolute',
          transform: `scale(${state.drift})`,
          transformOrigin: `${centre.x}px ${centre.y}px`,
        }}
      >
        <div
          style={{
            filter: state.blur > 0 ? `blur(${specPx(stage, state.blur)}px)` : undefined,
            inset: 0,
            position: 'absolute',
            transform: state.y !== 0 ? `translateY(${specPx(stage, state.y)}px)` : undefined,
          }}
        >
          {layout.lines.map((line, lineIndex) => {
            const lineState = state.lines[lineIndex];
            if (!lineState) return null;
            const direction = textDirection(line.words.join(' '));
            const marks = wordMarks(line.words, direction);
            return (
              <div
                key={`${line.textId}-${line.first}`}
                style={{
                  color: line.role === 'subhead' ? colors.muted : colors.foreground,
                  direction,
                  fontFamily: layout.fontFamily,
                  fontKerning: 'normal',
                  fontSize: line.fontSize,
                  fontWeight: layout.weight,
                  left: 0,
                  letterSpacing: layout.letterSpacing,
                  lineHeight: layout.lineHeight,
                  position: 'absolute',
                  textAlign: 'center',
                  top: lineState.baseline - line.baseline,
                  whiteSpace: 'pre',
                  width: stage.width,
                }}
              >
                {line.words.map((word, index) => {
                  const wordState = lineState.words[index] ?? still(false);
                  const n = line.first + index;
                  const accented = isAccented(props.accent, line.textId, n);
                  // The word's own move sits inside the drift, so it is divided by the drift to
                  // move exactly `x` on the frame.
                  const x = specPx(stage, wordState.x) / state.drift;
                  const y = specPx(stage, wordState.y);
                  return (
                    <span key={`${word}-${n}`}>
                      {index > 0 ? ' ' : ''}
                      {marks[index]}
                      <span
                        style={{
                          display: 'inline-block',
                          opacity: wordState.visible ? 1 : 0,
                          transform: x !== 0 || y !== 0 ? `translate(${x}px, ${y}px)` : undefined,
                          ...(accented ? { color: colors.accent } : {}),
                        }}
                      >
                        {word}
                      </span>
                      {marks[index]}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </SeamLayer>
  );
};

export const typeCard = defineScene<TypeCardProps>({
  component: TypeCard,
  props: propsSchema,
  roles: { headline: { min: 1, max: 1 }, subhead: { min: 0, max: 1 } },
  image: 'none',
  maxImages: 0,
  kind: 'type',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  // The text block. It enters on x, and leaves on x, or on y for the name, into the end card.
  anchors: [
    {
      id: 'headline',
      entry: anchorVelocity.x,
      exit: (props) => (props.variant === 'name' ? anchorVelocity.y : anchorVelocity.x),
      box: (f, { props, stage, text, theme }) =>
        typeCardBox(typeCardLayout(text, variantOf(props), stage, theme.fonts), f),
    },
  ],
});
