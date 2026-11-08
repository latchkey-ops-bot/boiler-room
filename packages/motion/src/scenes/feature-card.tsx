import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { withAlpha } from '../brand/color.ts';
import { BrowserFrame } from '../components/browser-frame.tsx';
import { RisingWords } from '../components/rising-words.tsx';
import { type SceneProps, useScene, useSceneClock } from '../components/scene-runtime.tsx';
import {
  baselineOffset,
  type FontMetrics,
  fontMetrics,
  lineBox,
  type SpecFit,
  type SpecTypeStyle,
  specFitAtCap,
  specPx,
  useSpecFit,
} from '../components/type.tsx';
import { type Point, WHOLE_IMAGE } from '../core/camera.ts';
import { arriveN, blink, springPop, typeDrift } from '../core/curves.ts';
import { textDirection } from '../layout/bidi.ts';
import { fitContain, type Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import { anchorVelocity, arrival, card, drift, specType, type as typography } from '../tokens.ts';
import { SeamLayer } from '../transitions/seam-layer.tsx';
import { type Accent, accentSchema, isAccented } from './accent.ts';
import { defineScene, type SceneImage } from './definition.ts';

const propsSchema = z.strictObject({
  /** `crop` shows the scene's captured crops, `chips` greeked shapes. */
  demo: z.enum(['chips', 'crop']).optional(),
  accent: accentSchema.optional(),
});

export type FeatureCardProps = z.infer<typeof propsSchema>;

/** `crop` when the scene gives an image, as the scene file sets the default. */
export const demoOf = (props: FeatureCardProps, imageCount: number): 'chips' | 'crop' =>
  props.demo ?? (imageCount > 0 ? 'crop' : 'chips');

export interface CardNode {
  /** Where the crop or chip sits. */
  visual: Rect;
  /** The space under it for the node's label. */
  label: Rect;
}

export interface CardLayout {
  /** The cap top of the headline, the same for every card in a group. */
  headlineTop: number;
  panel: Rect;
  cause: CardNode;
  effect: CardNode;
  /** The connector runs along this axis between the two visuals. */
  axis: 'x' | 'y';
}

/**
 * The panel, and a node at each end of it: thirds side by side, or in a tall frame halves. The
 * panel sits where the scene file puts it, or lower where the headline slot, `slot` from
 * `slotBottom`, would come within `card.slotGap` of its top. It keeps its size as it moves down,
 * so its nodes and crops are the size the render gate sized them at, and it is shortened only if
 * it would otherwise leave the safe area.
 */
export function cardLayout(stage: Stage, slot?: number): CardLayout {
  const { width: W, height: H, orientation } = stage;
  const share = card.panel[orientation];
  const height = H * share.height;
  const top = Math.max(
    H * share.centreY - height / 2,
    slot === undefined ? 0 : slot + specPx(stage, card.slotGap),
  );
  const panel = {
    x: (W - W * share.width) / 2,
    y: top,
    width: W * share.width,
    height: Math.min(height, stage.safe.y + stage.safe.height - top),
  };
  const pad = specPx(stage, 36);
  const labelHeight = specPx(stage, 150);
  const node = (box: Rect): CardNode => {
    const inner = {
      x: box.x + pad,
      y: box.y + pad,
      width: box.width - pad * 2,
      height: box.height - pad * 2,
    };
    return {
      visual: { ...inner, height: inner.height - labelHeight },
      label: { ...inner, y: inner.y + inner.height - labelHeight, height: labelHeight },
    };
  };
  if (orientation === 'portrait') {
    const part = panel.height * 0.42;
    return {
      headlineTop: H * card.headlineTop[orientation],
      panel,
      cause: node({ ...panel, height: part }),
      effect: node({ ...panel, y: panel.y + panel.height - part, height: part }),
      axis: 'y',
    };
  }
  const third = panel.width / 3;
  return {
    headlineTop: H * card.headlineTop[orientation],
    panel,
    cause: node({ ...panel, width: third }),
    effect: node({ ...panel, x: panel.x + third * 2, width: third }),
    axis: 'x',
  };
}

/** A crop fills as much of its node as it can without being cropped. */
export const cropRect = (node: CardNode, image: Pick<SceneImage, 'aspect'>): Rect =>
  fitContain(node.visual, image.aspect);

/** The shape a greeked or accent chip takes in its node. */
const chipRect = (node: CardNode): Rect => {
  const width = node.visual.width * 0.86;
  const height = Math.min(node.visual.height, width * 0.42);
  return {
    x: node.visual.x + (node.visual.width - width) / 2,
    y: node.visual.y + (node.visual.height - height) / 2,
    width,
    height,
  };
};

/**
 * How far the panel is below its rest at a spec frame. On a T1 entry it arrives with the headline
 * on the seam instead, so it does not rise.
 */
export const panelOffset = (f: number, stage: Stage, seamedIn: boolean): number =>
  seamedIn
    ? 0
    : specPx(stage, card.panelTravel) *
      (1 - arriveN(f - card.beats.panel, arrival.snap.k, arrival.snap.D));

const nodeDrift = (f: number, stage: Stage) => specPx(stage, drift.node * Math.max(0, f));

const Chip = ({ rect, fill, bars }: { rect: Rect; fill: string; bars: string }) => {
  const { radius } = useBrand();
  const bar = rect.height * 0.14;
  return (
    <div
      style={{
        background: fill,
        borderRadius: Math.min(radius * 2, rect.height / 2),
        display: 'flex',
        flexDirection: 'column',
        gap: bar * 0.9,
        height: rect.height,
        justifyContent: 'center',
        left: rect.x,
        padding: `0 ${rect.width * 0.12}px`,
        position: 'absolute',
        top: rect.y,
        width: rect.width,
      }}
    >
      {[0.72, 0.48].map((share) => (
        <div
          key={share}
          style={{ background: bars, borderRadius: bar, height: bar, width: `${share * 100}%` }}
        />
      ))}
    </div>
  );
};

const headlineStyle: SpecTypeStyle = {
  font: 'display',
  weight: typography.weight.display,
  cap: specType.capS,
};

/**
 * The widest a line of the headline is set: the line box, or the safe area where that is narrower,
 * made narrower again by the drift. The headline drifts larger about its centre on every frame, to
 * `dur` at the latest, so at this width no line is wider than the line box, 0.65 W in 16:9, or
 * outside the safe area on any frame of the scene, however long the card runs.
 */
export const headlineWidth = (stage: Stage, dur: number): number =>
  Math.min(lineBox(stage), stage.safe.width) / typeDrift(dur);

/**
 * The headline at the sentence cap height, `capS`, on at most two lines of `headlineWidth`: fit or
 * fail, as `docs/motion/scenes/README.md` sets it. It is never set smaller to fit, so `fits` is
 * false for copy that needs a smaller size or more lines, and the scene refuses to render it.
 */
export const fitCardHeadline = (
  value: string,
  stage: Stage,
  dur: number,
  fonts: { display: string; body: string },
): { fit: SpecFit; size: number; fits: boolean } =>
  specFitAtCap(
    value,
    headlineStyle,
    stage,
    { width: headlineWidth(stage, dur), maxLines: card.headlineLines },
    fonts,
  );

/** Why a headline that did not fit cannot be set, naming the scene and the text id. */
export const headlineProblem = (
  sceneId: string,
  headline: { id: string; value: string },
  stage: Pick<Stage, 'width' | 'height'>,
  width: number,
): string =>
  `Scene "${sceneId}", text "${headline.id}": the feature-card headline "${headline.value}" does not fit on ${card.headlineLines} lines of ${Math.round(width)} px at the sentence cap height (${specType.capS} px) at ${stage.width}x${stage.height}. Shorten the headline: a feature card never sets it below its cap height.`;

/** Thrown while rendering a feature-card whose headline cannot be set at its cap height. */
export class FeatureCardLayoutError extends Error {
  constructor(problem: string) {
    super(`LAYOUT_UNFIT: ${problem}`);
    this.name = 'FeatureCardLayoutError';
  }
}

/** The top of the headline's first line box: its cap top sits on the slot, the same on every card. */
const headlineLineTop = (
  fit: Pick<SpecFit, 'fontSize' | 'lineHeight' | 'metrics'>,
  top: number,
): number => top + fit.metrics.cap * fit.fontSize - baselineOffset(fit);

/**
 * The lowest the headline slot reaches: the bottom of two line boxes at `capS` in the display
 * font, line 1's cap top on the slot, as they drift larger about their centre to the scene's last
 * frame. A one-line headline stays above it too, so the panel under it is in one place on every
 * card of a group, whatever each card's headline.
 */
export function slotBottom(stage: Stage, metrics: FontMetrics, dur: number): number {
  const fontSize = Math.ceil(specPx(stage, specType.capS) / metrics.cap - 1e-9);
  const lineHeight = specType.lineHeight;
  const lineTop = headlineLineTop(
    { fontSize, lineHeight, metrics },
    stage.height * card.headlineTop[stage.orientation],
  );
  const height = card.headlineLines * fontSize * lineHeight;
  return lineTop + (height * (1 + typeDrift(dur))) / 2;
}

/**
 * The headline anchor's box at a spec frame: the fitted lines, centred in the slot, as they drift
 * larger about their centre. Its rack offset is an entry move, not part of the box.
 */
export function headlineBox(fit: SpecFit, stage: Stage, top: number, f: number): Rect {
  const scale = typeDrift(f);
  const height = fit.fontSize * fit.lineHeight * Math.max(1, fit.lines.length);
  const lineTop = headlineLineTop(fit, top);
  const centreY = lineTop + height / 2;
  return {
    x: stage.width / 2 - (fit.width * scale) / 2,
    y: centreY - (height * scale) / 2,
    width: fit.width * scale,
    height: height * scale,
  };
}

const Headline = ({
  id,
  fit,
  top,
  f,
  rack,
  accent,
}: {
  id: string;
  fit: SpecFit;
  top: number;
  f: number;
  rack: { blur: number; y: number };
  accent: Accent | undefined;
}) => {
  const { stage } = useScene();
  const { colors, fonts } = useBrand();
  const lineTop = headlineLineTop(fit, top);
  const { blur, y } = rack;
  let index = -1;
  return (
    <div
      style={{
        color: colors.foreground,
        filter: blur > 0 ? `blur(${specPx(stage, blur)}px)` : undefined,
        fontFamily: fonts.display,
        fontKerning: 'normal',
        fontSize: fit.fontSize,
        fontWeight: fit.weight,
        left: 0,
        letterSpacing: fit.letterSpacing,
        lineHeight: fit.lineHeight,
        position: 'absolute',
        textAlign: 'center',
        top: lineTop,
        transform: `translateY(${specPx(stage, y)}px) scale(${typeDrift(f)})`,
        transformOrigin: '50% 50%',
        width: stage.width,
      }}
    >
      {fit.lines.map((line) => (
        <div key={line} style={{ direction: textDirection(line), whiteSpace: 'pre' }}>
          {line.split(' ').map((word, position) => {
            index += 1;
            const accented = isAccented(accent, id, index);
            return (
              <span key={`${word}-${index}`} style={accented ? { color: colors.accent } : {}}>
                {position > 0 ? ' ' : ''}
                {word}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** A node label, set under its node's visual on up to two lines. */
const useLabelFit = (value: string, node: CardNode): SpecFit => {
  const { stage } = useScene();
  return useSpecFit(
    value,
    { font: 'body', weight: typography.weight.strong, cap: specType.capS * card.labelCap },
    stage,
    { width: node.label.width, maxLines: 2 },
  );
};

/**
 * Where the connector runs: from the facing edge of the cause to the facing edge of the effect.
 * Side by side those are the visuals' edges. Stacked, the cause's label sits under its visual, so
 * the line starts under the label, at `causeLabelBottom`, rather than through it.
 */
export function connectorEnds(
  axis: CardLayout['axis'],
  causeRect: Rect,
  effectRect: Rect,
  causeLabelBottom: number | undefined,
): { from: Point; to: Point } {
  if (axis === 'x') {
    return {
      from: { x: causeRect.x + causeRect.width, y: causeRect.y + causeRect.height / 2 },
      to: { x: effectRect.x, y: effectRect.y + effectRect.height / 2 },
    };
  }
  return {
    from: {
      x: causeRect.x + causeRect.width / 2,
      y: causeLabelBottom ?? causeRect.y + causeRect.height,
    },
    to: { x: effectRect.x + effectRect.width / 2, y: effectRect.y },
  };
}

const NodeLabel = ({
  fit,
  node,
  f,
  start,
}: {
  fit: SpecFit;
  node: CardNode;
  f: number;
  start: number;
}) => {
  const { colors, fonts } = useBrand();
  if (f < start) return null;
  return (
    <div
      style={{
        color: colors.foreground,
        fontFamily: fonts.body,
        fontSize: fit.fontSize,
        fontWeight: fit.weight,
        left: node.label.x,
        letterSpacing: fit.letterSpacing,
        lineHeight: fit.lineHeight,
        position: 'absolute',
        textAlign: 'center',
        top: node.label.y,
        width: node.label.width,
      }}
    >
      <RisingWords lines={fit.lines} f={f} start={start} />
    </div>
  );
};

const FeatureCard = ({ scene, props }: SceneProps<FeatureCardProps>) => {
  const { stage, images, dur } = useScene();
  const { f, b, inT } = useSceneClock();
  const { colors, radius, fonts } = useBrand();
  const headline = scene.text.find(({ role }) => role === 'headline');
  if (!headline) throw new Error(`Scene "${scene.id}" has no headline. validateFilm checks this.`);
  const fitted = fitCardHeadline(headline.value, stage, dur, fonts);
  if (!fitted.fits) {
    throw new FeatureCardLayoutError(
      headlineProblem(scene.id, headline, stage, headlineWidth(stage, dur)),
    );
  }
  const labels = scene.text.filter(({ role }) => role === 'label');
  const metrics = fontMetrics(fonts.display, headlineStyle.weight);
  const layout = cardLayout(stage, slotBottom(stage, metrics, dur));
  const demo = demoOf(props, images.length);
  // On T1 the headline and panel enter together on the seam, as the scene file says, never on the
  // anchor carry the resolver names when the outgoing scene has a headline too: a carry between two
  // different headlines is a morph, drawn at the outgoing headline's place and size, which put this
  // headline mid-frame under the panel. After T3 and T5 the headline is at full ink from its first
  // frame, racking into focus, and the panel rises on frame 6.
  const seamedIn = inT === 't1';
  const racked = seamedIn ? { blur: 0, y: 0 } : blink(f, b);
  const panelShown = seamedIn || f >= card.beats.panel;
  const down = panelOffset(f, stage, seamedIn);
  const sideways = nodeDrift(f, stage);
  const [causeImage, effectImage] = demo === 'crop' ? images : [];
  const { beats } = card;
  const effectScale = f >= beats.effect ? springPop(f - beats.effect) : 0;

  const causeRect = causeImage ? cropRect(layout.cause, causeImage) : chipRect(layout.cause);
  const effectRect = effectImage ? cropRect(layout.effect, effectImage) : chipRect(layout.effect);
  const causeLabel = useLabelFit(labels[0]?.value ?? '', layout.cause);
  const effectLabel = useLabelFit(labels[1]?.value ?? '', layout.effect);

  const along = layout.axis === 'x';
  const { from, to } = connectorEnds(
    layout.axis,
    causeRect,
    effectRect,
    labels[0] ? layout.cause.label.y + causeLabel.height : undefined,
  );
  const gap = specPx(stage, 18);
  const length = Math.max(0, (along ? to.x - from.x : to.y - from.y) - gap * 2);
  const drawn = length * arriveN(f - beats.connector, arrival.snap.k, arrival.snap.D);
  const stroke = specPx(stage, 2);

  const light = (f - beats.causeLight) / beats.lightFrames;

  // No corner mark: the scene file has none, and in 9:16 the headline slot sits just under the
  // corner, where the mark would crowd it. The headline is drawn last, above the panel, so nothing
  // the scene draws can cover it, and its layer has no anchor id, so a T1 moves it on `seamIn`
  // with the panel rather than carrying it.
  return (
    <>
      {panelShown ? (
        <SeamLayer>
          <div style={{ inset: 0, position: 'absolute', transform: `translateY(${down}px)` }}>
            <div
              style={{
                background: colors.surface,
                borderRadius: radius,
                boxShadow: `inset 0 0 0 1px ${colors.hairline}`,
                height: layout.panel.height,
                left: layout.panel.x,
                position: 'absolute',
                top: layout.panel.y,
                width: layout.panel.width,
              }}
            />
            <div style={{ inset: 0, position: 'absolute', transform: `translateX(${sideways}px)` }}>
              {causeImage ? (
                <BrowserFrame rect={causeRect} src={causeImage.src} pose={WHOLE_IMAGE} chrome={0} />
              ) : (
                <Chip rect={causeRect} fill={colors.chrome} bars={colors.hairline} />
              )}
              {light > 0 && light < 1 ? (
                <div
                  style={{
                    background: `linear-gradient(100deg, transparent ${light * 140 - 40}%, ${withAlpha(colors.accent, 0.42)} ${light * 140 - 20}%, transparent ${light * 140}%)`,
                    borderRadius: radius,
                    height: causeRect.height,
                    left: causeRect.x,
                    position: 'absolute',
                    top: causeRect.y,
                    width: causeRect.width,
                  }}
                />
              ) : null}
              <div
                style={{
                  background: colors.muted,
                  height: along ? stroke : drawn,
                  left: along ? from.x + gap : from.x - stroke / 2,
                  position: 'absolute',
                  top: along ? from.y - stroke / 2 : from.y + gap,
                  width: along ? drawn : stroke,
                }}
              />
              {effectScale > 0 ? (
                <div
                  style={{
                    inset: 0,
                    position: 'absolute',
                    transform: `scale(${effectScale})`,
                    transformOrigin: `${effectRect.x + effectRect.width / 2}px ${effectRect.y + effectRect.height / 2}px`,
                  }}
                >
                  {effectImage ? (
                    <BrowserFrame
                      rect={effectRect}
                      src={effectImage.src}
                      pose={WHOLE_IMAGE}
                      chrome={0}
                    />
                  ) : (
                    <Chip
                      rect={effectRect}
                      fill={colors.accent}
                      bars={withAlpha(colors.background, 0.4)}
                    />
                  )}
                </div>
              ) : null}
              {labels[0] ? (
                <NodeLabel fit={causeLabel} node={layout.cause} f={f} start={beats.causeLabel} />
              ) : null}
              {labels[1] ? (
                <NodeLabel fit={effectLabel} node={layout.effect} f={f} start={beats.effectLabel} />
              ) : null}
            </div>
          </div>
        </SeamLayer>
      ) : null}
      <SeamLayer>
        <Headline
          id={headline.id}
          fit={fitted.fit}
          top={layout.headlineTop}
          f={f}
          rack={racked}
          accent={props.accent}
        />
      </SeamLayer>
    </>
  );
};

export const featureCard = defineScene<FeatureCardProps>({
  component: FeatureCard,
  props: propsSchema,
  roles: { headline: { min: 1, max: 1 }, label: { min: 0, max: 2 } },
  image: 'optional',
  maxImages: 2,
  imagesShown: (props) => (props.demo === 'chips' ? 0 : 2),
  imageNeeded: (props) => props.demo === 'crop',
  imageView: ({ stage, image, index }) => {
    const layout = cardLayout(stage);
    const node = index === 0 ? layout.cause : layout.effect;
    // The effect pops past its size by up to 6.6% before it settles.
    return { width: cropRect(node, image).width, zoom: index === 0 ? 1 : 1.07 };
  },
  kind: 'product',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  anchors: [
    {
      id: 'headline',
      entry: anchorVelocity.x,
      exit: anchorVelocity.x,
      box: (f, { stage, text, theme, dur }) => {
        const value = text.find(({ role }) => role === 'headline')?.value ?? '';
        const { fit } = fitCardHeadline(value, stage, dur, theme.fonts);
        return headlineBox(fit, stage, cardLayout(stage).headlineTop, f);
      },
    },
  ],
});
