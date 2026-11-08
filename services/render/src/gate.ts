/**
 * The gate a campaign passes before anything is bundled or a computer is created. It runs the same
 * three checks as `<CampaignFilm>`'s `calculateMetadata`, in the same order, and throws the same
 * `FilmRejected` with every issue and its fix. Remotion's `schema` prop does not stop a render, so
 * nothing here relies on it.
 *
 * The checks `calculateMetadata` makes after these, that both brand fonts load and every scene
 * image loads and is still, need a browser. They run when the film is selected from the bundle,
 * which still happens before any computer exists.
 */
import {
  type FilmIssue,
  FilmRejected,
  type Format,
  resolveCut,
  sceneRegistry,
  validateFilm,
} from '@boiler-room/motion';
import { type Campaign, FORMATS, type Issue, validateCampaign } from '@boiler-room/schema';

export interface CutRequest {
  format: Format;
  hookId?: string | undefined;
  ctaId?: string | undefined;
}

export interface GatedCampaign {
  /** The campaign as written, validated. */
  campaign: Campaign;
  /** The one cut being rendered, with its hook and CTA resolved, validated again. */
  cut: Campaign;
  /** Warnings from every stage. Errors never get this far. */
  warnings: (Issue | FilmIssue)[];
}

const errorsIn = (issues: { severity: string }[]) =>
  issues.some(({ severity }) => severity === 'error');

export async function gateCampaign(input: unknown, request: CutRequest): Promise<GatedCampaign> {
  if (!(FORMATS as readonly string[]).includes(request.format)) {
    throw new RangeError(`Format "${request.format}" is not one of ${FORMATS.join(', ')}.`);
  }
  const written = await validateCampaign(input, { sceneRegistry });
  if (!written.ok) throw new FilmRejected('validateCampaign', written.issues);

  const selection = { hookId: request.hookId, ctaId: request.ctaId };
  const filmIssues = validateFilm(written.campaign, request.format, selection);
  if (errorsIn(filmIssues)) throw new FilmRejected('validateFilm', filmIssues);

  const cut = await validateCampaign(resolveCut(written.campaign, selection), { sceneRegistry });
  if (!cut.ok) throw new FilmRejected('validateCampaign on the selected cut', cut.issues);

  const warnings = [...written.issues, ...filmIssues, ...cut.issues].filter(
    ({ severity }) => severity === 'warning',
  );
  return { campaign: written.campaign, cut: cut.campaign, warnings };
}
