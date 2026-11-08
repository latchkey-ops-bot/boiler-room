import { type Campaign, type Issue, sceneFrames } from '@boiler-room/schema';
import { assetUrl } from '../brand/assets.ts';
import { type FontProbe, type FontRole, fontUrl, probeFont } from '../brand/fonts.ts';
import { resolveLogo } from '../brand/logo.ts';
import { probeImage } from '../brand/probe.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../layout/stage.ts';
import { ImageUnfit, type ImageView } from '../scenes/definition.ts';
import { definitionOf } from '../scenes/registry.ts';
import { type CutSelection, resolveCut } from './cut.ts';
import { type ImageSize, screenImageIds } from './media.ts';
import { type FilmPlan, planFilm } from './plan.ts';
import { type FilmIssue, validateFilm } from './validate-film.ts';
import { validateForRender } from './validate-render.ts';

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
  font: (url: string) => Promise<FontProbe>;
}

const browserProbe: MediaProbe = { image: probeImage, font: probeFont };

/**
 * Loads both brand fonts. Each render tab loads them again, but a font that fails there fails only
 * once the chunks render, which on Naive is after the computers exist and are billing.
 */
async function checkFonts(campaign: Campaign, probe: MediaProbe): Promise<FilmIssue[]> {
  const roles: FontRole[] = ['display', 'body'];
  const issues: FilmIssue[] = [];
  for (const role of roles) {
    const { family, source } = campaign.brand.fonts[role];
    const asset = Object.hasOwn(campaign.assets, source) ? campaign.assets[source] : undefined;
    const src = asset?.src ?? source;
    const seen = await probe.font(fontUrl(source, campaign));
    if (seen.loaded) continue;
    const path = asset ? `assets.${source}.src` : `brand.fonts.${role}.source`;
    issues.push({
      code: 'FONT_UNAVAILABLE',
      severity: 'error',
      path,
      message: `The ${role} font "${family}" could not be loaded from "${src}": ${seen.reason}`,
      fix: `Change ${path} to a WOFF2, WOFF, TTF or OTF file that loads, beside the campaign or at a URL served with CORS.`,
    });
  }
  return issues;
}

/** An image enlarged more than this, at the camera's closest, is visibly blurred. */
const MAX_UPSCALE = 1.5;
/** Outside these aspects a browser frame shows an image as a strip, such as a full-page capture. */
const MIN_ASPECT = 1 / 3;
const MAX_ASPECT = 4;

/**
 * Each scene image against how it is shown in this format: an image of a shape a browser frame
 * shows as a strip, one enlarged past what stays sharp, or one the template cannot show here, such
 * as a page too short to scroll, is refused with what to supply instead. Every image is checked,
 * so one refusal names every capture to replace. It needs only the images' sizes, so an agent can
 * run it on a campaign from the sizes its research recorded, before anything is loaded.
 */
export function checkImageFit(
  campaign: Campaign,
  format: Format,
  imageSizes: Record<string, ImageSize>,
): FilmIssue[] {
  const { width: stageWidth, height: stageHeight } = FORMAT_SIZES[format];
  const stage = stageFor(stageWidth, stageHeight);
  const { fps, scenes: frames } = sceneFrames(campaign);
  const issues = new Map<string, FilmIssue & { upscale: number }>();
  for (const [sceneIndex, scene] of campaign.scenes.entries()) {
    const definition = definitionOf(scene.type);
    if (!definition?.imageView) continue;
    const durationInFrames = frames[sceneIndex]?.durationInFrames ?? 0;
    for (const [index, id] of screenImageIds(scene, campaign).entries()) {
      const size = imageSizes[id];
      if (!size) continue;
      const path = `assets.${id}.src`;
      const aspect = size.width / size.height;
      const dimensions = `${size.width}×${size.height}`;
      if (aspect < MIN_ASPECT && definition.scrollsImages) {
        // A scrolled page is shown through a window, never whole, so it is a long capture: cut
        // from the top, its capture boxes still hold, and it is never cut to one screen.
        const lands = index > 0 ? ', keeping the CTA it lands on inside the crop' : '';
        issues.set(id, {
          code: 'IMAGE_WRONG_SHAPE',
          severity: 'error',
          path,
          message: `Image "${id}" is ${dimensions}, more than three times as tall as it is wide, the longest page a ${scene.type} scene scrolls.`,
          fix: `Crop it from the top of the page to at most ${Math.round(size.width / MIN_ASPECT)} px tall${lands}, so its ctaBox and targetY still hold, and point ${path} at the cropped file. Never crop it to one screen: the scroll needs more of the page than the frame shows.`,
          upscale: Number.POSITIVE_INFINITY,
        });
        continue;
      }
      if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) {
        issues.set(id, {
          code: 'IMAGE_WRONG_SHAPE',
          severity: 'error',
          path,
          message: `Image "${id}" is ${dimensions}, an aspect outside 1:3 to 4:1, so its browser frame would show it as a strip in which the product cannot be read.`,
          fix: `Crop it to the part that matters, such as one screen of a full-page capture, and point ${path} at the cropped file.`,
          upscale: Number.POSITIVE_INFINITY,
        });
        continue;
      }
      let view: ImageView;
      try {
        view = definition.imageView({
          props: definition.props.parse(scene.props),
          stage,
          image: { ...size, aspect },
          index,
          durationInFrames,
          fps,
        });
      } catch (error) {
        if (!(error instanceof ImageUnfit)) throw error;
        // Issues are keyed by image, so one image gets one; a props issue is keyed by its path.
        const inProps = error.code === 'PROPS_INVALID';
        const where = inProps
          ? `scenes[${sceneIndex}].props${error.propsPath ? `.${error.propsPath}` : ''}`
          : path;
        issues.set(inProps ? where : id, {
          code: error.code,
          severity: 'error',
          path: where,
          message: error.message,
          fix: error.fix,
          upscale: Number.POSITIVE_INFINITY,
        });
        continue;
      }
      const upscale = (view.width * view.zoom) / size.width;
      if (upscale <= MAX_UPSCALE || upscale <= (issues.get(id)?.upscale ?? 0)) continue;
      issues.set(id, {
        code: 'IMAGE_TOO_SMALL',
        severity: 'error',
        path,
        message: `Image "${id}" is ${dimensions}, and a ${scene.type} scene draws it ${Math.round(view.width)} px wide, scaled up to ${view.zoom.toFixed(2)}× in ${format}, enlarging it ${upscale.toFixed(1)} times, so it would look blurred.`,
        fix: `Supply a capture at least ${Math.ceil((view.width * view.zoom) / MAX_UPSCALE)} px wide at ${path}.`,
        upscale,
      });
    }
  }
  return [...issues.values()].map(({ upscale: _upscale, ...issue }) => issue);
}

/**
 * Gates and plans a film. The campaign is validated as written, then again as the one cut being
 * rendered, since choosing a hook or a CTA changes its copy. Nothing renders unless both pass.
 */
export async function prepareFilm(
  { campaign: input, format, hookId, ctaId }: FilmRequest,
  probe: MediaProbe = browserProbe,
): Promise<FilmPlan> {
  const written = await validateForRender(input);
  if (!written.ok) throw new FilmRejected('validateCampaign', written.issues);

  const selection = { hookId, ctaId };
  const filmIssues = validateFilm(written.campaign, format, selection);
  if (filmIssues.some(({ severity }) => severity === 'error')) {
    throw new FilmRejected('validateFilm', filmIssues);
  }

  const cut = await validateForRender(resolveCut(written.campaign, selection));
  if (!cut.ok) throw new FilmRejected('validateCampaign on the selected cut', cut.issues);
  const campaign = cut.campaign;

  const fontIssues = await checkFonts(campaign, probe);
  if (fontIssues.length > 0) throw new FilmRejected('loading the brand fonts', fontIssues);

  const imageIds = [
    ...new Set(campaign.scenes.flatMap((scene) => screenImageIds(scene, campaign))),
  ];
  const imageSizes: Record<string, ImageSize> = {};
  const unusable: FilmIssue[] = [];
  for (const id of imageIds) {
    const asset = campaign.assets[id];
    if (!asset) continue;
    const seen = await probe.image(assetUrl(asset.src));
    const path = `assets.${id}.src`;
    const reject = (code: FilmIssue['code'], message: string, fix: string) =>
      unusable.push({ code, severity: 'error', path, message, fix });
    if (!seen.loaded || !seen.width || !seen.height) {
      reject(
        'IMAGE_MISSING',
        `Image "${id}" could not be loaded from "${asset.src}".`,
        `Provide the file at "${asset.src}", or change ${path} to a file that exists.`,
      );
      continue;
    }
    if (seen.animated) {
      // An animated image plays on the browser's clock, so tabs and chunks would show other frames.
      reject(
        'IMAGE_ANIMATED',
        `Image "${id}" at "${asset.src}" is animated, and an animated image plays on the browser's clock rather than the film's, so two renders of one frame would differ.`,
        `Change ${path} to a still image, such as one frame of it saved as a PNG.`,
      );
    } else if (seen.animated === undefined) {
      reject(
        'IMAGE_UNREADABLE',
        `Image "${id}" at "${asset.src}" loaded, but its host does not let its bytes be read, so it cannot be checked to be a still image.`,
        `Save the file beside the campaign and point ${path} at it, or serve it with an Access-Control-Allow-Origin header.`,
      );
    }
    imageSizes[id] = { width: seen.width, height: seen.height };
  }
  if (unusable.length > 0) throw new FilmRejected('loading the scene images', unusable);
  const misfits = checkImageFit(campaign, format, imageSizes);
  if (misfits.length > 0) throw new FilmRejected('sizing the scene images', misfits);

  const logoAsset = campaign.assets[campaign.brand.logoAssetId];
  const logoSrc = logoAsset?.src ?? '';
  const seenLogo = logoAsset ? await probe.image(assetUrl(logoSrc)) : { loaded: false };
  const resolved = resolveLogo(seenLogo, logoSrc, campaign.brand.colors.background);
  // A raster logo is never drawn above its own pixels. An SVG scales without limit.
  const logo =
    resolved.kind === 'image' && logoAsset?.kind === 'image' && seenLogo.width
      ? { ...resolved, naturalWidth: seenLogo.width }
      : resolved;

  return planFilm({ campaign, format, logo, imageSizes });
}
