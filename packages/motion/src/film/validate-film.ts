import {
  type Campaign,
  type Issue,
  type Scene,
  TEXT_ROLES,
  type TextRole,
} from '@boiler-room/schema';
import type { Format } from '../layout/stage.ts';
import { definitionOf } from '../scenes/registry.ts';
import { isTransition, TRANSITIONS } from '../transitions/timeline.ts';
import type { CutSelection } from './cut.ts';
import { screenImageId } from './media.ts';

export const FILM_ISSUE_CODES = [
  'PROPS_INVALID',
  'TEXT_UNUSED',
  'TEXT_MISSING',
  'IMAGE_MISSING',
  'IMAGE_ANIMATED',
  'IMAGE_UNREADABLE',
  'FONT_UNAVAILABLE',
  'TRANSITION_UNKNOWN',
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

function checkProps(scene: Scene, path: string): FilmIssue[] {
  const definition = definitionOf(scene.type);
  if (!definition) return [];
  const parsed = definition.props.safeParse(scene.props);
  if (parsed.success) return [];
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
  if (definitionOf(scene.type)?.image !== 'required') return [];
  if (screenImageId(scene, campaign)) return [];
  return [
    error(
      'IMAGE_MISSING',
      `${path}.assetIds`,
      `${scene.type} shows the product, but ${path} lists no captured or uploaded image.`,
      `Add the id of an image asset with provenance "captured" or "uploaded" to ${path}.assetIds.`,
    ),
  ];
}

function checkTransition(scene: Scene, path: string, isLast: boolean): FilmIssue[] {
  const name = scene.transitionOut;
  if (name === undefined) return [];
  if (!isTransition(name)) {
    return [
      error(
        'TRANSITION_UNKNOWN',
        `${path}.transitionOut`,
        `Transition "${name}" does not exist.`,
        `Change ${path}.transitionOut to one of: ${TRANSITIONS.join(', ')}, or remove it for a cut.`,
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
        'Add a cta scene, or render without a CTA id.',
      ),
    );
  }
  return issues;
}

/**
 * The rules that only the templates know: props each template accepts, copy each one sets, the
 * images it needs, and transitions that exist. Run it on a campaign `validateCampaign` passed.
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
    ...checkSelection(campaign, format, selection),
  ];
}
