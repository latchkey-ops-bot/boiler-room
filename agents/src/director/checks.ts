import {
  type Campaign,
  campaignSchema,
  extractNumericTokens,
  type Issue,
  isBacked,
  type Scene,
  sceneRegistry,
  superlativeForms,
  type TextItem,
  toFrame,
  validateCampaign,
} from '@boiler-room/schema';
import type { ResearchOutput } from '../researcher/output.ts';
import { normaliseUrl } from '../researcher/text.ts';
import { canonicalJson } from '../sync.ts';
import { type DirectorBrief, directorOutputSchema, type Handoff } from './output.ts';
import { frameSeconds, PROOF_TYPES, rowStarts, type Template, templateFor } from './templates.ts';

/** Who must act on an issue. Only the Director's own issues are sent back to it. */
export type Owner = 'director' | 'art-director' | 'researcher';

export interface DirectorIssue {
  code: string;
  severity: 'error' | 'warning';
  path: string;
  message: string;
  fix: string;
  owner: Owner;
}

/** What the pipeline can count in the research without judgement, and tells the Director. */
export interface ResearchFacts {
  host: string;
  claims: number;
  approvedClaimIds: string[];
  /** Claims whose quote states a number, a percentage, a multiplier or a money amount. */
  numericClaimIds: string[];
  /** Distinct captured pages with a screenshot. Two crops of one page are one surface. */
  surfaces: string[];
  /** Captured images from the customer's own site, which `tile-wall` can use. */
  capturedTiles: number;
}

const FPS = 30;

/**
 * Superlatives Director policy adds to the ones `validateCampaign` warns on (`SUPERLATIVE_WORDS`).
 * Uncited, the validator's own are reported by the validator; Director policy makes them errors.
 */
const DIRECTOR_SUPERLATIVES = 'most\\s+powerful|world-class';

/**
 * A quote that states a number as an aim, not a fact: "Our mission is to connect a billion people
 * by 2031". Copy may repeat the number only as the goal it is.
 */
const GOAL =
  /\b(?:mission|goals?|aims?|aiming|ambitions?|vision|strives?|striving|plans? to|hopes? to|want to|wants to|on track to|by (?:19|20)\d\d)\b/i;

/** Validator codes the Director fixes. `CONTRAST_LOW` and `ASSET_UNAVAILABLE` belong to others. */
const DIRECTOR_CODES = new Set([
  'SCHEMA_INVALID',
  'SCENE_TIMING',
  'ASSET_UNDECLARED',
  'CLAIM_UNKNOWN',
  'CLAIM_UNBACKED',
  'CLAIM_SUPERLATIVE',
  'TEXT_TOO_LONG',
  'SCENE_TYPE_UNKNOWN',
  'VARIANT_INVALID',
]);

const OWNER_OF: Record<string, Owner> = {
  CONTRAST_LOW: 'art-director',
  ASSET_UNAVAILABLE: 'researcher',
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * True when a URL is on the site or one of its subdomains. The host is compared on a label
 * boundary, so `docs.linear.app` is on `linear.app` and the lookalike `getlinear.app` is not.
 */
export function onSite(url: string, host: string): boolean {
  const own = hostOf(url);
  return host !== '' && (own === host || own.endsWith(`.${host}`));
}

export function researchFacts(research: ResearchOutput): ResearchFacts {
  const home = research.brief.pages.find((page) => page.kind === 'home')?.url;
  const host = hostOf(home ?? research.claims[0]?.sourceUrl ?? '');
  const captured = Object.values(research.assets).filter(
    (asset) => asset.kind === 'image' && asset.provenance === 'captured',
  );
  const surfaces = [
    ...new Set(
      captured.flatMap((asset) => {
        const url = asset.sourceUrl ? normaliseUrl(asset.sourceUrl) : undefined;
        return url ? [url] : [];
      }),
    ),
  ];
  return {
    host,
    claims: research.claims.length,
    approvedClaimIds: research.claims
      .filter((claim) => claim.status === 'approved')
      .map((claim) => claim.id),
    numericClaimIds: research.claims
      .filter((claim) => extractNumericTokens(claim.quote).length > 0)
      .map((claim) => claim.id),
    surfaces,
    capturedTiles: captured.filter((asset) => onSite(asset.sourceUrl ?? '', host)).length,
  };
}

/**
 * The template §1 of the director skill picks. `usable` is the Director's own count, since it
 * needs judgement (can the film state the claim in 8 words); everything else is counted here.
 */
export function expectedTemplate(
  brief: DirectorBrief,
  facts: ResearchFacts,
  usable: number,
): { label: 'Short' | 'Standard' | 'Long'; rule: string } {
  if (brief.kind === 'outreach-sample')
    return { label: 'Short', rule: 'rule 1: an outreach sample is Short' };
  if (Math.min(usable, facts.claims) < 3)
    return { label: 'Short', rule: 'rule 2: fewer than 3 usable claims' };
  const verifiedNumeric = facts.approvedClaimIds.filter((id) => facts.numericClaimIds.includes(id));
  if (
    facts.approvedClaimIds.length >= 5 &&
    verifiedNumeric.length >= 3 &&
    facts.surfaces.length >= 3 &&
    !brief.asksFor45s
  ) {
    return {
      label: 'Long',
      rule: 'rule 3: at least 5 verified claims, 3 of them numeric, and 3 product surfaces',
    };
  }
  return {
    label: 'Standard',
    rule: `rule 4: ${facts.approvedClaimIds.length} verified claims (${verifiedNumeric.length} numeric) and ${facts.surfaces.length} surfaces do not reach Long`,
  };
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const firstWord = (text: string) =>
  (text.trim().split(/\s+/)[0] ?? '').replace(/[^\p{L}\p{N}'’-]/gu, '');

/** Text roles each scene type takes, with the number of items per role, from director-scene-types. */
const SLOTS: Record<string, Partial<Record<TextItem['role'], [min: number, max: number]>>> = {
  'word-slam': { headline: [1, 1] },
  'logo-reveal': { subhead: [0, 1] },
  'site-hero': { label: [0, 1] },
  'type-card': { headline: [1, 1], subhead: [0, 1] },
  'site-scroll': { label: [0, 2] },
  'proof-bars': { headline: [1, 1], label: [1, 3], subhead: [0, 1] },
  'stat-counter': { headline: [1, 1], label: [0, 1] },
  'feature-card': { headline: [1, 1], label: [0, 2] },
  'tile-wall': {},
  'status-relay': { headline: [1, 1], label: [0, 3] },
  'rail-words': { headline: [1, 1], subhead: [1, 1] },
  'colour-event': { headline: [1, 1] },
  'cell-type': { headline: [1, 1] },
  'iso-chain': { headline: [0, 1], label: [0, 3] },
  'end-card': { cta: [1, 1], label: [0, 1] },
};

/** Word limits per scene type and role, [min, max], from director-scene-types. */
const WORDS: Record<string, Partial<Record<TextItem['role'], [number, number]>>> = {
  'word-slam': { headline: [2, 8] },
  'logo-reveal': { subhead: [1, 6] },
  'proof-bars': { headline: [2, 6], subhead: [1, 4] },
  'stat-counter': { label: [1, 6] },
  'feature-card': { headline: [2, 6], label: [1, 2] },
  'status-relay': { headline: [2, 6], label: [1, 2] },
  'rail-words': { headline: [1, 2], subhead: [1, 2] },
  'colour-event': { headline: [1, 3] },
  'cell-type': { headline: [1, 3] },
  'iso-chain': { headline: [1, 5], label: [1, 2] },
  'end-card': { cta: [1, 4] },
};

/** Props that carry the Researcher's DOM capture data, which research.json does not hold. */
const CAPTURE_PROPS: Record<string, readonly string[]> = {
  'site-hero': ['frame', 'layers', 'focus', 'activeLayer'],
  'site-scroll': ['pages'],
};

type Push = (
  code: string,
  path: string,
  message: string,
  fix: string,
  severity?: Issue['severity'],
) => void;

function checkTemplate(campaign: Campaign, template: Template, push: Push): void {
  const { rows } = template;
  if (campaign.fps !== FPS)
    push('TEMPLATE_FRAMES', 'fps', `fps is ${campaign.fps}.`, 'Set fps to 30.');
  if (campaign.durationSeconds !== template.durationSeconds) {
    push(
      'TEMPLATE_LENGTH',
      'durationSeconds',
      `durationSeconds is ${campaign.durationSeconds}, but the ${template.label} template runs ${template.durationSeconds} s.`,
      `Set durationSeconds to ${template.durationSeconds}, or use the template the handoff names.`,
    );
  }
  if (campaign.scenes.length !== rows.length) {
    push(
      'TEMPLATE_ROWS',
      'scenes',
      `There are ${campaign.scenes.length} scenes, but the ${template.label} template has ${rows.length} rows.`,
      `Copy the ${rows.length} rows of ${template.label} in order from director-beat-templates: one scene per row, none added, dropped or reordered.`,
    );
    return;
  }

  const starts = rowStarts(template);
  const proofRows = rows.flatMap((each, index) => (each.slot === 'proof' ? [index] : []));
  const replaced = proofRows.filter(
    (index) => !(PROOF_TYPES as readonly string[]).includes(campaign.scenes[index]?.type ?? ''),
  );
  const proofTypes = new Set(
    proofRows.flatMap((index) => {
      const type = campaign.scenes[index]?.type ?? '';
      return (PROOF_TYPES as readonly string[]).includes(type) ? [type] : [];
    }),
  );
  const replacementTypes = new Set(replaced.map((index) => campaign.scenes[index]?.type));
  const replacementsAllowed =
    template.name === 'standard'
      ? ['feature-card', 'status-relay']
      : template.name === 'short'
        ? ['feature-card']
        : [];

  for (const [index, scene] of campaign.scenes.entries()) {
    const expected = rows[index];
    if (!expected) continue;
    const path = `scenes[${index}]`;
    const allowed =
      expected.slot === 'proof'
        ? [...PROOF_TYPES, ...replacementsAllowed]
        : expected.slot === 'set-piece'
          ? ['iso-chain', 'cell-type']
          : expected.slot === 'tiles'
            ? ['tile-wall', 'feature-card']
            : [expected.type];
    if (!allowed.includes(scene.type)) {
      push(
        'TEMPLATE_ROWS',
        `${path}.type`,
        `Row ${index + 1} of ${template.label} is ${allowed.join(' or ')}, but ${path} is "${scene.type}".`,
        `Set ${path}.type to ${allowed[0]}${allowed.length > 1 ? ` (or ${allowed.slice(1).join(', ')} through a substitution director-beat-templates allows)` : ''}.`,
      );
    }
    if (scene.type === 'type-card' || expected.variant) {
      const variant = scene.props.variant;
      if ((variant ?? undefined) !== expected.variant) {
        push(
          'TEMPLATE_ROWS',
          `${path}.props.variant`,
          `Row ${index + 1} is ${expected.variant ? `the ${expected.variant} card` : 'a plain type-card'}, but ${path}.props.variant is ${JSON.stringify(variant)}.`,
          expected.variant
            ? `Set ${path}.props.variant to "${expected.variant}".`
            : `Remove variant from ${path}.props.`,
        );
      }
    }
    const from = starts[index] ?? 0;
    const to = from + expected.frames;
    if (toFrame(scene.start, FPS) !== from || toFrame(scene.end, FPS) !== to) {
      push(
        'TEMPLATE_FRAMES',
        path,
        `${path} runs frames ${toFrame(scene.start, FPS)} to ${toFrame(scene.end, FPS)}, but row ${index + 1} of ${template.label} runs ${from} to ${to} (${expected.frames} frames).`,
        `Set ${path}.start to ${frameSeconds(from)} and ${path}.end to ${frameSeconds(to)}.`,
      );
    }
  }

  if (proofTypes.size > 1) {
    push(
      'TEMPLATE_ROWS',
      'scenes',
      `The proof rows mix ${[...proofTypes].join(' and ')}.`,
      'Use one proof type for every proof row: proof-bars only when every row fits it, else stat-counter for all.',
    );
  }
  if (replaced.length > 0) {
    const fromLastBack = replaced.every(
      (index, at) => index === proofRows[proofRows.length - replaced.length + at],
    );
    if (!fromLastBack || replacementTypes.size > 1) {
      push(
        'TEMPLATE_ROWS',
        'scenes',
        `Proof rows ${replaced.map((index) => index + 1).join(', ')} were replaced, ${fromLastBack ? 'with more than one type' : 'not from the last one back'}.`,
        'Replace missing proof rows from the last one back, with the same type for every replaced row.',
      );
    }
  }
}

/** The template's default seams, after the substitutions director-beat-templates lists. */
export function expectedSeams(campaign: Campaign, template: Template): (string | null)[] {
  const seams = template.rows.map((each) => each.seam);
  const isProof = (index: number) =>
    (PROOF_TYPES as readonly string[]).includes(campaign.scenes[index]?.type ?? '');
  if (template.name === 'standard') {
    // Rows 6 to 8 are proof. A replaced row 8 takes t1 on seam 7; replaced rows 7 and 8 take t1 on seam 6.
    if (isProof(5) && isProof(6) && !isProof(7)) seams[6] = 't1';
    if (isProof(5) && !isProof(6) && !isProof(7)) seams[5] = 't1';
  }
  if (template.name === 'short' && !isProof(6)) seams[5] = 't5';
  return seams;
}

function checkSeams(campaign: Campaign, template: Template, push: Push): void {
  if (campaign.scenes.length !== template.rows.length) return;
  const seams = expectedSeams(campaign, template);
  for (const [index, scene] of campaign.scenes.entries()) {
    const expected = seams[index] ?? null;
    const actual = scene.transitionOut ?? null;
    if (actual === expected) continue;
    const path = `scenes[${index}].transitionOut`;
    push(
      'SEAM',
      path,
      expected === null
        ? `The last scene has transitionOut "${actual}".`
        : `Seam ${index + 1} is ${actual === null ? 'missing' : `"${actual}"`}, but the ${template.label} plan in director-seams, after its substitutions, gives "${expected}".`,
      expected === null ? `Remove ${path}.` : `Set ${path} to "${expected}".`,
    );
  }
}

function checkHook(scene: Scene, path: string, push: Push): void {
  const headline = scene.text.find((item) => item.role === 'headline');
  if (!headline) return;
  const count = words(headline.value);
  if (count < 2 || count > 8) {
    push(
      'HOOK',
      `${path}.text`,
      `The hook sentence "${headline.value}" has ${count} words.`,
      'Write the hook sentence in 2 to 8 words, 6 or fewer by preference.',
    );
  }
  const slam = firstWord(headline.value);
  if ([...slam].length > 12) {
    push(
      'HOOK',
      `${path}.text`,
      `The slam word "${slam}" has ${[...slam].length} characters.`,
      'Start the hook with a slam word of 12 characters or fewer, 8 or fewer by preference.',
    );
  }
}

function checkVariants(
  campaign: Campaign,
  brief: DirectorBrief,
  facts: ResearchFacts,
  push: Push,
): void {
  const { hooks, ctas, formats } = campaign.variants;
  const opening = campaign.scenes[0];
  if (opening?.type !== 'word-slam') {
    push(
      'HOOK',
      'scenes[0].type',
      'The opening scene is not a word-slam.',
      'Set scenes[0].type to "word-slam".',
    );
  } else checkHook(opening, 'scenes[0]', push);
  if (hooks.length < 1 || hooks.length > 3) {
    push(
      'HOOK',
      'variants.hooks',
      `There are ${hooks.length} hook variants.`,
      'Write 1 to 3 hook variants.',
    );
  }
  for (const [index, hook] of hooks.entries()) {
    const path = `variants.hooks[${index}]`;
    if (hook.type !== 'word-slam') {
      push(
        'HOOK',
        `${path}.type`,
        `${path} is "${hook.type}".`,
        `Set ${path}.type to "word-slam".`,
      );
    }
    if ((hook.transitionOut ?? null) !== (opening?.transitionOut ?? null)) {
      push(
        'HOOK',
        `${path}.transitionOut`,
        `${path}.transitionOut is ${JSON.stringify(hook.transitionOut)}, not scenes[0]'s ${JSON.stringify(opening?.transitionOut)}.`,
        `Set ${path}.transitionOut to "${opening?.transitionOut}".`,
      );
    }
    checkHook(hook, path, push);
  }

  if (ctas.length < 1 || ctas.length > 3) {
    push(
      'CTA',
      'variants.ctas',
      `There are ${ctas.length} CTA variants.`,
      'Write 1 to 3 CTA variants.',
    );
  }
  for (const [index, cta] of ctas.entries()) {
    const path = `variants.ctas[${index}]`;
    if (words(cta.label) > 4 || [...cta.label].length > 24) {
      push(
        'CTA',
        `${path}.label`,
        `"${cta.label}" is ${words(cta.label)} words and ${[...cta.label].length} characters.`,
        'Write CTA labels in 4 words and 24 characters or fewer.',
      );
    }
    if (!onSite(cta.href, facts.host)) {
      push(
        'CTA',
        `${path}.href`,
        `${cta.href} is not on ${facts.host}.`,
        `Point ${path}.href at a real signup, demo or pricing page on ${facts.host}${brief.ctaPages.length ? `, such as ${brief.ctaPages[0]}` : ''}.`,
      );
    }
  }
  const end = campaign.scenes.at(-1);
  const endCta = end?.text.find((item) => item.role === 'cta');
  if (end?.type === 'end-card' && endCta && ctas[0] && endCta.value !== ctas[0].label) {
    push(
      'CTA',
      `scenes[${campaign.scenes.length - 1}].text`,
      `The end card's cta "${endCta.value}" is not the first CTA label "${ctas[0].label}".`,
      `Set the end card's cta text to "${ctas[0].label}".`,
    );
  }
  const wanted = [...brief.formats].sort().join(',');
  if ([...formats].sort().join(',') !== wanted) {
    push(
      'FORMATS',
      'variants.formats',
      `variants.formats is ${JSON.stringify(formats)}, but the brief asks for ${JSON.stringify(brief.formats)}.`,
      `Set variants.formats to ${JSON.stringify(brief.formats)}.`,
    );
  }
}

function checkText(campaign: Campaign, template: Template, push: Push): void {
  const scenes = [
    ...campaign.scenes.map((scene, index) => ({ scene, path: `scenes[${index}]` })),
    ...campaign.variants.hooks.map((scene, index) => ({ scene, path: `variants.hooks[${index}]` })),
  ];
  for (const { scene, path } of scenes) {
    const slots = SLOTS[scene.type];
    if (!slots) continue;
    for (const [index, item] of scene.text.entries()) {
      const at = `${path}.text[${index}]`;
      if (/\d/.test(item.id)) {
        push(
          'TEXT_ID',
          `${at}.id`,
          `Text id "${item.id}" contains a digit.`,
          `Rename ${at}.id to a slug with no digits.`,
        );
      }
      if (!slots[item.role]) {
        push(
          'ROLE',
          `${at}.role`,
          `${scene.type} takes no ${item.role}.`,
          `Use only the roles director-scene-types lists for ${scene.type}: ${Object.keys(slots).join(', ') || 'none (no text)'}.`,
        );
        continue;
      }
      const limit = WORDS[scene.type]?.[item.role];
      const count = words(item.value);
      if (limit && (count < limit[0] || count > limit[1])) {
        push(
          'WORDS',
          `${at}.value`,
          `This ${scene.type} ${item.role} "${item.value}" has ${count} words.`,
          `Write it in ${limit[0] === limit[1] ? limit[0] : `${limit[0]} to ${limit[1]}`} words.`,
        );
      }
    }
    for (const [role, [min, max]] of Object.entries(slots)) {
      const count = scene.text.filter((item) => item.role === role).length;
      if (count < min || count > max) {
        push(
          'SLOTS',
          `${path}.text`,
          `${scene.type} has ${count} ${role} item(s).`,
          `Give ${path} ${min === max ? min : `${min} to ${max}`} ${role} item(s).`,
        );
      }
    }

    if (scene.type === 'type-card') {
      const total = scene.text.reduce((sum, item) => sum + words(item.value), 0);
      const frames = toFrame(scene.end, FPS) - toFrame(scene.start, FPS);
      const minimum = Math.max(43, Math.ceil(6.5 * total));
      if (total > 8) {
        push(
          'WORDS',
          `${path}.text`,
          `This type-card holds ${total} words.`,
          'Keep a type-card to 8 words, headline and subhead together.',
        );
      }
      if (frames < minimum) {
        push(
          'CARD_TIME',
          `${path}.text`,
          `This type-card holds ${total} words for ${frames} frames; card.min is ${minimum}.`,
          `Cut it to ${Math.floor(frames / 6.5)} words or fewer, which ${frames} frames can hold.`,
        );
      }
      const variant = scene.props.variant;
      const subhead = scene.text.find((item) => item.role === 'subhead');
      const headline = scene.text.find((item) => item.role === 'headline');
      if (variant === 'name') {
        if (headline && headline.value !== campaign.brand.name) {
          push(
            'WORDS',
            `${path}.text`,
            `The name card's headline is "${headline.value}".`,
            `Set it to brand.name, "${campaign.brand.name}".`,
          );
        }
        if (subhead && words(subhead.value) > 4) {
          push(
            'WORDS',
            `${path}.text`,
            `The name card's subhead has ${words(subhead.value)} words.`,
            'Keep the name card subhead to 4 words.',
          );
        }
      }
      if (variant === 'pivot' && (subhead || total > 4)) {
        push(
          'WORDS',
          `${path}.text`,
          `The pivot card holds ${total} words${subhead ? ' and a subhead' : ''}.`,
          'Write the pivot as one line of 4 words at most, with no subhead.',
        );
      }
    }
    if (scene.type === 'end-card' && template.name === 'short') {
      const url = scene.text.find((item) => item.role === 'label');
      if (url && [...url.value].length > 20) {
        push(
          'WORDS',
          `${path}.text`,
          `The end card URL "${url.value}" is ${[...url.value].length} characters.`,
          'On Short the end card URL is 20 characters at most: drop the path or the www.',
        );
      }
    }

    const accent = scene.props.accent;
    if (accent !== undefined) {
      const textId = (accent as { textId?: unknown } | null)?.textId;
      if (scene.type === 'colour-event') {
        push(
          'ACCENT',
          `${path}.props.accent`,
          'colour-event takes no accent.',
          `Remove ${path}.props.accent.`,
        );
      } else if (typeof textId !== 'string' || !scene.text.some((item) => item.id === textId)) {
        push(
          'ACCENT',
          `${path}.props.accent`,
          'props.accent does not name a text item of this scene.',
          `Set ${path}.props.accent to {textId, from, to} with textId one of this scene's text ids, or remove it.`,
        );
      }
    }
    for (const key of CAPTURE_PROPS[scene.type] ?? []) {
      if (key in scene.props) {
        push(
          'PROPS',
          `${path}.props.${key}`,
          `${path}.props.${key} is capture data, and the research holds none to copy.`,
          `Remove ${path}.props.${key}. Never invent DOM boxes.`,
        );
      }
    }
  }
}

function checkSources(
  campaign: Campaign,
  research: ResearchOutput,
  brief: DirectorBrief,
  facts: ResearchFacts,
  push: Push,
): void {
  if (canonicalJson(campaign.brand) !== canonicalJson(research.brand)) {
    push(
      'BRAND_ALTERED',
      'brand',
      'brand differs from the research brand.',
      "Copy brand from the research unchanged. Colour problems are the Art Director's.",
    );
  }
  const researchClaims = new Map(research.claims.map((claim) => [claim.id, claim]));
  for (const [index, claim] of campaign.claims.entries()) {
    const source = researchClaims.get(claim.id);
    if (!source) {
      push(
        'CLAIM_INVENTED',
        `claims[${index}]`,
        `Claim "${claim.id}" is not in the research.`,
        `Remove claims[${index}] and every citation of it. Cite only research claims.`,
      );
    } else if (canonicalJson(source) !== canonicalJson(claim)) {
      push(
        'CLAIM_ALTERED',
        `claims[${index}]`,
        `Claim "${claim.id}" differs from the research claim.`,
        `Copy claim "${claim.id}" from the research unchanged: id, text, sourceUrl, quote and status.`,
      );
    }
  }
  for (const [id, asset] of Object.entries(campaign.assets)) {
    if (brief.music && id === brief.music.assetId) continue;
    const source = Object.hasOwn(research.assets, id) ? research.assets[id] : undefined;
    if (!source) {
      push(
        'ASSET_INVENTED',
        `assets.${id}`,
        `Asset "${id}" is not in the research.`,
        `Remove assets.${id}, or use an asset id from the research.`,
      );
    } else if (canonicalJson(source) !== canonicalJson(asset)) {
      push(
        'ASSET_ALTERED',
        `assets.${id}`,
        `Asset "${id}" differs from the research asset.`,
        `Copy assets.${id} from the research unchanged.`,
      );
    }
  }
  if (hostOf(campaign.sourceUrl) !== facts.host) {
    push(
      'SOURCE_URL',
      'sourceUrl',
      `sourceUrl ${campaign.sourceUrl} is not on ${facts.host}.`,
      `Set sourceUrl to the site's home page on ${facts.host}.`,
    );
  }

  const claims = new Map(campaign.claims.map((claim) => [claim.id, claim]));
  const scenes = [
    ...campaign.scenes.map((scene, index) => ({ scene, path: `scenes[${index}]` })),
    ...campaign.variants.hooks.map((scene, index) => ({ scene, path: `variants.hooks[${index}]` })),
  ];
  for (const { scene, path } of scenes) {
    const cited = [
      ...scene.text.map((item, index) => ({
        at: `${path}.text[${index}]`,
        value: item.value,
        ids: item.claimIds,
      })),
      ...(scene.voiceover
        ? [{ at: `${path}.voiceover`, value: scene.voiceover.text, ids: scene.voiceover.claimIds }]
        : []),
    ];
    const sceneWords = cited.map((each) => each.value).join(' ');
    for (const { at, value, ids } of cited) {
      const goals = ids.flatMap((id) => {
        const quote = claims.get(id)?.quote;
        return quote
          ? [{ id, quote, goal: GOAL.test(quote), tokens: extractNumericTokens(quote, 'literal') }]
          : [];
      });
      for (const token of extractNumericTokens(value)) {
        const backers = goals.filter((each) => isBacked(token, each.tokens));
        if (backers.length === 0 || !backers.every((each) => each.goal) || GOAL.test(sceneWords))
          continue;
        push(
          'CLAIM_GOAL',
          `${at}.value`,
          `"${value}" states "${token.raw}" as a fact, but ${backers.map((each) => `"${each.id}" ("${each.quote}")`).join(' and ')} only states it as a goal.`,
          `Say "${token.raw}" as the goal the quote states, with its own words such as "our mission" or its year, or cite a claim that states it as a fact, or remove it.`,
        );
      }
      for (const id of ids) {
        const claim = claims.get(id);
        if (claim && claim.status !== 'approved' && !brief.citeExtracted) {
          push(
            'CLAIM_STATUS',
            `${at}.claimIds`,
            `${at} cites "${id}", which is ${claim.status}, and this brief allows only approved claims on screen.`,
            `Cite an approved claim, or rewrite ${at} so it states nothing that needs one.`,
          );
        }
      }
      const forms = superlativeForms(value, DIRECTOR_SUPERLATIVES);
      // The validator already reports a superlative from its own list that cites no known claim.
      const known = ids.filter((id) => claims.has(id));
      const own = known.length === 0 ? new Set(superlativeForms(value)) : new Set<string>();
      const quoted = known.flatMap((id) => {
        const quote = claims.get(id)?.quote;
        return quote ? superlativeForms(quote, DIRECTOR_SUPERLATIVES) : [];
      });
      for (const form of new Set(forms)) {
        if (own.has(form) || quoted.includes(form)) continue;
        const inCompound = quoted.filter((each) => each.split('-').includes(form));
        push(
          'CLAIM_SUPERLATIVE',
          `${at}.value`,
          known.length === 0
            ? `"${value}" says "${form}" and cites no claim.`
            : inCompound.length
              ? `"${value}" says "${form}", but the cited quotes only use it inside ${inCompound.map((each) => `"${each}"`).join(', ')}, which describes something else.`
              : `"${value}" says "${form}", which no cited quote states.`,
          inCompound.length
            ? `Remove "${form}", or repeat the quote's own "${inCompound[0]}" with what it describes.`
            : `Remove "${form}", or cite a claim whose quote says it as a word of its own.`,
        );
      }
    }
    if (!brief.narrationPaid && scene.voiceover) {
      push(
        'AUDIO',
        `${path}.voiceover`,
        'This brief pays for no narration.',
        `Remove ${path}.voiceover.`,
      );
    }
  }

  if (!brief.music && campaign.audio) {
    push(
      'AUDIO',
      'audio',
      'No music track was given, so audio must be omitted.',
      'Remove audio, and say "no music given" in the handoff notes.',
    );
  }
  if (brief.music && campaign.audio?.musicAssetId !== brief.music.assetId) {
    push(
      'AUDIO',
      'audio.musicAssetId',
      'audio.musicAssetId is not the track the brief gave.',
      `Set audio.musicAssetId to "${brief.music.assetId}" and declare it in assets.`,
    );
  }
  if (!brief.narrationPaid && campaign.audio?.voice) {
    push('AUDIO', 'audio.voice', 'This brief pays for no narration.', 'Remove audio.voice.');
  }
}

function checkHandoff(campaign: Campaign, handoff: Handoff, template: Template, push: Push): void {
  const rows = template.rows;
  if (campaign.scenes.length !== rows.length) return;
  for (const [index, scene] of campaign.scenes.entries()) {
    const expected = rows[index];
    if (!expected) continue;
    const substituted =
      (expected.slot === 'proof' && !(PROOF_TYPES as readonly string[]).includes(scene.type)) ||
      (expected.slot === 'tiles' && scene.type !== 'tile-wall');
    if (substituted && !handoff.substitutions.some((each) => each.row === index + 1)) {
      push(
        'HANDOFF',
        'handoff.substitutions',
        `Row ${index + 1} became ${scene.type}, and the handoff does not list it.`,
        `Add {row: ${index + 1}, from: "${expected.type}", to: "${scene.type}"} to handoff.substitutions.`,
      );
    }
    if (
      (scene.type === 'status-relay' || scene.type === 'rail-words') &&
      !handoff.tier4SceneIds.includes(scene.id)
    ) {
      push(
        'HANDOFF',
        'handoff.tier4SceneIds',
        `${scene.type} scene "${scene.id}" is tier 4 and is not listed.`,
        `Add "${scene.id}" to handoff.tier4SceneIds.`,
      );
    }
  }
}

export interface Verdict {
  /** The Director's own errors. A submission passes when this is empty. */
  blocking: DirectorIssue[];
  /** Warnings, and issues that belong to the Art Director or the Researcher. */
  other: DirectorIssue[];
  campaign: Campaign | undefined;
  handoff: Handoff | undefined;
}

/**
 * Checks one submission: `validateCampaign` with `sceneRegistry`, then the checks of §10 of the
 * director skill that the validator does not make, and the rules of this pipeline: the brand,
 * claims and assets are the research's, unchanged, and the template is the one §1 picks.
 */
export async function checkSubmission(
  raw: unknown,
  research: ResearchOutput,
  brief: DirectorBrief,
): Promise<Verdict> {
  const issues: DirectorIssue[] = [];
  const push: Push = (code, path, message, fix, severity = 'error') =>
    issues.push({ code, severity, path, message, fix, owner: 'director' });

  const shape = directorOutputSchema.safeParse(raw);
  if (!shape.success) {
    for (const issue of shape.error.issues) {
      const path = ['$', ...issue.path.map(String)].join('.');
      push(
        'HANDOFF_INVALID',
        path,
        `${path}: ${issue.message}`,
        `Fix ${path} so the submission matches the output schema.`,
      );
    }
    return { blocking: issues, other: [], campaign: undefined, handoff: undefined };
  }
  const { campaign: input, handoff } = shape.data;

  const validated = await validateCampaign(input, { sceneRegistry });
  for (const issue of validated.issues) {
    const owner: Owner = OWNER_OF[issue.code] ?? 'director';
    const blocking =
      owner === 'director' &&
      DIRECTOR_CODES.has(issue.code) &&
      (issue.severity === 'error' || issue.code === 'CLAIM_SUPERLATIVE') &&
      issue.path !== 'brand.name';
    issues.push({
      ...issue,
      path: `campaign.${issue.path}`.replace('campaign.$', 'campaign'),
      severity: blocking ? 'error' : issue.severity,
      owner,
    });
  }

  const parsed = campaignSchema.safeParse(input);
  const campaign = parsed.success ? parsed.data : undefined;
  if (campaign) {
    const facts = researchFacts(research);
    const before = issues.length;
    const template = templateFor(handoff.template);
    if (template) {
      const expected = expectedTemplate(brief, facts, handoff.counts.usableClaims);
      if (expected.label !== template.label) {
        push(
          'TEMPLATE_LENGTH',
          'handoff.template',
          `The handoff picks ${template.label}, but ${expected.rule}, so §1 picks ${expected.label}.`,
          `Rebuild the campaign on the ${expected.label} template from director-beat-templates.`,
        );
      }
      checkTemplate(campaign, template, push);
      checkSeams(campaign, template, push);
      checkText(campaign, template, push);
      checkHandoff(campaign, handoff, template, push);
    }
    checkVariants(campaign, brief, facts, push);
    checkSources(campaign, research, brief, facts, push);
    for (const issue of issues.slice(before))
      issue.path = `campaign.${issue.path}`.replace('campaign.handoff', 'handoff');
  }

  return {
    blocking: issues.filter((issue) => issue.owner === 'director' && issue.severity === 'error'),
    other: issues.filter((issue) => !(issue.owner === 'director' && issue.severity === 'error')),
    campaign,
    handoff,
  };
}
