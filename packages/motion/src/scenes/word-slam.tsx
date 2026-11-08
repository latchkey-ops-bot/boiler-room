import { useMemo } from 'react';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { cornerMark, SceneMark } from '../components/scene-base.tsx';
import { type SceneProps, useScene, useSceneClock } from '../components/scene-runtime.tsx';
import {
  lineBox,
  type SpecFit,
  type SpecTypeStyle,
  specFit,
  useSpecFit,
  widthAt,
  wordWidths,
} from '../components/type.tsx';
import { arriveN, secondLinePush, typeDrift } from '../core/curves.ts';
import { bezier } from '../core/time.ts';
import { textDirection } from '../layout/bidi.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import { slam, specType, type as typography } from '../tokens.ts';
import { SeamLayer } from '../transitions/seam-layer.tsx';
import { type Accent, accentSchema, isAccented } from './accent.ts';
import { defineScene } from './definition.ts';

const propsSchema = z.strictObject({
  accent: accentSchema.optional(),
});

export type WordSlamProps = z.infer<typeof propsSchema>;

const scaleOf = (f: number) =>
  1 + (f <= 0 ? slam.firstExcess : slam.excess * slam.decay ** (f - 1));
const collapseEnd = slam.collapseFrom + slam.collapseFrames;
const collapse = bezier(slam.collapseCurve);

/**
 * The slam word's scale over its rest at display size: 5.4 on frame 0, decaying sharply, then
 * collapsing from frame 9 to `rest`, the sentence size over the display size, by frame 22.
 */
export function slamScale(f: number, rest: number): number {
  if (f <= slam.collapseFrom) return scaleOf(f);
  if (f >= collapseEnd) return rest;
  const from = scaleOf(slam.collapseFrom);
  return from + (rest - from) * collapse((f - slam.collapseFrom) / slam.collapseFrames);
}

/** Blurred only while it moves fast: frame 0, and any frame whose scale changes by over the gate. */
export function slamBlurred(f: number, rest: number): boolean {
  if (f <= 0) return true;
  if (f >= collapseEnd) return false;
  return Math.abs(Math.log(slamScale(f, rest) / slamScale(f - 1, rest))) > slam.blurGate;
}

/** The frame word `n` of the sentence appears on. The first is the slam word, there from frame 0. */
export const appearsAt = (n: number): number =>
  n === 0 ? 0 : slam.appendAt + slam.appendStagger * (n - 1);

export interface SentenceLine {
  /** Each word's width at sentence size. */
  widths: number[];
  /** The index in the sentence of the line's first word. */
  first: number;
}

/**
 * Where a line starts at a frame. A word joins at its place after the words before it, and the
 * line re-centres on `slam.recentre`, half of each new word's width at a time.
 */
export function lineStart(f: number, line: SentenceLine, space: number, centreX: number): number {
  const [first = 0, ...rest] = line.widths;
  let start = centreX - first / 2;
  for (const [index, width] of rest.entries()) {
    const at = appearsAt(line.first + index + 1);
    if (f < at) break;
    start -= ((space + width) / 2) * arriveN(f - at, slam.recentre.k, slam.recentre.D);
  }
  return start;
}

interface SlamLayout {
  fit: SpecFit;
  lines: { words: string[]; line: SentenceLine; offsets: number[] }[];
  space: number;
  displaySize: number;
  displayWidth: number;
}

const sentenceStyle: SpecTypeStyle = {
  font: 'display',
  weight: typography.weight.display,
  cap: specType.capS,
};

/**
 * The headline anchor's box: the whole sentence at rest, centred on the frame, as it drifts. The
 * slam and the collapse happen inside this box's centre, so nothing carried across a seam moves it.
 */
export function sentenceBox(fit: SpecFit, stage: Stage, f: number): Rect {
  const scale = typeDrift(Math.max(0, f - slam.appendAt));
  const width = fit.width * scale;
  const height = fit.lines.length * fit.fontSize * fit.lineHeight * scale;
  return { x: (stage.width - width) / 2, y: (stage.height - height) / 2, width, height };
}

function useSlamLayout(text: string, stage: Stage): SlamLayout {
  const fit = useSpecFit(text, sentenceStyle, stage, { width: lineBox(stage), maxLines: 2 });
  return useMemo(() => {
    let first = 0;
    let space = 0;
    const lines = fit.lines.map((value) => {
      const words = value.split(' ');
      const measured = wordWidths(fit, words);
      space = measured.space;
      const offsets = measured.words.map((_, index) =>
        measured.words.slice(0, index).reduce((sum, width) => sum + width + measured.space, 0),
      );
      const line = { words, line: { widths: measured.words, first }, offsets };
      first += words.length;
      return line;
    });
    const word = lines[0]?.words[0] ?? '';
    const capDerived = fit.targetSize * (specType.capD / specType.capS);
    const probe = widthAt(fit, word, capDerived);
    const fitsWidth =
      probe > 0 ? (capDerived * stage.width * slam.displayWidth) / probe : capDerived;
    const displaySize = Math.min(capDerived, fitsWidth);
    return { fit, lines, space, displaySize, displayWidth: widthAt(fit, word, displaySize) };
  }, [fit, stage]);
}

const Word = ({
  value,
  x,
  y,
  fontSize,
  lineHeight,
  color,
  style,
}: {
  value: string;
  x: number;
  y: number;
  fontSize: number;
  lineHeight: number;
  color: string;
  style?: React.CSSProperties;
}) => (
  <div
    style={{
      ...style,
      color,
      direction: textDirection(value),
      fontSize,
      left: x,
      lineHeight,
      position: 'absolute',
      top: y,
      unicodeBidi: 'isolate',
      whiteSpace: 'pre',
    }}
  >
    {value}
  </div>
);

const WordSlam = ({ scene, props }: SceneProps<WordSlamProps>) => {
  const { stage } = useScene();
  const { f } = useSceneClock();
  const { colors, fonts } = useBrand();
  const headline = scene.text.find(({ role }) => role === 'headline');
  if (!headline) throw new Error(`Scene "${scene.id}" has no headline. validateFilm checks this.`);
  const layout = useSlamLayout(headline.value, stage);
  const { fit, lines, space, displaySize, displayWidth } = layout;
  const rtl = textDirection(headline.value) === 'rtl';
  const centreX = stage.width / 2;
  const centreY = stage.height / 2;
  const accent: Accent | undefined = props.accent;
  const colorOf = (n: number) =>
    isAccented(accent, headline.id, n) ? colors.accent : colors.foreground;
  const shared = {
    fontFamily: fonts.display,
    fontKerning: 'normal' as const,
    fontWeight: fit.weight,
    letterSpacing: fit.letterSpacing,
  };
  const slamWord = lines[0]?.words[0] ?? '';

  const content =
    f < slam.appendAt ? (
      (() => {
        const rest = fit.fontSize / displaySize;
        const scale = slamScale(f, rest);
        const blur = slamBlurred(f, rest) ? slam.blurShare * displaySize * fit.metrics.cap : 0;
        return (
          <Word
            value={slamWord}
            x={centreX - displayWidth / 2}
            y={centreY - (displaySize * fit.lineHeight) / 2}
            fontSize={displaySize}
            lineHeight={fit.lineHeight}
            color={colorOf(0)}
            style={{
              ...shared,
              filter: blur > 0 ? `blur(${blur}px)` : undefined,
              transform: `scale(${scale})`,
              transformOrigin: '50% 50%',
            }}
          />
        );
      })()
    ) : (
      <div
        style={{
          inset: 0,
          position: 'absolute',
          transform: `scale(${typeDrift(f - slam.appendAt)})`,
          transformOrigin: '50% 50%',
        }}
      >
        {lines.map(({ words, line, offsets }, lineIndex) => {
          const lineHeightPx = fit.fontSize * fit.lineHeight;
          const travel = lineHeightPx / 2;
          const secondStart = appearsAt(lines[1]?.line.first ?? Number.POSITIVE_INFINITY);
          const middle =
            lines.length === 1 || f < secondStart
              ? centreY
              : lineIndex === 0
                ? centreY - secondLinePush(f, secondStart, travel)
                : centreY + travel;
          if (lineIndex > 0 && f < secondStart) return null;
          const start = lineStart(f, line, space, centreX);
          return words.map((word, index) => {
            const n = line.first + index;
            if (f < appearsAt(n)) return null;
            const width = line.widths[index] ?? 0;
            const ltrX = start + (offsets[index] ?? 0);
            return (
              <Word
                key={`${word}-${n}`}
                value={word}
                x={rtl ? 2 * centreX - ltrX - width : ltrX}
                y={middle - lineHeightPx / 2}
                fontSize={fit.fontSize}
                lineHeight={fit.lineHeight}
                color={colorOf(n)}
                style={shared}
              />
            );
          });
        })}
      </div>
    );

  return (
    <>
      <SceneMark placement={cornerMark(stage)} />
      <SeamLayer anchor="headline">{content}</SeamLayer>
    </>
  );
};

export const wordSlam = defineScene<WordSlamProps>({
  component: WordSlam,
  props: propsSchema,
  roles: { headline: { min: 1, max: 1 } },
  image: 'none',
  maxImages: 0,
  markAnchor: (stage) => cornerMark(stage),
  kind: 'type',
  ground: { 'neutral-cut': 'base', 'kinetic-plate': 'plate' },
  // The sentence block, with no exit velocity: the hook leaves by a dead stop.
  anchors: [
    {
      id: 'headline',
      box: (f, { stage, text, theme }) => {
        const value = text.find(({ role }) => role === 'headline')?.value ?? '';
        const fit = specFit(
          value,
          sentenceStyle,
          stage,
          { width: lineBox(stage), maxLines: 2 },
          theme.fonts,
        );
        return sentenceBox(fit, stage, f);
      },
    },
  ],
});
