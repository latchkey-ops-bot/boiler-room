/**
 * `stat-counter`, as `docs/motion/scenes/stat-counter.md` specifies it: one large cited number with
 * a label, the proof scene for a single claim. The number is `scene.text`'s headline, set exactly
 * as written, and the label says what it counts. Nothing on screen comes from props.
 */
import type { Scene } from '@boiler-room/schema';
import { measureText } from '@remotion/layout-utils';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { RisingWords } from '../components/rising-words.tsx';
import { cornerMark, SceneMark } from '../components/scene-base.tsx';
import { type SceneProps, useScene, useSceneClock } from '../components/scene-runtime.tsx';
import {
  baselineOffset,
  type FontMetrics,
  fontMetrics,
  lineBox,
  type SpecFit,
  type SpecTypeStyle,
  specFit,
  specPx,
} from '../components/type.tsx';
import { arriveN, blink, typeDrift } from '../core/curves.ts';
import { textDirection } from '../layout/bidi.ts';
import type { Rect } from '../layout/rect.ts';
import type { Orientation, Stage } from '../layout/stage.ts';
import { anchorVelocity, arrival, specType, type as typography } from '../tokens.ts';
import { SeamLayer } from '../transitions/seam-layer.tsx';
import { type Accent, accentSchema, isAccented } from './accent.ts';
import { defineScene } from './definition.ts';

/**
 * The scene file's values, in spec px and spec frames. [M] the pop, the label rise and the drift;
 * [D] the number's 0.8 W at 16:9, the 0.13 W floor and the count-up's end; [N] the other formats'
 * boxes and centres, and the label baselines.
 */
export const stat = {
  /** The widest the number may be, of the width, and the centre of its cap box, of the height. */
  number: {
    landscape: { width: 0.8, centreY: 0.42 },
    portrait: { width: 0.86, centreY: 0.4 },
    square: { width: 0.8, centreY: 0.42 },
  } satisfies Record<Orientation, { width: number; centreY: number }>,
  /** Below this share of the width, the number cannot read as a stat, and the layout fails. */
  smallestNumber: 0.13,
  /** The baseline of the label's first line, as a share of the height. Its box is `lineBox`. */
  labelBaseline: { landscape: 0.72, portrait: 0.56, square: 0.74 } satisfies Record<
    Orientation,
    number
  >,
  labelLines: 2,
  /** The label's first word rises on this frame, one word a frame after it. */
  labelAt: 8,
  /** The T3 entry: scale `1 + excess * k ** f` from frame 0 until `arrive.slam` settles. */
  pop: { excess: 0.26, k: arrival.slam.k, frames: arrival.slam.D },
  /** A count-up holds 0 until this frame, then rises on `arrive.long` to the exact value. */
  countFrom: 6,
} as const;

const propsSchema = z.strictObject({
  /**
   * Count-ups wait for the founder: a count-up shows numbers no quote states, which the project's
   * rule on numbers forbids until that decision is made. The motion is built, and this refusal is
   * the one thing to remove once it is approved.
   */
  countUp: z
    .boolean()
    .optional()
    .refine((value): boolean => value !== true, {
      error:
        'count-ups wait for the founder: until count-ups are approved, every number on screen is the cited value from its first frame. Set countUp to false or remove it',
    }),
  accent: accentSchema.optional(),
});

export type StatCounterProps = z.infer<typeof propsSchema>;

/** The number is set in the display face, at display cap height, with tabular figures. */
const numberStyle = {
  font: 'display',
  weight: typography.weight.display,
  cap: specType.capD,
} as const;
/** The label is a sentence: the display face at sentence cap height, in one weight with the number. */
const labelStyle: SpecTypeStyle = {
  font: 'display',
  weight: typography.weight.display,
  cap: specType.capS,
};
/**
 * Tabular figures, measured and drawn by one declaration. `measureText` leaves
 * `fontVariantNumeric` out of its cache key, so measuring a value with and without it would return
 * whichever came first. The feature setting goes through `additionalStyles`, which is in the key.
 */
const TABULAR = { fontFeatureSettings: '"tnum" 1' } as const;

/** Measures a run of the number's face at a size. Tests pass their own. */
export type WidthOf = (text: string, fontSize: number) => number;

const tabularWidth =
  (fontFamily: string): WidthOf =>
  (text, fontSize) =>
    measureText({
      text,
      fontFamily,
      fontSize,
      fontWeight: numberStyle.weight,
      letterSpacing: specType.tracking,
      additionalStyles: TABULAR,
      validateFontIsLoaded: true,
    }).width;

export interface NumberFit {
  /** The size the number is set at: its cap-height size, or smaller to fit its box. */
  fontSize: number;
  /** Its width at that size. */
  width: number;
  /** Its cap height at that size, in px. */
  cap: number;
  /** The centre of its cap box. */
  centreX: number;
  centreY: number;
  /** The widest it may be. */
  maxWidth: number;
  /** The smallest size it may be set at, 0.13 W. */
  smallest: number;
}

/**
 * The number's size and place: `Math.min(capDerivedSize, the size that fits its box)`, as the
 * scene file writes it, in whole pixels as every fitted size is. Its cap box is centred on the
 * frame's centre line at the format's height.
 */
export function fitNumber(
  value: string,
  stage: Pick<Stage, 'width' | 'height' | 'orientation'>,
  metrics: Pick<FontMetrics, 'cap'>,
  widthOf: WidthOf,
): NumberFit {
  const share = stat.number[stage.orientation];
  const maxWidth = stage.width * share.width;
  let fontSize = Math.floor(specPx(stage, numberStyle.cap) / metrics.cap);
  const probe = widthOf(value, fontSize);
  if (probe > maxWidth && probe > 0) {
    fontSize = Math.floor((fontSize * maxWidth) / probe);
    while (fontSize > 1 && widthOf(value, fontSize) > maxWidth) fontSize -= 1;
  }
  return {
    fontSize,
    width: widthOf(value, fontSize),
    cap: metrics.cap * fontSize,
    centreX: stage.width / 2,
    centreY: stage.height * share.centreY,
    maxWidth,
    smallest: stage.width * stat.smallestNumber,
  };
}

export interface StatLayout {
  number: NumberFit;
  /** The number's face, for drawing it as it was measured. */
  numberFace: { fontFamily: string; weight: number; metrics: FontMetrics };
  label: SpecFit;
  /** The label's box: centred, `lineBox` wide, its first baseline on the format's line. */
  labelBox: { x: number; width: number; baseline: number };
}

/** The label's box: centred, `lineBox` wide (1248, 929 or 864 px), its first baseline on its line. */
export const labelBoxOf = (stage: Stage): StatLayout['labelBox'] => {
  const width = lineBox(stage);
  return {
    x: (stage.width - width) / 2,
    width,
    baseline: stage.height * stat.labelBaseline[stage.orientation],
  };
};

const layoutCache = new Map<string, StatLayout>();

/**
 * The scene's layout, from its copy, the stage and the brand's fonts only. It is pure once the
 * fonts are loaded, and memoised in a module `Map` keyed by everything it reads, so the anchor's
 * `box` can call it on any frame, in any tab, in any order.
 */
export function statLayout(
  headline: string,
  label: string,
  stage: Stage,
  fonts: { display: string; body: string },
): StatLayout {
  const fontFamily = fonts[numberStyle.font];
  const key = [headline, label, fontFamily, fonts.body, stage.width, stage.height].join('|');
  const known = layoutCache.get(key);
  if (known) return known;
  const metrics = fontMetrics(fontFamily, numberStyle.weight);
  const labelBox = labelBoxOf(stage);
  const layout: StatLayout = {
    number: fitNumber(headline, stage, metrics, tabularWidth(fontFamily)),
    numberFace: { fontFamily, weight: numberStyle.weight, metrics },
    label: specFit(
      label,
      labelStyle,
      stage,
      { width: labelBox.width, maxLines: stat.labelLines },
      fonts,
    ),
    labelBox,
  };
  layoutCache.set(key, layout);
  return layout;
}

interface TextRef {
  id: string;
  value: string;
}

/**
 * Fit or fail, as `docs/motion/scenes/README.md` sets it: copy is never set below its cap height
 * to make it fit. The number may be made smaller to fit its box, down to 0.13 W and no further, and
 * the label is set at the sentence cap height on at most two lines or not at all. Each problem
 * names the scene and the text id, and says what the Director changes.
 */
export function layoutProblems(
  sceneId: string,
  copy: { headline: TextRef; label: TextRef },
  layout: {
    number: NumberFit;
    label: Pick<SpecFit, 'lines' | 'fontSize' | 'targetSize'>;
    labelBox: Pick<StatLayout['labelBox'], 'width'>;
  },
  stage: Pick<Stage, 'width' | 'height'>,
): string[] {
  const problems: string[] = [];
  const size = `${stage.width}x${stage.height}`;
  const { number, label, labelBox } = layout;
  if (number.fontSize < number.smallest) {
    problems.push(
      `Scene "${sceneId}", text "${copy.headline.id}": the number "${copy.headline.value}" fits ${Math.round(number.maxWidth)} px only at ${number.fontSize} px, under 0.13 W (${Math.ceil(number.smallest)} px at ${size}), so it would not read as a stat. Shorten the headline to the number and its unit.`,
    );
  }
  if (label.lines.length === 0 || label.fontSize < Math.floor(label.targetSize)) {
    problems.push(
      `Scene "${sceneId}", text "${copy.label.id}": the label "${copy.label.value}" does not fit ${stat.labelLines} lines of ${Math.round(labelBox.width)} px at the sentence cap height (${specType.capS} px) at ${size}. Shorten the label.`,
    );
  }
  return problems;
}

/** The accent is the number's: the scene file draws the label in ink. */
export function accentProblem(scene: Pick<Scene, 'id' | 'text'>, accent: Accent | undefined) {
  if (!accent) return undefined;
  const target = scene.text.find(({ id }) => id === accent.textId);
  if (!target || target.role === 'headline') return undefined;
  return `Scene "${scene.id}": props.accent names text "${accent.textId}", a ${target.role}, but stat-counter draws its label in ink and only accents the number. Point props.accent.textId at the headline, or remove it.`;
}

/** Thrown while rendering a stat-counter whose copy cannot be laid out at its cap heights. */
export class StatCounterLayoutError extends Error {
  constructor(problems: readonly string[]) {
    super(`LAYOUT_UNFIT: ${problems.join(' ')}`);
    this.name = 'StatCounterLayoutError';
  }
}

/** The T3 entry: the number pops at full value, at 1.26 on frame 0, exactly 1 from frame 6. */
export const popScale = (f: number): number =>
  f >= stat.pop.frames ? 1 : 1 + stat.pop.excess * stat.pop.k ** Math.max(0, f);

/**
 * The number's cap box at a spec frame: centred at its place, and drifting larger about that
 * centre, which the label drifts about too. The centre is one fixed point for the whole scene, so
 * a stat-counter after a T5 racks into exactly the slot the one before it held. The pop and the
 * rack are entry moves, not part of the box.
 */
export function numberBox(number: NumberFit, f: number): Rect {
  const scale = typeDrift(f);
  const width = number.width * scale;
  const height = number.cap * scale;
  return { x: number.centreX - width / 2, y: number.centreY - height / 2, width, height };
}

const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/;

/**
 * The headline during a count-up, which `props.countUp` turns on once the founder approves it: `0`
 * up to frame 5, then `round(target * arriveN(f - 6, 0.88, 35))` at the target's decimals and
 * grouping, so it reaches exactly the written value on frame 41 and holds it. The prefix and unit
 * show from frame 0, values only rise, and no other digits ever appear. `f` is `abs - from` in spec
 * frames: the shared clock the scene file names.
 */
export function countUpText(value: string, f: number): string {
  const match = NUMBER.exec(value);
  if (!match) return value;
  const progress =
    f < stat.countFrom ? 0 : arriveN(f - stat.countFrom, arrival.long.k, arrival.long.D);
  if (progress >= 1) return value;
  const digits = match[0];
  const decimals = digits.split('.')[1]?.length ?? 0;
  const target = Number(digits.replaceAll(',', ''));
  const scale = 10 ** decimals;
  const shown = Math.round(target * progress * scale) / scale;
  let [whole = '0', fraction] = shown.toFixed(decimals).split('.');
  if (digits.includes(',')) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const number = fraction === undefined ? whole : `${whole}.${fraction}`;
  return value.slice(0, match.index) + number + value.slice(match.index + digits.length);
}

/**
 * The headline as runs of words and the gaps between them, so it is drawn exactly as written. Each
 * word has its index as the validator counts words, and each run its offset, which keys it.
 */
export const headlineRuns = (value: string) => {
  let word = -1;
  let at = 0;
  const runs = value.split(/(\s+)/).filter((text) => text !== '');
  return runs.map((text) => {
    const space = /^\s+$/.test(text);
    if (!space) word += 1;
    const run = { text, at, word: space ? undefined : word };
    at += text.length;
    return run;
  });
};

const StatCounter = ({ scene, props }: SceneProps<StatCounterProps>) => {
  const { stage } = useScene();
  const { f, b, inT } = useSceneClock();
  const { colors, fonts } = useBrand();
  const headline = scene.text.find(({ role }) => role === 'headline');
  const label = scene.text.find(({ role }) => role === 'label');
  if (!headline || !label) {
    throw new Error(`Scene "${scene.id}" needs a headline and a label. validateFilm checks this.`);
  }
  const layout = statLayout(headline.value, label.value, stage, fonts);
  const problems = layoutProblems(scene.id, { headline, label }, layout, stage);
  const accentIssue = accentProblem(scene, props.accent);
  if (accentIssue) problems.push(accentIssue);
  if (problems.length > 0) throw new StatCounterLayoutError(problems);

  const { number, numberFace, label: labelFit, labelBox } = layout;
  // T1 brings the number in on the seam, with no entry of its own. After T5 it racks into focus
  // at full ink once the blank frames are over. Otherwise, after T3 or as the first scene, it pops.
  const racked = inT === 't5' ? blink(f, b) : { blur: 0, y: 0 };
  const pop = inT === 't1' || inT === 't5' ? 1 : popScale(f);
  const shown = props.countUp === true ? countUpText(headline.value, f) : headline.value;
  const numberTop =
    number.centreY +
    number.cap / 2 -
    baselineOffset({
      fontSize: number.fontSize,
      lineHeight: specType.lineHeight,
      metrics: numberFace.metrics,
    });
  // Number and label drift as one, about the number's centre: the headline slot of a T5 group.
  const drift = {
    inset: 0,
    position: 'absolute' as const,
    transform: `scale(${typeDrift(f)})`,
    transformOrigin: `${number.centreX}px ${number.centreY}px`,
  };

  return (
    <>
      <SceneMark placement={cornerMark(stage)} />
      <SeamLayer anchor="number">
        <div style={drift}>
          <div
            style={{
              inset: 0,
              position: 'absolute',
              transform: pop === 1 ? undefined : `scale(${pop})`,
              transformOrigin: `${number.centreX}px ${number.centreY}px`,
            }}
          >
            <div
              style={{
                ...TABULAR,
                color: colors.foreground,
                direction: textDirection(shown),
                filter: racked.blur > 0 ? `blur(${specPx(stage, racked.blur)}px)` : undefined,
                fontFamily: numberFace.fontFamily,
                fontKerning: 'normal',
                fontSize: number.fontSize,
                fontWeight: numberFace.weight,
                left: 0,
                letterSpacing: specType.tracking,
                lineHeight: specType.lineHeight,
                position: 'absolute',
                textAlign: 'center',
                top: numberTop,
                transform: racked.y === 0 ? undefined : `translateY(${specPx(stage, racked.y)}px)`,
                unicodeBidi: 'isolate',
                whiteSpace: 'pre',
                width: stage.width,
              }}
            >
              {headlineRuns(shown).map(({ text, at, word }) => (
                <span
                  key={at}
                  style={
                    word !== undefined && isAccented(props.accent, headline.id, word)
                      ? { color: colors.accent }
                      : undefined
                  }
                >
                  {text}
                </span>
              ))}
            </div>
          </div>
        </div>
      </SeamLayer>
      <SeamLayer>
        <div style={drift}>
          <div
            style={{
              color: colors.foreground,
              fontFamily: labelFit.fontFamily,
              fontKerning: 'normal',
              fontSize: labelFit.fontSize,
              fontWeight: labelFit.weight,
              left: labelBox.x,
              letterSpacing: labelFit.letterSpacing,
              lineHeight: labelFit.lineHeight,
              position: 'absolute',
              textAlign: 'center',
              top: labelBox.baseline - baselineOffset(labelFit),
              width: labelBox.width,
            }}
          >
            <RisingWords lines={labelFit.lines} f={f} start={stat.labelAt} />
          </div>
        </div>
      </SeamLayer>
    </>
  );
};

export const statCounter = defineScene<StatCounterProps>({
  component: StatCounter,
  props: propsSchema,
  roles: { headline: { min: 1, max: 1 }, label: { min: 1, max: 1 } },
  image: 'none',
  maxImages: 0,
  markAnchor: (stage) => cornerMark(stage),
  kind: 'proof',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  anchors: [
    {
      id: 'number',
      entry: anchorVelocity.x,
      exit: anchorVelocity.x,
      box: (f, { stage, text, theme }) => {
        const value = (role: string) => text.find((item) => item.role === role)?.value ?? '';
        const { number } = statLayout(value('headline'), value('label'), stage, theme.fonts);
        return numberBox(number, f);
      },
    },
  ],
});
