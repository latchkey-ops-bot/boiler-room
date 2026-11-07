import { type Issue, validateCampaign } from '@boiler-room/schema';
import { assetUrl } from '../brand/assets.ts';
import { resolveLogo } from '../brand/logo.ts';
import { probeImage } from '../brand/probe.ts';
import type { Format } from '../layout/stage.ts';
import { sceneRegistry } from '../scenes/registry.ts';
import { type CutSelection, resolveCut } from './cut.ts';
import { type ImageSize, screenImageId } from './media.ts';
import { type FilmPlan, planFilm } from './plan.ts';
import { type FilmIssue, validateFilm } from './validate-film.ts';

/** Thrown when a campaign may not be rendered. It lists every issue, with what to change. */
export class FilmRejected extends Error {
  readonly issues: (Issue | FilmIssue)[];

  constructor(stage: string, issues: (Issue | FilmIssue)[]) {
    const errors = issues.filter(({ severity }) => severity === 'error');
    const lines = errors.map(
      ({ code, path, message, fix }) => `- ${code} at ${path}: ${message} ${fix}`,
    );
    super(
      `This campaign cannot be rendered: ${stage} found ${errors.length} error(s).\n${lines.join('\n')}`,
    );
    this.name = 'FilmRejected';
    this.issues = issues;
  }
}

export interface FilmRequest extends CutSelection {
  campaign: unknown;
  format: Format;
}

/** What the browser reports about the files a film draws. Tests pass their own. */
export interface MediaProbe {
  image: (url: string) => ReturnType<typeof probeImage>;
}

const browserProbe: MediaProbe = { image: probeImage };

/**
 * Gates and plans a film. The campaign is validated as written, then again as the one cut being
 * rendered, since choosing a hook or a CTA changes its copy. Nothing renders unless both pass.
 */
export async function prepareFilm(
  { campaign: input, format, hookId, ctaId }: FilmRequest,
  probe: MediaProbe = browserProbe,
): Promise<FilmPlan> {
  const written = await validateCampaign(input, { sceneRegistry });
  if (!written.ok) throw new FilmRejected('validateCampaign', written.issues);

  const selection = { hookId, ctaId };
  const filmIssues = validateFilm(written.campaign, format, selection);
  if (filmIssues.some(({ severity }) => severity === 'error')) {
    throw new FilmRejected('validateFilm', filmIssues);
  }

  const cut = await validateCampaign(resolveCut(written.campaign, selection), { sceneRegistry });
  if (!cut.ok) throw new FilmRejected('validateCampaign on the selected cut', cut.issues);
  const campaign = cut.campaign;

  const imageIds = [
    ...new Set(campaign.scenes.flatMap((scene) => screenImageId(scene, campaign) ?? [])),
  ];
  const imageSizes: Record<string, ImageSize> = {};
  const missing: FilmIssue[] = [];
  for (const id of imageIds) {
    const asset = campaign.assets[id];
    if (!asset) continue;
    const seen = await probe.image(assetUrl(asset.src));
    if (seen.loaded && seen.width && seen.height) {
      imageSizes[id] = { width: seen.width, height: seen.height };
    } else {
      missing.push({
        code: 'IMAGE_MISSING',
        severity: 'error',
        path: `assets.${id}.src`,
        message: `Image "${id}" could not be loaded from "${asset.src}".`,
        fix: `Provide the file at "${asset.src}", or change assets.${id}.src to a file that exists.`,
      });
    }
  }
  if (missing.length > 0) throw new FilmRejected('loading the scene images', missing);

  const logoAsset = campaign.assets[campaign.brand.logoAssetId];
  const logoSrc = logoAsset?.src ?? '';
  const logo = resolveLogo(
    logoAsset ? await probe.image(assetUrl(logoSrc)) : { loaded: false },
    logoSrc,
    campaign.brand.colors.background,
  );

  return planFilm({ campaign, format, logo, imageSizes });
}
