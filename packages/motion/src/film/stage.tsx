/**
 * The `Stage` of `docs/motion/reference-spec.md`, section 5: the parent of every scene. Its layers,
 * bottom to top, are the ground, the scenes, then transition overlays. The ground belongs to the
 * film, not to a scene, and runs on the film's clock, so a seam cuts the content and never the
 * ground. Scenes draw on a transparent background.
 */
import type { Scene } from '@boiler-room/schema';
import { useMemo } from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import { assetUrl } from '../brand/assets.ts';
import { useBrand } from '../brand/brand-context.tsx';
import type { BrandTheme } from '../brand/theme.ts';
import { Backdrop } from '../components/backdrop.tsx';
import { SceneRuntimeProvider } from '../components/scene-runtime.tsx';
import { specFrame } from '../core/curves.ts';
import type { Stage as StageSize } from '../layout/stage.ts';
import { anchorsOf, type Ground } from '../scenes/definition.ts';
import { definitionOf } from '../scenes/registry.ts';
import type { FilmPlan, ScenePlan } from './plan.ts';

/**
 * The ground at a film frame: the ground of the scene on screen. A ground change takes effect at
 * the seam, which is where every built transition switches it.
 */
export function groundAt(plan: Pick<FilmPlan, 'scenes'>, frame: number): Ground {
  let ground: Ground = plan.scenes[0]?.ground ?? 'base';
  for (const scene of plan.scenes) {
    if (scene.span.from <= frame) ground = scene.ground;
  }
  return ground;
}

/** The clock the ground drifts on: the film frame, stopped where the film holds still. */
export const groundClock = (plan: Pick<FilmPlan, 'stillFrom'>, frame: number): number =>
  Math.min(frame, plan.stillFrom);

const GroundLayer = ({ plan }: { plan: FilmPlan }) => {
  const frame = useCurrentFrame();
  return (
    <Backdrop
      seed={plan.campaign.id}
      clock={groundClock(plan, frame)}
      ground={groundAt(plan, frame)}
    />
  );
};

function useAnchorRequest(
  film: FilmPlan,
  scenePlan: ScenePlan,
  stage: StageSize,
  theme: BrandTheme,
) {
  const scene = film.campaign.scenes[scenePlan.index] as Scene;
  const definition = definitionOf(scene.type);
  if (!definition) throw new Error(`Scene type "${scene.type}" is not registered.`);
  return useMemo(() => {
    const props = definition.props.parse(scene.props);
    const request = {
      props,
      stage,
      theme,
      images: scenePlan.images.map(({ width, height }) => ({
        width,
        height,
        aspect: width / height,
      })),
      dur: specFrame(scenePlan.span.durationInFrames, film.fps),
      text: scene.text,
    };
    return { definition, props, anchors: anchorsOf(definition, request) };
  }, [definition, scene, scenePlan, stage, theme, film.fps]);
}

const SceneHost = ({
  film,
  plan,
  stage,
}: {
  film: FilmPlan;
  plan: ScenePlan;
  stage: StageSize;
}) => {
  const frame = useCurrentFrame() + plan.span.mountFrom - plan.span.from;
  const theme = useBrand();
  const scene = film.campaign.scenes[plan.index] as Scene;
  const { definition, props, anchors } = useAnchorRequest(film, plan, stage, theme);
  const before = film.scenes[plan.index - 1];
  const previous = useAnchorRequest(film, before ?? plan, stage, theme);
  const { in: incoming, out } = plan.span;
  const f = specFrame(frame, film.fps);
  const b = incoming?.blank ?? 0;

  // T5: the incoming scene draws the blink, so for its blank frames there is only the ground.
  if (f < b) return null;

  const carryFrom =
    incoming?.carry && before
      ? previous.anchors
          .find(({ id }) => id === incoming.carry)
          ?.box(specFrame(before.span.durationInFrames - 1, film.fps))
      : undefined;
  const images = plan.images.flatMap(({ assetId, width, height }) => {
    const asset = film.campaign.assets[assetId];
    return asset ? [{ src: assetUrl(asset.src), width, height, aspect: width / height }] : [];
  });
  const Component = definition.component;
  return (
    <SceneRuntimeProvider
      value={{
        frame,
        fps: film.fps,
        durationInFrames: plan.span.durationInFrames,
        from: plan.span.from,
        f,
        dur: specFrame(plan.span.durationInFrames, film.fps),
        b,
        stage,
        timing: plan.timing,
        images,
        image: images[0],
        in: incoming,
        out,
        anchors,
        carryFrom,
      }}
    >
      <Component scene={scene} props={props} />
    </SceneRuntimeProvider>
  );
};

/** The ground, then each scene mounted for its own frames, the later scene above the earlier. */
export const Stage = ({
  plan,
  stage,
  ready,
}: {
  plan: FilmPlan;
  stage: StageSize;
  ready: boolean;
}) => {
  const { colors } = useBrand();
  return (
    <AbsoluteFill style={{ background: colors.background, overflow: 'hidden' }}>
      <GroundLayer plan={plan} />
      {ready
        ? plan.scenes.map((scenePlan) => (
            <Sequence
              key={scenePlan.span.id}
              from={scenePlan.span.mountFrom}
              durationInFrames={scenePlan.span.mountFrames}
              name={`${scenePlan.span.id} (${scenePlan.span.in?.name ?? 'start'})`}
            >
              <AbsoluteFill>
                <SceneHost film={plan} plan={scenePlan} stage={stage} />
              </AbsoluteFill>
            </Sequence>
          ))
        : null}
    </AbsoluteFill>
  );
};
