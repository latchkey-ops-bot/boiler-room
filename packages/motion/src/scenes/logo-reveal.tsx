/**
 * `logo-reveal`, as `docs/motion/scenes/logo-reveal.md` specifies it: the mark resolves by a soft
 * mask, a blur, tiles or an iris bloom, is legible by `markLegibleAt`, drifts, and leaves upward
 * on the T1 seam. The scene's values live here rather than in `tokens.ts`, beside the template that
 * reads them.
 */
import type { CSSProperties } from 'react';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import type { ResolvedLogo } from '../brand/logo.ts';
import { BrandMark, logoRect, type MarkPlacement, useMarkRect } from '../components/brand-mark.tsx';
import { RisingWords } from '../components/rising-words.tsx';
import { type SceneProps, useScene, useSceneClock } from '../components/scene-runtime.tsx';
import {
  baselineOffset,
  lineBox,
  type SpecFit,
  type SpecTypeStyle,
  specPx,
  useSpecFit,
} from '../components/type.tsx';
import { arriveN, blink, secondLinePush, typeDrift } from '../core/curves.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import { anchorVelocity, arrival, rise, specType, type as typography } from '../tokens.ts';
import { SeamLayer } from '../transitions/seam-layer.tsx';
import { defineScene } from './definition.ts';

export const REVEAL_MODES = ['mask', 'blur', 'tiles', 'iris'] as const;
export type RevealMode = (typeof REVEAL_MODES)[number];

/**
 * The scene file's values, in spec px and spec frames. Tags as the file gives them: layout [N];
 * `legibleAt` [N] from the curves below; mask [M] `arrive.fast` with [E] softness and an [N]
 * mapping; blur [M] `arrive.snap` and [N] 12 px; tiles [M] T7 coverage with [E] last two and an
 * [N] cell size; iris [M] T13; the tagline's [M] short rise from an [N] start.
 */
export const reveal = {
  /** The box the logo fits within, as shares of the frame, and the tagline's first baseline. */
  layout: {
    landscape: { logo: { width: 0.36, height: 0.22, centreY: 0.5 }, tagline: 0.7 },
    portrait: { logo: { width: 0.7, height: 0.14, centreY: 0.45 }, tagline: 0.58 },
    square: { logo: { width: 0.6, height: 0.24, centreY: 0.5 }, tagline: 0.72 },
  },
  /** The frame each mode has the logo at full scale, unmasked and unblurred. */
  legibleAt: { mask: 13, blur: 8, tiles: 7, iris: 10 },
  /** T11: `p = from + span * arriveN(f + lead, 0.72, 14)`, a soft edge `softness` % wide. */
  mask: { from: -8, span: 116, lead: 1, softness: 8 },
  /** Blur radius on frame 0, in spec px. */
  blur: 12,
  /** Cells across the logo, and the share of them shown on frames 0 to 7. */
  tiles: { columns: 12, coverage: [0.024, 0.055, 0.11, 0.19, 0.35, 0.54, 0.78, 1] },
  /**
   * T13's close, played backwards. The close runs from the frame-corner radius to a dot of `dot`
   * px at `workWidth` wide on `arriveN(f, k, frames)`, its edge `softness` px on its first frames.
   */
  iris: { frames: 10, k: 0.6, dot: 23, workWidth: 540, softness: [39, 8, 3, 1], restSoftness: 1 },
  /** The tagline's first word pops in this many frames after the logo is legible. */
  taglineAfter: 6,
  taglineLines: 2,
} as const;

/** The frame the logo is legible in a mode: full scale, unmasked, unblurred, every tile in. */
export const legibleAt = (mode: RevealMode = 'mask'): number => reveal.legibleAt[mode];

/** The latest of the four, which every mode meets: `90 + 13 <= 105`, the mark deadline. */
export const LATEST_LEGIBLE_AT = Math.max(...Object.values(reveal.legibleAt));

/** The box the logo fits within, and the baseline of the tagline's first line. */
export function revealLayout(stage: Stage): { box: Rect; taglineBaseline: number } {
  const { width: W, height: H, orientation } = stage;
  const { logo, tagline } = reveal.layout[orientation];
  return {
    box: {
      x: (W - W * logo.width) / 2,
      y: H * logo.centreY - (H * logo.height) / 2,
      width: W * logo.width,
      height: H * logo.height,
    },
    taglineBaseline: H * tagline,
  };
}

export const logoPlacement = (stage: Stage): MarkPlacement => ({
  box: revealLayout(stage).box,
  align: 'center',
});

/** The scene's scale about the frame centre: 1 until the logo is legible, then type drift. */
export const markDrift = (f: number, ml: number): number => typeDrift(Math.max(0, f - ml));

/** A rect scaled about a point. */
export const scaleAbout = (rect: Rect, scale: number, x: number, y: number): Rect => ({
  x: x + (rect.x - x) * scale,
  y: y + (rect.y - y) * scale,
  width: rect.width * scale,
  height: rect.height * scale,
});

/**
 * The logo at rest, before drift: fitted to its box and, for a raster logo, small enough that at
 * `maxScale`, the most the scene drifts it, it is still no larger than its own pixels. A wordmark
 * is set inside the box, so the box is its rect, as in `end-card`.
 */
export function restingLogoRect(
  logo: ResolvedLogo,
  placement: MarkPlacement,
  maxScale: number,
): Rect {
  if (logo.kind !== 'image') return placement.box;
  const fitted = logoRect(logo, placement);
  if (!logo.naturalWidth || fitted.width * maxScale <= logo.naturalWidth) return fitted;
  const shrink = logo.naturalWidth / (fitted.width * maxScale);
  return scaleAbout(fitted, shrink, fitted.x + fitted.width / 2, fitted.y + fitted.height / 2);
}

/** The most the scene drifts, on its last frame. `dur` errs high at any rate, never low. */
const largestDrift = (dur: number, ml: number) => markDrift(dur, ml);

/**
 * Mask mode, T11: the soft edge's centre `p` and half-width `s`, in percent of the logo's width.
 * `+ 1` puts part of the logo on screen at `f = 0`. Undefined once the logo is unmasked, at 13.
 */
export function maskEdge(f: number): { p: number; s: number } | undefined {
  if (f >= reveal.legibleAt.mask) return undefined;
  const { from, span, lead, softness } = reveal.mask;
  const p = from + span * arriveN(f + lead, arrival.fast.k, arrival.fast.D);
  return { p, s: softness };
}

/** Blur mode: the blur radius in spec px, 12 on frame 0 and 0 from frame 8. */
export const blurAt = (f: number): number =>
  f >= reveal.legibleAt.blur ? 0 : reveal.blur * (1 - arriveN(f, arrival.snap.k, arrival.snap.D));

/** Tiles mode: the share of cells shown on a frame, keyed to the whole frame. */
export function tileCoverage(f: number): number {
  const { coverage } = reveal.tiles;
  if (f >= coverage.length - 1) return 1;
  return coverage[Math.max(0, Math.floor(f))] ?? 0;
}

/**
 * The logo cut into square cells, `1 / 12` of its width, in the order they appear: nearest its
 * centre first, and in reading order between cells as near. The rows are centred on the logo.
 */
export function tileCells(rect: Rect): Rect[] {
  const { columns } = reveal.tiles;
  const size = rect.width / columns;
  const rows = Math.max(1, Math.ceil(rect.height / size - 1e-9));
  const top = rect.y + rect.height / 2 - (rows * size) / 2;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const cells: { rect: Rect; distance: number; index: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cell = { x: rect.x + column * size, y: top + row * size, width: size, height: size };
      const dx = cell.x + size / 2 - cx;
      const dy = cell.y + size / 2 - cy;
      cells.push({ rect: cell, distance: dx * dx + dy * dy, index: row * columns + column });
    }
  }
  return cells
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ rect: cell }) => cell);
}

/** How many of `count` cells show on a frame: at least one, so the first frame is never blank. */
export const tilesShown = (f: number, count: number): number => {
  const coverage = tileCoverage(f);
  return coverage >= 1 ? count : Math.min(count, Math.max(1, Math.round(coverage * count)));
};

const px = (value: number) => Number(value.toFixed(3));

/** The cells as one path, for `clip-path: path()`: a union, so neighbours show no seam. */
export const tilesPath = (cells: readonly Rect[]): string =>
  cells
    .map(
      ({ x, y, width, height }) => `M${px(x)} ${px(y)}h${px(width)}v${px(height)}h${px(-width)}Z`,
    )
    .join('');

/**
 * Iris mode, T13's bloom: the close of the outgoing scene played backwards, so bloom frame `f`
 * shows close frame `10 - f`. On frame 0 the logo shows through a dot of `23 * W / 540` px; on
 * frame 10 the circle reaches the farthest frame corner. Undefined once it has.
 */
export function irisAt(
  f: number,
  stage: Pick<Stage, 'width' | 'height'>,
  centre: { x: number; y: number },
): { radius: number; softness: number } | undefined {
  const { frames, k, dot, workWidth, softness, restSoftness } = reveal.iris;
  if (f >= reveal.legibleAt.iris) return undefined;
  const scale = stage.width / workWidth;
  const rDot = dot * scale;
  const rCorner = Math.max(
    ...[0, stage.width].flatMap((x) =>
      [0, stage.height].map((y) => Math.hypot(x - centre.x, y - centre.y)),
    ),
  );
  const close = frames - Math.max(0, f);
  const radius = rDot + (rCorner - rDot) * (1 - arriveN(close, k, frames));
  return { radius, softness: (softness[Math.floor(close)] ?? restSoftness) * scale };
}

const centreOf = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

/**
 * The style that reveals the logo on a frame, on a layer the size of the frame: its stops, cells
 * and circle are in frame px, placed on the logo's ink. Undefined once the logo is legible.
 */
export function revealStyle(
  mode: RevealMode,
  f: number,
  ink: Rect,
  stage: Pick<Stage, 'width' | 'height'>,
): CSSProperties | undefined {
  if (f >= legibleAt(mode)) return undefined;
  if (mode === 'mask') {
    const edge = maskEdge(f);
    if (!edge) return undefined;
    const at = (percent: number) => px(ink.x + (percent / 100) * ink.width);
    const image = `linear-gradient(90deg, #000 ${at(edge.p - edge.s)}px, transparent ${at(edge.p + edge.s)}px)`;
    return { maskImage: image, WebkitMaskImage: image };
  }
  if (mode === 'blur') {
    const radius = specPx(stage, blurAt(f));
    return radius > 0 ? { filter: `blur(${px(radius)}px)` } : undefined;
  }
  if (mode === 'tiles') {
    const cells = tileCells(ink);
    const shown = tilesShown(f, cells.length);
    if (shown >= cells.length) return undefined;
    return { clipPath: `path('${tilesPath(cells.slice(0, shown))}')` };
  }
  const centre = centreOf(ink);
  const iris = irisAt(f, stage, centre);
  if (!iris) return undefined;
  const { radius, softness } = iris;
  const image = `radial-gradient(circle at ${px(centre.x)}px ${px(centre.y)}px, #000 ${px(Math.max(0, radius - softness / 2))}px, transparent ${px(radius + softness / 2)}px)`;
  return { maskImage: image, WebkitMaskImage: image };
}

const taglineStyle: SpecTypeStyle = {
  font: 'display',
  weight: typography.weight.display,
  cap: specType.capS,
};

/**
 * Fit or fail: the tagline is set at the sentence cap height on at most two lines, or the scene
 * refuses to render, naming the scene and the text id. It is never set smaller to fit.
 */
export function taglineProblem(
  sceneId: string,
  textId: string,
  fit: Pick<SpecFit, 'fontSize' | 'targetSize' | 'lines'>,
  stage: Pick<Stage, 'width' | 'height'>,
): string | undefined {
  const wanted = Math.floor(fit.targetSize);
  if (fit.lines.length > 0 && fit.fontSize >= wanted) return undefined;
  return `Layout error in scene "${sceneId}": subhead "${textId}" does not fit on ${reveal.taglineLines} lines at the sentence cap height of ${specType.capS} px in ${stage.width}x${stage.height}. It would have to be set at ${fit.fontSize} px instead of ${wanted} px, and type is never shrunk to fit. Shorten text "${textId}".`;
}

/**
 * Where the tagline's lines sit on a frame, as baselines. One line sits on the layout's baseline.
 * With two, line 1 rises in half a line lower and is pushed up onto that baseline by T3's
 * `secondLinePush` as line 2 arrives one line below it, so the settled block hangs from the
 * baseline and never rises into the logo.
 */
export function taglineBaselines(
  f: number,
  fit: Pick<SpecFit, 'fontSize' | 'lineHeight' | 'lines'>,
  baseline: number,
  start: number,
): { first: number; second: number | undefined; secondStart: number } {
  const [first = '', second] = fit.lines;
  const line = fit.fontSize * fit.lineHeight;
  const secondStart = start + first.split(' ').length;
  if (second === undefined) return { first: baseline, second: undefined, secondStart };
  const travel = line / 2;
  return {
    first: baseline + travel - secondLinePush(f, secondStart, travel),
    second: baseline + line,
    secondStart,
  };
}

const propsSchema = z.strictObject({
  mode: z.enum(REVEAL_MODES).optional(),
});

export type LogoRevealProps = z.infer<typeof propsSchema>;

const TaglineLine = ({
  line,
  baseline,
  fit,
  f,
  start,
  color,
  fontFamily,
  width,
}: {
  line: string;
  baseline: number;
  fit: SpecFit;
  f: number;
  start: number;
  color: string;
  fontFamily: string;
  width: number;
}) => (
  <div
    style={{
      color,
      fontFamily,
      fontKerning: 'normal',
      fontSize: fit.fontSize,
      fontWeight: fit.weight,
      left: 0,
      letterSpacing: fit.letterSpacing,
      lineHeight: fit.lineHeight,
      position: 'absolute',
      textAlign: 'center',
      top: baseline - baselineOffset(fit),
      whiteSpace: 'pre',
      width,
    }}
  >
    <RisingWords lines={[line]} f={f} start={start} rise={rise.short} />
  </div>
);

const LogoReveal = ({ scene, props }: SceneProps<LogoRevealProps>) => {
  const { stage } = useScene();
  const { f, dur, b, inT } = useSceneClock();
  const { colors, fonts, logo } = useBrand();
  const mode = props.mode ?? 'mask';
  const ml = legibleAt(mode);
  const layout = revealLayout(stage);
  const rest = restingLogoRect(logo, logoPlacement(stage), largestDrift(dur, ml));
  const placement: MarkPlacement = { box: rest, align: 'center' };
  // The ink the reveal works on: a wordmark is narrower than its box.
  const ink = useMarkRect(placement, stage.unit);

  const subhead = scene.text.find(({ role }) => role === 'subhead');
  const fit = useSpecFit(subhead?.value ?? '', taglineStyle, stage, {
    width: lineBox(stage),
    maxLines: reveal.taglineLines,
  });
  if (subhead) {
    const problem = taglineProblem(scene.id, subhead.id, fit, stage);
    if (problem) throw new Error(problem);
  }

  // After T1 the seam brings the logo in whole. After T5 it racks into focus as a headline does.
  // Otherwise, after T3, it resolves in its mode from the first frame.
  const racked = inT === 't5' ? blink(f, b) : undefined;
  const entry: CSSProperties | undefined =
    inT === 't1'
      ? undefined
      : racked
        ? {
            filter: racked.blur > 0 ? `blur(${specPx(stage, racked.blur)}px)` : undefined,
            transform: `translateY(${specPx(stage, racked.y)}px)`,
          }
        : revealStyle(mode, f, ink, stage);

  const drift: CSSProperties = {
    inset: 0,
    position: 'absolute',
    transform: `scale(${markDrift(f, ml)})`,
    transformOrigin: '50% 50%',
  };
  const start = ml + reveal.taglineAfter;
  const lines = subhead ? taglineBaselines(f, fit, layout.taglineBaseline, start) : undefined;
  const shared = {
    fit,
    f,
    color: colors.muted,
    fontFamily: fonts.display,
    width: stage.width,
  };

  return (
    <>
      <SeamLayer anchor="logo">
        <div style={drift}>
          <div style={{ inset: 0, position: 'absolute', ...entry }}>
            <BrandMark placement={placement} unit={stage.unit} />
          </div>
        </div>
      </SeamLayer>
      {lines && f >= start ? (
        <SeamLayer>
          <div style={drift}>
            <TaglineLine
              {...shared}
              line={fit.lines[0] ?? ''}
              baseline={lines.first}
              start={start}
            />
            {lines.second !== undefined && f >= lines.secondStart ? (
              <TaglineLine
                {...shared}
                line={fit.lines[1] ?? ''}
                baseline={lines.second}
                start={lines.secondStart}
              />
            ) : null}
          </div>
        </SeamLayer>
      ) : null}
    </>
  );
};

export const logoReveal = defineScene<LogoRevealProps>({
  component: LogoReveal,
  props: propsSchema,
  roles: { subhead: { min: 0, max: 1 } },
  image: 'none',
  maxImages: 0,
  markAnchor: (stage) => logoPlacement(stage),
  kind: 'mark',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  anchors: [
    {
      id: 'logo',
      exit: anchorVelocity.y,
      // The logo at rest, drifting about the frame centre. Its reveal and its seam are not part
      // of its box.
      box: (f, { props, stage, theme, dur }) => {
        const ml = legibleAt(props.mode);
        const rest = restingLogoRect(theme.logo, logoPlacement(stage), largestDrift(dur, ml));
        return scaleAbout(rest, markDrift(f, ml), stage.width / 2, stage.height / 2);
      },
    },
  ],
  // The definition holds one frame: the latest mode's, which every mode meets.
  // `legibleAt(mode)` gives each mode's own.
  markLegibleAt: LATEST_LEGIBLE_AT,
});
