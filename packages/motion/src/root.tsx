import type { Campaign } from '@boiler-room/schema';
import nova from '@boiler-room/schema/examples/nova.campaign.json' with { type: 'json' };
import { Composition, registerRoot } from 'remotion';
import {
  CampaignFilm,
  type CampaignFilmProps,
  CopyFit,
  calculateCampaignFilm,
  calculateCopyFit,
  campaignFilmSchema,
  copyFitSchema,
} from './film/campaign-film.tsx';
import { FORMAT_SIZES } from './layout/stage.ts';

const defaults: CampaignFilmProps = { campaign: nova as Campaign, format: '16:9' };

/**
 * The width, height, fps and length below are placeholders that `calculateMetadata` replaces.
 * `CopyFit` is the copy check alone, which the crew selects before a script is approved.
 */
export const Root = () => (
  <>
    <Composition
      id="CampaignFilm"
      component={CampaignFilm}
      schema={campaignFilmSchema}
      defaultProps={defaults}
      calculateMetadata={calculateCampaignFilm}
      fps={30}
      durationInFrames={1}
      {...FORMAT_SIZES['16:9']}
    />
    <Composition
      id="CopyFit"
      component={CopyFit}
      schema={copyFitSchema}
      defaultProps={defaults}
      calculateMetadata={calculateCopyFit}
      fps={30}
      durationInFrames={1}
      {...FORMAT_SIZES['16:9']}
    />
  </>
);

registerRoot(Root);
