import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { withAlpha } from '../brand/color.ts';
import { skinOf } from '../brand/skin.ts';
import type { BrandTheme } from '../brand/theme.ts';
import { type SceneProps, useScene, useSceneClock } from '../components/scene-runtime.tsx';
import { specFit, specPx } from '../components/type.tsx';
import { springPop } from '../core/curves.ts';
import { textDirection } from '../layout/bidi.ts';
import type { Stage } from '../layout/stage.ts';
import { anchorVelocity } from '../tokens.ts';
import { SeamLayer } from '../transitions/seam-layer.tsx';
import { accentSchema, isAccented } from './accent.ts';
import { defineScene } from './definition.ts';
import type { Fitter } from './proof-bars-layout.ts';
import {
  actorBox,
  type ChipState,
  type RelayChip,
  type RelayLayout,
  type RelayText,
  relayLayout,
  relayLayoutOrThrow,
  relayState,
  statusBox,
} from './status-relay-layout.ts';

const propsSchema = z.strictObject({
  accent: accentSchema.optional(),
});

export type StatusRelayProps = z.infer<typeof propsSchema>;

/** Kinetic Plate: `light.rim` stays on the actor this many frames from each absorb [N]. */
export const rimFrames = 8;
/** Neutral Cut: the actor's `spring.pop` on an absorb starts from this scale [N]. */
export const popFrom = 0.92;
/** [N, build] A greeked chip's bar is this share of the pill's height. */
const greekBarShare = 0.2;

const layouts = new Map<string, ReturnType<typeof relayLayout>>();

/**
 * The card's layout for its text on this stage in these fonts, memoised in a module `Map` keyed by
 * everything it reads, so the component and every anchor box read one computation.
 */
export function relayLayoutFor(
  text: readonly RelayText[],
  stage: Stage,
  theme: Pick<BrandTheme, 'fonts'>,
) {
  const key = JSON.stringify([
    text.map(({ id, role, value }) => [id, role, value]),
    stage.width,
    stage.height,
    theme.fonts.display,
    theme.fonts.body,
  ]);
  const known = layouts.get(key);
  if (known) return known;
  const fit: Fitter = (value, style, box) => specFit(value, style, stage, box, theme.fonts);
  const result = relayLayout(text, stage, fit);
  layouts.set(key, result);
  return result;
}

function laidOut(
  where: string,
  text: readonly RelayText[],
  stage: Stage,
  theme: Pick<BrandTheme, 'fonts'>,
): RelayLayout {
  const result = relayLayoutFor(text, stage, theme);
  // Throws naming each text id, through the layout's own message.
  if (!result.ok) {
    return relayLayoutOrThrow(where, text, stage, (value, style, box) =>
      specFit(value, style, stage, box, theme.fonts),
    );
  }
  return result.layout;
}

/** The frames an absorb happens on: where each chip reaches the actor. */
export const absorbFrames = (chips: readonly Pick<RelayChip, 'arrival'>[]): number[] =>
  chips.map(({ arrival }) => arrival);

/** Neutral Cut: the actor's scale, `spring.pop` from 0.92 from the latest absorb on or before `f`. */
export function actorPop(f: number, arrivals: readonly number[]): number {
  const last = arrivals.filter((arrival) => arrival <= f).at(-1);
  return last === undefined ? 1 : springPop(f - last, popFrom);
}

/** Kinetic Plate: true for the 8 frames from each absorb. */
export const rimOn = (f: number, arrivals: readonly number[]): boolean =>
  arrivals.some((arrival) => f >= arrival && f < arrival + rimFrames);

const Chip = ({ chip, state }: { chip: RelayChip; state: ChipState }) => {
  const { stage } = useScene();
  const { colors, fonts } = useBrand();
  if (!state.visible) return null;
  const { rect } = state;
  const inner = chip.size.width - 2 * specPx(stage, 4);
  return (
    <div
      style={{
        alignItems: 'center',
        background: withAlpha(colors.muted, 0.4),
        borderRadius: rect.height / 2,
        display: 'flex',
        height: rect.height,
        justifyContent: 'center',
        left: rect.x,
        position: 'absolute',
        top: rect.y,
        transform: `scale(${state.scale})`,
        width: rect.width,
      }}
    >
      {chip.label !== undefined && chip.labelFit ? (
        <div
          style={{
            color: colors.foreground,
            direction: textDirection(chip.label),
            fontFamily: fonts.body,
            fontKerning: 'normal',
            fontSize: chip.labelFit.fontSize,
            fontWeight: chip.labelFit.weight,
            letterSpacing: chip.labelFit.letterSpacing,
            lineHeight: 1,
            whiteSpace: 'pre',
          }}
        >
          {chip.label}
        </div>
      ) : (
        <div
          style={{
            background: colors.muted,
            borderRadius: rect.height / 2,
            height: rect.height * greekBarShare,
            width: inner * (chip.greek ?? 0),
          }}
        />
      )}
    </div>
  );
};

/** Words repeat in a line, so a key is the word and the count of its kind before it. */
const wordKey = (text: string, position: number) => ['word', text, String(position)].join(':');

const StatusRelay = ({ scene, props }: SceneProps<StatusRelayProps>) => {
  const { stage } = useScene();
  const { f, inT } = useSceneClock();
  const theme = useBrand();
  const { colors, fonts } = theme;
  const layout = laidOut(`scene "${scene.id}"`, scene.text, stage, theme);
  // T1 (first card) and T3 start the line at f = 0; a later card, on T5, racks in and develops from 6.
  const state = relayState(layout, stage, f, { first: inT !== 't5' });
  if (state.blank) return null;
  const { frame, line } = layout;
  const arrivals = absorbFrames(layout.chips);
  const plate = skinOf(colors.background) === 'kinetic-plate';
  const scale = plate ? 1 : actorPop(f, arrivals);
  const rim = plate && rimOn(f, arrivals);
  const { blur, dy } = state.entry;
  // Only a T5 racks: the seam layers carry a T1, so the entry's own x offset is not applied here.
  const rack = {
    filter: blur > 0 ? `blur(${specPx(stage, blur)}px)` : undefined,
    transform: dy !== 0 ? `translateY(${dy}px)` : undefined,
  };
  const accent = props.accent;
  const { actor } = frame;
  return (
    <>
      <SeamLayer>
        <div
          style={{
            background: colors.muted,
            height: frame.rail.height,
            left: frame.rail.x,
            position: 'absolute',
            top: frame.rail.y,
            width: frame.rail.width,
          }}
        />
        {layout.chips.map((chip) => {
          const chipState = state.chips[chip.index];
          return chipState ? <Chip key={chip.index} chip={chip} state={chipState} /> : null;
        })}
      </SeamLayer>
      <SeamLayer anchor="actor" style={rack}>
        <div
          style={{
            background: colors.accent,
            borderRadius: theme.radius,
            boxShadow: rim
              ? `0 0 0 ${specPx(stage, 2)}px ${colors.accent}, 0 0 ${specPx(stage, 32)}px ${withAlpha(colors.accent, 0.5)}`
              : undefined,
            height: actor.height,
            left: actor.x,
            position: 'absolute',
            top: actor.y,
            transform: `rotate(${state.actor.rotation}deg) scale(${scale})`,
            width: actor.width,
          }}
        />
      </SeamLayer>
      <SeamLayer anchor="status" style={rack}>
        <div
          style={{
            color: colors.foreground,
            direction: textDirection(line.words.map(({ text }) => text).join(' ')),
            fontFamily: fonts.display,
            fontKerning: 'normal',
            fontSize: line.fit.fontSize,
            fontWeight: line.fit.weight,
            left: line.left,
            letterSpacing: line.fit.letterSpacing,
            lineHeight: line.fit.lineHeight,
            position: 'absolute',
            top: line.top,
            whiteSpace: 'pre',
            width: line.width,
          }}
        >
          {state.words.map((word, j) => (
            <span
              key={wordKey(word.text, j)}
              style={{
                color: isAccented(accent, line.textId, j) ? colors.accent : undefined,
                opacity: word.opacity,
              }}
            >
              {j > 0 ? ' ' : ''}
              {word.text}
            </span>
          ))}
        </div>
      </SeamLayer>
    </>
  );
};

export const statusRelay = defineScene<StatusRelayProps>({
  component: StatusRelay,
  props: propsSchema,
  roles: {
    headline: { min: 1, max: 1 },
    label: { min: 0, max: 3 },
  },
  image: 'none',
  maxImages: 0,
  kind: 'product',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  anchors: [
    {
      id: 'actor',
      entry: anchorVelocity.x,
      box: (_f, { text, stage, theme }) => actorBox(laidOut('actor', text, stage, theme)),
    },
    {
      id: 'status',
      entry: anchorVelocity.x,
      box: (_f, { text, stage, theme }) => statusBox(laidOut('status', text, stage, theme)),
    },
  ],
});
