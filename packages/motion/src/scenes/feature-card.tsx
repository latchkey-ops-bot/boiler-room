import type { CSSProperties } from 'react';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { withAlpha } from '../brand/color.ts';
import { BrowserFrame } from '../components/browser-frame.tsx';
import { cornerMark, SceneBase, SceneMark } from '../components/scene-base.tsx';
import { type SceneProps, useScene } from '../components/scene-runtime.tsx';
import { baselineOffset, lineBox, type SpecFit, specPx, useSpecFit } from '../components/type.tsx';
import { WHOLE_IMAGE } from '../core/camera.ts';
import { arriveN, rack, specFrame, springPop, typeDrift, wordRise } from '../core/curves.ts';
import { presence } from '../core/presence.ts';
import { textDirection } from '../layout/bidi.ts';
import { fitContain, type Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import { arrival, card, drift, rise, specType, type as typography } from '../tokens.ts';
import { type Accent, accentSchema, isAccented } from './accent.ts';
import { defineScene, type ImageAnchor, type SceneImage } from './definition.ts';

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

/** The panel, and a node at each end of it: thirds side by side, or in a tall frame halves. */
export function cardLayout(stage: Stage): CardLayout {
  const { width: W, height: H, orientation } = stage;
  const share = card.panel[orientation];
  const panel = {
    x: (W - W * share.width) / 2,
    y: H * share.centreY - (H * share.height) / 2,
    width: W * share.width,
    height: H * share.height,
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

/** How far the panel is below its rest at a spec frame. It does not rise under a carried image. */
export const panelOffset = (f: number, stage: Stage, carriedIn: boolean): number =>
  carriedIn
    ? 0
    : specPx(stage, card.panelTravel) *
      (1 - arriveN(f - card.beats.panel, arrival.snap.k, arrival.snap.D));

const nodeDrift = (f: number, stage: Stage) => specPx(stage, drift.node * Math.max(0, f));

const shift = (rect: Rect, x: number, y: number): Rect => ({
  ...rect,
  x: rect.x + x,
  y: rect.y + y,
});

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

/** Words rise one frame apart, `rise.short` px, from their start frame. */
const RisingWords = ({
  fit,
  box,
  f,
  start,
  color,
  style,
}: {
  fit: SpecFit;
  box: Rect;
  f: number;
  start: number;
  color: string;
  style: CSSProperties;
}) => {
  const { stage } = useScene();
  let index = -1;
  return (
    <div
      style={{
        ...style,
        color,
        fontSize: fit.fontSize,
        left: box.x,
        lineHeight: fit.lineHeight,
        position: 'absolute',
        textAlign: 'center',
        top: box.y,
        width: box.width,
      }}
    >
      {fit.lines.map((line) => (
        <div key={line} style={{ direction: textDirection(line), whiteSpace: 'pre' }}>
          {line.split(' ').map((word, position) => {
            index += 1;
            const { visible, y } = wordRise(f - start, index, 1, rise.short.rise, rise.short.k);
            return (
              <span key={`${word}-${index}`}>
                {position > 0 ? ' ' : ''}
                <span
                  style={{
                    display: 'inline-block',
                    opacity: visible ? 1 : 0,
                    transform: `translateY(${specPx(stage, y)}px)`,
                  }}
                >
                  {word}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const Headline = ({
  id,
  value,
  top,
  f,
  accent,
}: {
  id: string;
  value: string;
  top: number;
  f: number;
  accent: Accent | undefined;
}) => {
  const { stage, durationInFrames, fps, timing } = useScene();
  const { colors, fonts } = useBrand();
  // The headline drifts larger about the frame centre to the scene's last frame. It is set in the
  // line box, and smaller where it would otherwise drift out of the safe area by the end, however
  // long the card runs. A push out slides the whole card off, so the frames it drifts on past its
  // end are not held anywhere.
  const largest = typeDrift(specFrame(durationInFrames - 1 - timing.entryAt, fps));
  const fit = useSpecFit(
    value,
    { font: 'display', weight: typography.weight.display, cap: specType.capS },
    stage,
    { width: Math.min(lineBox(stage), stage.safe.width / largest), maxLines: 1 },
  );
  const lineTop = top + fit.metrics.cap * fit.fontSize - baselineOffset(fit);
  const { blur, y } = rack(f);
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
    <RisingWords
      fit={fit}
      box={node.label}
      f={f}
      start={start}
      color={colors.foreground}
      style={{ fontFamily: fonts.body, fontWeight: fit.weight, letterSpacing: fit.letterSpacing }}
    />
  );
};

const FeatureCard = ({ scene, props }: SceneProps<FeatureCardProps>) => {
  const { frame, fps, stage, timing, images, carriedIn, carriedOut, overlayHides } = useScene();
  const { colors, radius } = useBrand();
  const headline = scene.text.find(({ role }) => role === 'headline');
  if (!headline) throw new Error(`Scene "${scene.id}" has no headline. validateFilm checks this.`);
  const labels = scene.text.filter(({ role }) => role === 'label');
  const f = specFrame(frame - timing.entryAt, fps);
  const layout = cardLayout(stage);
  const demo = demoOf(props, images.length);
  const arrived = carriedIn === 'image';
  const opacity = 1 - presence(frame, timing.text).exit;
  const panelShown = arrived || f >= card.beats.panel;
  const down = panelOffset(f, stage, arrived);
  const sideways = nodeDrift(f, stage);
  const [causeImage, effectImage] = demo === 'crop' ? images : [];
  const { beats } = card;
  const effectScale = f >= beats.effect ? springPop(f - beats.effect) : 0;

  const causeRect = causeImage ? cropRect(layout.cause, causeImage) : chipRect(layout.cause);
  const effectRect = effectImage ? cropRect(layout.effect, effectImage) : chipRect(layout.effect);
  const causeLabel = useLabelFit(labels[0]?.value ?? '', layout.cause);
  const effectLabel = useLabelFit(labels[1]?.value ?? '', layout.effect);

  // The connector runs from the facing edge of one node to the facing edge of the other. Side by
  // side those are the visuals' edges. Stacked, the cause's label sits under its visual, so the
  // line starts under the label rather than through it.
  const along = layout.axis === 'x';
  const causeBottom = labels[0]
    ? layout.cause.label.y + causeLabel.height
    : causeRect.y + causeRect.height;
  const from = along
    ? { x: causeRect.x + causeRect.width, y: causeRect.y + causeRect.height / 2 }
    : { x: causeRect.x + causeRect.width / 2, y: causeBottom };
  const to = along
    ? { x: effectRect.x, y: effectRect.y + effectRect.height / 2 }
    : { x: effectRect.x + effectRect.width / 2, y: effectRect.y };
  const gap = specPx(stage, 18);
  const length = Math.max(0, (along ? to.x - from.x : to.y - from.y) - gap * 2);
  const drawn = length * arriveN(f - beats.connector, arrival.snap.k, arrival.snap.D);
  const stroke = specPx(stage, 2);

  const light = (f - beats.causeLight) / beats.lightFrames;

  return (
    <SceneBase seed={scene.id}>
      <SceneMark placement={cornerMark(stage)} />
      <div style={{ inset: 0, opacity, position: 'absolute' }}>
        {f >= 0 ? (
          <Headline
            id={headline.id}
            value={headline.value}
            top={layout.headlineTop}
            f={f}
            accent={props.accent}
          />
        ) : null}
        {panelShown ? (
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
              {causeImage ? null : (
                <Chip rect={causeRect} fill={colors.chrome} bars={colors.hairline} />
              )}
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
        ) : null}
      </div>
      {causeImage && panelShown && !overlayHides('image') ? (
        // Drawn above the panel's layer, so that a carry can take it while the rest clears. When
        // the carry moves the mark instead, it clears with the rest.
        <BrowserFrame
          rect={shift(causeRect, sideways, down)}
          src={causeImage.src}
          pose={WHOLE_IMAGE}
          chrome={0}
          style={{ opacity: carriedOut === 'image' ? 1 : opacity }}
        />
      ) : null}
      {panelShown && light > 0 && light < 1 ? (
        <div
          style={{
            background: `linear-gradient(100deg, transparent ${light * 140 - 40}%, ${withAlpha(colors.accent, 0.42)} ${light * 140 - 20}%, transparent ${light * 140}%)`,
            borderRadius: radius,
            height: causeRect.height,
            left: causeRect.x + sideways,
            position: 'absolute',
            top: causeRect.y + down,
            width: causeRect.width,
          }}
        />
      ) : null}
    </SceneBase>
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
  imageAnchor: ({ stage, image, frame, fps, timing }): ImageAnchor => {
    const f = specFrame(frame - timing.entryAt, fps);
    const layout = cardLayout(stage);
    return {
      rect: shift(cropRect(layout.cause, image), nodeDrift(f, stage), 0),
      pose: WHOLE_IMAGE,
      chrome: 0,
    };
  },
  imageView: ({ stage, image, index }) => {
    const layout = cardLayout(stage);
    const node = index === 0 ? layout.cause : layout.effect;
    // The effect pops past its size by up to 6.6% before it settles.
    return { width: cropRect(node, image).width, zoom: index === 0 ? 1 : 1.07 };
  },
  markAnchor: (stage) => cornerMark(stage),
});
