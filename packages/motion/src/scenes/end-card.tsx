import { toFrame } from '@boiler-room/schema';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { BrandMark, type MarkPlacement } from '../components/brand-mark.tsx';
import { SceneBase } from '../components/scene-base.tsx';
import { type SceneProps, useScene } from '../components/scene-runtime.tsx';
import { baselineOffset, lineBox, specPx, useSpecFit } from '../components/type.tsx';
import { arriveN, SPEC_FPS, specFrame, wordRise } from '../core/curves.ts';
import { textDirection } from '../layout/bidi.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import { arrival, lockup, rise, specType, type as typography } from '../tokens.ts';
import { defineScene, type HoldRequest, type HoldShortfall } from './definition.ts';

const propsSchema = z.strictObject({
  urlReveal: z.enum(['decode', 'type']).optional(),
});

export type EndCardProps = z.infer<typeof propsSchema>;

export type UrlReveal = NonNullable<EndCardProps['urlReveal']>;

export interface EndCardLayout {
  logo: Rect;
  ctaBaseline: number;
  urlBaseline: number;
}

export function endCardLayout(stage: Stage): EndCardLayout {
  const { width: W, height: H, orientation } = stage;
  const { logo, cta, url } = lockup.layout[orientation];
  return {
    logo: {
      x: (W - W * logo.width) / 2,
      y: H * logo.centreY - (H * logo.height) / 2,
      width: W * logo.width,
      height: H * logo.height,
    },
    ctaBaseline: H * cta,
    urlBaseline: H * url,
  };
}

export const logoPlacement = (stage: Stage): MarkPlacement => ({
  box: endCardLayout(stage).logo,
  align: 'center',
});

const LETTER = /^[a-zA-Z]$/;

/**
 * The URL as it decodes: each letter starts three letters on within its case and settles on its
 * own frame, the last letter first, one frame apart. Anything that is not a letter is final from
 * the first frame.
 */
export function decodingUrl(url: string, f: number): string {
  const chars = [...url];
  return chars
    .map((char, index) => {
      const settles = lockup.urlAt + (chars.length - 1 - index);
      if (f >= settles || !LETTER.test(char)) return char;
      const base = char <= 'Z' ? 65 : 97;
      const code = ((char.charCodeAt(0) - base + lockup.decodeShift) % 26) + base;
      return String.fromCharCode(code);
    })
    .join('');
}

/** How many characters of a typed URL show: 18 every 40 frames. */
export const typedLength = (url: string, f: number): number =>
  Math.max(
    0,
    Math.min(
      [...url].length,
      Math.floor(((f - lockup.urlAt) * lockup.typeChars) / lockup.typeFrames),
    ),
  );

/** The URL as it reads at a spec frame: nothing before its reveal starts, then decoding or typed. */
export const urlShown = (url: string, reveal: UrlReveal, f: number): string => {
  if (f < lockup.urlAt) return '';
  return reveal === 'decode'
    ? decodingUrl(url, f)
    : [...url].slice(0, typedLength(url, f)).join('');
};

/** The scene frame the static hold starts on. Nothing moves from here to the end of the film. */
export const holdStart = (durationInFrames: number, fps: number): number =>
  durationInFrames - toFrame(lockup.hold / SPEC_FPS, fps);

/**
 * The scene frame the card stops on: the hold, or the frame its own entry starts if a transition
 * in reaches past where the hold would start.
 */
export const stillFrom = (durationInFrames: number, fps: number, entryAt: number): number =>
  Math.max(entryAt, holdStart(durationInFrames, fps));

/**
 * The spec frame the last moving frame shows, the one before the hold. The scene file's acceptance
 * check wants everything final there: at `f = dur - 70` on a card that starts on its first frame.
 */
const lastMoving = (durationInFrames: number, fps: number, entryAt: number): number =>
  specFrame(stillFrom(durationInFrames, fps, entryAt) - 1 - entryAt, fps);

/**
 * The most characters a URL can have and still show in full by a spec frame. A decoding URL counts
 * as if every character were a letter, which is the slowest it can be.
 */
export function urlCapacity(reveal: UrlReveal, f: number): number {
  if (reveal === 'type') return typedLength('x'.repeat(200), f);
  let n = 0;
  while (n < 200 && decodingUrl('x'.repeat(n + 1), f) === 'x'.repeat(n + 1)) n += 1;
  return f >= lockup.urlAt ? n : 0;
}

/**
 * What the hold would freeze unfinished: a URL still decoding or being typed, or a logo still
 * rising. The CTA needs no check: at 24 characters it has at most 12 words, and the last of them
 * is at rest, under half a pixel from its place, by spec frame 21, before the logo.
 */
function unfinishedAtHold({
  props,
  text,
  durationInFrames,
  fps,
  timing,
  carriedIn,
  path,
}: HoldRequest<EndCardProps>): HoldShortfall[] {
  const reveal = props.urlReveal ?? 'decode';
  const labelIndex = text.findIndex(({ role }) => role === 'label');
  const url = text[labelIndex]?.value;
  const logoAtRest = (f: number) => carriedIn || arriveN(f, arrival.slow.k, arrival.slow.D) >= 1;
  const urlInFull = (f: number) => url === undefined || urlShown(url, reveal, f) === url;
  const fits = (length: number) => {
    const f = lastMoving(length, fps, timing.entryAt);
    return logoAtRest(f) && urlInFull(f);
  };
  const f = lastMoving(durationInFrames, fps, timing.entryAt);
  if (fits(durationInFrames)) return [];

  let needed = durationInFrames + 1;
  while (needed < durationInFrames + toFrame(120, fps) && !fits(needed)) needed += 1;
  const longer = `make ${path} at least ${needed} frames long (${(needed / fps).toFixed(2)} s at ${fps} fps)`;
  const hold = stillFrom(durationInFrames, fps, timing.entryAt);
  const held = `${path} is an end-card of ${durationInFrames} frames, so it holds still from its frame ${hold} to its end`;
  const shortfalls: HoldShortfall[] = [];
  if (!logoAtRest(f)) {
    shortfalls.push({
      message: `${held}, and its logo is still rising then.`,
      fix: `To finish the build before the hold, ${longer}.`,
    });
  }
  if (url !== undefined && !urlInFull(f)) {
    const frozen = urlShown(url, reveal, specFrame(hold - timing.entryAt, fps));
    const where = `${path}.text[${labelIndex}]`;
    const options = [`shorten ${where} to ${urlCapacity(reveal, f)} characters or fewer`];
    const decodes = urlCapacity('decode', f);
    if (reveal === 'type' && decodes >= [...url].length) {
      options.push(
        `set ${path}.props.urlReveal to "decode", which shows up to ${decodes} characters at this length`,
      );
    }
    options.push(longer);
    shortfalls.push({
      message: `${held}, but its URL is not fully ${reveal === 'type' ? 'typed' : 'decoded'} by then, so the film would end on "${frozen}" instead of "${url}".`,
      fix: `${options.join(', or ').replace(/^./, (first) => first.toUpperCase())}.`,
    });
  }
  return shortfalls;
}

const EndCard = ({ scene, props }: SceneProps<EndCardProps>) => {
  const { frame, fps, stage, timing, durationInFrames, carriedIn, overlayHides } = useScene();
  const { colors, fonts } = useBrand();
  const cta = scene.text.find(({ role }) => role === 'cta');
  if (!cta) throw new Error(`Scene "${scene.id}" has no CTA. validateFilm checks this.`);
  const url = scene.text.find(({ role }) => role === 'label')?.value;
  const layout = endCardLayout(stage);
  // Everything is at rest by the hold, and from its first frame nothing moves at all.
  const still = Math.min(frame, stillFrom(durationInFrames, fps, timing.entryAt));
  const f = specFrame(still - timing.entryAt, fps);

  const ctaFit = useSpecFit(
    cta.value,
    { font: 'display', weight: typography.weight.display, cap: specType.capS },
    stage,
    { width: lineBox(stage), maxLines: 1 },
  );
  const urlFit = useSpecFit(
    url ?? '',
    { font: 'body', weight: typography.weight.body, cap: specType.capS * lockup.urlCap },
    stage,
    { width: lineBox(stage), maxLines: 1 },
  );

  const logoRise =
    carriedIn === 'mark'
      ? 0
      : specPx(stage, lockup.logoTravel) * (1 - arriveN(f, arrival.slow.k, arrival.slow.D));
  const reveal = props.urlReveal ?? 'decode';
  let word = -1;
  const caretHeight = urlFit.fontSize * 0.78;

  return (
    <SceneBase seed={scene.id} clock={still}>
      {overlayHides('mark') || frame < timing.entryAt ? null : (
        <BrandMark
          placement={logoPlacement(stage)}
          unit={stage.unit}
          style={{ transform: `translateY(${logoRise}px)` }}
        />
      )}
      {f >= 0 ? (
        <div
          style={{
            color: colors.foreground,
            direction: textDirection(cta.value),
            fontFamily: fonts.display,
            fontKerning: 'normal',
            fontSize: ctaFit.fontSize,
            fontWeight: ctaFit.weight,
            left: 0,
            letterSpacing: ctaFit.letterSpacing,
            lineHeight: ctaFit.lineHeight,
            position: 'absolute',
            textAlign: 'center',
            top: layout.ctaBaseline - baselineOffset(ctaFit),
            whiteSpace: 'pre',
            width: stage.width,
          }}
        >
          {(ctaFit.lines[0] ?? cta.value).split(' ').map((value, position) => {
            word += 1;
            const { visible, y } = wordRise(
              f - lockup.ctaAt,
              word,
              1,
              rise.short.rise,
              rise.short.k,
            );
            return (
              <span key={`${value}-${word}`}>
                {position > 0 ? ' ' : ''}
                <span
                  style={{
                    display: 'inline-block',
                    opacity: visible ? 1 : 0,
                    transform: `translateY(${specPx(stage, y)}px)`,
                  }}
                >
                  {value}
                </span>
              </span>
            );
          })}
        </div>
      ) : null}
      {url && f >= lockup.urlAt ? (
        <div
          style={{
            color: colors.muted,
            fontFamily: fonts.body,
            fontKerning: 'normal',
            fontSize: urlFit.fontSize,
            fontWeight: urlFit.weight,
            left: 0,
            letterSpacing: urlFit.letterSpacing,
            lineHeight: urlFit.lineHeight,
            position: 'absolute',
            textAlign: 'center',
            top: layout.urlBaseline - baselineOffset(urlFit),
            whiteSpace: 'pre',
            width: stage.width,
          }}
        >
          {urlShown(url, reveal, f)}
          {reveal === 'type' ? (
            <span
              style={{
                background: colors.accent,
                display: 'inline-block',
                height: caretHeight,
                marginLeft: urlFit.fontSize * 0.04,
                verticalAlign: 'baseline',
                width: urlFit.fontSize * 0.075,
              }}
            />
          ) : null}
        </div>
      ) : null}
    </SceneBase>
  );
};

export const endCard = defineScene<EndCardProps>({
  component: EndCard,
  props: propsSchema,
  roles: { cta: { min: 1, max: 1 }, label: { min: 0, max: 1 } },
  image: 'none',
  maxImages: 0,
  markAnchor: (stage) => logoPlacement(stage),
  unfinishedAtHold,
});
