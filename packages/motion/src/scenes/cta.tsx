import { interpolate } from 'remotion';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import type { BrandTheme } from '../brand/theme.ts';
import { alongPath, ClickRing, Cursor, cursorPath } from '../components/cursor.tsx';
import { SceneBase, SceneMark } from '../components/scene-base.tsx';
import { type SceneProps, useScene } from '../components/scene-runtime.tsx';
import {
  type StackItem,
  type TextSpec,
  TextStack,
  useFit,
  useTextStyle,
} from '../components/text.tsx';
import { presence, springAt } from '../core/presence.ts';
import { bezier, framesFor } from '../core/time.ts';
import { ctaLayout } from '../layout/scenes.ts';
import type { Stage } from '../layout/stage.ts';
import { beat, duration, easing, spring, type as typography } from '../tokens.ts';
import { defineScene } from './definition.ts';

const propsSchema = z.strictObject({});

export type CtaProps = z.infer<typeof propsSchema>;

const buttonSpec: TextSpec = {
  font: 'body',
  weight: typography.weight.strong,
  lineHeight: typography.lineHeight.label,
  maxSize: 4.6,
  maxLines: 1,
  color: ({ colors }: BrandTheme) => colors.onPrimary,
};

export const ctaBeats = (durationInFrames: number) => ({
  cursorIn: Math.round(durationInFrames * beat.ctaCursorIn),
  press: Math.round(durationInFrames * beat.ctaPress),
});

const Button = ({ label, delay, stage }: { label: string; delay: number; stage: Stage }) => {
  const { colors, radius } = useBrand();
  const { frame, fps, durationInFrames, timing } = useScene();
  const { button: row } = ctaLayout(stage);
  const paddingX = stage.unit * 5;
  const paddingY = stage.unit * 2.4;
  const fit = useFit(label, buttonSpec, row.width - paddingX * 2, row.height - paddingY * 2);
  const style = useTextStyle(buttonSpec, fit);

  const width = fit.width + paddingX * 2;
  const height = fit.height + paddingY * 2;
  const left = row.x + (row.width - width) / 2;
  const top = row.y + (row.height - height) / 2;

  const beats = ctaBeats(durationInFrames);
  // The click lands in the padding after the label, so the resting cursor never covers a word.
  const target = { x: left + width - paddingX * 0.55, y: top + height * 0.68 };
  const start = { x: stage.width * 0.86, y: stage.height * 0.94 };
  const travelled = interpolate(frame, [beats.cursorIn, beats.press - 2], [0, 1], {
    easing: bezier(easing.standard),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const at = alongPath(cursorPath(start, target), travelled);
  const cursorOpacity = interpolate(frame, [beats.cursorIn - 1, beats.cursorIn + 6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const dip = interpolate(frame, [beats.press - 3, beats.press, beats.press + 4], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const landed = springAt(frame, fps, timing.text.enterAt + delay, spring.press);
  const ring = interpolate(
    frame,
    [beats.press, beats.press + framesFor(duration.moderate, fps)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const cursorSize = stage.unit * 5.5;

  return (
    <>
      <div
        style={{
          alignItems: 'center',
          background: colors.primary,
          borderRadius: radius,
          display: 'flex',
          height,
          justifyContent: 'center',
          left,
          opacity: presence(frame, { ...timing.text, enterAt: timing.text.enterAt + delay })
            .visible,
          position: 'absolute',
          top,
          transform: `scale(${(0.9 + landed * 0.1) * (1 - dip * 0.05)})`,
          width,
        }}
      >
        <div style={{ ...style, whiteSpace: 'pre' }}>{fit.lines.join(' ')}</div>
      </div>
      <ClickRing at={target} size={height} progress={ring} />
      <Cursor at={at} size={cursorSize} pressed={dip} opacity={cursorOpacity} />
    </>
  );
};

const Cta = ({ scene }: SceneProps<CtaProps>) => {
  const { stage, fps } = useScene();
  const layout = ctaLayout(stage);
  const copy = scene.text.filter(({ role }) => role !== 'cta') as StackItem[];
  const label = scene.text.find(({ role }) => role === 'cta')?.value;
  return (
    <SceneBase seed={scene.id}>
      <SceneMark placement={{ box: layout.mark, align: 'center' }} />
      <TextStack items={copy} rect={layout.text} align="center" kinetic />
      {label ? <Button label={label} delay={framesFor(duration.fast, fps)} stage={stage} /> : null}
    </SceneBase>
  );
};

export const cta = defineScene<CtaProps>({
  component: Cta,
  props: propsSchema,
  text: { headline: 48, subhead: 100, label: 40, cta: 30 },
  roles: {
    headline: { min: 1, max: 1 },
    subhead: { min: 0, max: 1 },
    label: { min: 0, max: 1 },
    cta: { min: 1, max: 1 },
  },
  image: 'none',
  markAnchor: (stage) => ({ box: ctaLayout(stage).mark, align: 'center' }),
});
