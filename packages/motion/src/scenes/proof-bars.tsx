import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { withAlpha } from '../brand/color.ts';
import type { BrandTheme } from '../brand/theme.ts';
import { RisingWords } from '../components/rising-words.tsx';
import { type SceneProps, useScene, useSceneClock } from '../components/scene-runtime.tsx';
import { baselineOffset, type SpecFit, specFit, specPx } from '../components/type.tsx';
import { blink } from '../core/curves.ts';
import { textDirection } from '../layout/bidi.ts';
import type { Stage } from '../layout/stage.ts';
import { anchorVelocity, rise } from '../tokens.ts';
import { SeamLayer } from '../transitions/seam-layer.tsx';
import { type Accent, accentSchema, isAccented } from './accent.ts';
import { defineScene } from './definition.ts';
import {
  barBox,
  type Fitter,
  fillShare,
  headlineBox,
  headlinePose,
  layoutErrorMessage,
  numberShown,
  type ProofBar,
  type ProofLayout,
  type ProofLayoutResult,
  type ProofText,
  proofGeometry,
  proofLayout,
  type TypeBlock,
  verdictScale,
} from './proof-bars-layout.ts';

const propsSchema = z.strictObject({
  accent: accentSchema.optional(),
});

export type ProofBarsProps = z.infer<typeof propsSchema>;

const layouts = new Map<string, ProofLayoutResult>();

/**
 * The card's layout for its text on this stage in these fonts, memoised in a module `Map` keyed by
 * everything it reads, so the component and every anchor box, on any frame and in any tab, read
 * one computation.
 */
export function proofLayoutFor(
  text: readonly ProofText[],
  stage: Stage,
  theme: Pick<BrandTheme, 'fonts' | 'radius'>,
): ProofLayoutResult {
  const key = JSON.stringify([
    text.map(({ id, role, value }) => [id, role, value]),
    stage.width,
    stage.height,
    theme.fonts.display,
    theme.fonts.body,
    theme.radius,
  ]);
  const known = layouts.get(key);
  if (known) return known;
  const fit: Fitter = (value, style, box) => specFit(value, style, stage, box, theme.fonts);
  const result = proofLayout(text, stage, theme.radius, fit);
  layouts.set(key, result);
  return result;
}

/** The layout, or the layout error that stops the render, naming the text that does not fit. */
function laidOut(
  where: string,
  text: readonly ProofText[],
  stage: Stage,
  theme: Pick<BrandTheme, 'fonts' | 'radius'>,
): ProofLayout {
  const result = proofLayoutFor(text, stage, theme);
  if (!result.ok) throw new Error(layoutErrorMessage(where, stage, result.issues));
  return result.layout;
}

/** The words of a fitted block, each in the accent colour when the accent phrase covers it. */
const StaticLines = ({
  lines,
  colorOf,
}: {
  lines: readonly string[];
  colorOf: (index: number) => string | undefined;
}) => {
  let index = -1;
  return (
    <>
      {lines.map((line) => (
        <div key={line} style={{ direction: textDirection(line), whiteSpace: 'pre' }}>
          {line.split(' ').map((word, position) => {
            index += 1;
            const color = colorOf(index);
            return (
              <span key={`${word}-${index}`} style={color ? { color } : {}}>
                {position > 0 ? ' ' : ''}
                {word}
              </span>
            );
          })}
        </div>
      ))}
    </>
  );
};

const blockStyle = (fit: SpecFit, family: string, color: string) => ({
  color,
  fontFamily: family,
  fontKerning: 'normal' as const,
  fontSize: fit.fontSize,
  fontWeight: fit.weight,
  letterSpacing: fit.letterSpacing,
  lineHeight: fit.lineHeight,
  position: 'absolute' as const,
});

/**
 * The hero claim. On T3, and as the first scene, its words pop in and rise on `wordRise(f, i, 1,
 * 72, 0.75)`. On T1 it is all there on frame 0, moving on the seam. After a T5 it is at full ink
 * from its first drawn frame, racking into focus. It then drifts, lifts to the slot and drifts.
 */
const Headline = ({
  block,
  lift,
  entry,
  rack,
  f,
  colorOf,
}: {
  block: TypeBlock;
  lift: number;
  entry: 'rise' | 'none';
  rack: { blur: number; y: number };
  f: number;
  colorOf: (index: number) => string | undefined;
}) => {
  const { stage } = useScene();
  const { colors, fonts } = useBrand();
  const { dy, scale } = headlinePose(f, lift);
  const { fit } = block;
  return (
    <div
      style={{
        ...blockStyle(fit, fonts.display, colors.foreground),
        filter: rack.blur > 0 ? `blur(${specPx(stage, rack.blur)}px)` : undefined,
        left: 0,
        textAlign: 'center',
        top: block.top,
        transform: `translateY(${dy + specPx(stage, rack.y)}px) scale(${scale})`,
        transformOrigin: `50% ${block.centreY - block.top}px`,
        width: stage.width,
      }}
    >
      {entry === 'rise' ? (
        <RisingWords lines={fit.lines} f={f} rise={rise.long} colorOf={colorOf} />
      ) : (
        <StaticLines lines={fit.lines} colorOf={colorOf} />
      )}
    </div>
  );
};

/** A bar's track, its fill, its name, and its number once the fill is complete. */
const Bar = ({
  bar,
  f,
  radius,
  colorOf,
}: {
  bar: ProofBar;
  f: number;
  radius: number;
  colorOf: (wordInLabel: number) => string | undefined;
}) => {
  const { colors, fonts } = useBrand();
  const { track, nameFit, numberFit, baseline } = bar;
  if (f < bar.start) return null;
  const fill = bar.length * fillShare(f, bar.index);
  const nameTop = baseline - baselineOffset(nameFit);
  const numberTop = baseline - baselineOffset(numberFit);
  const nameColor = (index: number) => colorOf(bar.nameWords[index] ?? -1);
  const numberAccented = bar.numberWords.some((index) => colorOf(index) !== undefined);
  // The name is drawn first, so a descender that reaches the bar tucks under it.
  return (
    <>
      <div
        style={{
          ...blockStyle(nameFit, fonts.body, colors.foreground),
          left: track.x,
          top: nameTop,
          whiteSpace: 'pre',
        }}
      >
        <RisingWords lines={nameFit.lines} f={f} start={bar.start} colorOf={nameColor} />
      </div>
      <div
        style={{
          background: withAlpha(colors.muted, proofGeometry.trackAlpha),
          borderRadius: radius,
          height: track.height,
          left: track.x,
          position: 'absolute',
          top: track.y,
          width: track.width,
        }}
      />
      {fill > 0 ? (
        <div
          style={{
            background: colors.accent,
            borderRadius: radius,
            height: track.height,
            left: track.x,
            position: 'absolute',
            top: track.y,
            width: fill,
          }}
        />
      ) : null}
      {numberShown(f, bar.index) ? (
        <div
          style={{
            ...blockStyle(
              numberFit,
              fonts.display,
              numberAccented ? colors.accent : colors.foreground,
            ),
            direction: 'ltr',
            left: bar.numberX,
            top: numberTop,
            whiteSpace: 'pre',
          }}
        >
          {bar.number}
        </div>
      ) : null}
    </>
  );
};

/** The verdict stamps when the last bar is full, with the slam pop, then drifts. */
const Verdict = ({
  block,
  scale,
  colorOf,
}: {
  block: TypeBlock;
  scale: number;
  colorOf: (index: number) => string | undefined;
}) => {
  const { stage } = useScene();
  const { colors, fonts } = useBrand();
  if (scale <= 0) return null;
  return (
    <div
      style={{
        ...blockStyle(block.fit, fonts.display, colors.foreground),
        left: 0,
        textAlign: 'center',
        top: block.top,
        transform: `scale(${scale})`,
        transformOrigin: `50% ${block.centreY - block.top}px`,
        width: stage.width,
      }}
    >
      <StaticLines lines={block.fit.lines} colorOf={colorOf} />
    </div>
  );
};

const ProofBars = ({ scene, props }: SceneProps<ProofBarsProps>) => {
  const { stage } = useScene();
  const { f, b, inT } = useSceneClock();
  const theme = useBrand();
  const layout = laidOut(`scene "${scene.id}"`, scene.text, stage, theme);
  const accent: Accent | undefined = props.accent;
  const accentOf = (textId: string) => (index: number) =>
    isAccented(accent, textId, index) ? theme.colors.accent : undefined;
  // T1 enters on the seam and T5 racks, so only T3, and a card that opens the film, rise.
  const entry = inT === 't1' || inT === 't5' ? 'none' : 'rise';
  const rack = inT === 't5' ? blink(f, b) : { blur: 0, y: 0 };
  const { verdict } = layout;
  // No corner mark: at 9:16 and 1:1 the headline's slot is in the mark's corner, and a mark shown
  // in one format and not another, or on one card of a group and not the next, would blink.
  return (
    <>
      <SeamLayer anchor="headline">
        <Headline
          block={layout.headline}
          lift={layout.lift}
          entry={entry}
          rack={rack}
          f={f}
          colorOf={accentOf(layout.headline.textId)}
        />
      </SeamLayer>
      <SeamLayer>
        {layout.bars.map((bar) => (
          <Bar
            key={bar.textId}
            bar={bar}
            f={f}
            radius={layout.frame.track.radius}
            colorOf={accentOf(bar.textId)}
          />
        ))}
        {verdict ? (
          <Verdict
            block={verdict}
            scale={verdictScale(f, layout.verdictAt)}
            colorOf={accentOf(verdict.textId)}
          />
        ) : null}
      </SeamLayer>
    </>
  );
};

const barAnchor = (j: number) => ({
  id: `bar-${j}`,
  colour: 'accent',
  box: (
    f: number,
    { text, stage, theme }: { text: readonly ProofText[]; stage: Stage; theme: BrandTheme },
  ) => barBox(laidOut(`bar-${j}`, text, stage, theme), j, f),
});

export const proofBars = defineScene<ProofBarsProps>({
  component: ProofBars,
  props: propsSchema,
  roles: {
    headline: { min: 1, max: 1 },
    label: { min: 1, max: 3 },
    subhead: { min: 0, max: 1 },
  },
  image: 'none',
  maxImages: 0,
  kind: 'proof',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  anchors: [
    {
      id: 'headline',
      entry: anchorVelocity.x,
      exit: anchorVelocity.x,
      box: (f, { text, stage, theme }) =>
        headlineBox(laidOut('headline', text, stage, theme), stage, f),
    },
    barAnchor(0),
    barAnchor(1),
    barAnchor(2),
  ],
});
