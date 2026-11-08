import { campaignSchema, FORMATS } from '@boiler-room/schema';
import { useEffect, useMemo, useState } from 'react';
import { type CalculateMetadataFunction, useDelayRender } from 'remotion';
import { z } from 'zod';
import { BrandProvider } from '../brand/brand-context.tsx';
import { loadBrandFonts } from '../brand/fonts.ts';
import { resolveTheme } from '../brand/theme.ts';
import { StageProvider } from '../components/scene-runtime.tsx';
import { stageFor } from '../layout/stage.ts';
import type { FilmPlan } from './plan.ts';
import { prepareFilm } from './prepare.ts';
import { Stage } from './stage.tsx';

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

/**
 * One cut of a campaign in one format, on the `Stage`. Each scene is mounted for its own frames,
 * and each transition is drawn inside the two scenes it joins, so the film keeps the length
 * `sceneFrames` gives it.
 */
export const CampaignFilm = ({ plan }: CampaignFilmProps) => {
  if (!plan) throw new Error('<CampaignFilm> renders only a plan from calculateCampaignFilm.');
  const theme = useMemo(() => resolveTheme(plan.campaign.brand, plan.logo), [plan]);
  const stage = useMemo(() => stageFor(plan.width, plan.height), [plan]);
  const ready = useBrandFonts(plan.campaign);
  return (
    <BrandProvider theme={theme}>
      <StageProvider value={stage}>
        <Stage plan={plan} stage={stage} ready={ready} />
      </StageProvider>
    </BrandProvider>
  );
};
