import { Img } from 'remotion';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { withAlpha } from '../brand/color.ts';
import type { BrandTheme } from '../brand/theme.ts';
import { type SceneProps, useScene, useSceneClock } from '../components/scene-runtime.tsx';
import { baselineOffset, specFit, specPx } from '../components/type.tsx';
import { textDirection } from '../layout/bidi.ts';
import type { Stage } from '../layout/stage.ts';
import { anchorVelocity } from '../tokens.ts';
import { type Accent, accentSchema, isAccented } from './accent.ts';
import { defineScene } from './definition.ts';
import type { Fitter } from './proof-bars-layout.ts';
import {
  type RailLayout,
  type RailText,
  type RailWord,
  type RailWordState,
  railGeometry,
  railLayout,
  railLayoutOrThrow,
  railState,
  railsBox,
} from './rail-words-layout.ts';

const propsSchema = z.strictObject({
  accent: accentSchema.optional(),
});

export type RailWordsProps = z.infer<typeof propsSchema>;

const layouts = new Map<string, ReturnType<typeof railLayout>>();

/**
 * The scene's layout for its text on this stage in these fonts, memoised in a module `Map` keyed
 * by everything it reads, so the component and the anchor box read one computation.
 */
export function railLayoutFor(
  text: readonly RailText[],
  stage: Stage,
  theme: Pick<BrandTheme, 'fonts' | 'radius'>,
  elementAspect?: number,
) {
  const key = JSON.stringify([
    text.map(({ id, role, value }) => [id, role, value]),
    stage.width,
    stage.height,
    theme.fonts.display,
    theme.fonts.body,
    theme.radius,
    elementAspect ?? null,
  ]);
  const known = layouts.get(key);
  if (known) return known;
  const fit: Fitter = (value, style, box) => specFit(value, style, stage, box, theme.fonts);
  const result = railLayout(text, stage, fit, { elementAspect, radius: theme.radius });
  layouts.set(key, result);
  return result;
}

function laidOut(
  where: string,
  text: readonly RailText[],
  stage: Stage,
  theme: Pick<BrandTheme, 'fonts' | 'radius'>,
  elementAspect?: number,
): RailLayout {
  const result = railLayoutFor(text, stage, theme, elementAspect);
  // Throws naming the scene and each text id, through the layout's own message.
  if (!result.ok) {
    return railLayoutOrThrow(
      where,
      text,
      stage,
      (value, style, box) => specFit(value, style, stage, box, theme.fonts),
      { elementAspect, radius: theme.radius },
    );
  }
  return result.layout;
}

const wordsOf = (value: string) => value.trim().split(/\s+/).filter(Boolean);

/** Words repeat in a line, so a key is the word and its position. */
const wordKey = (text: string, position: number) => ['word', text, String(position)].join(':');

const Rail = ({
  word,
  state,
  accent,
  filter,
}: {
  word: RailWord;
  state: RailWordState;
  accent: Accent | undefined;
  filter: string | undefined;
}) => {
  const { colors, fonts } = useBrand();
  const { fit } = word;
  return (
    <div
      style={{
        color: colors.foreground,
        direction: textDirection(word.text),
        filter,
        fontFamily: fonts.display,
        fontKerning: 'normal',
        fontSize: fit.fontSize,
        fontWeight: fit.weight,
        left: state.rect.x,
        letterSpacing: fit.letterSpacing,
        lineHeight: fit.lineHeight,
        position: 'absolute',
        top: word.baseline - baselineOffset(fit),
        whiteSpace: 'pre',
        width: word.width,
      }}
    >
      {wordsOf(word.text).map((text, j) => (
        <span
          key={wordKey(text, j)}
          style={{ color: isAccented(accent, word.textId, j) ? colors.accent : undefined }}
        >
          {j > 0 ? ' ' : ''}
          {text}
        </span>
      ))}
    </div>
  );
};

const RailWords = ({ scene, props }: SceneProps<RailWordsProps>) => {
  const { stage, images } = useScene();
  const { f } = useSceneClock();
  const theme = useBrand();
  const { colors } = theme;
  const image = images[0];
  const layout = laidOut(`scene "${scene.id}"`, scene.text, stage, theme, image?.aspect);
  const state = railState(layout, stage, f);
  const blur = state.top.blur;
  const filter = `rail-words-blur-${scene.id}`;
  const { rect } = state.centre;
  const { band } = layout;
  const { greek } = band;
  const pad = greek ? greek.padding * rect.height : 0;
  const barHeight = greek ? greek.barHeight * rect.height : 0;
  const gap = greek
    ? (rect.height - 2 * pad - greek.shares.length * barHeight) / (greek.shares.length - 1)
    : 0;
  // The rails carry their own T1 whip (`seamOut` inside the rail's clock), so no seam layer here.
  return (
    <>
      {blur > 0 ? (
        <svg aria-hidden="true" height={0} style={{ position: 'absolute' }} width={0}>
          <filter
            colorInterpolationFilters="sRGB"
            height="1"
            id={filter}
            width="1.2"
            x="-0.1"
            y="0"
          >
            <feGaussianBlur stdDeviation={`${blur} 0`} />
          </filter>
        </svg>
      ) : null}
      <div
        style={{
          background: withAlpha(colors.muted, 0.4),
          borderRadius: band.radius,
          boxShadow: `0 0 0 ${specPx(stage, 2)}px ${colors.accent}, 0 0 ${specPx(stage, 32)}px ${withAlpha(colors.accent, 0.5)}`,
          height: rect.height,
          left: rect.x,
          overflow: 'hidden',
          position: 'absolute',
          top: rect.y,
          width: rect.width,
        }}
      >
        {greek
          ? greek.shares.map((share, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the bars are fixed and unlabelled
                key={i}
                style={{
                  background: colors.muted,
                  borderRadius: barHeight / 2,
                  height: barHeight,
                  left: pad,
                  position: 'absolute',
                  top: pad + i * (barHeight + gap),
                  width: (rect.width - 2 * pad) * share,
                }}
              />
            ))
          : image && (
              <Img src={image.src} style={{ height: '100%', objectFit: 'cover', width: '100%' }} />
            )}
      </div>
      <Rail
        word={layout.top}
        state={state.top}
        accent={props.accent}
        filter={blur > 0 ? `url(#${filter})` : undefined}
      />
      <Rail
        word={layout.bottom}
        state={state.bottom}
        accent={props.accent}
        filter={blur > 0 ? `url(#${filter})` : undefined}
      />
    </>
  );
};

/** The rails run left, `sign -1`, at the 46 px/f lateral seam: the opposite of the shared x. */
const railsVelocity = { ...anchorVelocity.x, sign: -1 } as const;

export const railWords = defineScene<RailWordsProps>({
  component: RailWords,
  props: propsSchema,
  roles: {
    headline: { min: 1, max: 1 },
    subhead: { min: 1, max: 1 },
  },
  image: 'optional',
  maxImages: 1,
  imageView: ({ stage, image }) => {
    // The crop fills the band: its height is `bandHeight` of H, its width that and its aspect.
    const height = stage.height * railGeometry.bandHeight[stage.orientation];
    return { width: height * image.aspect, zoom: 1 };
  },
  kind: 'product',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  anchors: [
    {
      id: 'rails',
      entry: railsVelocity,
      exit: railsVelocity,
      box: (_f, { text, stage, theme, images }) =>
        railsBox(laidOut('rails', text, stage, theme, images[0]?.aspect), stage),
    },
  ],
});
