/**
 * `colour-event`, as `docs/motion/scenes/colour-event.md` gives it: the payoff, one full-bleed
 * moment in the brand's primary colour. The `Stage` draws that colour as the `event` ground; this
 * scene draws only the card and the headline on it, and both enter, settle by frame 8 and drift.
 */
import { readableOn } from '@boiler-room/schema';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { mix, withAlpha } from '../brand/color.ts';
import { cornerMark } from '../components/scene-base.tsx';
import { type SceneProps, useScene, useSceneClock } from '../components/scene-runtime.tsx';
import {
  baselineOffset,
  type SpecFit,
  type SpecTypeStyle,
  specFit,
  specPx,
  useSpecFit,
} from '../components/type.tsx';
import { arriveN, blink, typeDrift } from '../core/curves.ts';
import { textDirection } from '../layout/bidi.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import { arrival, specType, type as typography } from '../tokens.ts';
import { SeamLayer } from '../transitions/seam-layer.tsx';
import { defineScene } from './definition.ts';

// No `accent`: the accent is the ground here, so the scene allows no accent phrase [D].
const propsSchema = z.strictObject({
  card: z.enum(['simple', 'frosted']).optional(),
});

export type ColourEventProps = z.infer<typeof propsSchema>;
export type EventCard = 'simple' | 'frosted';

export const cardOf = (props: ColourEventProps): EventCard => props.card ?? 'simple';

/** The values of the scene file, in spec px and spec frames. */
export const colourEvent = {
  /** The headline's box, as a share of the frame's width. [N] */
  headlineWidth: { landscape: 0.6, portrait: 0.8, square: 0.7 },
  /** The frosted card, as shares of the frame's width and height, centred. [N] */
  frosted: {
    landscape: { width: 0.5, height: 0.36 },
    portrait: { width: 0.86, height: 0.3 },
    square: { width: 0.76, height: 0.4 },
  },
  /**
   * A frosted card keeps its headline this share of the frame's width in from each side. 9:16 and
   * 1:1 give a headline 0.06 W narrower than the card, so 0.03 W a side. 16:9 gives a headline
   * box of 0.60 W on a card of 0.50 W, which would set type half on the card and half on the
   * ground, where the ink chosen for one need not read on the other. So a frosted headline is
   * fitted to the narrower of its own box and the card less this inset. [N]
   */
  frostedInset: 0.03,
  /** Card travel: it rises this far into place on `arrive.snap`. [N] */
  cardTravel: 60,
  /** The headline's slam: `1 + slamExcess * k ** f`, with `k` from `arrive.slam`. [M] */
  slamExcess: 0.26,
  /**
   * The frosted card is white at this opacity on a dark primary, black on a light one. The scene
   * file's `backdrop-filter: blur(24px)` is not drawn: see the card in the component. [N]
   */
  veil: 0.18,
  /** The headline is 1 to 3 words on one line. */
  maxWords: 3,
} as const;

const WHITE = '#FFFFFF';
const BLACK = '#000000';

const headlineStyle: SpecTypeStyle = {
  font: 'display',
  weight: typography.weight.display,
  cap: specType.capD,
};

/** The frosted card at rest, centred on the frame. */
export function frostedRect(stage: Pick<Stage, 'width' | 'height' | 'orientation'>): Rect {
  const { width: W, height: H, orientation } = stage;
  const share = colourEvent.frosted[orientation];
  const width = W * share.width;
  const height = H * share.height;
  return { x: (W - width) / 2, y: (H - height) / 2, width, height };
}

/** The width the headline is fitted to: its box, and on a frosted card no wider than the card. */
export function headlineWidth(
  stage: Pick<Stage, 'width' | 'orientation'>,
  card: EventCard,
): number {
  const own = colourEvent.headlineWidth[stage.orientation];
  if (card === 'simple') return stage.width * own;
  const onCard = colourEvent.frosted[stage.orientation].width - 2 * colourEvent.frostedInset;
  return stage.width * Math.min(own, onCard);
}

/**
 * Fits the headline at the display cap height on one line, made smaller only to fit its width:
 * `Math.min(capDerivedSize, fitted)`, as the scene file writes it.
 */
export const fitHeadline = (
  value: string,
  stage: Stage,
  card: EventCard,
  fonts: { display: string; body: string },
): SpecFit =>
  specFit(value, headlineStyle, stage, { width: headlineWidth(stage, card), maxLines: 1 }, fonts);

/** The size the headline is set at when its cap height is the sentence cap height. */
export const sentenceSize = (
  fit: Pick<SpecFit, 'metrics'>,
  stage: Pick<Stage, 'width' | 'height'>,
) => specPx(stage, specType.capS) / fit.metrics.cap;

/**
 * Fit or fail: why this headline cannot be set, or undefined when it can. It must be 1 to 3 words
 * on one line, and is never set below the sentence cap height to make it fit. The Director
 * shortens the copy instead.
 */
export function headlineFitError(
  value: string,
  fit: Pick<SpecFit, 'fontSize' | 'lines' | 'metrics'>,
  stage: Pick<Stage, 'width' | 'height'>,
  width: number,
): string | undefined {
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  if (words < 1 || words > colourEvent.maxWords) {
    return `"${value}" is ${words} words, and a colour-event headline is 1 to ${colourEvent.maxWords}.`;
  }
  // Sizes are whole pixels, so the floor is the whole size at or under the sentence size.
  const floor = Math.floor(sentenceSize(fit, stage));
  if (fit.lines.length !== 1 || fit.fontSize < floor) {
    return `"${value}" does not fit on one line ${Math.round(width)} px wide in ${stage.width}×${stage.height} at the sentence cap height or above. Shorten it.`;
  }
  return undefined;
}

export interface EventLayout {
  /** What the headline sits on: the frosted card, or for a simple card the headline's line box. */
  card: Rect;
  /** The top of the headline's line box. Its cap height is centred on the frame. */
  lineTop: number;
  /** The headline's line box. */
  headline: Rect;
  /** The centre of the headline's cap height, which the slam scales about. */
  slamOrigin: { x: number; y: number };
}

/** The card and the headline at rest, before the entry and the drift. */
export function eventLayout(
  fit: Pick<SpecFit, 'fontSize' | 'lineHeight' | 'metrics' | 'width'>,
  stage: Pick<Stage, 'width' | 'height' | 'orientation'>,
  card: EventCard,
): EventLayout {
  const { width: W, height: H } = stage;
  const cap = fit.metrics.cap * fit.fontSize;
  const baseline = H / 2 + cap / 2;
  const lineTop = baseline - baselineOffset(fit);
  const headline = {
    x: (W - fit.width) / 2,
    y: lineTop,
    width: fit.width,
    height: fit.fontSize * fit.lineHeight,
  };
  return {
    card: card === 'frosted' ? frostedRect(stage) : headline,
    lineTop,
    headline,
    slamOrigin: { x: W / 2, y: H / 2 },
  };
}

/** How far below its rest the card is: 60 px on frame 0, on `arrive.snap`, at rest from frame 8. */
export const cardRise = (f: number, stage: Pick<Stage, 'width' | 'height'>): number =>
  specPx(stage, colourEvent.cardTravel) * (1 - arriveN(f, arrival.snap.k, arrival.snap.D));

/**
 * The headline's slam: 1.26 on frame 0, decaying by `arrive.slam`'s 0.3 a frame, and exactly 1 from
 * the frame it settles. It only ever shrinks towards rest, so it never overshoots.
 */
export const slamScale = (f: number): number =>
  f >= arrival.slam.D ? 1 : 1 + colourEvent.slamExcess * arrival.slam.k ** Math.max(0, f);

/**
 * A point of the scene at rest, where it is drawn at a spec frame: raised by the entry, then
 * drifting larger about the frame centre. On a T1 entry the seam brings it in, with no rise.
 */
export function placed(
  rect: Rect,
  stage: Pick<Stage, 'width' | 'height'>,
  f: number,
  rise: number,
) {
  const scale = typeDrift(f);
  const cx = stage.width / 2;
  const cy = stage.height / 2;
  return {
    x: cx + (rect.x - cx) * scale,
    y: cy + (rect.y + rise - cy) * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

/** The `card` anchor's box at a spec frame. */
export const cardBox = (
  layout: EventLayout,
  stage: Pick<Stage, 'width' | 'height'>,
  f: number,
  seamedIn = false,
): Rect => placed(layout.card, stage, f, seamedIn ? 0 : cardRise(f, stage));

/**
 * The headline's ink and what sits behind it. A simple card sets type straight on the primary. A
 * frosted card is a veil, white on a dark primary and black on a light one, at 18%, blurring a flat
 * ground into the same flat colour, so what is behind the type is the veil over the primary. The
 * ink is black or white, whichever clears 4.5:1 on that.
 */
export function eventInk(
  primary: string,
  card: EventCard,
): { behind: string; ink: string; veil: string | undefined } {
  if (card === 'simple') return { behind: primary, ink: readableOn(primary), veil: undefined };
  const veil = readableOn(primary) === WHITE ? WHITE : BLACK;
  const behind = mix(primary, veil, colourEvent.veil);
  return { behind, ink: readableOn(behind), veil };
}

const ColourEvent = ({ scene, props }: SceneProps<ColourEventProps>) => {
  const { stage } = useScene();
  const { f, b, inT } = useSceneClock();
  const { colors, fonts, radius } = useBrand();
  const headline = scene.text.find(({ role }) => role === 'headline');
  if (!headline) throw new Error(`Scene "${scene.id}" has no headline. validateFilm checks this.`);
  const card = cardOf(props);
  const width = headlineWidth(stage, card);
  const fit = useSpecFit(headline.value, headlineStyle, stage, { width, maxLines: 1 });
  const problem = headlineFitError(headline.value, fit, stage, width);
  if (problem) {
    throw new Error(
      `Scene "${scene.id}" (colour-event), text "${headline.id}": ${problem} The scene never sets its headline below the sentence cap height.`,
    );
  }
  const layout = eventLayout(fit, stage, card);
  const { ink, veil } = eventInk(colors.primary, card);

  // Into a change of ground only T3 is built, so the native entry plays. A T1 brings the card in
  // on the seam with no entry of its own, and a T5 racks the headline after the host's blank.
  const seamedIn = inT === 't1';
  const rise = seamedIn ? 0 : cardRise(f, stage);
  const slam = seamedIn ? 1 : slamScale(f);
  const racked = inT === 't5' ? blink(f, b) : { blur: 0, y: 0 };
  const { slamOrigin } = layout;
  const frame = layout.card;

  return (
    <SeamLayer anchor="card">
      <div
        style={{
          inset: 0,
          position: 'absolute',
          transform: `scale(${typeDrift(f)})`,
          transformOrigin: '50% 50%',
        }}
      >
        <div style={{ inset: 0, position: 'absolute', transform: `translateY(${rise}px)` }}>
          {veil ? (
            // The veil, with no `backdrop-filter`. What it would blur is the `Stage`'s event
            // ground, one flat primary, and a blur of a flat colour is that colour, so the card
            // looks the same without it. With it, Chrome drew the drifting card's bottom edge a
            // pixel lower across part of its width, a tile seam seen on the 16:9 still at f = 8.
            // Bring the blur back when the `Stage` draws a generated field it would change.
            <div
              style={{
                background: withAlpha(veil, colourEvent.veil),
                borderRadius: radius,
                height: frame.height,
                left: frame.x,
                position: 'absolute',
                top: frame.y,
                width: frame.width,
              }}
            />
          ) : null}
          <div
            style={{
              color: ink,
              direction: textDirection(headline.value),
              filter: racked.blur > 0 ? `blur(${specPx(stage, racked.blur)}px)` : undefined,
              fontFamily: fonts.display,
              fontKerning: 'normal',
              fontSize: fit.fontSize,
              fontWeight: fit.weight,
              left: 0,
              letterSpacing: fit.letterSpacing,
              lineHeight: fit.lineHeight,
              position: 'absolute',
              textAlign: 'center',
              top: layout.lineTop,
              transform: `translateY(${specPx(stage, racked.y)}px) scale(${slam})`,
              transformOrigin: `${slamOrigin.x}px ${slamOrigin.y - layout.lineTop}px`,
              unicodeBidi: 'isolate',
              whiteSpace: 'pre',
              width: stage.width,
            }}
          >
            {fit.lines[0]}
          </div>
        </div>
      </div>
    </SeamLayer>
  );
};

export const colourEventScene = defineScene<ColourEventProps>({
  component: ColourEvent,
  props: propsSchema,
  roles: { headline: { min: 1, max: 1 } },
  // The event ground is the `Stage`'s. A generated field in place of a primary that reads as
  // nothing would be drawn there too, and the `Stage` does not draw one yet.
  image: 'none',
  maxImages: 0,
  // The scene draws no mark: the frame is the event colour and the card. This is where one sits.
  markAnchor: (stage) => cornerMark(stage),
  kind: 'type',
  ground: { 'neutral-cut': 'event', 'kinetic-plate': 'event' },
  // Both of its boundaries change the ground, where T1 is never legal, so it declares no velocity.
  anchors: [
    {
      id: 'card',
      box: (f, { props, stage, text, theme }) => {
        const card = cardOf(props);
        const value = text.find(({ role }) => role === 'headline')?.value ?? '';
        const fit = fitHeadline(value, stage, card, theme.fonts);
        return cardBox(eventLayout(fit, stage, card), stage, f);
      },
    },
  ],
});
