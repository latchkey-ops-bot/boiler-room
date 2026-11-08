import { z } from 'zod';
import { BrowserFrame } from '../components/browser-frame.tsx';
import { cornerMark } from '../components/scene-base.tsx';
import { type SceneProps, useScene, useSceneClock } from '../components/scene-runtime.tsx';
import { specPx } from '../components/type.tsx';
import { type Point, WHOLE_IMAGE } from '../core/camera.ts';
import { arriveN, specFrame } from '../core/curves.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import { anchorVelocity, arrival, drift, hero } from '../tokens.ts';
import { SeamLayer } from '../transitions/seam-layer.tsx';
import { defineScene, type SceneImage } from './definition.ts';

/** A box on the captured page in source pixels, as the Researcher measured it from the DOM. */
const captureBox = z.strictObject({
  x: z.number().min(0),
  y: z.number().min(0),
  w: z.number().positive(),
  h: z.number().positive(),
});

const propsSchema = z.strictObject({
  frame: z
    .literal('browser', {
      error:
        'site-hero draws frame "browser" only. Plane mode tilts the page in 3D, which made frames depend on the order they were rendered in, so it is not built yet',
    })
    .optional(),
  focus: captureBox.optional(),
  layers: z.never({ error: 'site-hero does not draw layers yet. Remove props.layers' }).optional(),
  activeLayer: z
    .never({ error: 'site-hero does not light a layer yet. Remove props.activeLayer' })
    .optional(),
});

export type SiteHeroProps = z.infer<typeof propsSchema>;

export interface HeroLayout {
  /** The browser frame at rest, before the push. Its foot may run off the frame. */
  frame: Rect;
  chrome: number;
  /** The capture as drawn in the frame: it fills the frame's viewport and is cropped, centred. */
  image: Rect;
}

/**
 * The frame is a share of the width, with its top at a share of the height. It shows the whole
 * width of the capture, and in a tall format runs to the foot of the frame and shows the capture's
 * centre column, as `docs/motion/scenes/site-hero.md` sets out.
 */
export function heroLayout(stage: Stage, image: Pick<SceneImage, 'aspect'>): HeroLayout {
  const { width: W, height: H, orientation } = stage;
  const share = hero.frame[orientation];
  const width = W * share.width;
  const top = H * share.top;
  const chrome = specPx(stage, hero.chrome);
  const whole = chrome + width / image.aspect;
  const height = orientation === 'portrait' ? Math.max(whole, H - top) : whole;
  const frame = { x: (W - width) / 2, y: top, width, height };
  const viewport = { width, height: height - chrome };
  const drawnWidth = Math.max(viewport.width, viewport.height * image.aspect);
  const drawnHeight = drawnWidth / image.aspect;
  return {
    frame,
    chrome,
    image: {
      x: frame.x + (viewport.width - drawnWidth) / 2,
      y: top + chrome + (viewport.height - drawnHeight) / 2,
      width: drawnWidth,
      height: drawnHeight,
    },
  };
}

/** The point the push centres on: the focus box, or else the top of the crop that shows. */
export function heroFocus(
  stage: Stage,
  layout: HeroLayout,
  image: SceneImage,
  focus: SiteHeroProps['focus'],
): Point {
  if (focus) {
    return {
      x: layout.image.x + ((focus.x + focus.w / 2) / image.width) * layout.image.width,
      y: layout.image.y + ((focus.y + focus.h / 2) / image.height) * layout.image.height,
    };
  }
  const viewportTop = layout.frame.y + layout.chrome;
  const shown = Math.min(layout.frame.y + layout.frame.height, stage.height) - viewportTop;
  return {
    x: layout.frame.x + layout.frame.width / 2,
    y: viewportTop + (shown * hero.defaultFocusTop) / 2,
  };
}

/**
 * The frame at a spec frame: it rises into place, and pushes in about the focus from the start. On
 * a T1 entry the seam brings it in instead, with no rise of its own.
 */
export function heroPlacement(
  f: number,
  stage: Stage,
  layout: HeroLayout,
  origin: Point,
  rises: boolean,
): { rect: Rect; chrome: number; scale: number } {
  const rise = !rises
    ? 0
    : specPx(stage, hero.entryTravel) * (1 - arriveN(f, arrival.slow.k, arrival.slow.D));
  const scale = 1 + drift.push * f;
  const { frame } = layout;
  return {
    rect: {
      x: origin.x + (frame.x - origin.x) * scale,
      y: origin.y + (frame.y - origin.y) * scale + rise,
      width: frame.width * scale,
      height: frame.height * scale,
    },
    chrome: layout.chrome * scale,
    scale,
  };
}

const addressOf = (text: readonly { role: string; value: string }[]) =>
  text.find(({ role }) => role === 'label')?.value;

const SiteHero = ({ scene, props }: SceneProps<SiteHeroProps>) => {
  const { stage, image } = useScene();
  const { f, inT } = useSceneClock();
  if (!image)
    throw new Error(`Scene "${scene.id}" has no image. validateFilm should have said so.`);
  const layout = heroLayout(stage, image);
  const origin = heroFocus(stage, layout, image, props.focus);
  const placed = heroPlacement(f, stage, layout, origin, inT !== 't1');
  const address = addressOf(scene.text);
  // No corner mark: the page is the subject, and its push would carry it over the mark.
  return (
    <SeamLayer anchor="browser">
      <BrowserFrame
        rect={placed.rect}
        src={image.src}
        pose={WHOLE_IMAGE}
        chrome={placed.chrome}
        address={address ? { text: address } : undefined}
      />
    </SeamLayer>
  );
};

export const siteHero = defineScene<SiteHeroProps>({
  component: SiteHero,
  props: propsSchema,
  roles: { label: { min: 0, max: 1 } },
  image: 'required',
  maxImages: 1,
  imageView: ({ stage, image, durationInFrames, fps }) => {
    const layout = heroLayout(stage, image);
    return {
      width: layout.image.width,
      zoom: 1 + drift.push * specFrame(durationInFrames, fps),
    };
  },
  markAnchor: (stage) => cornerMark(stage),
  kind: 'product',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  anchors: [
    {
      id: 'browser',
      entry: anchorVelocity.y,
      exit: anchorVelocity.scale,
      box: (f, { props, stage, images }) => {
        const [image] = images;
        if (!image) return { x: 0, y: 0, width: stage.width, height: stage.height };
        const layout = heroLayout(stage, image);
        const origin = heroFocus(stage, layout, image, props.focus);
        return heroPlacement(f, stage, layout, origin, true).rect;
      },
    },
  ],
});
