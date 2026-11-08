/**
 * `site-scroll`, `docs/motion/scenes/site-scroll.md`: a tour of the real site. Page 1 flings, page
 * 2 replaces it inside the fling's peak speed, and decays onto its call to action, which a slow
 * push and one light sweep then hold the eye on.
 */
import { Img } from 'remotion';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { withAlpha } from '../brand/color.ts';
import { BrowserFrame } from '../components/browser-frame.tsx';
import { cornerMark } from '../components/scene-base.tsx';
import { type SceneProps, useScene, useSceneClock } from '../components/scene-runtime.tsx';
import { specPx } from '../components/type.tsx';
import { type Point, WHOLE_IMAGE } from '../core/camera.ts';
import { specFrame } from '../core/curves.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import { anchorVelocity, arrival, departure, drift } from '../tokens.ts';
import { SeamLayer } from '../transitions/seam-layer.tsx';
import { defineScene, type SceneImage } from './definition.ts';
import { heroLayout } from './site-hero.tsx';

/** The motion of the scene file, in spec px and spec frames. */
export const fling = {
  /** [M] ref C's peak scroll speed, in px a frame. Page 2's landing can lower it, never raise it. */
  vPeak: 167,
  /** [N] Page 1's speed multiplies by this each frame, as `depart.long` does. */
  r: departure.long.r,
  /** [M] Page 1 ramps over frames 0 to 7, and page 2 replaces it on this frame. */
  jumpAt: 8,
  /** [M] `arrive.long`: page 2 decays by k a frame and lands exactly D frames after the jump. */
  decay: arrival.long,
  /** [N] Page 2 lands with its CTA's top this share of the frame's height below the bar. */
  ctaTop: 0.35,
  /** [D] The landing push, about the CTA's centre, from the frame page 2 lands on. */
  push: drift.push,
  /** [E] One `light.sweep` across the CTA, 15 frames from frame 50, in the accent. */
  light: { from: 50, frames: 15, alpha: 0.42 },
  /** [N] The page blurs vertically while it moves faster than `gate`: v / `per`, at most `max`. */
  blur: { gate: 60, per: 20, max: 8 },
} as const;

/** The frame page 2 comes to rest on its landing point: 43. */
export const LAND_AT = fling.jumpAt + fling.decay.D;

/** A box on a captured page in source pixels, as the Researcher measured it from the DOM. */
const captureBox = z.strictObject({
  x: z.number().min(0),
  y: z.number().min(0),
  w: z.number().positive(),
  h: z.number().positive(),
});

const pageSchema = z.strictObject({
  targetY: z
    .number()
    .min(0)
    .optional()
    .describe(
      'Source pixels from the top of the capture. On page 1, where the page starts (0 if unset). On page 2, where it lands; unset, it is ctaBox.y less 0.35 of the frame height.',
    ),
  ctaBox: captureBox
    .optional()
    .describe(
      "Page 2: the DOM box of the CTA or heading the page lands on, in source pixels. The push centres on it and the light sweeps across it. Page 1's is not used.",
    ),
});

const propsSchema = z.strictObject({
  pages: z
    .array(pageSchema)
    .length(2, {
      error: 'site-scroll shows two pages: give one entry per page asset, page 1 then page 2',
    })
    .refine(
      ([, second]) =>
        second === undefined || second.targetY !== undefined || second.ctaBox !== undefined,
      {
        error:
          'Page 2 has nothing to land on: copy its CTA or heading DOM box into ctaBox, or give targetY',
        path: [1],
      },
    ),
});

export type SiteScrollProps = z.infer<typeof propsSchema>;
export type ScrollPage = SiteScrollProps['pages'][number];

export interface ScrollLayout {
  /**
   * The browser frame at rest: `site-hero`'s width, left edge and top, on whole pixels, so the
   * frame is drawn exactly where a site hero draws it. Its foot runs past the foot of the stage.
   */
  frame: Rect;
  chrome: number;
  /** The top of the window under the bar. */
  viewportTop: number;
  /** How much of the window shows, from under the bar to the foot of the stage. */
  viewportHeight: number;
}

/** The frame in this format. The page fills its width, so its scale is `frame.width / width`. */
export function scrollLayout(stage: Stage, image: Pick<SceneImage, 'aspect'>): ScrollLayout {
  const hero = heroLayout(stage, image);
  const x = Math.round(hero.frame.x);
  const y = Math.round(hero.frame.y);
  const chrome = Math.round(hero.chrome);
  // The foot of the frame stays past the foot of the stage, so its corners never show.
  const foot = stage.height + chrome * 2;
  return {
    frame: { x, y, width: Math.round(hero.frame.x + hero.frame.width) - x, height: foot - y },
    chrome,
    viewportTop: y + chrome,
    viewportHeight: stage.height - y - chrome,
  };
}

/**
 * How far page 1 has scrolled from its start at spec frame `f` of its ramp, in px. Speed starts at
 * `vPeak / r ** 7` and multiplies by `r` a frame, so frame 7 to 8 runs at `vPeak`, and the whole
 * ramp covers 545 px at a peak of 167.
 */
export function rampTravel(f: number, vPeak: number): number {
  const { r, jumpAt } = fling;
  const t = Math.min(Math.max(f, 0), jumpAt);
  return ((vPeak / r ** (jumpAt - 1)) * (r ** t - 1)) / (r - 1);
}

/** How far page 2 is above its landing point at spec frame `f`, in px: exactly 0 from frame 43. */
export function decayOffset(f: number, vPeak: number): number {
  const { k, D } = fling.decay;
  if (f >= LAND_AT) return 0;
  const t = Math.max(f, fling.jumpAt) - fling.jumpAt;
  return ((vPeak / (1 - k)) * (k ** t - k ** D)) / (1 - k ** D);
}

/** Where page 2 lands, in output px from its top: `targetY`, or else the CTA's top less 0.35 H. */
export function landingY(page: ScrollPage | undefined, scale: number, stage: Stage): number {
  if (page?.targetY !== undefined) return page.targetY * scale;
  if (page?.ctaBox) return page.ctaBox.y * scale - fling.ctaTop * stage.height;
  return 0;
}

/** What page 1 needs below its start, in output px: the frame's height and the whole ramp. */
export const page1Need = (stage: Stage): number =>
  stage.height + rampTravel(fling.jumpAt, specPx(stage, fling.vPeak));

/** The landing push at spec frame `f`: 1 until page 2 lands, then +0.15% a frame, unclamped. */
export const pushAt = (f: number): number => 1 + fling.push * Math.max(0, f - LAND_AT);

export interface ScrollPlan {
  layout: ScrollLayout;
  /** Output px per source px for each page: the page fills the frame's width. */
  scales: readonly [number, number];
  /** Where page 1 starts and page 2 lands, in output px from the top of each page. */
  start: number;
  target: number;
  /** The peak speed in output px a frame, capped so page 2 never jumps past its top. */
  vPeak: number;
  /** The point the landing pushes about, in frame px. */
  origin: Point;
  /** Page 2's CTA in source px, which the light sweeps across. */
  cta: ScrollPage['ctaBox'];
}

/** Everything about the scroll that does not change from frame to frame. */
export function scrollPlan(
  stage: Stage,
  [first, second]: readonly [SceneImage, SceneImage],
  props: SiteScrollProps,
): ScrollPlan {
  const layout = scrollLayout(stage, first);
  const scales = [layout.frame.width / first.width, layout.frame.width / second.width] as const;
  const [page1, page2] = props.pages;
  const start = (page1?.targetY ?? 0) * scales[0];
  const target = Math.max(0, landingY(page2, scales[1], stage));
  const vPeak = Math.min(specPx(stage, fling.vPeak), target * (1 - fling.decay.k));
  const cta = page2?.ctaBox;
  const origin = cta
    ? {
        x: layout.frame.x + (cta.x + cta.w / 2) * scales[1],
        y: layout.viewportTop + (cta.y + cta.h / 2) * scales[1] - target,
      }
    : {
        x: layout.frame.x + layout.frame.width / 2,
        y: layout.viewportTop + fling.ctaTop * stage.height,
      };
  return { layout, scales, start, target, vPeak, origin, cta };
}

/** Which page shows at spec frame `f`, and how far it is scrolled, in output px at rest. */
export function scrollAt(f: number, plan: ScrollPlan): { page: 0 | 1; y: number } {
  if (f < fling.jumpAt) return { page: 0, y: plan.start + rampTravel(f, plan.vPeak) };
  return { page: 1, y: plan.target - decayOffset(f, plan.vPeak) };
}

/**
 * The scroll speed at spec frame `f`, in output px a frame, from `f` to `f + 1` on the page that
 * shows: `vPeak` from 7 to 8, and the same within 1.2% from 8 to 9, across the page jump.
 */
export function speedAt(f: number, plan: ScrollPlan): number {
  if (f < fling.jumpAt)
    return (plan.vPeak / fling.r ** (fling.jumpAt - 1)) * fling.r ** Math.max(f, 0);
  return decayOffset(f, plan.vPeak) - decayOffset(f + 1, plan.vPeak);
}

/** The page layer's vertical blur at spec frame `f`, in output px: none at or under the gate. */
export function blurAt(f: number, plan: ScrollPlan, stage: Stage): number {
  const v = speedAt(f, plan) / specPx(stage, 1);
  const { gate, per, max } = fling.blur;
  return v > gate ? specPx(stage, Math.min(max, v / per)) : 0;
}

/**
 * Where the light's band is across the CTA at spec frame `f`, as a share of the CTA's width from
 * its left edge, or undefined outside the sweep. It crosses the middle on frame 57.
 */
export function sweepAt(f: number): number | undefined {
  const { from, frames } = fling.light;
  if (f < from || f >= from + frames) return undefined;
  return (f - from + 0.5) / frames;
}

/** The frame at spec frame `f`: at rest until page 2 lands, then pushing in about the CTA. */
export function framePlacement(f: number, plan: ScrollPlan): { rect: Rect; chrome: number } {
  const scale = pushAt(f);
  const { frame, chrome } = plan.layout;
  const { x, y } = plan.origin;
  return {
    rect: {
      x: x + (frame.x - x) * scale,
      y: y + (frame.y - y) * scale,
      width: frame.width * scale,
      height: frame.height * scale,
    },
    chrome: chrome * scale,
  };
}

/**
 * The page as drawn at spec frame `f`, in the window `BrowserFrame` draws: `left` and `top` from
 * the window's top left, which sits on whole pixels, and `width` the page's drawn width.
 *
 * The frame snaps to whole pixels, and its edges move less than a pixel a frame in the push, so
 * the page is placed at its exact size and position instead: the push then shows on every frame.
 * While the page is blurred it moves by whole pixels, so the blur is never drawn at a sub-pixel
 * offset.
 */
export function pageAt(
  f: number,
  plan: ScrollPlan,
  stage: Stage,
): { page: 0 | 1; left: number; top: number; width: number; blur: number } {
  const { page, y } = scrollAt(f, plan);
  const scale = pushAt(f);
  const { rect, chrome } = framePlacement(f, plan);
  const blur = blurAt(f, plan, stage);
  const windowTop = Math.round(rect.y) + Math.round(chrome);
  return {
    page,
    left: rect.x - Math.round(rect.x),
    top: rect.y + chrome - windowTop - (blur > 0 ? Math.round(y) : y) * scale,
    width: plan.layout.frame.width * scale,
    blur,
  };
}

/** The share of the light band's half width, either side of its centre. */
const BAND = 0.3;

const Sweep = ({ rect, at }: { rect: Rect; at: number }) => {
  const { colors, radius } = useBrand();
  const centre = (-BAND + (1 + 2 * BAND) * at) * 100;
  const edge = BAND * 100;
  return (
    <div
      style={{
        background: `linear-gradient(100deg, transparent ${centre - edge}%, ${withAlpha(colors.accent, fling.light.alpha)} ${centre}%, transparent ${centre + edge}%)`,
        borderRadius: Math.min(radius, rect.height / 2),
        height: rect.height,
        left: rect.x,
        position: 'absolute',
        top: rect.y,
        width: rect.width,
      }}
    />
  );
};

const SiteScroll = ({ scene, props }: SceneProps<SiteScrollProps>) => {
  const { stage, images } = useScene();
  const { f } = useSceneClock();
  const [first, second] = images;
  if (!first || !second) {
    throw new Error(
      `Scene "${scene.id}" shows ${images.length} page(s), and site-scroll needs two captured pages, in assetIds[0] and assetIds[1]. validateFilm should have said so.`,
    );
  }
  const plan = scrollPlan(stage, [first, second], props);
  const placed = framePlacement(f, plan);
  const { page, left, top, width, blur } = pageAt(f, plan, stage);
  const image = page === 0 ? first : second;
  const scale = width / image.width;
  const address = scene.text.filter(({ role }) => role === 'label')[page]?.value;
  const sweep = page === 1 ? sweepAt(f) : undefined;
  const filter = `site-scroll-blur-${scene.id}`;
  // No corner mark: the page is the subject, as in `site-hero`.
  return (
    <SeamLayer anchor="browser">
      {blur > 0 ? (
        <svg aria-hidden="true" height={0} style={{ position: 'absolute' }} width={0}>
          <filter
            colorInterpolationFilters="sRGB"
            height="1.1"
            id={filter}
            width="1"
            x="0"
            y="-0.05"
          >
            <feGaussianBlur stdDeviation={`0 ${blur}`} />
          </filter>
        </svg>
      ) : null}
      <BrowserFrame
        rect={placed.rect}
        pose={WHOLE_IMAGE}
        chrome={placed.chrome}
        address={address ? { text: address } : undefined}
      >
        <div
          style={{
            height: image.height * scale,
            left,
            position: 'absolute',
            top,
            width,
          }}
        >
          <Img
            src={image.src}
            style={{
              display: 'block',
              filter: blur > 0 ? `url(#${filter})` : undefined,
              height: '100%',
              width: '100%',
            }}
          />
          {sweep !== undefined && plan.cta ? (
            <Sweep
              at={sweep}
              rect={{
                x: plan.cta.x * scale,
                y: plan.cta.y * scale,
                width: plan.cta.w * scale,
                height: plan.cta.h * scale,
              }}
            />
          ) : null}
        </div>
      </BrowserFrame>
    </SeamLayer>
  );
};

const sizeOf = ({ width, height }: SceneImage) => `${width}×${height}`;

export const siteScroll = defineScene<SiteScrollProps>({
  component: SiteScroll,
  props: propsSchema,
  roles: { label: { min: 0, max: 2 } },
  image: 'required',
  maxImages: 2,
  // Each page fills the frame's width, and only page 2 is pushed. A page too short for its part
  // of the scroll is refused here, before a frame renders: fit or fail.
  imageView: ({ props, stage, image, index, durationInFrames, fps }) => {
    const layout = scrollLayout(stage, image);
    const scale = layout.frame.width / image.width;
    const drawn = image.height * scale;
    const where = `site-scroll page ${index + 1} (assetIds[${index}], ${sizeOf(image)})`;
    const format = `${stage.width}×${stage.height}`;
    if (index === 0) {
      const start = (props.pages[0]?.targetY ?? 0) * scale;
      const need = start + page1Need(stage);
      if (drawn < need) {
        throw new Error(
          `${where} is drawn ${Math.round(drawn)} px tall in a ${format} frame, and its fling needs ${Math.round(need)} px: the frame's height and the ramp's travel below where it starts. Capture at least ${Math.ceil(need / scale)} px of the page.`,
        );
      }
      return { width: layout.frame.width, zoom: 1 };
    }
    const target = landingY(props.pages[1], scale, stage);
    if (target <= 0) {
      throw new Error(
        `${where} lands at ${Math.round(target)} px in a ${format} frame: its CTA is too near the top of the page to scroll onto. Land on a CTA or heading further down the page.`,
      );
    }
    const need = target + layout.viewportHeight;
    if (drawn < need) {
      throw new Error(
        `${where} is drawn ${Math.round(drawn)} px tall in a ${format} frame, and landing on its CTA shows it down to ${Math.round(need)} px. Capture at least ${Math.ceil(need / scale)} px of the page.`,
      );
    }
    return { width: layout.frame.width, zoom: pushAt(specFrame(durationInFrames, fps) - 1) };
  },
  markAnchor: (stage) => cornerMark(stage),
  kind: 'product',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  anchors: [
    {
      id: 'browser',
      exit: anchorVelocity.x,
      box: (f, { props, stage, images }) => {
        const [first, second] = images;
        if (!first || !second) return { x: 0, y: 0, width: stage.width, height: stage.height };
        return framePlacement(f, scrollPlan(stage, [first, second], props)).rect;
      },
    },
  ],
});
