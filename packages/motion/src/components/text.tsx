import type { TextItem, TextRole } from '@boiler-room/schema';
import { fitTextOnNLines, measureText } from '@remotion/layout-utils';
import { type CSSProperties, type ReactNode, useMemo } from 'react';
import { useBrand } from '../brand/brand-context.tsx';
import type { BrandTheme } from '../brand/theme.ts';
import { type PresenceWindow, presence, springAt } from '../core/presence.ts';
import { staggerDelays } from '../core/stagger.ts';
import { textDirection, wordMarks } from '../layout/bidi.ts';
import { type FitResult, fitBlock } from '../layout/fit.ts';
import type { Rect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import { spring as springs, stagger, travel, type as typography } from '../tokens.ts';
import { useScene, useStage } from './scene-runtime.tsx';

export interface TextSpec {
  font: 'display' | 'body';
  weight: number;
  lineHeight: number;
  /** Stage units. */
  maxSize: number;
  maxLines: number;
  letterSpacing?: string;
  upperCase?: boolean;
  color: (theme: BrandTheme) => string;
}

/** Keeps the measured width just inside the box, since words are measured apart from each other. */
const WIDTH_MARGIN = 0.985;

function measurer(
  text: string,
  fontFamily: string,
  spec: TextSpec,
  maxWidth: number,
  maxSize: number,
) {
  const shared = {
    fontFamily,
    fontWeight: spec.weight,
    letterSpacing: spec.letterSpacing,
    textTransform: spec.upperCase ? ('uppercase' as const) : undefined,
    validateFontIsLoaded: true,
  };
  return {
    fitLines: (maxLines: number) =>
      fitTextOnNLines({ ...shared, text, maxLines, maxBoxWidth: maxWidth, maxFontSize: maxSize }),
    widthOf: (line: string, fontSize: number) =>
      measureText({ ...shared, text: line, fontSize }).width,
  };
}

/** Fits text to a box with `@remotion/layout-utils`. Fonts are loaded before any scene mounts. */
function fitText(
  text: string,
  fontFamily: string,
  spec: TextSpec,
  { width, height, unit }: { width: number; height: number; unit: number },
): FitResult {
  const maxWidth = width * WIDTH_MARGIN;
  const maxSize = spec.maxSize * unit;
  return fitBlock(
    {
      text,
      maxWidth,
      maxHeight: height,
      maxSize,
      maxLines: spec.maxLines,
      lineHeight: spec.lineHeight,
    },
    measurer(text, fontFamily, spec, maxWidth, maxSize),
  );
}

/** Fits several texts to one size, so that a list reads as one thing. */
export function useFits(
  texts: readonly string[],
  spec: TextSpec,
  width: number,
  height: number,
): FitResult[] {
  const { fonts } = useBrand();
  const { unit } = useStage();
  const fontFamily = fonts[spec.font];
  const key = texts.join('\n');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the contents of `texts`.
  return useMemo(() => {
    const box = { width, height, unit };
    const fits = texts.map((text) => fitText(text, fontFamily, spec, box));
    const fontSize = Math.min(...fits.map((fit) => fit.fontSize));
    return fits.map((fit) => ({
      ...fit,
      fontSize,
      height: fontSize * spec.lineHeight * fit.lines.length,
      width: fit.width * (fontSize / Math.max(1, fit.fontSize)),
    }));
  }, [key, spec, width, height, unit, fontFamily]);
}

export function useFit(text: string, spec: TextSpec, width: number, height: number): FitResult {
  const [fit] = useFits([text], spec, width, height);
  return fit as FitResult;
}

/** The CSS of a text block, once it is fitted. */
export function useTextStyle(
  spec: TextSpec,
  fit: Pick<FitResult, 'fontSize' | 'height'>,
): CSSProperties {
  const theme = useBrand();
  return {
    color: spec.color(theme),
    fontFamily: theme.fonts[spec.font],
    fontKerning: 'normal',
    fontSize: fit.fontSize,
    fontWeight: spec.weight,
    height: fit.height,
    letterSpacing: spec.letterSpacing,
    lineHeight: spec.lineHeight,
    textTransform: spec.upperCase ? 'uppercase' : undefined,
  };
}

const delayed = (window: PresenceWindow, delay: number): PresenceWindow => ({
  ...window,
  enterAt: window.enterAt + delay,
});

interface LinesProps {
  lines: readonly string[];
}

const Lines = ({ lines }: LinesProps) =>
  lines.map((line) => (
    <div key={line} style={{ whiteSpace: 'pre' }}>
      {line}
    </div>
  ));

/** Words rise out of a mask one after another, each on its own spring. */
export const WordReveal = ({
  text,
  spec,
  fit,
  window,
}: {
  text: string;
  spec: TextSpec;
  fit: FitResult;
  window: PresenceWindow;
}) => {
  const { frame, fps } = useScene();
  const style = useTextStyle(spec, fit);
  const delays = staggerDelays(text.split(' ').length, fps, { each: stagger.word });
  const { exit } = presence(frame, window);
  // Each word is a box, which the line orders by the line's direction alone, so the line reads in
  // the copy's direction and each box carries marks of its own: Hebrew stays right to left, and a
  // Latin name inside it left to right.
  const direction = textDirection(text);
  let word = -1;
  return (
    <div style={{ ...style, direction, opacity: 1 - exit }}>
      {fit.lines.map((line) => {
        const tokens = line.split(' ');
        const marks = wordMarks(tokens, direction);
        return (
          <div key={line} style={{ whiteSpace: 'pre' }}>
            {tokens.map((token, index) => {
              word += 1;
              const landed = springAt(
                frame,
                fps,
                window.enterAt + (delays[word] ?? 0),
                springs.word,
              );
              const mark = marks[index] ?? '';
              return (
                <span key={`${token}-${word}`}>
                  {index > 0 ? ' ' : ''}
                  {mark}
                  <span
                    style={{
                      clipPath: 'inset(-25% -12% -14% -12%)',
                      display: 'inline-block',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        transform: `translateY(${(1 - landed) * 120}%)`,
                      }}
                    >
                      {token}
                    </span>
                  </span>
                  {mark}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

/** A block that rises and fades in as one. */
export const RiseIn = ({
  window,
  delay = 0,
  children,
  style,
}: {
  window: PresenceWindow;
  delay?: number;
  children: ReactNode;
  style?: CSSProperties;
}) => {
  const { frame, stage } = useScene();
  const { enter, visible } = presence(frame, delayed(window, delay));
  return (
    <div
      style={{
        ...style,
        opacity: visible,
        transform: `translateY(${(1 - enter) * travel.text * stage.unit}px)`,
      }}
    >
      {children}
    </div>
  );
};

export const RiseText = ({
  spec,
  fit,
  window,
  delay,
}: {
  spec: TextSpec;
  fit: FitResult;
  window: PresenceWindow;
  delay?: number;
}) => {
  const style = useTextStyle(spec, fit);
  // Plain text is ordered by the browser, but its paragraph still needs the copy's direction, or
  // the punctuation at the end of a Hebrew or Arabic line sits at the wrong end.
  const direction = textDirection(fit.lines.join(' '));
  return (
    <RiseIn window={window} delay={delay ?? 0} style={{ ...style, direction }}>
      <Lines lines={fit.lines} />
    </RiseIn>
  );
};

const headlineSize: Record<Stage['orientation'], number> = {
  landscape: 12.5,
  portrait: 13,
  square: 12,
};

/** The style of each role of copy. Scenes change a size, and never a colour or a font. */
export const textSpecs = (stage: Stage): Record<Exclude<TextRole, 'cta'>, TextSpec> => ({
  headline: {
    font: 'display',
    weight: typography.weight.display,
    lineHeight: typography.lineHeight.display,
    maxSize: headlineSize[stage.orientation],
    maxLines: stage.orientation === 'landscape' ? 3 : 4,
    letterSpacing: typography.tracking.display,
    color: ({ colors }) => colors.foreground,
  },
  subhead: {
    font: 'body',
    weight: typography.weight.body,
    lineHeight: typography.lineHeight.body,
    maxSize: 4.2,
    maxLines: 3,
    color: ({ colors }) => colors.muted,
  },
  body: {
    font: 'body',
    weight: typography.weight.body,
    lineHeight: typography.lineHeight.body,
    maxSize: 3.8,
    maxLines: 4,
    color: ({ colors }) => colors.foreground,
  },
  label: {
    font: 'body',
    weight: typography.weight.strong,
    lineHeight: typography.lineHeight.label,
    maxSize: 3.2,
    maxLines: 2,
    letterSpacing: typography.tracking.label,
    upperCase: true,
    color: ({ colors }) => colors.primary,
  },
});

/** How much of a column each role may fill, against the others. */
const HEIGHT_SHARE: Record<TextRole, number> = {
  headline: 1,
  subhead: 0.32,
  body: 0.32,
  label: 0.16,
  cta: 0.2,
};

export type StackItem = TextItem & { role: Exclude<TextRole, 'cta'> };

const ItemText = ({
  item,
  spec,
  width,
  height,
  kinetic,
  window,
  delay,
}: {
  item: StackItem;
  spec: TextSpec;
  width: number;
  height: number;
  kinetic: boolean;
  window: PresenceWindow;
  delay: number;
}) => {
  const fit = useFit(item.value, spec, width, height);
  if (kinetic) return <WordReveal text={item.value} spec={spec} fit={fit} window={window} />;
  return <RiseText spec={spec} fit={fit} window={window} delay={delay} />;
};

export interface TextStackProps {
  items: readonly StackItem[];
  rect: Rect;
  align: 'left' | 'center';
  justify?: 'flex-start' | 'center' | 'flex-end';
  /** Sets the headline with `WordReveal`. Otherwise it rises like everything else. */
  kinetic?: boolean;
  /** Replaces a role's size or line count for this scene. */
  overrides?: Partial<Record<StackItem['role'], Partial<TextSpec>>>;
}

/**
 * Sets copy in the order the campaign gives it. Each item is fitted into a share of the column, so
 * the stack cannot outgrow its box however long the copy is.
 */
export const TextStack = ({
  items,
  rect,
  align,
  justify = 'center',
  kinetic = false,
  overrides,
}: TextStackProps) => {
  const { stage, timing, fps } = useScene();
  const specs = useMemo(() => textSpecs(stage), [stage]);
  const gap = stage.unit * 2.4;
  const shares = items.reduce((sum, { role }) => sum + HEIGHT_SHARE[role], 0);
  const available = rect.height - gap * Math.max(0, items.length - 1);
  const delays = staggerDelays(items.length, fps);
  return (
    <div
      style={{
        alignItems: align === 'center' ? 'center' : 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        gap,
        height: rect.height,
        justifyContent: justify,
        left: rect.x,
        position: 'absolute',
        textAlign: align,
        top: rect.y,
        width: rect.width,
      }}
    >
      {items.map((item, index) => (
        <ItemText
          key={item.id}
          item={item}
          spec={{ ...specs[item.role], ...overrides?.[item.role] }}
          width={rect.width}
          height={(available * HEIGHT_SHARE[item.role]) / shares}
          kinetic={kinetic && item.role === 'headline'}
          window={timing.text}
          delay={delays[index] ?? 0}
        />
      ))}
    </div>
  );
};
