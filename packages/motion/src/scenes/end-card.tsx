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
import { defineScene } from './definition.ts';

const propsSchema = z.strictObject({
  urlReveal: z.enum(['decode', 'type']).optional(),
});

export type EndCardProps = z.infer<typeof propsSchema>;

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

/** The scene frame the static hold starts on. Nothing moves from here to the end of the film. */
export const holdStart = (durationInFrames: number, fps: number): number =>
  durationInFrames - toFrame(lockup.hold / SPEC_FPS, fps);

const EndCard = ({ scene, props }: SceneProps<EndCardProps>) => {
  const { frame, fps, stage, timing, durationInFrames, carriedIn, overlayHides } = useScene();
  const { colors, fonts } = useBrand();
  const cta = scene.text.find(({ role }) => role === 'cta');
  if (!cta) throw new Error(`Scene "${scene.id}" has no CTA. validateFilm checks this.`);
  const url = scene.text.find(({ role }) => role === 'label')?.value;
  const layout = endCardLayout(stage);
  // Everything is at rest by the hold, and from its first frame nothing moves at all.
  const still = Math.min(frame, Math.max(timing.entryAt, holdStart(durationInFrames, fps)));
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
          {reveal === 'decode' ? (
            decodingUrl(url, f)
          ) : (
            <>
              {[...url].slice(0, typedLength(url, f)).join('')}
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
            </>
          )}
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
});
