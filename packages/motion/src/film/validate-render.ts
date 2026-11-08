import {
  type Campaign,
  type Issue,
  sceneRegistry,
  type ValidateOptions,
  validateCampaign,
} from '@boiler-room/schema';
import { IMPLEMENTED_SCENE_TYPES, renderSceneRegistry } from '../scenes/registry.ts';
import type { FilmIssue } from './validate-film.ts';

export type RenderValidation =
  | { ok: true; issues: (Issue | FilmIssue)[]; campaign: Campaign }
  | { ok: false; issues: (Issue | FilmIssue)[]; campaign: undefined };

const SCENE_TYPE_PATH = /^(scenes|variants\.hooks)\[(\d+)\]\.type$/;

/** The scene type at a `scenes[i].type` or `variants.hooks[i].type` path of the input. */
function typeAt(input: unknown, path: string): string | undefined {
  const match = SCENE_TYPE_PATH.exec(path);
  if (!match || typeof input !== 'object' || input === null) return undefined;
  const [, list, index] = match;
  const record = input as { scenes?: unknown; variants?: { hooks?: unknown } };
  const scenes = list === 'scenes' ? record.scenes : record.variants?.hooks;
  const scene = Array.isArray(scenes) ? (scenes[Number(index)] as unknown) : undefined;
  const type = (scene as { type?: unknown } | undefined)?.type;
  return typeof type === 'string' ? type : undefined;
}

/**
 * A scene type the scene library specifies but no template draws yet is not a typo, so it is not
 * reported as one: the issue names it as unbuilt and lists the types that render.
 */
function explainUnbuilt(issue: Issue, input: unknown): Issue | FilmIssue {
  if (issue.code !== 'SCENE_TYPE_UNKNOWN') return issue;
  const type = typeAt(input, issue.path);
  if (type === undefined || !Object.hasOwn(sceneRegistry, type)) return issue;
  return {
    code: 'SCENE_TYPE_UNBUILT',
    severity: 'error',
    path: issue.path,
    message: `Scene type "${type}" is in the scene library, but motion has no template for it yet, so it cannot be rendered.`,
    fix: `Change ${issue.path} to a type motion renders: ${IMPLEMENTED_SCENE_TYPES.join(', ')}. Or keep it and render once the ${type} template is built.`,
  };
}

/**
 * `validateCampaign` against the schema's scene registry restricted to the types motion renders.
 * It is the first check of every render, in `calculateMetadata` and in the render service, so a
 * campaign with a scene type that has no template is refused before anything is drawn.
 */
export async function validateForRender(
  input: unknown,
  options: Omit<ValidateOptions, 'sceneRegistry'> = {},
): Promise<RenderValidation> {
  const result = await validateCampaign(input, { ...options, sceneRegistry: renderSceneRegistry });
  const issues = result.issues.map((issue) => explainUnbuilt(issue, input));
  return result.ok
    ? { ok: true, issues, campaign: result.campaign }
    : { ok: false, issues, campaign: undefined };
}
