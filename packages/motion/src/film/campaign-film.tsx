import { campaignSchema, FORMATS, type Scene } from '@boiler-room/schema';
import { useEffect, useMemo, useState } from 'react';
import {
  AbsoluteFill,
  type CalculateMetadataFunction,
  Sequence,
  useCurrentFrame,
  useDelayRender,
} from 'remotion';
import { z } from 'zod';
import { assetUrl } from '../brand/assets.ts';
import { BrandProvider } from '../brand/brand-context.tsx';
import { loadBrandFonts } from '../brand/fonts.ts';
import { resolveTheme } from '../brand/theme.ts';
import {
  type CarryElement,
  SceneRuntimeProvider,
  StageProvider,
} from '../components/scene-runtime.tsx';
import { type Stage, stageFor } from '../layout/stage.ts';
import { definitionOf } from '../scenes/registry.ts';
import { CarryOverlay } from '../transitions/carry.tsx';
import { pushProgress, pushStyle } from '../transitions/push.ts';
import { windowProgress } from '../transitions/timeline.ts';
import type { CarryPlan, FilmPlan, ScenePlan } from './plan.ts';
import { prepareFilm } from './prepare.ts';

export const campaignFilmSchema = z.object({
  campaign: campaignSchema,
  format: z.enum(FORMATS),
  hookId: z.string().optional(),
  ctaId: z.string().optional(),
  /** Set by `calculateMetadata`, which replaces anything passed in. Do not supply it. */
  plan: z.custom<FilmPlan>().optional(),
});

export type CampaignFilmProps = z.infer<typeof campaignFilmSchema>;

/**
 * Validates and plans the film before Remotion asks for a frame. `remotion render` and `remotion
 * still` both stop here when the campaign is rejected, because the `schema` prop is not a gate.
 */
export const calculateCampaignFilm: CalculateMetadataFunction<CampaignFilmProps> = async ({
  props,
}) => {
  const { campaign, format, hookId, ctaId } = props;
  const plan = await prepareFilm({ campaign, format, hookId, ctaId });
  return {
    durationInFrames: plan.durationInFrames,
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
    props: { ...props, plan },
  };
};

function useBrandFonts(campaign: FilmPlan['campaign']): boolean {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender('Loading the brand fonts'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadBrandFonts(campaign).then(() => setReady(true), cancelRender);
  }, [campaign, cancelRender]);
  useEffect(() => {
    if (ready) continueRender(handle);
  }, [ready, handle, continueRender]);
  return ready;
}

const inWindow = (frame: number, window: { from: number; to: number } | undefined) =>
  window !== undefined && frame >= window.from && frame < window.to;

function transitionStyle(plan: ScenePlan, filmFrame: number, stage: Stage) {
  const { in: incoming, out: outgoing } = plan.span;
  if (incoming && inWindow(filmFrame, incoming)) {
    if (incoming.name === 'push') return pushStyle(pushProgress(filmFrame, incoming), 'in', stage);
    return { opacity: windowProgress(filmFrame, incoming) };
  }
  if (outgoing?.name === 'push' && inWindow(filmFrame, outgoing)) {
    return pushStyle(pushProgress(filmFrame, outgoing), 'out', stage);
  }
  return {};
}

const SceneHost = ({
  plan,
  scene,
  film,
  stage,
}: {
  plan: ScenePlan;
  scene: Scene;
  film: FilmPlan;
  stage: Stage;
}) => {
  const filmFrame = useCurrentFrame() + plan.span.mountFrom;
  const definition = definitionOf(scene.type);
  if (!definition) throw new Error(`Scene type "${scene.type}" is not registered.`);
  const props = useMemo(() => definition.props.parse(scene.props), [definition, scene.props]);
  const images = plan.images.flatMap(({ assetId, width, height }) => {
    const asset = film.campaign.assets[assetId];
    return asset ? [{ src: assetUrl(asset.src), width, height, aspect: width / height }] : [];
  });
  const { in: incoming, out: outgoing } = plan.span;

  const overlayHides = (element: CarryElement['kind']) =>
    (plan.carriedIn?.kind === element && incoming !== undefined && filmFrame < incoming.to) ||
    (plan.carriedOut?.kind === element && outgoing !== undefined && filmFrame >= outgoing.from);

  const Component = definition.component;
  return (
    <AbsoluteFill style={transitionStyle(plan, filmFrame, stage)}>
      <SceneRuntimeProvider
        value={{
          frame: filmFrame - plan.span.from,
          fps: film.fps,
          durationInFrames: plan.span.durationInFrames,
          stage,
          timing: plan.timing,
          images,
          image: images[0],
          carriedIn: plan.carriedIn?.kind,
          carriedOut: plan.carriedOut?.kind,
          overlayHides,
        }}
      >
        <Component scene={scene} props={props} />
      </SceneRuntimeProvider>
    </AbsoluteFill>
  );
};

const Carry = ({ carry, film, stage }: { carry: CarryPlan; film: FilmPlan; stage: Stage }) => {
  const before = film.campaign.scenes[carry.outgoing] as Scene;
  const after = film.campaign.scenes[carry.incoming] as Scene;
  const marks = {
    from: definitionOf(before.type)?.markAnchor(stage),
    to: definitionOf(after.type)?.markAnchor(stage),
  };
  if (!marks.from || !marks.to) return null;
  const src =
    carry.element.kind === 'image' ? film.campaign.assets[carry.element.assetId]?.src : undefined;
  return (
    <CarryOverlay
      carry={carry}
      filmFrom={carry.window.from}
      imageSrc={src}
      marks={{ from: marks.from, to: marks.to }}
      stage={stage}
    />
  );
};

/**
 * One cut of a campaign in one format. Each scene is mounted for its own frames plus any frames a
 * transition shares with a neighbour, so transitions sit on the boundaries and the film keeps the
 * length `sceneFrames` gives it.
 */
export const CampaignFilm = ({ plan }: CampaignFilmProps) => {
  if (!plan) throw new Error('<CampaignFilm> renders only a plan from calculateCampaignFilm.');
  const theme = useMemo(() => resolveTheme(plan.campaign.brand, plan.logo), [plan]);
  const stage = useMemo(() => stageFor(plan.width, plan.height), [plan]);
  const ready = useBrandFonts(plan.campaign);
  return (
    <BrandProvider theme={theme}>
      <StageProvider value={stage}>
        <AbsoluteFill style={{ background: theme.colors.background, overflow: 'hidden' }}>
          {ready
            ? plan.scenes.map((scenePlan) => (
                <Sequence
                  key={scenePlan.span.id}
                  from={scenePlan.span.mountFrom}
                  durationInFrames={scenePlan.span.mountFrames}
                  name={scenePlan.span.id}
                >
                  <SceneHost
                    plan={scenePlan}
                    scene={plan.campaign.scenes[scenePlan.index] as Scene}
                    film={plan}
                    stage={stage}
                  />
                </Sequence>
              ))
            : null}
          {ready
            ? plan.carries.map((carry) => (
                <Sequence
                  key={`carry-${carry.window.boundary}`}
                  from={carry.window.from}
                  durationInFrames={carry.window.to - carry.window.from}
                  name={`carry ${carry.element.kind}`}
                >
                  <Carry carry={carry} film={plan} stage={stage} />
                </Sequence>
              ))
            : null}
        </AbsoluteFill>
      </StageProvider>
    </BrandProvider>
  );
};
