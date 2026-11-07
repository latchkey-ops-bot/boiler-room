import type { z } from 'zod';
import { type Campaign, campaignSchema, type Scene, type TextRole } from './campaign.ts';
import { contrastRatio, readableOn } from './contrast.ts';
import { toFrame } from './frames.ts';
import { extractNumericTokens, isBacked, isWholeNumber, type NumericToken } from './numbers.ts';

export const ISSUE_CODES = [
  'SCHEMA_INVALID',
  'SCENE_TIMING',
  'ASSET_UNDECLARED',
  'ASSET_UNAVAILABLE',
  'CLAIM_UNKNOWN',
  'CLAIM_UNBACKED',
  'CLAIM_SUPERLATIVE',
  'TEXT_TOO_LONG',
  'CONTRAST_LOW',
  'SCENE_TYPE_UNKNOWN',
  'VARIANT_INVALID',
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

export interface Issue {
  code: IssueCode;
  severity: 'error' | 'warning';
  /** Where the problem is, such as `scenes[2].text[0].value`. `$` is the whole campaign. */
  path: string;
  message: string;
  /** What an agent should change to resolve this issue. */
  fix: string;
}

export interface SceneLimits {
  /** Maximum characters per text role, replacing `DEFAULT_TEXT_LIMITS` for this scene type. */
  text?: Partial<Record<TextRole, number>>;
}

export type SceneRegistry = Record<string, SceneLimits>;

export interface ValidateOptions {
  /** Reports whether an asset's `src` can be fetched. Without it, availability is not checked. */
  assetExists?: (src: string) => boolean | Promise<boolean>;
  /** The scene types that exist. Without it, scene types are not checked. */
  sceneRegistry?: SceneRegistry;
}

/** `campaign` is set only when `ok` is true, so a failed campaign cannot be rendered by mistake. */
export type ValidationResult =
  | { ok: true; issues: Issue[]; campaign: Campaign }
  | { ok: false; issues: Issue[]; campaign: undefined };

export const DEFAULT_TEXT_LIMITS: Record<TextRole, number> = {
  headline: 60,
  subhead: 120,
  body: 240,
  cta: 30,
  label: 40,
};

/** WCAG AA: 4.5:1 for body text, and 3:1 for large text and UI, which is how primary is used. */
export const MIN_CONTRAST = { foreground: 4.5, primary: 3 } as const;

const TIME_TOLERANCE_SECONDS = 1e-6;

const SUPERLATIVE =
  /(?<![\p{L}\p{N}])(?:fastest|quickest|best|leading|top-rated|#1|no\.\s?1|number[\s-]one|cheapest|largest|biggest|greatest|highest|lowest|smartest|strongest|safest|easiest|unmatched|unrivall?ed|unbeatable)(?![\p{L}\p{N}])/iu;

/**
 * A URL or a path to a file, which can hold digits such as `2x` without being copy. The extension
 * starts with a letter, so that `1.5x` is not a file name.
 */
const LOCATOR =
  /^(?:(?:https?|s3|gs|file):\/\/\S+|(?:\.{0,2}\/)?(?:[\w.@-]+\/)*[\w.@-]+\.[a-z][a-z0-9]{1,4})$/i;

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

const STATEMENT_KINDS: ReadonlySet<NumericToken['kind']> = new Set([
  'percent',
  'multiplier',
  'money',
]);

/** Number kinds that make a brand name read as a claim. A plain number does not: "Nova 2". */
const CLAIM_KINDS: ReadonlySet<NumericToken['kind']> = new Set([...STATEMENT_KINDS, 'rank']);

interface CopyItem {
  /** Where the copy is. */
  path: string;
  /** Where its citations go. Variant CTAs have nowhere to cite from. */
  claimsPath: string | undefined;
  value: string;
  claimIds: string[];
  role: TextRole | undefined;
  sceneType: string | undefined;
}

/** What a claim's quote says, in both readings. */
interface Quote {
  text: string;
  literal: NumericToken[];
  strict: NumericToken[];
}

const issue =
  (severity: Issue['severity']) =>
  (code: IssueCode, path: string, message: string, fix: string): Issue => ({
    code,
    severity,
    path,
    message,
    fix,
  });
const error = issue('error');
const warning = issue('warning');

const sameTime = (a: number, b: number) => Math.abs(a - b) < TIME_TOLERANCE_SECONDS;

function formatPath(segments: readonly PropertyKey[]): string {
  const path = segments.reduce<string>((joined, segment) => {
    if (typeof segment === 'number') return `${joined}[${segment}]`;
    return joined ? `${joined}.${String(segment)}` : String(segment);
  }, '');
  return path || '$';
}

function fixForSchemaIssue(zodIssue: z.core.$ZodIssue, path: string): string {
  switch (zodIssue.code) {
    case 'invalid_type':
      return zodIssue.input === undefined
        ? `Add ${path}: expected ${zodIssue.expected}.`
        : `Change ${path} to type ${zodIssue.expected}.`;
    case 'unrecognized_keys':
      return `Remove ${zodIssue.keys.join(', ')} from ${path}. Only fields in the schema are allowed.`;
    case 'invalid_value': {
      const allowed = zodIssue.values.map((value) => JSON.stringify(value)).join(', ');
      return `Change ${path} to one of: ${allowed}.`;
    }
    default:
      return `Change ${path} so that it passes: ${zodIssue.message}.`;
  }
}

/** Empty formats and a CTA with no label fail the schema, but belong to `VARIANT_INVALID`. */
function isVariantRule([section, list, , field]: readonly PropertyKey[]): boolean {
  return section === 'variants' && (list === 'formats' || (list === 'ctas' && field === 'label'));
}

function schemaIssues(zodIssues: readonly z.core.$ZodIssue[]): Issue[] {
  return zodIssues.map((zodIssue) => {
    const path = formatPath(zodIssue.path);
    const code = isVariantRule(zodIssue.path) ? 'VARIANT_INVALID' : 'SCHEMA_INVALID';
    return error(code, path, `${path}: ${zodIssue.message}`, fixForSchemaIssue(zodIssue, path));
  });
}

function allScenes(campaign: Campaign): { scene: Scene; path: string }[] {
  return [
    ...campaign.scenes.map((scene, index) => ({ scene, path: `scenes[${index}]` })),
    ...campaign.variants.hooks.map((scene, index) => ({
      scene,
      path: `variants.hooks[${index}]`,
    })),
  ];
}

function allCopy(campaign: Campaign): CopyItem[] {
  const fromScenes = allScenes(campaign).flatMap(({ scene, path }) => {
    const text = scene.text.map(
      (item, index): CopyItem => ({
        path: `${path}.text[${index}].value`,
        claimsPath: `${path}.text[${index}].claimIds`,
        value: item.value,
        claimIds: item.claimIds,
        role: item.role,
        sceneType: scene.type,
      }),
    );
    if (!scene.voiceover) return text;
    return [
      ...text,
      {
        path: `${path}.voiceover.text`,
        claimsPath: `${path}.voiceover.claimIds`,
        value: scene.voiceover.text,
        claimIds: scene.voiceover.claimIds,
        role: undefined,
        sceneType: scene.type,
      },
    ];
  });
  const fromCtas = campaign.variants.ctas.map(
    (cta, index): CopyItem => ({
      path: `variants.ctas[${index}].label`,
      claimsPath: undefined,
      value: cta.label,
      claimIds: [],
      role: 'cta',
      sceneType: undefined,
    }),
  );
  return [...fromScenes, ...fromCtas];
}

/** The index of every id that repeats an earlier one. */
function repeatedIndexes(ids: readonly string[]): number[] {
  const seen = new Set<string>();
  return ids.flatMap((id, index) => {
    if (seen.has(id)) return [index];
    seen.add(id);
    return [];
  });
}

function checkUniqueIds(campaign: Campaign): Issue[] {
  const duplicate = (ids: readonly string[], pathOf: (index: number) => string) =>
    repeatedIndexes(ids).map((index) => {
      const path = pathOf(index);
      return error(
        'SCHEMA_INVALID',
        path,
        `${path} repeats the id "${ids[index]}".`,
        `Give ${path} an id that is unique in its list.`,
      );
    });
  return [
    ...duplicate(
      campaign.scenes.map((scene) => scene.id),
      (index) => `scenes[${index}].id`,
    ),
    ...duplicate(
      campaign.claims.map((claim) => claim.id),
      (index) => `claims[${index}].id`,
    ),
    ...allScenes(campaign).flatMap(({ scene, path }) =>
      duplicate(
        scene.text.map((item) => item.id),
        (index) => `${path}.text[${index}].id`,
      ),
    ),
  ];
}

function checkSceneTiming({ scenes, durationSeconds, fps, audio, variants }: Campaign): Issue[] {
  const issues: Issue[] = [];
  const frameOf = (time: number) => toFrame(time, fps);
  // Two times within the tolerance can still round apart, which leaves a one frame seam.
  const sameFrame = (a: number, b: number) => sameTime(a, b) && frameOf(a) === frameOf(b);
  let expectedStart = 0;

  for (const [index, scene] of scenes.entries()) {
    const path = `scenes[${index}]`;
    if (!sameFrame(scene.start, expectedStart)) {
      const problem =
        index === 0
          ? 'the first scene must start at 0'
          : scene.start > expectedStart
            ? `there is a gap after ${expectedStart}s`
            : `it overlaps the scene before, which ends at ${expectedStart}s`;
      issues.push(
        error(
          'SCENE_TIMING',
          `${path}.start`,
          `${path} starts at ${scene.start}s: ${problem}.`,
          `Set ${path}.start to ${expectedStart}.`,
        ),
      );
    }
    if (frameOf(scene.end) <= frameOf(scene.start)) {
      issues.push(
        error(
          'SCENE_TIMING',
          `${path}.end`,
          `${path} runs from ${scene.start}s to ${scene.end}s, which is less than one frame at ${fps} fps.`,
          `Set ${path}.end to at least ${scene.start + 1 / fps}, then move the scenes after it.`,
        ),
      );
    }
    expectedStart = scene.end;
  }

  if (!sameFrame(expectedStart, durationSeconds)) {
    const path = `scenes[${scenes.length - 1}].end`;
    issues.push(
      error(
        'SCENE_TIMING',
        path,
        `The last scene ends at ${expectedStart}s, but durationSeconds is ${durationSeconds}.`,
        `Set ${path} to ${durationSeconds}, or change durationSeconds to ${expectedStart}.`,
      ),
    );
  }

  const opening = scenes[0];
  for (const [index, hook] of variants.hooks.entries()) {
    for (const edge of ['start', 'end'] as const) {
      if (opening && !sameFrame(hook[edge], opening[edge])) {
        const path = `variants.hooks[${index}].${edge}`;
        issues.push(
          error(
            'SCENE_TIMING',
            path,
            `${path} is ${hook[edge]}s, but a hook replaces the first scene, whose ${edge} is ${opening[edge]}s.`,
            `Set ${path} to ${opening[edge]}.`,
          ),
        );
      }
    }
  }

  for (const [index, effect] of (audio?.sfx ?? []).entries()) {
    if (effect.at > durationSeconds + TIME_TOLERANCE_SECONDS) {
      const path = `audio.sfx[${index}].at`;
      issues.push(
        error(
          'SCENE_TIMING',
          path,
          `${path} is ${effect.at}s, after the video ends at ${durationSeconds}s.`,
          `Set ${path} to ${durationSeconds} or less, or remove the sound effect.`,
        ),
      );
    }
  }

  return issues;
}

function checkAssetReferences(campaign: Campaign): Issue[] {
  const { brand, assets, audio } = campaign;
  const references: [path: string, id: string][] = [['brand.logoAssetId', brand.logoAssetId]];

  for (const role of ['display', 'body'] as const) {
    const { source } = brand.fonts[role];
    if (!/^https?:\/\//i.test(source)) references.push([`brand.fonts.${role}.source`, source]);
  }
  for (const { scene, path } of allScenes(campaign)) {
    for (const [index, id] of scene.assetIds.entries()) {
      references.push([`${path}.assetIds[${index}]`, id]);
    }
  }
  if (audio?.musicAssetId) references.push(['audio.musicAssetId', audio.musicAssetId]);
  for (const [index, effect] of (audio?.sfx ?? []).entries()) {
    references.push([`audio.sfx[${index}].assetId`, effect.assetId]);
  }

  return references
    .filter(([, id]) => !Object.hasOwn(assets, id))
    .map(([path, id]) =>
      error(
        'ASSET_UNDECLARED',
        path,
        `${path} refers to "${id}", which is not declared in assets.`,
        `Add "${id}" to assets, or change ${path} to an asset that is declared.`,
      ),
    );
}

async function checkAssetAvailability(
  { assets }: Campaign,
  assetExists: ValidateOptions['assetExists'],
): Promise<Issue[]> {
  if (!assetExists) return [];
  const checks = Object.entries(assets).map(async ([id, asset]) => {
    const path = `assets.${id}.src`;
    const fix = `Provide the file at "${asset.src}", or change ${path} to a file that exists.`;
    try {
      if (await assetExists(asset.src)) return [];
      return [error('ASSET_UNAVAILABLE', path, `Asset "${id}" not found at "${asset.src}".`, fix)];
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      const message = `Asset "${id}" could not be checked at "${asset.src}": ${reason}.`;
      return [error('ASSET_UNAVAILABLE', path, message, fix)];
    }
  });
  return (await Promise.all(checks)).flat();
}

function wholePhrase(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu');
}

/** True when a name reads as a statistic, so it cannot be told apart from copy that states one. */
function brandReadsAsClaim(name: string): boolean {
  const isNumberWord = isWholeNumber(name) && !/\p{N}/u.test(name.normalize('NFKC'));
  return isNumberWord || extractNumericTokens(name).some(({ kind }) => CLAIM_KINDS.has(kind));
}

/**
 * Nothing cites a claim for `brand.name`, and templates put it on screen. A name that reads as a
 * statistic therefore needs a claim that quotes it. Even then copy gets no exemption for it, so
 * every use of the name cites that claim.
 */
function checkBrandName({ brand: { name }, claims }: Campaign): Issue[] {
  if (!brandReadsAsClaim(name)) return [];
  const path = 'brand.name';
  if (claims.some((claim) => claim.quote.includes(name))) {
    return [
      warning(
        'CLAIM_UNBACKED',
        path,
        `"${name}" reads as a statistic. A claim quotes it, so it passes as a name, and copy that uses it must cite that claim.`,
        `Keep ${path} if this is the product's real name. Otherwise change it to the name alone.`,
      ),
    ];
  }
  return [
    error(
      'CLAIM_UNBACKED',
      path,
      `"${name}" reads as a statistic, and no claim quotes it.`,
      `Change ${path} to the product's name alone. If this is its real name, add a claim that quotes it, and cite that claim wherever copy uses the name.`,
    ),
  ];
}

function unbackedFix({ claimsPath }: CopyItem, { raw }: NumericToken): string {
  return claimsPath
    ? `Cite a claim whose quote states "${raw}" in ${claimsPath}, or remove "${raw}" from the text.`
    : `Remove "${raw}" from the label, or move it to a scene text item with role "cta" that cites a claim. Variant CTAs cannot cite claims.`;
}

const wording = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The numbers these quotes state for this copy. Copy that repeats a quote word for word says no
 * more than the quote does, so it reads the quote as strictly as it reads itself. One word is too
 * little to count as repeating a quote, and the numbers are still compared, so "10" is not backed
 * by a quote saying "110".
 */
function backingFor(value: string, quotes: readonly Quote[]): NumericToken[] {
  const copy = wording(value);
  return quotes.flatMap((quote) =>
    copy.includes(' ') && wording(quote.text).includes(copy) ? quote.strict : quote.literal,
  );
}

const citationSource = (cited: readonly string[]) =>
  cited.length ? `the quotes of ${cited.join(', ')} do not state it` : 'it cites no claim';

/**
 * A number can be backed in one text item and given a new meaning by the next, such as "40" citing
 * "40 teams" beside "percent faster". Items sit together on screen, so they are also read in order
 * as one sentence, against everything each of them may state alone.
 */
function checkTextTogether(
  values: readonly string[],
  scene: Scene,
  path: string,
  quotes: Map<string, Quote>,
): Issue[] {
  const quotesOf = (ids: readonly string[]) => ids.flatMap((id) => quotes.get(id) ?? []);
  const quoteTokens = scene.text.flatMap((item, index) =>
    backingFor(values[index] ?? '', quotesOf(item.claimIds)),
  );
  const cited = [...new Set(scene.text.flatMap((item) => item.claimIds))].filter((id) =>
    quotes.has(id),
  );
  const together = values.join(' ');
  return extractNumericTokens(together)
    .filter((token) => !isBacked(token, quoteTokens))
    .map(({ raw }) =>
      error(
        'CLAIM_UNBACKED',
        `${path}.text`,
        `The text of ${path} reads "${together}", which states "${raw}", but ${citationSource(cited)}.`,
        `Reword ${path}.text so its items do not read as "${raw}" together, or cite a claim whose quote states it.`,
      ),
    );
}

function checkClaims(campaign: Campaign): Issue[] {
  const brandName = brandReadsAsClaim(campaign.brand.name)
    ? undefined
    : wholePhrase(campaign.brand.name);
  const withoutBrand = (text: string) => (brandName ? text.replace(brandName, ' ') : text);
  const quotes = new Map(
    campaign.claims.map((claim): [string, Quote] => {
      const text = withoutBrand(claim.quote);
      return [
        claim.id,
        {
          text,
          literal: extractNumericTokens(text, 'literal'),
          strict: extractNumericTokens(text),
        },
      ];
    }),
  );
  const issues: Issue[] = [];

  for (const item of allCopy(campaign)) {
    for (const [index, id] of item.claimIds.entries()) {
      if (!quotes.has(id)) {
        const path = `${item.claimsPath}[${index}]`;
        issues.push(
          error(
            'CLAIM_UNKNOWN',
            path,
            `${path} cites "${id}", which is not in claims.`,
            `Add a claim with id "${id}" and its verbatim quote, or remove it from ${item.claimsPath}.`,
          ),
        );
      }
    }

    const cited = item.claimIds.flatMap((id) => (quotes.has(id) ? [id] : []));
    const value = withoutBrand(item.value);
    const quoteTokens = backingFor(
      value,
      cited.flatMap((id) => quotes.get(id) ?? []),
    );
    for (const token of extractNumericTokens(value)) {
      if (!isBacked(token, quoteTokens)) {
        issues.push(
          error(
            'CLAIM_UNBACKED',
            item.path,
            `"${item.value}" states "${token.raw}", but ${citationSource(cited)}.`,
            unbackedFix(item, token),
          ),
        );
      }
    }

    if (cited.length === 0 && SUPERLATIVE.test(item.value.normalize('NFKC'))) {
      issues.push(
        warning(
          'CLAIM_SUPERLATIVE',
          item.path,
          `"${item.value}" makes a superlative claim without citing one.`,
          item.claimsPath
            ? `Cite a claim that supports it in ${item.claimsPath}, or reword it.`
            : 'Reword the label. Variant CTAs cannot cite claims.',
        ),
      );
    }
  }

  // Only once each item passes alone, so one bad number is reported once.
  const reportedIn = (path: string) =>
    issues.some(({ code, path: where }) => code === 'CLAIM_UNBACKED' && where.startsWith(path));
  for (const { scene, path } of allScenes(campaign)) {
    if (scene.text.length > 1 && !reportedIn(`${path}.text[`)) {
      const values = scene.text.map((item) => withoutBrand(item.value));
      issues.push(...checkTextTogether(values, scene, path, quotes));
    }
  }

  return issues;
}

function stringsIn(value: unknown, path: string): [path: string, value: string][] {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => stringsIn(entry, `${path}[${index}]`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, entry]) => [
      [`${path}.${key}`, key] as [string, string],
      ...stringsIn(entry, `${path}.${key}`),
    ]);
  }
  return [];
}

/** The number a props string states as copy, if any. `split-2` and `16:9` state none. */
function statementIn(value: string): NumericToken | undefined {
  if (LOCATOR.test(value) || HEX_COLOUR.test(value)) return undefined;
  const readsAsCopy =
    /\s/.test(value.trim()) || value.split(/[-_]/).length >= 3 || isWholeNumber(value);
  const tokens = extractNumericTokens(value.replaceAll('_', ' '));
  return readsAsCopy ? tokens[0] : tokens.find((token) => STATEMENT_KINDS.has(token.kind));
}

/**
 * Props have no claimIds, so a statistic written there would never reach the check above. This
 * catches strings and keys that read as copy. It cannot catch a JSON number that a template
 * displays, which is why templates must render numbers only from `scene.text`.
 */
function checkPropsForCopy(campaign: Campaign): Issue[] {
  return allScenes(campaign).flatMap(({ scene, path }) =>
    stringsIn(scene.props, `${path}.props`).flatMap(([propPath, value]) => {
      const statement = statementIn(value);
      if (!statement) return [];
      return [
        error(
          'CLAIM_UNBACKED',
          propPath,
          `"${value}" states "${statement.raw}" in scene props, where it cannot cite a claim.`,
          `Move this copy to ${path}.text and cite a claim. Keep props for template parameters, and write numeric parameters as JSON numbers.`,
        ),
      ];
    }),
  );
}

function checkTextLength(campaign: Campaign, registry: SceneRegistry = {}): Issue[] {
  return allCopy(campaign).flatMap((item) => {
    if (!item.role) return [];
    const { role, sceneType } = item;
    const registered =
      sceneType !== undefined && Object.hasOwn(registry, sceneType)
        ? registry[sceneType]?.text?.[role]
        : undefined;
    const limit = registered ?? DEFAULT_TEXT_LIMITS[role];
    const length = [...item.value].length;
    if (length <= limit) return [];
    return [
      error(
        'TEXT_TOO_LONG',
        item.path,
        `This ${role} is ${length} characters, over the limit of ${limit}.`,
        `Shorten ${item.path} to ${limit} characters or fewer.`,
      ),
    ];
  });
}

function checkContrast({ brand: { colors } }: Campaign): Issue[] {
  return (['foreground', 'primary'] as const).flatMap((name) => {
    const ratio = contrastRatio(colors[name], colors.background);
    const minimum = MIN_CONTRAST[name];
    if (ratio >= minimum) return [];
    const measured = (Math.floor(ratio * 100) / 100).toFixed(2);
    const path = `brand.colors.${name}`;
    return [
      error(
        'CONTRAST_LOW',
        path,
        `${colors[name]} on ${colors.background} has a contrast of ${measured}:1, below the WCAG AA minimum of ${minimum}:1.`,
        `Change ${path} to a colour with at least ${minimum}:1 against the background, such as ${readableOn(colors.background)}, or change brand.colors.background.`,
      ),
    ];
  });
}

function checkSceneTypes(campaign: Campaign, registry: SceneRegistry | undefined): Issue[] {
  if (!registry) return [];
  const known = Object.keys(registry).join(', ');
  return allScenes(campaign)
    .filter(({ scene }) => !Object.hasOwn(registry, scene.type))
    .map(({ scene, path }) =>
      error(
        'SCENE_TYPE_UNKNOWN',
        `${path}.type`,
        `Scene type "${scene.type}" is not in the scene registry.`,
        `Change ${path}.type to one of: ${known}.`,
      ),
    );
}

function checkVariants({ scenes, variants }: Campaign): Issue[] {
  const duplicate = (ids: readonly string[], list: string, field: string) =>
    repeatedIndexes(ids).map((index) => {
      const path = `variants.${list}[${index}]${field}`;
      return error(
        'VARIANT_INVALID',
        path,
        `${path} repeats "${ids[index]}".`,
        field ? `Give ${path} a unique id.` : `Remove ${path}.`,
      );
    });

  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const collisions = variants.hooks.flatMap((hook, index) => {
    if (!sceneIds.has(hook.id)) return [];
    const path = `variants.hooks[${index}].id`;
    return [
      error(
        'VARIANT_INVALID',
        path,
        `${path} is "${hook.id}", which is also a scene id.`,
        `Give ${path} an id no scene uses.`,
      ),
    ];
  });

  return [
    ...duplicate(
      variants.hooks.map((hook) => hook.id),
      'hooks',
      '.id',
    ),
    ...collisions,
    ...duplicate(
      variants.ctas.map((cta) => cta.id),
      'ctas',
      '.id',
    ),
    ...duplicate(variants.formats, 'formats', ''),
  ];
}

/**
 * Gates a campaign before it renders. Every issue says what to change, because agents read these
 * and repair the file themselves. Schema failures stop the run, since the other rules need typed
 * data. All other rules run together, so one pass reports everything that is wrong.
 */
export async function validateCampaign(
  input: unknown,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const parsed = campaignSchema.safeParse(input, { reportInput: true });
  if (!parsed.success) {
    return { ok: false, issues: schemaIssues(parsed.error.issues), campaign: undefined };
  }

  const campaign = parsed.data;
  const issues = [
    ...checkUniqueIds(campaign),
    ...checkSceneTiming(campaign),
    ...checkAssetReferences(campaign),
    ...(await checkAssetAvailability(campaign, options.assetExists)),
    ...checkBrandName(campaign),
    ...checkClaims(campaign),
    ...checkPropsForCopy(campaign),
    ...checkTextLength(campaign, options.sceneRegistry),
    ...checkContrast(campaign),
    ...checkSceneTypes(campaign, options.sceneRegistry),
    ...checkVariants(campaign),
  ];

  return issues.every((each) => each.severity !== 'error')
    ? { ok: true, issues, campaign }
    : { ok: false, issues, campaign: undefined };
}
