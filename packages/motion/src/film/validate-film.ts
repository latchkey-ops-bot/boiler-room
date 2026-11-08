import {
  type Campaign,
  type Issue,
  type Scene,
  TEXT_ROLES,
  type TextRole,
} from '@boiler-room/schema';
import type { Format } from '../layout/stage.ts';
import { definitionOf } from '../scenes/registry.ts';
import { isCatalogId, isTransition, TRANSITIONS } from '../transitions/catalog.ts';
import type { CutSelection } from './cut.ts';
import { screenImageId } from './media.ts';
import { filmSeams } from './seams.ts';

export const FILM_ISSUE_CODES = [
  'SCENE_TYPE_UNBUILT',
  'PROPS_INVALID',
  'TEXT_UNUSED',
  'TEXT_MISSING',
  'IMAGE_MISSING',
  'IMAGE_ANIMATED',
  'IMAGE_UNREADABLE',
  'IMAGE_TOO_SMALL',
  'IMAGE_WRONG_SHAPE',
  'FONT_UNAVAILABLE',
  'TRANSITION_UNKNOWN',
  'TRANSITION_UNBUILT',
  'TRANSITION_RESOLVED',
  'TRANSITION_UNUSED',
  'FORMAT_UNLISTED',
  'VARIANT_UNKNOWN',
  'VARIANT_UNUSED',
] as const;

export type FilmIssueCode = (typeof FILM_ISSUE_CODES)[number];

/** Shaped like a validator issue, for the rules only the templates know. */
export type FilmIssue = Omit<Issue, 'code'> & { code: FilmIssueCode };

const issue =
  (severity: FilmIssue['severity']) =>
  (code: FilmIssueCode, path: string, message: string, fix: string): FilmIssue => ({
    code,
    severity,
    path,
    message,
    fix,
  });
const error = issue('error');
const warning = issue('warning');

const scenesOf = (campaign: Campaign) => [
  ...campaign.scenes.map((scene, index) => ({ scene, path: `scenes[${index}]` })),
  ...campaign.variants.hooks.map((scene, index) => ({ scene, path: `variants.hooks[${index}]` })),
];

const wordsIn = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;

/** `props.accent` names a text item of its own scene, and words that the item has. */
function checkAccent(scene: Scene, path: string, accent: unknown): FilmIssue[] {
  if (typeof accent !== 'object' || accent === null) return [];
  const { textId, to } = accent as { textId: string; to: number };
  const where = `${path}.props.accent`;
  const item = scene.text.find(({ id }) => id === textId);
  if (!item) {
    return [
      error(
        'PROPS_INVALID',
        `${where}.textId`,
        `${where}.textId is "${textId}", which is not a text item of ${path}.`,
        `Change ${where}.textId to the id of one of ${path}.text: ${scene.text.map(({ id }) => id).join(', ')}.`,
      ),
    ];
  }
  const count = wordsIn(item.value);
  if (to <= count) return [];
  return [
    error(
      'PROPS_INVALID',
      `${where}.to`,
      `${where}.to is ${to}, but "${item.value}" has ${count} words.`,
      `Change ${where}.to to ${count} or less. Words are counted from 0, and the end is exclusive.`,
    ),
  ];
}

function checkProps(scene: Scene, path: string): FilmIssue[] {
  const definition = definitionOf(scene.type);
  if (!definition) return [];
  const parsed = definition.props.safeParse(scene.props);
  if (parsed.success) return checkAccent(scene, path, (parsed.data as { accent?: unknown }).accent);
  return parsed.error.issues.map((zodIssue) => {
    const where = [`${path}.props`, ...zodIssue.path.map(String)].join('.');
    return error(
      'PROPS_INVALID',
      where,
      `${where}: ${zodIssue.message}`,
      `Change ${where} so that the ${scene.type} template accepts it.`,
    );
  });
}

function checkRoles(scene: Scene, path: string): FilmIssue[] {
  const definition = definitionOf(scene.type);
  if (!definition) return [];
  const counts = new Map<TextRole, number>();
  for (const { role } of scene.text) counts.set(role, (counts.get(role) ?? 0) + 1);
  return TEXT_ROLES.flatMap((role) => {
    const count = counts.get(role) ?? 0;
    const { min, max } = definition.roles[role] ?? { min: 0, max: 0 };
    if (count > max) {
      const allowed = max === 0 ? 'no' : `at most ${max}`;
      return [
        error(
          'TEXT_UNUSED',
          `${path}.text`,
          `${path} has ${count} ${role} text items, but ${scene.type} sets ${allowed} ${role}, so the rest would never reach the screen.`,
          `Remove ${role} items from ${path}.text, or use a scene type that sets them.`,
        ),
      ];
    }
    if (count < min) {
      return [
        error(
          'TEXT_MISSING',
          `${path}.text`,
          `${path} has ${count} ${role} text items, but ${scene.type} needs at least ${min}.`,
          `Add a ${role} item to ${path}.text.`,
        ),
      ];
    }
    return [];
  });
}

function checkImage(scene: Scene, path: string, campaign: Campaign): FilmIssue[] {
  const definition = definitionOf(scene.type);
  if (!definition) return [];
  const parsed = definition.props.safeParse(scene.props);
  const needed =
    definition.image === 'required' ||
    (parsed.success && definition.imageNeeded?.(parsed.data) === true);
  if (!needed || screenImageId(scene, campaign)) return [];
  const why =
    definition.image === 'required'
      ? `${scene.type} shows the product`
      : `${scene.type} with these props shows a crop of the product`;
  return [
    error(
      'IMAGE_MISSING',
      `${path}.assetIds`,
      `${why}, but ${path} lists no captured or uploaded image.`,
      `Add the id of an image asset with provenance "captured" or "uploaded" to ${path}.assetIds.`,
    ),
  ];
}

function checkTransition(scene: Scene, path: string, isLast: boolean): FilmIssue[] {
  const name = scene.transitionOut;
  if (name === undefined) return [];
  if (!isCatalogId(name)) {
    return [
      error(
        'TRANSITION_UNKNOWN',
        `${path}.transitionOut`,
        `Transition "${name}" is not in the catalog: transitionOut is an id from t1 to t17.`,
        `Change ${path}.transitionOut to a catalog id. Motion draws ${TRANSITIONS.join(', ')}.`,
      ),
    ];
  }
  if (!isLast) return [];
  return [
    warning(
      'TRANSITION_UNUSED',
      `${path}.transitionOut`,
      `${path} is the last scene, so its transition has no scene to lead into.`,
      `Remove ${path}.transitionOut.`,
    ),
  ];
}

/**
 * Every boundary where the resolver plays something other than what was written, with both scene
 * ids, the id written and the id used. A catalog id with no build yet is reported as unbuilt. These
 * are warnings: the resolver's choice always renders.
 */
function checkSeams(campaign: Campaign): FilmIssue[] {
  if (campaign.scenes.some(({ transitionOut }) => transitionOut && !isCatalogId(transitionOut))) {
    return [];
  }
  return filmSeams(campaign).flatMap((seam) => {
    if (seam.reason === 'written' || (seam.reason === 'pinned' && seam.note === undefined)) {
      return [];
    }
    const path = `scenes[${seam.index}].transitionOut`;
    const between = `Between "${seam.from}" and "${seam.to}"`;
    const message =
      seam.written === undefined
        ? `${between} no transitionOut was written, so ${seam.used} plays.`
        : `${between}, "${seam.written}" was written and ${seam.used} plays: ${seam.note}.`;
    const unbuilt =
      seam.written !== undefined && isCatalogId(seam.written) && !isTransition(seam.written);
    return [
      warning(
        unbuilt ? 'TRANSITION_UNBUILT' : 'TRANSITION_RESOLVED',
        path,
        message,
        unbuilt
          ? `Write ${seam.used} at ${path}, or keep ${seam.written} and render it once it is built.`
          : `Write ${seam.used} at ${path}, so the film plays as written.`,
      ),
    ];
  });
}

function checkSelection(campaign: Campaign, format: Format, selection: CutSelection): FilmIssue[] {
  const { variants } = campaign;
  const issues: FilmIssue[] = [];
  if (!variants.formats.includes(format)) {
    issues.push(
      error(
        'FORMAT_UNLISTED',
        'variants.formats',
        `Format ${format} is not one this campaign lists.`,
        `Render one of: ${variants.formats.join(', ')}, or add ${format} to variants.formats.`,
      ),
    );
  }
  const { hookId, ctaId } = selection;
  if (hookId !== undefined && !variants.hooks.some(({ id }) => id === hookId)) {
    issues.push(
      error(
        'VARIANT_UNKNOWN',
        'variants.hooks',
        `Hook "${hookId}" is not in variants.hooks.`,
        `Choose one of: ${variants.hooks.map(({ id }) => id).join(', ') || 'no hooks exist'}.`,
      ),
    );
  }
  if (ctaId !== undefined && !variants.ctas.some(({ id }) => id === ctaId)) {
    issues.push(
      error(
        'VARIANT_UNKNOWN',
        'variants.ctas',
        `CTA "${ctaId}" is not in variants.ctas.`,
        `Choose one of: ${variants.ctas.map(({ id }) => id).join(', ') || 'no CTAs exist'}.`,
      ),
    );
  }
  const hasCtaText = campaign.scenes.some((scene) => scene.text.some(({ role }) => role === 'cta'));
  if (ctaId !== undefined && !hasCtaText) {
    issues.push(
      error(
        'VARIANT_UNUSED',
        'scenes',
        `CTA "${ctaId}" was chosen, but no scene has text with role "cta" for its label to replace.`,
        'Add an end-card scene with a cta text item, or render without a CTA id.',
      ),
    );
  }
  return issues;
}

/**
 * The rules that only the templates know: props each template accepts, copy each one sets, the
 * images it needs, transitions that are catalog ids, and what the seam resolver plays on each
 * boundary. Run it on a campaign `validateCampaign` passed.
 */
export function validateFilm(
  campaign: Campaign,
  format: Format,
  selection: CutSelection = {},
): FilmIssue[] {
  return [
    ...scenesOf(campaign).flatMap(({ scene, path }) => [
      ...checkProps(scene, path),
      ...checkRoles(scene, path),
      ...checkImage(scene, path, campaign),
      ...checkTransition(
        scene,
        path,
        path.startsWith('scenes[') && scene === campaign.scenes.at(-1),
      ),
    ]),
    ...checkSeams(campaign),
    ...checkSelection(campaign, format, selection),
  ];
}
