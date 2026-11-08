import { type Campaign, FORMATS, sceneRegistry } from '@boiler-room/schema';
import novaTiles from '@boiler-room/schema/examples/nova-tiles.campaign.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import type { LogoProbe } from '../src/brand/logo.ts';
import { specFrame } from '../src/core/curves.ts';
import { screenImageIds } from '../src/film/media.ts';
import { prepareFilm } from '../src/film/prepare.ts';
import { filmSeams } from '../src/film/seams.ts';
import { validateFilm } from '../src/film/validate-film.ts';
import { validateForRender } from '../src/film/validate-render.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../src/layout/stage.ts';
import { anchorsOf, anchorVelocities, groundOf } from '../src/scenes/definition.ts';
import { definitionOf } from '../src/scenes/registry.ts';
import {
  blurFrames,
  rampStart,
  rowX,
  stripTiles,
  tileImage,
  tileRect,
  tileWall,
  wallDistance,
  wallLayout,
  wallSpeed,
} from '../src/scenes/tile-wall.tsx';
import { at, exampleProbe } from './fixtures.ts';

const tilesCopy = () => structuredClone(novaTiles) as Campaign;
const stageOf = (format: Format) => {
  const { width, height } = FORMAT_SIZES[format];
  return stageFor(width, height);
};

/** The scene lengths the beat templates give the wall: Standard row 14 and Long row 5. */
const STANDARD = 66;
const LONG = 72;

const TILE_FILES = ['nav', 'runs', 'chart', 'status', 'queue', 'header', 'runs-more'];
const tileProbe = (width = 960, height = 600): Record<string, LogoProbe> =>
  Object.fromEntries(
    TILE_FILES.map((name) => [
      `tiles/${name}.png`,
      { loaded: true, width, height, animated: false },
    ]),
  );

describe('tile-wall speed', () => {
  it('enters at 60 px/f and decays on arrive.long to a cruise of about 11', () => {
    expect(wallSpeed(0, STANDARD, false)).toBe(60);
    expect(wallSpeed(35, STANDARD, false)).toBeCloseTo(11.6, 1);
    expect(wallSpeed(rampStart(STANDARD), STANDARD, false)).toBeGreaterThan(11);
    expect(wallSpeed(rampStart(STANDARD), STANDARD, false)).toBeLessThan(11.5);
    expect(wallSpeed(STANDARD - 1, STANDARD, false)).toBeCloseTo(11, 1);
    expect(wallSpeed(LONG - 1, LONG, false)).toBeCloseTo(11, 1);
  });

  it('moves each frame by exactly its speed, in closed form', () => {
    for (const ramp of [false, true]) {
      for (let f = 0; f < STANDARD; f += 1) {
        const step = wallDistance(f + 1, STANDARD, ramp) - wallDistance(f, STANDARD, ramp);
        expect(step).toBeCloseTo(wallSpeed(f, STANDARD, ramp), 9);
      }
    }
    expect(wallDistance(0, STANDARD, false)).toBe(0);
  });

  it('ramps into the cut on a T9 exit: about 153 px/f on the last frame, 15 times at the cut', () => {
    const start = rampStart(STANDARD);
    expect(start).toBe(STANDARD - 26);
    const cruise = wallSpeed(start, STANDARD, true);
    expect(cruise).toBeCloseTo(11.3, 1);
    expect(wallSpeed(STANDARD - 1, STANDARD, true)).toBeCloseTo(153.4, 0);
    expect(wallSpeed(STANDARD, STANDARD, true) / cruise).toBeCloseTo(15.1, 1);
    expect(rampStart(LONG)).toBe(LONG - 26);
  });

  it('leaves every frame before the ramp where the cruise has it', () => {
    for (let f = 0; f <= rampStart(STANDARD); f += 1) {
      expect(wallDistance(f, STANDARD, true)).toBe(wallDistance(f, STANDARD, false));
    }
    expect(wallDistance(STANDARD - 1, STANDARD, true)).toBeGreaterThan(
      wallDistance(STANDARD - 1, STANDARD, false),
    );
  });

  it('moves forward on every frame at 24 fps, whose spec frames are fractional', () => {
    const dur = specFrame(53, 24);
    let before = -1;
    for (let frame = 0; frame < 53; frame += 1) {
      const distance = wallDistance(specFrame(frame, 24), dur, false);
      expect(distance).toBeGreaterThan(before);
      before = distance;
    }
  });
});

describe('tile-wall layout', () => {
  it('sets three rows of 484 x 302 tiles at 0.19, 0.50 and 0.81 H in 16:9 and 1:1', () => {
    for (const format of ['16:9', '1:1'] as const) {
      const stage = stageOf(format);
      const layout = wallLayout(stage);
      expect(layout.tile).toEqual({ width: 484, height: 302 });
      expect(layout.gap).toBe(32);
      expect(layout.pitch).toBe(516);
      expect(layout.rows.map(({ top }) => top + 151)).toEqual([
        0.19 * stage.height,
        0.5 * stage.height,
        0.81 * stage.height,
      ]);
      expect(layout.rows.map(({ sign }) => sign)).toEqual([-1, 1, -1]);
      expect(layout.rows.map(({ phase }) => phase)).toEqual([-0, -0.37 * 484, -2 * 0.37 * 484]);
    }
  });

  it('sets four rows of 614 x 384 tiles at 0.2 to 0.8 H in 9:16', () => {
    const stage = stageOf('9:16');
    const layout = wallLayout(stage);
    expect(layout.tile).toEqual({ width: 614, height: 384 });
    expect(layout.rows.map(({ top }) => top + 192)).toEqual([384, 768, 1152, 1536]);
    expect(layout.rows.map(({ sign }) => sign)).toEqual([-1, 1, -1, 1]);
  });

  it('keeps tiles at 16:10', () => {
    for (const format of FORMATS) {
      const { tile } = wallLayout(stageOf(format));
      expect(tile.width / tile.height).toBeCloseTo(1.6, 2);
    }
  });

  it('scales tiles, gap and travel by the short side, as a 4K export needs', () => {
    const stage = stageFor(3840, 2160);
    const layout = wallLayout(stage);
    expect(layout.tile).toEqual({ width: 968, height: 604 });
    expect(layout.gap).toBe(64);
    const row = at(layout.rows, 0);
    expect(rowX(stage, row, 10, STANDARD, false)).toBeCloseTo(
      -2 * wallDistance(10, STANDARD, false),
      9,
    );
  });

  it('moves adjacent rows in opposite directions', () => {
    const stage = stageOf('9:16');
    const layout = wallLayout(stage);
    const moved = layout.rows.map(
      (row) => rowX(stage, row, 1, STANDARD, false) - rowX(stage, row, 0, STANDARD, false),
    );
    expect(moved).toEqual([-60, 60, -60, 60]);
  });
});

describe('tile-wall strip', () => {
  const cases = FORMATS.flatMap((format) =>
    [
      { fps: 30, frames: STANDARD },
      { fps: 30, frames: LONG },
      { fps: 24, frames: 53 },
    ].flatMap(({ fps, frames }) => [false, true].map((ramp) => ({ format, fps, frames, ramp }))),
  );

  it.each(cases)(
    'fills every row on every frame, $format at $fps fps for $frames frames, ramp $ramp',
    ({ format, fps, frames, ramp }) => {
      const stage = stageOf(format);
      const layout = wallLayout(stage);
      const dur = specFrame(frames, fps);
      for (const row of layout.rows) {
        const strip = stripTiles(stage, layout, row, dur, ramp);
        for (let frame = 0; frame < frames; frame += 1) {
          const x = rowX(stage, row, specFrame(frame, fps), dur, ramp);
          const rects = strip.map((k) => tileRect(layout, row, x, k));
          // No empty strip end in frame, and nothing between tiles but the gap.
          expect(at(rects, 0).x).toBeLessThanOrEqual(0);
          const last = at(rects, rects.length - 1);
          expect(last.x + last.width).toBeGreaterThanOrEqual(stage.width);
          for (let index = 1; index < rects.length; index += 1) {
            const hole = at(rects, index).x - (at(rects, index - 1).x + at(rects, index - 1).width);
            expect(hole).toBeLessThanOrEqual(layout.gap + 1);
          }
        }
      }
    },
  );

  it('covers the frame, the distance travelled and a tile, as the scene file sets it', () => {
    for (const format of FORMATS) {
      const stage = stageOf(format);
      const layout = wallLayout(stage);
      for (const row of layout.rows) {
        const strip = stripTiles(stage, layout, row, STANDARD, false);
        const length = (strip.length - 1) * layout.pitch + layout.tile.width;
        expect(length).toBeGreaterThanOrEqual(
          stage.width + wallDistance(STANDARD, STANDARD, false) + layout.tile.width,
        );
      }
    }
  });

  it('runs each row through the images in assetIds order, starting further on per row', () => {
    expect([0, 1, 2].map((r) => tileImage(7, 3, r, 0))).toEqual([0, 2, 4]);
    expect([0, 1, 2, 3].map((r) => tileImage(6, 4, r, 0))).toEqual([0, 1, 3, 4]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((k) => tileImage(7, 3, 1, k))).toEqual([
      2, 3, 4, 5, 6, 0, 1, 2,
    ]);
    expect([-1, -2, -8].map((k) => tileImage(7, 3, 0, k))).toEqual([6, 5, 6]);
    expect(tileImage(1, 3, 2, 5)).toBe(0);
  });

  it('puts tiles on whole pixels', () => {
    const stage = stageFor(3840, 2160);
    const layout = wallLayout(stage);
    const row = at(layout.rows, 1);
    const rect = tileRect(layout, row, rowX(stage, row, 7.3, STANDARD, false), 3);
    for (const value of Object.values(rect)) expect(Number.isInteger(value)).toBe(true);
  });
});

describe('tile-wall motion blur', () => {
  it('samples as CameraMotionBlur does: 5 samples over a 180 degree shutter, in film frames', () => {
    expect(blurFrames(10, 30).map((f) => Number(f.toFixed(9)))).toEqual([
      10.9, 10.8, 10.7, 10.6, 10.5,
    ]);
    expect(blurFrames(10, 24).map((f) => Number(f.toFixed(9)))).toEqual([
      11.125, 11, 10.875, 10.75, 10.625,
    ]);
  });
});

describe('tile-wall definition', () => {
  it('is registered under the schema name, sets no copy and shows up to 18 captures', () => {
    expect(definitionOf('tile-wall')).toBe(tileWall);
    expect(sceneRegistry['tile-wall']).toEqual({ text: {} });
    expect(tileWall.roles).toEqual({});
    expect(tileWall.image).toBe('required');
    expect(tileWall.maxImages).toBe(18);
    expect(tileWall.kind).toBe('product');
    expect(groundOf(tileWall, {}, 'neutral-cut')).toBe('base');
    expect(groundOf(tileWall, {}, 'kinetic-plate')).toBe('plate');
    expect(tileWall.holdFrom).toBeUndefined();
  });

  it('takes only motionBlur, a boolean, as props', () => {
    expect(tileWall.props.safeParse({}).success).toBe(true);
    expect(tileWall.props.safeParse({ motionBlur: true }).success).toBe(true);
    expect(tileWall.props.safeParse({ motionBlur: 'yes' }).success).toBe(false);
    expect(tileWall.props.safeParse({ speed: 2 }).success).toBe(false);
  });

  it('exposes the full frame as its wall anchor, with no velocity, so it never seams on T1', () => {
    expect(anchorVelocities(tileWall, {})).toEqual([
      { id: 'wall', entry: undefined, exit: undefined },
    ]);
    const stage = stageOf('9:16');
    const [anchor] = anchorsOf(tileWall, {
      props: {},
      stage,
      theme: {} as never,
      images: [],
      dur: STANDARD,
      text: [],
    });
    expect(anchor?.box(0)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(anchor?.box(40)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });

  it('sizes each capture by the tile it fills, so a capture too small to stay sharp is refused', () => {
    const view = (format: Format, width: number, height: number) =>
      tileWall.imageView?.({
        props: {},
        stage: stageOf(format),
        image: { width, height, aspect: width / height },
        index: 0,
        durationInFrames: STANDARD,
        fps: 30,
      });
    expect(view('16:9', 960, 600)).toEqual({ width: 484, zoom: 1 });
    expect(view('9:16', 960, 600)?.width).toBeCloseTo(384 * 1.6, 9);
    expect(view('1:1', 1600, 1200)).toEqual({ width: 484, zoom: 1 });
    expect(view('16:9', 2100, 900)?.width).toBeCloseTo((302 * 21) / 9, 9);
  });
});

describe('tile-wall in a film', () => {
  it('passes the gate as the nova-tiles example stands, in every format', async () => {
    const campaign = tilesCopy();
    expect(await validateForRender(campaign)).toEqual({ ok: true, issues: [], campaign });
    for (const format of FORMATS) expect(validateFilm(campaign, format)).toEqual([]);
  });

  it('plans the example in every format with all seven tiles, on the plate of a dark brand', async () => {
    for (const format of FORMATS) {
      const plan = await prepareFilm({ campaign: tilesCopy(), format }, exampleProbe(tileProbe()));
      const scene = at(plan.scenes, 1);
      expect(plan.skin).toBe('kinetic-plate');
      expect(scene.images.map(({ assetId }) => assetId)).toEqual(at(novaTiles.scenes, 1).assetIds);
      expect(scene.ground).toBe('plate');
      expect(scene.span.durationInFrames).toBe(STANDARD);
      expect(scene.span.in?.name).toBe('t3');
      expect(scene.span.out?.name).toBe('t3');
    }
  });

  it('refuses copy, which the wall never shows', () => {
    const campaign = tilesCopy();
    at(campaign.scenes, 1).text = [
      { id: 'wall-label', role: 'label', value: 'Every page', claimIds: [] },
    ];
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'TEXT_UNUSED', path: 'scenes[1].text' }),
    ]);
  });

  it('refuses a wall with no captured or uploaded image', () => {
    const campaign = tilesCopy();
    const nav = campaign.assets['tile-nav'];
    if (nav) nav.provenance = 'stock';
    at(campaign.scenes, 1).assetIds = ['tile-nav'];
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'IMAGE_MISSING', path: 'scenes[1].assetIds' }),
    ]);
  });

  it('refuses a tile too small for its tile in that format, with the size to supply', async () => {
    const rejection = prepareFilm(
      { campaign: tilesCopy(), format: '9:16' },
      exampleProbe(tileProbe(400, 250)),
    );
    await expect(rejection).rejects.toThrow(/IMAGE_TOO_SMALL/);
    await expect(rejection).rejects.toThrow(/at least 410 px wide/);
  });

  it('shows at most 18 tiles', () => {
    const campaign = tilesCopy();
    const ids = Array.from({ length: 20 }, (_, index) => `extra-${index}`);
    for (const id of ids) {
      campaign.assets[id] = { kind: 'image', src: `${id}.png`, provenance: 'captured' };
    }
    at(campaign.scenes, 1).assetIds = ids;
    expect(screenImageIds(at(campaign.scenes, 1), campaign)).toEqual(ids.slice(0, 18));
  });

  it('cuts in and out by T3 when T1 is written, since the rows share no velocity', () => {
    const campaign = tilesCopy();
    at(campaign.scenes, 1).transitionOut = 't1';
    expect(at(filmSeams(campaign), 1)).toMatchObject({
      from: 'wall',
      to: 'close',
      written: 't1',
      used: 't3',
      reason: 'fallback',
    });
  });
});
