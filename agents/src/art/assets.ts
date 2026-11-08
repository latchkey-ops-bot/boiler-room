import type { Asset, Campaign, Scene } from '@boiler-room/schema';

/**
 * Which assets each scene may show, and a ranked default for each, from
 * `skills/art-director/SKILL.md` section 4 and the scene files in `docs/motion/scenes/`. The code
 * proposes and checks; the agent looks at the images and may choose differently, but only from
 * the candidates listed here.
 */

/** 1 product imagery, 2 docs, changelog, pricing and integrations, 3 the marketing site. */
export type Tier = 1 | 2 | 3;

export type PageKind =
  | 'home'
  | 'product'
  | 'docs'
  | 'pricing'
  | 'changelog'
  | 'integrations'
  | 'about'
  | 'customers'
  | 'blog'
  | 'contact'
  | 'other';

const TIER_TWO: ReadonlySet<PageKind> = new Set(['docs', 'pricing', 'changelog', 'integrations']);

/** What fills a scene's `assetIds`. */
export type SlotSource = 'none' | 'captured' | 'event-field' | 'hero-texture';

export interface Slot {
  source: SlotSource;
  min: number;
  max: number;
  tiers: readonly Tier[];
  kinds: readonly Asset['kind'][];
  /** How many the default fills, when it has candidates. */
  fill: number;
}

const none: Slot = { source: 'none', min: 0, max: 0, tiers: [], kinds: [], fill: 0 };

/** The asset slot of each of the 15 scene types. A logo comes from `brand.logoAssetId`. */
export const SLOTS: Readonly<Record<string, Slot>> = {
  'word-slam': none,
  'type-card': none,
  'proof-bars': none,
  'stat-counter': none,
  'cell-type': none,
  'logo-reveal': none,
  'end-card': none,
  // Its actor is a CSS square unless a captured or labelled SVG replaces it; none is generated.
  'status-relay': none,
  'site-hero': {
    source: 'captured',
    min: 1,
    max: 1,
    tiers: [1, 2, 3],
    kinds: ['image', 'video'],
    fill: 1,
  },
  'site-scroll': { source: 'captured', min: 2, max: 2, tiers: [2, 3], kinds: ['image'], fill: 2 },
  // 6 to 18 tiles; the default fills 12, three rows of four [N].
  'tile-wall': {
    source: 'captured',
    min: 6,
    max: 18,
    tiers: [1, 2, 3],
    kinds: ['image'],
    fill: 12,
  },
  'feature-card': {
    source: 'captured',
    min: 0,
    max: 2,
    tiers: [1, 2, 3],
    kinds: ['image'],
    fill: 1,
  },
  'rail-words': { source: 'captured', min: 0, max: 1, tiers: [1, 2, 3], kinds: ['image'], fill: 1 },
  'colour-event': { source: 'event-field', min: 0, max: 1, tiers: [], kinds: ['image'], fill: 0 },
  'iso-chain': { source: 'hero-texture', min: 0, max: 1, tiers: [], kinds: ['image'], fill: 0 },
};

export function slotOf(type: string): Slot {
  const slot = Object.hasOwn(SLOTS, type) ? SLOTS[type] : undefined;
  if (!slot)
    throw new Error(`Scene type "${type}" has no asset slot. Validate with sceneRegistry first.`);
  return slot;
}

export interface AssetInfo {
  id: string;
  asset: Asset;
  /** The page it was captured from, without query or fragment, or undefined for uploads. */
  page: string | undefined;
  pageKind: PageKind;
  /** An element crop (`<page>-ui-N`) rather than the top of a page. */
  crop: boolean;
  tier: Tier;
  /** SHA-256 of the file, when known. Equal digests are one picture. */
  digest: string | undefined;
  /** Other asset ids holding the same picture, set by `distinctAssets`. */
  sameAs: string[];
}

/** A page's identity: origin and path, no trailing slash, no query or fragment. */
export function pageKey(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin.toLowerCase()}${path}`;
  } catch {
    return undefined;
  }
}

const KIND_BY_SEGMENT: [RegExp, PageKind][] = [
  [/^(docs?|documentation|developers?|api|guides?|reference|help)$/, 'docs'],
  [/^(pricing|plans?)$/, 'pricing'],
  [/^(changelog|releases?|release-notes|whats-new|updates)$/, 'changelog'],
  [/^(integrations?|apps|marketplace|plugins)$/, 'integrations'],
  [
    /^(features?|product|products|platform|demo|tour|playground|sandbox|how-it-works|solutions?)$/,
    'product',
  ],
  [/^(about|company|team|careers|mission)$/, 'about'],
  [/^(customers?|case-studies|stories|testimonials)$/, 'customers'],
  [/^(blog|news|posts?|articles?)$/, 'blog'],
  [/^(contact|signup|sign-up|login|sign-in|register|book-a-demo|contact-sales)$/, 'contact'],
];

/** The Researcher's page kinds, mapped onto the finer kinds used here. */
const RESEARCH_KINDS: Record<string, PageKind> = {
  home: 'home',
  pricing: 'pricing',
  product: 'product',
  demo: 'product',
  docs: 'docs',
  about: 'about',
  customers: 'customers',
  blog: 'blog',
};

export function pageKindOf(
  url: string | undefined,
  research?: ReadonlyMap<string, string>,
): PageKind {
  if (!url) return 'other';
  const key = pageKey(url);
  const told = key ? research?.get(key) : undefined;
  const fromPath = (() => {
    const path = key ? new URL(key).pathname : '';
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return 'home' as const;
    // `/contact/demo` is a form, not a product page, so the first segment decides.
    for (const [pattern, kind] of KIND_BY_SEGMENT) {
      if (segments[0] && pattern.test(segments[0].toLowerCase())) return kind;
    }
    if (segments.length === 1 && /^(home|homepage|index)$/i.test(segments[0] ?? '')) return 'home';
    return 'other' as const;
  })();
  // A finer kind from the path wins over the Researcher's coarse one, which has no changelog.
  if (told && RESEARCH_KINDS[told] && (fromPath === 'other' || fromPath === 'home')) {
    return RESEARCH_KINDS[told] ?? fromPath;
  }
  return fromPath;
}

const isCrop = (id: string) => /-ui-\d+$/.test(id);

export interface ClassifyOptions {
  /** Researcher page kinds by `pageKey`. */
  pageKinds?: ReadonlyMap<string, string>;
  /** File digests by asset id. */
  digests?: ReadonlyMap<string, string>;
}

/**
 * Every asset a scene may show as captured or uploaded imagery, with its tier. The logo, fonts,
 * audio and anything generated, stock or from a library are not scene imagery.
 */
export function classifyAssets(campaign: Campaign, options: ClassifyOptions = {}): AssetInfo[] {
  return Object.entries(campaign.assets).flatMap(([id, asset]): AssetInfo[] => {
    if (id === campaign.brand.logoAssetId) return [];
    if (asset.kind !== 'image' && asset.kind !== 'video') return [];
    if (asset.provenance !== 'captured' && asset.provenance !== 'uploaded') return [];
    const pageKind = pageKindOf(asset.sourceUrl, options.pageKinds);
    const crop = isCrop(id);
    const tier: Tier = asset.provenance === 'uploaded' || crop ? 1 : TIER_TWO.has(pageKind) ? 2 : 3;
    return [
      {
        id,
        asset,
        page: asset.sourceUrl ? pageKey(asset.sourceUrl) : undefined,
        pageKind,
        crop,
        tier,
        digest: options.digests?.get(id),
        sameAs: [],
      },
    ];
  });
}

/**
 * One asset per picture. Of assets with the same digest, a page top wins over a "crop", because a
 * crop that is byte for byte the page top is not a crop; then an upload over a capture, then the
 * shorter id. The others stay declared and are listed in `sameAs`, but never offered, so a wall
 * never shows a tile twice.
 */
export function distinctAssets(infos: readonly AssetInfo[]): AssetInfo[] {
  const groups = new Map<string, AssetInfo[]>();
  for (const info of infos) {
    const key = info.digest ?? `id:${info.id}`;
    groups.set(key, [...(groups.get(key) ?? []), info]);
  }
  const rank = (info: AssetInfo) => [
    info.crop ? 1 : 0,
    info.asset.provenance === 'uploaded' ? 0 : 1,
    info.id.length,
  ];
  const better = (a: AssetInfo, b: AssetInfo) => {
    const [x, y] = [rank(a), rank(b)];
    for (let index = 0; index < x.length; index++) {
      const diff = (x[index] ?? 0) - (y[index] ?? 0);
      if (diff !== 0) return diff < 0;
    }
    return a.id < b.id;
  };
  const kept = new Map<string, AssetInfo>();
  for (const group of groups.values()) {
    const best = group.reduce((a, b) => (better(b, a) ? b : a));
    const sameAs = group.filter((info) => info !== best).map((info) => info.id);
    // A lone "crop" keeps tier 1; one that duplicates its page top is that page top.
    const tier: Tier = best.crop || best.asset.provenance === 'uploaded' ? 1 : best.tier;
    kept.set(best.id, { ...best, tier, sameAs });
  }
  return infos.flatMap((info) => kept.get(info.id) ?? []);
}

/** The asset id offered for each id, so a duplicate the Director chose maps to its picture. */
export function canonicalIds(infos: readonly AssetInfo[]): Map<string, string> {
  const canonical = new Map<string, string>();
  for (const info of infos) {
    canonical.set(info.id, info.id);
    for (const id of info.sameAs) canonical.set(id, info.id);
  }
  return canonical;
}

/** Every scene that has an asset slot, in film order, then the hooks. */
export function allScenes(campaign: Campaign): { scene: Scene; path: string; hook: boolean }[] {
  return [
    ...campaign.scenes.map((scene, index) => ({ scene, path: `scenes[${index}]`, hook: false })),
    ...campaign.variants.hooks.map((scene, index) => ({
      scene,
      path: `variants.hooks[${index}]`,
      hook: true,
    })),
  ];
}

/** The pages a scene's copy cites, by `pageKey`. */
export function citedPages(scene: Scene, campaign: Campaign): Set<string> {
  const byId = new Map(campaign.claims.map((claim) => [claim.id, claim]));
  const ids = [
    ...scene.text.flatMap((item) => item.claimIds),
    ...(scene.voiceover?.claimIds ?? []),
  ];
  return new Set(
    ids.flatMap((id) => {
      const claim = byId.get(id);
      const key = claim ? pageKey(claim.sourceUrl) : undefined;
      return key ? [key] : [];
    }),
  );
}

export interface Candidate {
  id: string;
  score: number;
  /** Why it ranks where it does, for the agent and the report. */
  why: string;
}

const PAGE_ORDER: Record<string, PageKind[]> = {
  'site-hero': [
    'home',
    'product',
    'other',
    'customers',
    'about',
    'integrations',
    'docs',
    'pricing',
    'changelog',
    'blog',
    'contact',
  ],
  'site-scroll-first': ['product', 'home', 'other', 'customers', 'about', 'blog', 'contact'],
  'site-scroll-second': ['pricing', 'docs', 'changelog', 'integrations'],
};

const orderScore = (order: readonly PageKind[], kind: PageKind) => {
  const index = order.indexOf(kind);
  return index < 0 ? 0 : (order.length - index) * 5;
};

/**
 * The candidates a scene may take, best first. `used` counts assets already given to earlier
 * scenes, so the film does not repeat a picture while another would do.
 */
export function rankCandidates(
  scene: Scene,
  campaign: Campaign,
  infos: readonly AssetInfo[],
  used: ReadonlyMap<string, number>,
): Candidate[] {
  const slot = slotOf(scene.type);
  if (slot.source !== 'captured') return [];
  const eligible = infos.filter(
    (info) => slot.tiers.includes(info.tier) && slot.kinds.includes(info.asset.kind),
  );
  const canonical = canonicalIds(infos);
  const director = new Set(scene.assetIds.map((id) => canonical.get(id) ?? id));
  const cited = citedPages(scene, campaign);
  // A montage may repeat a picture shown elsewhere; a scene about one idea should not.
  const reuse = (id: string) => (scene.type === 'tile-wall' ? 0 : (used.get(id) ?? 0) * REUSE);

  const scored = eligible.map((info): Candidate => {
    const reasons: string[] = [`tier ${info.tier}`, info.crop ? 'crop' : 'page top', info.pageKind];
    let score = 0;
    switch (scene.type) {
      case 'site-hero':
        score += orderScore(PAGE_ORDER['site-hero'] ?? [], info.pageKind) + (info.crop ? 0 : 20);
        if (info.asset.provenance === 'uploaded') score += 30;
        break;
      case 'site-scroll':
        score +=
          info.tier === 2
            ? 60 + orderScore(PAGE_ORDER['site-scroll-second'] ?? [], info.pageKind)
            : orderScore(PAGE_ORDER['site-scroll-first'] ?? [], info.pageKind);
        if (info.crop) score -= 40;
        break;
      case 'tile-wall':
        score += (4 - info.tier) * 10 + (info.pageKind === 'contact' ? -20 : 0);
        break;
      default: {
        // feature-card and rail-words: a crop from a page the copy cites shows that feature.
        if (info.page !== undefined && cited.has(info.page)) {
          score += info.crop ? 100 : 60;
          reasons.push('on a cited page');
        } else if (info.crop) score += 10;
      }
    }
    if (director.has(info.id)) {
      score += 50;
      reasons.push("the Director's choice");
    }
    score -= reuse(info.id);
    if (used.has(info.id) && scene.type !== 'tile-wall') reasons.push('already used');
    return { id: info.id, score, why: reasons.join(', ') };
  });
  return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** A candidate counts as relevant for an optional slot only when it is on a page the copy cites. */
const RELEVANT = 30;
/** What each earlier use of a picture costs it, outside `tile-wall`. */
const REUSE = 50;
/** Candidates offered to the agent per scene, besides `tile-wall`, which is offered its maximum. */
export const OFFER = 6;

export interface Proposal {
  sceneId: string;
  path: string;
  type: string;
  slot: Slot;
  candidates: Candidate[];
  /** The code's default pick. */
  assetIds: string[];
  tier: Tier | 4 | 5 | undefined;
  note: string | undefined;
}

/**
 * The code's default assignment for every scene with a captured-asset slot. `site-hero` and
 * `site-scroll` keep the Director's eligible choice, because their props hold capture boxes in that
 * page's pixels. Optional slots are filled only with a relevant candidate; otherwise the scene is
 * tier 4 (greeked) and takes none.
 */
export function proposeAssets(campaign: Campaign, infos: readonly AssetInfo[]): Proposal[] {
  const used = new Map<string, number>();
  const tierOf = new Map(infos.map((info) => [info.id, info.tier]));
  const canonical = canonicalIds(infos);
  const proposals: Proposal[] = [];
  for (const { scene, path } of allScenes(campaign)) {
    const slot = slotOf(scene.type);
    if (slot.source !== 'captured') continue;
    const candidates = rankCandidates(scene, campaign, infos, used);
    const eligible = new Set(candidates.map((candidate) => candidate.id));
    let assetIds: string[];
    let note: string | undefined;
    const chosen = scene.assetIds.map((id) => canonical.get(id) ?? id);
    const keepDirector =
      (scene.type === 'site-hero' || scene.type === 'site-scroll') &&
      chosen.length === slot.min &&
      chosen.every((id) => eligible.has(id)) &&
      new Set(chosen).size === chosen.length;
    if (keepDirector) {
      assetIds = chosen;
      note = "Kept the Director's pages: the props hold capture boxes in their pixels.";
    } else if (scene.type === 'site-scroll') {
      assetIds = pickPages(candidates, infos);
    } else {
      const pool = slot.min === 0 ? candidates.filter((c) => c.score >= RELEVANT) : candidates;
      assetIds = pool.slice(0, slot.fill).map((candidate) => candidate.id);
    }
    if (assetIds.length < slot.min) {
      note = `Only ${assetIds.length} eligible asset(s) for a slot that needs ${slot.min}.`;
    }
    if (scene.type !== 'tile-wall') {
      for (const id of assetIds) used.set(id, (used.get(id) ?? 0) + 1);
    }
    const tiers = assetIds.flatMap((id) => tierOf.get(id) ?? []);
    // The agent sees the best few, and always the default, so its view stays small.
    const offer = scene.type === 'tile-wall' ? slot.max : OFFER;
    const offered = candidates.filter(
      (candidate, index) => index < offer || assetIds.includes(candidate.id),
    );
    proposals.push({
      sceneId: scene.id,
      path,
      type: scene.type,
      slot,
      candidates: offered,
      assetIds,
      tier: tiers.length ? (Math.max(...tiers) as Tier) : slot.min === 0 ? 4 : undefined,
      note,
    });
  }
  return proposals;
}

/** Two different pages for `site-scroll`: a site page, then a docs, pricing or changelog page. */
function pickPages(candidates: readonly Candidate[], infos: readonly AssetInfo[]): string[] {
  const info = new Map(infos.map((item) => [item.id, item]));
  const pageOf = (id: string) => info.get(id)?.page ?? id;
  const second = candidates.find((candidate) => info.get(candidate.id)?.tier === 2);
  const others = candidates.filter(
    (candidate) => !second || pageOf(candidate.id) !== pageOf(second.id),
  );
  const first = others.find((candidate) => info.get(candidate.id)?.tier === 3) ?? others[0];
  if (!first) return second ? [second.id] : [];
  if (second) return [first.id, second.id];
  const another = others.find((candidate) => pageOf(candidate.id) !== pageOf(first.id));
  return another ? [first.id, another.id] : [first.id];
}

export interface PickProblem {
  sceneId: string;
  message: string;
  fix: string;
}

/**
 * Checks a set of picks for one scene against its slot and candidates. A picture may not repeat in
 * a scene, and a `site-scroll` needs two different pages.
 */
export function checkPick(
  proposal: Proposal,
  assetIds: readonly string[],
  infos: readonly AssetInfo[],
): PickProblem[] {
  const problems: PickProblem[] = [];
  const allowed = new Set(proposal.candidates.map((candidate) => candidate.id));
  const info = new Map(infos.map((item) => [item.id, item]));
  const outside = assetIds.filter((id) => !allowed.has(id));
  const { min, max } = proposal.slot;
  const enough = Math.min(min, proposal.candidates.length);
  if (outside.length > 0) {
    problems.push({
      sceneId: proposal.sceneId,
      message: `${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} not among this scene's candidates.`,
      fix: `Choose only from: ${[...allowed].join(', ')}.`,
    });
  }
  if (assetIds.length < enough || assetIds.length > max) {
    problems.push({
      sceneId: proposal.sceneId,
      message: `${proposal.type} takes ${min === max ? min : `${enough} to ${max}`} asset(s); you gave ${assetIds.length}.`,
      fix: `Give ${proposal.sceneId} between ${enough} and ${max} asset ids.`,
    });
  }
  const pictures = assetIds.map((id) => info.get(id)?.digest ?? id);
  if (new Set(pictures).size !== pictures.length) {
    problems.push({
      sceneId: proposal.sceneId,
      message: 'The same picture is listed twice.',
      fix: 'List each picture once.',
    });
  }
  if (proposal.type === 'site-scroll') {
    const pages = assetIds.map((id) => info.get(id)?.page ?? id);
    if (new Set(pages).size !== pages.length) {
      problems.push({
        sceneId: proposal.sceneId,
        message: 'Both site-scroll assets are the same page.',
        fix: 'Choose two different pages, the second a docs, pricing or changelog page if one exists.',
      });
    }
  }
  return problems;
}
