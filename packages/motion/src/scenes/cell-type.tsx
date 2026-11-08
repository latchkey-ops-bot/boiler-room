import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { mix } from '../brand/color.ts';
import type { BrandTheme } from '../brand/theme.ts';
import { type SceneProps, useScene, useSceneClock } from '../components/scene-runtime.tsx';
import { baselineOffset, specFit } from '../components/type.tsx';
import { textDirection } from '../layout/bidi.ts';
import type { Stage } from '../layout/stage.ts';
import { accentSchema } from './accent.ts';
import {
  type CellLayout,
  type CellText,
  cellLayout,
  cellLayoutOrThrow,
  cellState,
  panelBox,
  sampleCells,
  sampleRequestOf,
} from './cell-type-layout.ts';
import { defineScene } from './definition.ts';
import type { Fitter } from './proof-bars-layout.ts';

/**
 * `props.accent` is accepted, as the scene file's Registry entry lists it. The scene file gives the
 * accent no place on dots or knocked-out glyphs, so it is validated and not drawn (flagged in the
 * pull request).
 */
const propsSchema = z.strictObject({
  accent: accentSchema.optional(),
});

export type CellTypeProps = z.infer<typeof propsSchema>;

const layouts = new Map<string, ReturnType<typeof cellLayout>>();

/**
 * The scene's layout for its text on this stage in these fonts, memoised in a module `Map` keyed
 * by everything it reads, so the component and the anchor box read one computation.
 */
export function cellLayoutFor(
  text: readonly CellText[],
  stage: Stage,
  theme: Pick<BrandTheme, 'fonts' | 'radius'>,
) {
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
  const result = cellLayout(text, stage, fit, { radius: theme.radius });
  layouts.set(key, result);
  return result;
}

function laidOut(
  where: string,
  text: readonly CellText[],
  stage: Stage,
  theme: Pick<BrandTheme, 'fonts' | 'radius'>,
): CellLayout {
  const result = cellLayoutFor(text, stage, theme);
  // Throws naming the scene and each text id, through the layout's own message.
  if (!result.ok) {
    return cellLayoutOrThrow(
      where,
      text,
      stage,
      (value, style, box) => specFit(value, style, stage, box, theme.fonts),
      { radius: theme.radius },
    );
  }
  return result.layout;
}

const CellType = ({ scene }: SceneProps<CellTypeProps>) => {
  const { stage } = useScene();
  const { f } = useSceneClock();
  const theme = useBrand();
  const { colors, fonts } = theme;
  const layout = laidOut(`scene "${scene.id}"`, scene.text, stage, theme);
  const grid = sampleCells(sampleRequestOf(layout));
  const state = cellState(layout, grid, f);
  const { pitch, headline } = layout;
  const { fit } = headline;
  const { glyph, panel } = state;
  const about = `${stage.width / 2}px ${stage.height / 2}px`;
  return (
    <div
      style={{
        height: stage.height,
        left: 0,
        position: 'absolute',
        top: 0,
        transform: `scale(${state.scale})`,
        transformOrigin: about,
        width: stage.width,
      }}
    >
      {state.solid ? (
        <>
          <div
            style={{
              background: colors.foreground,
              borderRadius: panel.radius,
              height: panel.rect.height,
              left: panel.rect.x,
              position: 'absolute',
              top: panel.rect.y,
              width: panel.rect.width,
            }}
          />
          <div
            style={{
              color: colors.background,
              direction: textDirection(headline.text),
              fontFamily: fonts.display,
              fontKerning: 'normal',
              fontSize: glyph.fontSize,
              fontWeight: fit.weight,
              left: glyph.rect.x,
              letterSpacing: fit.letterSpacing,
              lineHeight: fit.lineHeight,
              position: 'absolute',
              textAlign: 'center',
              top: glyph.baseline - baselineOffset(fit),
              whiteSpace: 'pre',
              width: glyph.rect.width,
            }}
          >
            {headline.text}
          </div>
        </>
      ) : (
        <svg
          aria-hidden="true"
          height={stage.height}
          style={{ left: 0, position: 'absolute', top: 0 }}
          width={stage.width}
        >
          {state.dots.map((dot) =>
            dot.radius > 0 ? (
              <circle
                cx={dot.x}
                cy={dot.y}
                fill={mix(colors.muted, colors.foreground, dot.inkMix)}
                fillOpacity={dot.alpha}
                key={`${dot.c}:${dot.r}`}
                r={dot.radius * pitch}
              />
            ) : null,
          )}
        </svg>
      )}
    </div>
  );
};

export const cellType = defineScene<CellTypeProps>({
  component: CellType,
  props: propsSchema,
  roles: {
    headline: { min: 1, max: 1 },
  },
  image: 'none',
  maxImages: 0,
  kind: 'setpiece',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  // Entry T3 and exit T3 or the T5 chapter are cuts of the host: nothing moves across a seam.
  anchors: [
    {
      id: 'panel',
      box: (_f, { text, stage, theme }) => panelBox(laidOut('panel', text, stage, theme)),
    },
  ],
});
