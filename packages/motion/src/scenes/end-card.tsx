import { toFrame } from '@boiler-room/schema';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { BrandMark, logoRect, type MarkPlacement } from '../components/brand-mark.tsx';
import { RisingWords } from '../components/rising-words.tsx';
import { type SceneProps, useScene, useSceneClock } from '../components/scene-runtime.tsx';
import { baselineOffset, lineBox, specPx, useSpecFit } from '../components/type.tsx';
import { arriveN, SPEC_FPS, specFrame, wordRise } from '../core/curves.ts';
import { textDirection } from '../layout/bidi.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import {
  anchorVelocity,
  arrival,
  lockup,
  rise,
  seams,
  specType,
  type as typography,
} from '../tokens.ts';
import type { TransitionName } from '../transitions/catalog.ts';
import { SeamLayer } from '../transitions/seam-layer.tsx';
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

/** How far below its rest the logo is on its native entry: 200 px on `arrive.slow`. */
export const logoOffset = (f: number, stage: Stage): number =>
  specPx(stage, lockup.logoTravel) * (1 - arriveN(f, arrival.slow.k, arrival.slow.D));

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

/** The scene frame the card stops on: the hold, or its first frame if it is shorter than a hold. */
export const stillFrom = (durationInFrames: number, fps: number): number =>
  Math.max(0, holdStart(durationInFrames, fps));

/**
 * The spec frame of the last frame that moves, the one before the hold. The scene file wants
 * everything final there, at `f = dur - 70`: the logo at rest, the CTA complete and the URL exact.
 */
const lastMoving = (durationInFrames: number, fps: number): number =>
  specFrame(stillFrom(durationInFrames, fps) - 1, fps);

/** A word that has risen to within this many spec pixels of its place is at rest. */
const AT_REST = 0.5;

/**
 * True when the logo is at rest at a spec frame. Its own rise settles on frame 23. On a T1 entry it
 * has no rise, and the seam brings it in, at rest from the seam's settle frame, 14.
 */
export const logoAtRest = (f: number, inT: TransitionName | undefined): boolean =>
  inT === 't1' ? f >= seams.t1.D : arriveN(f, arrival.slow.k, arrival.slow.D) >= 1;

/**
 * True when every word of the CTA is in and at rest at a spec frame. Its words rise one frame apart
 * from frame 4, so the last of them comes to rest about 6 frames after it appears: by frame 13 for
 * 4 words, and by 21 for the 12 that 24 characters can hold. That is before the logo's own rise
 * settles, but not always before a T1 seam does.
 */
export function ctaAtRest(cta: string, f: number): boolean {
  const last = cta.split(' ').length - 1;
  const { visible, y } = wordRise(f - lockup.ctaAt, last, 1, rise.short.rise, rise.short.k);
  return visible && y < AT_REST;
}

/**
 * The most characters a URL can have and still show in full at a spec frame. A decoding URL
 * counts as if every character were a letter, which is the slowest it can be.
 */
export function urlCapacity(reveal: UrlReveal, f: number): number {
  let n = 0;
  while (n < 200 && urlShown('x'.repeat(n + 1), reveal, f) === 'x'.repeat(n + 1)) n += 1;
  return n;
}

/**
 * What the hold would freeze unfinished: a logo still rising or moving in on its seam, a CTA still
 * rising, or a URL still decoding or being typed. Each comes with the change that gives it time,
 * and the URL with the longest that fits.
 */
function unfinishedAtHold({
  props,
  text,
  durationInFrames,
  fps,
  inT,
  path,
}: HoldRequest<EndCardProps>): HoldShortfall[] {
  const reveal = props.urlReveal ?? 'decode';
  const cta = text.find(({ role }) => role === 'cta')?.value;
  const labelIndex = text.findIndex(({ role }) => role === 'label');
  const url = text[labelIndex]?.value;
  const ctaDone = (f: number) => cta === undefined || ctaAtRest(cta, f);
  const urlDone = (f: number) => url === undefined || urlShown(url, reveal, f) === url;
  const fits = (length: number) => {
    const f = lastMoving(length, fps);
    return logoAtRest(f, inT) && ctaDone(f) && urlDone(f);
  };
  if (fits(durationInFrames)) return [];

  const f = lastMoving(durationInFrames, fps);
  // The logo, the CTA and the URL each finish on some frame, so a longer card always fits.
  let needed = durationInFrames + 1;
  while (!fits(needed)) needed += 1;
  const longer = `make ${path} at least ${needed} frames long (${(needed / fps).toFixed(2)} s at ${fps} fps)`;
  const hold = stillFrom(durationInFrames, fps);
  const held = `${path} is an end-card of ${durationInFrames} frames, so it holds still from its frame ${hold} to its end`;
  const shortfalls: HoldShortfall[] = [];
  if (!logoAtRest(f, inT)) {
    const moving = inT === 't1' ? 'still moving in on its T1 seam' : 'still rising';
    shortfalls.push({
      message: `${held}, and its logo is ${moving} then.`,
      fix: `To finish the build before the hold, ${longer}.`,
    });
  }
  if (!ctaDone(f)) {
    shortfalls.push({
      message: `${held}, and the last word of its CTA is still rising then.`,
      fix: `To finish the build before the hold, ${longer}, or choose a CTA of fewer words.`,
    });
  }
  if (url !== undefined && !urlDone(f)) {
    const where = `${path}.text[${labelIndex}]`;
    const verb = reveal === 'type' ? 'typed' : 'decoded';
    const frozen = urlShown(url, reveal, specFrame(hold, fps));
    const capacity = urlCapacity(reveal, f);
    const options = [
      capacity > 0 ? `shorten ${where} to ${capacity} characters or fewer` : `remove ${where}`,
    ];
    const decodes = urlCapacity('decode', f);
    if (reveal === 'type' && decodes >= [...url].length) {
      options.push(
        `set ${path}.props.urlReveal to "decode", which shows up to ${decodes} characters at this length`,
      );
    }
    options.push(longer);
    shortfalls.push({
      message:
        frozen === url
          ? `${held}, but its URL is not fully ${verb} until that frame, so the build runs into the hold.`
          : `${held}, but its URL is not fully ${verb} by then, so the film would end on "${frozen}" instead of "${url}".`,
      fix: `${options.join(', or ').replace(/^./, (first) => first.toUpperCase())}.`,
    });
  }
  return shortfalls;
}

const EndCard = ({ scene, props }: SceneProps<EndCardProps>) => {
  const { frame, fps, stage, durationInFrames } = useScene();
  const { inT } = useSceneClock();
  const { colors, fonts } = useBrand();
  const cta = scene.text.find(({ role }) => role === 'cta');
  if (!cta) throw new Error(`Scene "${scene.id}" has no CTA. validateFilm checks this.`);
  const url = scene.text.find(({ role }) => role === 'label')?.value;
  const layout = endCardLayout(stage);
  // Everything is at rest by the hold, which `validateFilm` checks, and from its first frame
  // nothing moves at all.
  const still = Math.min(frame, stillFrom(durationInFrames, fps));
  const f = specFrame(still, fps);

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

  // On a T1 entry the seam brings the logo in, with no rise of its own.
  const logoRise = inT === 't1' ? 0 : logoOffset(f, stage);
  const reveal = props.urlReveal ?? 'decode';
  const caretHeight = urlFit.fontSize * 0.78;

  return (
    <>
      <SeamLayer anchor="logo">
        <BrandMark
          placement={logoPlacement(stage)}
          unit={stage.unit}
          style={{ transform: `translateY(${logoRise}px)` }}
        />
      </SeamLayer>
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
          <RisingWords lines={[ctaFit.lines[0] ?? cta.value]} f={f} start={lockup.ctaAt} />
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
    </>
  );
};

export const endCard = defineScene<EndCardProps>({
  component: EndCard,
  props: propsSchema,
  roles: { cta: { min: 1, max: 1 }, label: { min: 0, max: 1 } },
  image: 'none',
  maxImages: 0,
  markAnchor: (stage) => logoPlacement(stage),
  kind: 'mark',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  anchors: [
    {
      id: 'logo',
      entry: anchorVelocity.y,
      // The logo's box at rest. A wordmark is measured inside the same box, so this is its box.
      box: (_f, { stage, theme }) => {
        const placement = logoPlacement(stage);
        return theme.logo.kind === 'image' ? logoRect(theme.logo, placement) : placement.box;
      },
    },
  ],
  holdFrom: stillFrom,
  unfinishedAtHold,
});
