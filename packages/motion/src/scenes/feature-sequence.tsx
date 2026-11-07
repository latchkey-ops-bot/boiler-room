import { interpolate, interpolateColors } from 'remotion';
import { z } from 'zod';
import { useBrand } from '../brand/brand-context.tsx';
import { BrowserFrame } from '../components/browser-frame.tsx';
import { cornerMark, SceneBase, SceneMark } from '../components/scene-base.tsx';
import { type SceneProps, useScene } from '../components/scene-runtime.tsx';
import {
  RiseIn,
  type StackItem,
  type TextSpec,
  TextStack,
  textSpecs,
  useFits,
  useTextStyle,
} from '../components/text.tsx';
import { lerpPose, type Point, type Pose, poseAt, WHOLE_IMAGE } from '../core/camera.ts';
import { presence, type SceneTiming, springAt } from '../core/presence.ts';
import { activeStep, type Step, stepWindows } from '../core/steps.ts';
import { bezier, framesFor, lerp } from '../core/time.ts';
import { split } from '../layout/rect.ts';
import { featureLayout } from '../layout/scenes.ts';
import { camera, duration, easing, travel } from '../tokens.ts';
import { defineScene } from './definition.ts';

const fraction = z.number().min(0).max(1);

const propsSchema = z.strictObject({
  /** Where the camera goes for each feature. It loops if there are fewer stops than features. */
  stops: z
    .array(
      z.strictObject({
        x: fraction,
        y: fraction,
        zoom: z.number().min(1).max(3).optional(),
      }),
    )
    .min(1)
    .optional(),
});

export type FeatureSequenceProps = z.infer<typeof propsSchema>;

type Stop = Point & { zoom?: number | undefined };

const DEFAULT_STOPS: Stop[] = [
  { x: 0.3, y: 0.35 },
  { x: 0.7, y: 0.4 },
  { x: 0.5, y: 0.7 },
];

/** The frames each feature has the stage. */
export function featureSteps(count: number, timing: SceneTiming): Step[] {
  const { enterAt, enterFrames, exitAt } = timing.text;
  return stepWindows(count, enterAt + enterFrames, exitAt);
}

/** Pose at each step's midpoint, so the camera is already on its subject as the step is read. */
export function featurePose(
  frame: number,
  steps: readonly Step[],
  { stops }: FeatureSequenceProps,
): Pose {
  const route: Stop[] = stops ?? DEFAULT_STOPS;
  const poses = [
    { at: 0, pose: WHOLE_IMAGE },
    ...steps.map(({ from, to }, index) => {
      const stop = route[index % route.length] as Stop;
      return { at: (from + to) / 2, pose: poseAt(stop, stop.zoom ?? camera.defaultZoom) };
    }),
  ];
  const next = poses.findIndex(({ at }) => frame < at);
  if (next === -1) return (poses[poses.length - 1] as (typeof poses)[number]).pose;
  if (next === 0) return WHOLE_IMAGE;
  const [before, after] = [poses[next - 1], poses[next]] as [
    (typeof poses)[number],
    (typeof poses)[number],
  ];
  const t = interpolate(frame, [before.at, after.at], [0, 1], {
    easing: bezier(easing.expressive),
  });
  return lerpPose(before.pose, after.pose, t);
}

const FeatureRow = ({
  lines,
  spec,
  fit,
  step,
  frame,
  active,
}: {
  lines: string[];
  spec: TextSpec;
  fit: { fontSize: number; height: number };
  step: Step;
  frame: number;
  active: number;
}) => {
  const { colors } = useBrand();
  const { stage } = useScene();
  const style = useTextStyle(spec, fit);
  const filled = interpolate(frame, [step.from, step.to], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const bar = stage.unit * 0.5;
  return (
    <div style={{ display: 'flex', gap: stage.unit * 2.4 }}>
      <div
        style={{
          background: colors.hairline,
          borderRadius: bar,
          flexShrink: 0,
          overflow: 'hidden',
          position: 'relative',
          width: bar,
        }}
      >
        <div
          style={{
            background: colors.primary,
            height: `${filled * 100}%`,
            left: 0,
            position: 'absolute',
            right: 0,
            top: 0,
          }}
        />
      </div>
      <div
        style={{
          ...style,
          color: interpolateColors(active, [0, 1], [colors.muted, colors.foreground]),
        }}
      >
        {lines.map((line) => (
          <div key={line} style={{ whiteSpace: 'pre' }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};

const FeatureSequence = ({ scene, props }: SceneProps<FeatureSequenceProps>) => {
  const { frame, fps, stage, timing, image, carriedIn, overlayHides } = useScene();
  const layout = featureLayout(stage, image?.aspect);
  const headline = scene.text.filter(({ role }) => role === 'headline') as StackItem[];
  const features = scene.text.filter(({ role }) => role !== 'headline');
  const steps = featureSteps(features.length, timing);

  const specs = textSpecs(stage);
  const portrait = stage.orientation !== 'landscape';
  const ratio = features.length === 0 ? 1 : portrait ? 0.3 : 0.42;
  const gap = stage.unit * 3;
  const [head, list] = split(layout.text, 'y', ratio, gap);
  const rowGap = stage.unit * 2.2;
  const rowWidth = list.width - stage.unit * 3;
  const rowHeight =
    (list.height - rowGap * Math.max(0, features.length - 1)) / Math.max(1, features.length);
  const rowSpec = specs.body;
  const fits = useFits(
    features.map(({ value }) => value),
    rowSpec,
    rowWidth,
    rowHeight,
  );
  const current = activeStep(frame, steps);

  const arrived = carriedIn === 'image';
  const opened = arrived ? 1 : springAt(frame, fps, timing.container.enterAt);
  const { exit, enter } = presence(frame, timing.container);
  const pose = featurePose(frame, steps, props);
  const settle = framesFor(duration.moderate, fps);

  return (
    <SceneBase seed={scene.id}>
      <SceneMark placement={cornerMark(stage)} />
      {image && layout.media && !overlayHides('image') ? (
        <BrowserFrame
          rect={layout.media}
          src={image.src}
          pose={pose}
          style={{
            opacity: (arrived ? 1 : enter) * (1 - exit),
            transform: `translateY(${(1 - opened) * travel.container * stage.unit}px) scale(${lerp(
              camera.startScale,
              1,
              opened,
            )})`,
          }}
        />
      ) : null}
      <TextStack items={headline} rect={head} align="left" justify="flex-end" />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: rowGap,
          left: list.x,
          position: 'absolute',
          top: list.y,
          width: list.width,
        }}
      >
        {features.map(({ id }, index) => {
          const step = steps[index] as Step;
          const fit = fits[index];
          if (!fit) return null;
          const lit = interpolate(
            frame,
            [step.from - 1, step.from + settle / 2, step.to - 1, step.to + settle / 2],
            [0, 1, 1, index === features.length - 1 ? 1 : 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );
          return (
            <RiseIn key={id} window={{ ...timing.text, enterAt: step.from, enterFrames: settle }}>
              <FeatureRow
                lines={fit.lines}
                spec={rowSpec}
                fit={fit}
                step={step}
                frame={frame}
                active={index === current ? lit : Math.min(lit, 0.6)}
              />
            </RiseIn>
          );
        })}
      </div>
    </SceneBase>
  );
};

export const featureSequence = defineScene<FeatureSequenceProps>({
  component: FeatureSequence,
  props: propsSchema,
  text: { headline: 48, subhead: 72, body: 72, label: 40 },
  roles: {
    headline: { min: 1, max: 1 },
    subhead: { min: 0, max: 4 },
    body: { min: 0, max: 4 },
    label: { min: 0, max: 4 },
  },
  image: 'optional',
  imageAnchor: ({ stage, imageAspect, props, timing, frame, featureCount }) => ({
    rect: featureLayout(stage, imageAspect).media as NonNullable<
      ReturnType<typeof featureLayout>['media']
    >,
    pose: featurePose(frame, featureSteps(featureCount, timing), props),
  }),
  markAnchor: (stage) => cornerMark(stage),
});
