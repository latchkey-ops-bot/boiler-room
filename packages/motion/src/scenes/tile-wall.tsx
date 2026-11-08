import { AbsoluteFill, Img } from 'remotion';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import {
  type RuntimeImage,
  type SceneProps,
  useScene,
  useSceneClock,
} from '../components/scene-runtime.tsx';
import { specPx } from '../components/type.tsx';
import { specFrame } from '../core/curves.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import { arrival, departure } from '../tokens.ts';
import { SeamLayer } from '../transitions/seam-layer.tsx';
import { defineScene } from './definition.ts';

const propsSchema = z.strictObject({
  /** Five-sample motion blur over the rows. It multiplies the scene's render cost by five. */
  motionBlur: z.boolean().optional(),
});

export type TileWallProps = z.infer<typeof propsSchema>;

/**
 * `docs/motion/scenes/tile-wall.md`, in px at a short side of 1080 and in spec frames. Rows and
 * tile sizes are [N]. The speed is `cruise + burst * decay ** f`: 60 px/f at `f = 0`, decaying on
 * `arrive.long` [M] to a cruise of 11 [N]. The T9 ramp is `depart.drag` [M ref F-TL].
 */
export const wall = {
  /** Row centres, as shares of the height. */
  rows: {
    landscape: [0.19, 0.5, 0.81],
    portrait: [0.2, 0.4, 0.6, 0.8],
    square: [0.19, 0.5, 0.81],
  },
  /** Tiles are 16:10. */
  tile: {
    landscape: { width: 484, height: 302 },
    portrait: { width: 614, height: 384 },
    square: { width: 484, height: 302 },
  },
  gap: 32,
  /** Row `r` moves along x with this sign, so adjacent rows move in opposite directions. */
  signs: [-1, 1, -1, 1],
  cruise: 11,
  burst: 49,
  decay: arrival.long.k,
  ramp: departure.drag,
  /** Row `r` starts `r` times this share of a tile width to the left. */
  phase: 0.37,
  /** `CameraMotionBlur` with 5 samples and its default shutter angle of 180 degrees [D gap 9]. */
  blur: { samples: 5, shutter: 180 / 360 },
} as const;

/** The first frame of the T9 ramp, `R = dur - 26`. */
export const rampStart = (dur: number): number => Math.max(0, dur - wall.ramp.n);

/** Distance on the entry and long decay: the closed-form sum of the speeds before `f`. */
const decayed = (f: number): number =>
  wall.cruise * f + (wall.burst * (1 - wall.decay ** f)) / (1 - wall.decay);

const decaySpeed = (f: number): number => wall.cruise + wall.burst * wall.decay ** f;

/**
 * The rows' speed at spec frame `f`, in spec px per frame: how far they move from `f` to `f + 1`.
 * With `ramp`, the T9 exit, the speed multiplies by 1.11 a frame from `R` to the cut.
 */
export function wallSpeed(f: number, dur: number, ramp: boolean): number {
  const t = Math.max(0, f);
  const start = rampStart(dur);
  if (!ramp || t <= start) return decaySpeed(t);
  return decaySpeed(start) * wall.ramp.r ** (t - start);
}

/**
 * How far every row has moved by spec frame `f`, in spec px, in closed form so each frame is pure.
 * Its step from `f` to `f + 1` is `wallSpeed(f)`.
 */
export function wallDistance(f: number, dur: number, ramp: boolean): number {
  const t = Math.max(0, f);
  const start = rampStart(dur);
  if (!ramp || t <= start) return decayed(t);
  const { r } = wall.ramp;
  return decayed(start) + (decaySpeed(start) * (r ** (t - start) - 1)) / (r - 1);
}

export interface WallRow {
  /** `r`: the row's place from the top. */
  index: number;
  /** The top of the row's tiles. */
  top: number;
  sign: 1 | -1;
  /** Where tile 0 sits at `f = 0`: `-r * 0.37 * tileWidth`. */
  phase: number;
}

export interface WallLayout {
  tile: { width: number; height: number };
  gap: number;
  /** A tile and the gap after it. */
  pitch: number;
  rows: WallRow[];
}

/** The rows and tile size for this stage, in frame pixels. */
export function wallLayout(stage: Stage): WallLayout {
  const size = wall.tile[stage.orientation];
  const tile = { width: specPx(stage, size.width), height: specPx(stage, size.height) };
  const gap = specPx(stage, wall.gap);
  return {
    tile,
    gap,
    pitch: tile.width + gap,
    rows: wall.rows[stage.orientation].map((share, r) => ({
      index: r,
      top: stage.height * share - tile.height / 2,
      sign: wall.signs[r] ?? 1,
      phase: -r * wall.phase * tile.width,
    })),
  };
}

/** Where tile 0 of a row is at spec frame `f`, in frame pixels. */
export const rowX = (stage: Stage, row: WallRow, f: number, dur: number, ramp: boolean): number =>
  row.sign * specPx(stage, wallDistance(f, dur, ramp)) + row.phase;

/**
 * The tiles of a row's strip, by index: tile `k` is drawn `k` pitches after tile 0. The strip is
 * long enough that no end of it is in frame on any frame of the scene: it spans the frame, plus the
 * distance the row travels by `dur`, plus a tile, plus the row's phase. It depends only on the
 * scene's length, so the same tiles are mounted on every frame.
 */
export function stripTiles(
  stage: Stage,
  layout: WallLayout,
  row: WallRow,
  dur: number,
  ramp: boolean,
): number[] {
  const atStart = rowX(stage, row, 0, dur, ramp);
  const atEnd = rowX(stage, row, dur, dur, ramp);
  const left = Math.max(atStart, atEnd);
  const right = Math.min(atStart, atEnd);
  // A pixel of slack either side, for the snap to whole pixels.
  const first = Math.floor((-left - 1) / layout.pitch);
  const covers = Math.ceil((stage.width + 1 - layout.tile.width - right) / layout.pitch);
  // At least `W + D(dur) + tileWidth` long, as the scene file sets the strip.
  const long = first + Math.ceil((stage.width + Math.abs(atEnd - atStart)) / layout.pitch);
  const last = Math.max(covers, long);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/**
 * Which image tile `k` of row `r` shows: every row runs through the images in `assetIds` order,
 * starting `r / rows` of the way through them, so adjacent rows open on different pages [N].
 */
export function tileImage(count: number, rows: number, r: number, k: number): number {
  const start = Math.floor((r * count) / rows);
  return (((k + start) % count) + count) % count;
}

/**
 * A tile's rect with its edges on whole pixels. Chrome reuses a raster drawn at one sub-pixel
 * offset for the next frame, so a moving layer at fractional pixels can depend on render order.
 */
export function tileRect(layout: WallLayout, row: WallRow, x: number, k: number): Rect {
  const left = Math.round(x + k * layout.pitch);
  const top = Math.round(row.top);
  return {
    x: left,
    y: top,
    width: Math.round(x + k * layout.pitch + layout.tile.width) - left,
    height: Math.round(row.top + layout.tile.height) - top,
  };
}

/**
 * The spec frames `CameraMotionBlur` samples for the frame at `f`: with 5 samples and a shutter of
 * 180 degrees, sample `i` of 5 is drawn at `frame + 1 - shutter * i / 5`, in frames at the film's
 * rate. Its `Freeze` cannot reach this scene's clock, which the `Stage` reads above the scene, so
 * the scene draws its pure rows at those frames itself.
 */
export function blurFrames(f: number, fps: number): number[] {
  const { samples, shutter } = wall.blur;
  const frame = specFrame(1, fps);
  return Array.from(
    { length: samples },
    (_, index) => f + (1 - (shutter * (index + 1)) / samples) * frame,
  );
}

interface RowsProps {
  f: number;
  dur: number;
  ramp: boolean;
  stage: Stage;
  layout: WallLayout;
  strips: number[][];
  images: readonly RuntimeImage[];
  radius: number;
}

/** Every row's strip at spec frame `f`. */
const Rows = ({ f, dur, ramp, stage, layout, strips, images, radius }: RowsProps) => (
  <>
    {layout.rows.map((row) => {
      const x = rowX(stage, row, f, dur, ramp);
      return (strips[row.index] ?? []).map((k) => {
        const rect = tileRect(layout, row, x, k);
        const shown = tileImage(images.length, layout.rows.length, row.index, k);
        const image = images[shown] as RuntimeImage;
        return (
          <Img
            key={`${row.index}:${k}`}
            src={image.src}
            style={{
              borderRadius: radius,
              display: 'block',
              height: rect.height,
              left: rect.x,
              objectFit: 'cover',
              position: 'absolute',
              top: rect.y,
              width: rect.width,
            }}
          />
        );
      });
    })}
  </>
);

const TileWall = ({ scene, props }: SceneProps<TileWallProps>) => {
  const { stage, images, fps } = useScene();
  const { f, dur, outT } = useSceneClock();
  const { radius } = useBrand();
  if (images.length === 0) {
    throw new Error(`Scene "${scene.id}" has no tiles. validateFilm should have said so.`);
  }
  // T9 is template-pinned and the resolver plays no pin for it yet, so the ramp stays dormant
  // until one exists. Every other exit, T3, T5 and T7, cruises to the last frame.
  const ramp = (outT as string | undefined) === 't9';
  const layout = wallLayout(stage);
  const strips = layout.rows.map((row) => stripTiles(stage, layout, row, dur, ramp));
  const rows = (at: number) => (
    <Rows
      f={at}
      dur={dur}
      ramp={ramp}
      stage={stage}
      layout={layout}
      strips={strips}
      images={images}
      radius={radius}
    />
  );
  // No corner mark: the wall fills the frame, and its rows would run under the mark. No shadow:
  // a blurred shadow on a moving layer was drawn differently by tabs with different histories.
  // The rows are the scene's entry and exit, so nothing else enters: no T1 reaches this scene,
  // since the wall declares no velocity, and after a T5 the host has already blanked `f < b`.
  return (
    <SeamLayer anchor="wall">
      {props.motionBlur ? (
        <AbsoluteFill style={{ isolation: 'isolate' }}>
          {blurFrames(f, fps).map((at) => (
            <AbsoluteFill
              key={at}
              style={{ filter: `opacity(${1 / wall.blur.samples})`, mixBlendMode: 'plus-lighter' }}
            >
              {rows(at)}
            </AbsoluteFill>
          ))}
        </AbsoluteFill>
      ) : (
        rows(f)
      )}
    </SeamLayer>
  );
};

export const tileWall = defineScene<TileWallProps>({
  component: TileWall,
  props: propsSchema,
  roles: {},
  image: 'required',
  maxImages: 18,
  // Each image fills a tile, cropped to it, and is never zoomed.
  imageView: ({ stage, image }) => {
    const { tile } = wallLayout(stage);
    return { width: Math.max(tile.width, tile.height * image.aspect), zoom: 1 };
  },
  kind: 'product',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  anchors: [
    {
      // The full frame, with no velocity: the rows move in opposed directions, so no T1.
      id: 'wall',
      box: (_f, { stage }) => ({ x: 0, y: 0, width: stage.width, height: stage.height }),
    },
  ],
});
