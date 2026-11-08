import {
  type Campaign,
  DEFAULT_TEXT_LIMITS,
  type Scene,
  sceneRegistry,
  type TextRole,
} from '@boiler-room/schema';
import type { FilmStatus, Format, Stage } from '../lib/film.ts';
import type { ApprovalView, FilmDetail, FilmEventView } from './api/films.ts';

/**
 * What the script review screen shows, built on the server from a film and its campaign. Plain
 * data only: the screen is a client component, and importing `@boiler-room/schema` there would
 * put zod in the browser bundle. So the character limits are worked out here.
 */
export interface ReviewModel {
  film: {
    id: string;
    title: string;
    simulated: boolean;
    status: FilmStatus;
    stage: Stage;
    scriptVersion: number;
  };
  /** What the founder can do right now. */
  state: ReviewState;
  /** The Validator's last word on this script was a pass. */
  validatorPassed: boolean;
  /** The founder's choices, once they approved. */
  approved: { hookId: string | null; ctaId: string | null; formats: Format[] } | null;
  /** The note on the version the Director is rewriting, while they rewrite it. */
  rewriteNote: string | null;
  durationSeconds: number;
  brand: ReviewBrand;
  scenes: ReviewScene[];
  /** Alternate first scenes. Each replaces scene 1 and keeps its timing. */
  hooks: ReviewHook[];
  ctas: { id: string; label: string; href: string }[];
  formats: Format[];
  claims: ReviewClaim[];
  /** On-screen or spoken copy that cites a claim nobody has confirmed. */
  unconfirmed: UnconfirmedUse[];
  /** The music bed's asset id, if there is one. */
  music: string | null;
  sfx: { assetId: string; at: number }[];
  /** Seconds to mark on the timeline's ruler, from 0 to the end. */
  ticks: number[];
  /** The campaign as the crew wrote it. */
  campaignJson: string;
}

/**
 * `waiting`: the script is the founder's to approve or send back.
 * `checking`: the crew is still writing or checking it. `rewriting`: the Director is working from
 * the founder's note. `approved`: approved, and the crew is making the film or has delivered it.
 * `failed`: the run stopped.
 */
export type ReviewState = 'waiting' | 'checking' | 'rewriting' | 'approved' | 'failed';

export interface ReviewBrand {
  name: string;
  background: string;
  foreground: string;
  primary: string;
  muted: string;
  /** Corner radius in px. The customer's shape, not ours. */
  radius: number;
  /** Font family names only. The preview never downloads the customer's fonts. */
  displayFont: string;
  bodyFont: string;
}

export interface ReviewScene {
  id: string;
  /** 1 for the first scene. */
  number: number;
  /** The scene id as words: `open` is "Open", `hero-shot` is "Hero shot". */
  name: string;
  type: string;
  start: number;
  end: number;
  transitionOut: string | null;
  /** Template settings with a simple value, such as layout or align. */
  props: { key: string; value: string }[];
  text: ReviewText[];
  voiceover: { text: string; claimIds: string[] } | null;
  /** Cited by any line or the voiceover, first use first. */
  claimIds: string[];
  /** Shows a product image or video, so the preview draws a screenshot frame. */
  showsProduct: boolean;
}

export interface ReviewText {
  id: string;
  role: TextRole;
  label: string;
  value: string;
  /** Characters, counted as the Validator counts them. */
  length: number;
  limit: number;
  claimIds: string[];
}

export interface ReviewHook {
  id: string;
  /** "Hook B" for the first alternate, as the main opening is A. */
  label: string;
  /** The hook's headline, or its first line. */
  headline: string;
  scene: ReviewScene;
}

export interface ReviewClaim {
  id: string;
  quote: string;
  sourceUrl: string;
  /** The source without its scheme, as the design shows it: `nova.example.com/customers`. */
  sourceLabel: string;
  approved: boolean;
  /** Scene numbers that cite it. Empty when the film does not use it. */
  usedIn: number[];
}

export interface UnconfirmedUse {
  claimId: string;
  sceneNumber: number;
  /** The line that cites the claim, as it reads in the video. */
  says: string;
}

export const ROLE_LABELS: Record<TextRole, string> = {
  headline: 'Headline',
  subhead: 'Subhead',
  body: 'Body',
  cta: 'Call to action',
  label: 'Label',
};

const PRODUCT_ASSETS = new Set(['image', 'video']);

export function buildReviewModel(detail: FilmDetail & { campaign: Campaign }): ReviewModel {
  const { film, campaign } = detail;
  const scenes = campaign.scenes.map((scene, index) => reviewScene(campaign, scene, index + 1));
  const first = campaign.scenes[0];
  const hooks = campaign.variants.hooks.map((hook, index) => {
    // A hook replaces the first scene and matches its timing.
    const scene = reviewScene(
      campaign,
      { ...hook, start: first?.start ?? hook.start, end: first?.end ?? hook.end },
      1,
    );
    return {
      id: hook.id,
      label: `Hook ${String.fromCharCode(66 + index)}`,
      headline: headlineOf(hook),
      scene,
    };
  });

  const usage = new Map<string, Set<number>>();
  for (const scene of [...scenes, ...hooks.map((hook) => hook.scene)]) {
    for (const id of scene.claimIds) {
      const used = usage.get(id) ?? new Set<number>();
      used.add(scene.number);
      usage.set(id, used);
    }
  }
  const claims: ReviewClaim[] = campaign.claims.map((claim) => ({
    id: claim.id,
    quote: claim.quote,
    sourceUrl: claim.sourceUrl,
    sourceLabel: sourceLabel(claim.sourceUrl),
    approved: claim.status === 'approved',
    usedIn: [...(usage.get(claim.id) ?? [])].sort((a, b) => a - b),
  }));

  const pending = new Set(campaign.claims.filter((c) => c.status !== 'approved').map((c) => c.id));
  const unconfirmed: UnconfirmedUse[] = [];
  const seen = new Set<string>();
  for (const scene of [...scenes, ...hooks.map((hook) => hook.scene)]) {
    const lines = [
      ...scene.text.map((item) => ({ says: item.value, claimIds: item.claimIds })),
      ...(scene.voiceover
        ? [{ says: scene.voiceover.text, claimIds: scene.voiceover.claimIds }]
        : []),
    ];
    for (const line of lines) {
      for (const claimId of line.claimIds) {
        if (!pending.has(claimId) || seen.has(claimId)) continue;
        seen.add(claimId);
        unconfirmed.push({ claimId, sceneNumber: scene.number, says: line.says });
      }
    }
  }

  const colors = campaign.brand.colors;
  const state = reviewState(film, detail.approvals);
  return {
    film: {
      id: film.id,
      title: film.title,
      simulated: film.simulated,
      status: film.status,
      stage: film.stage,
      scriptVersion: film.scriptVersion,
    },
    state,
    // A pass on an earlier version says nothing about the one being rewritten.
    validatorPassed:
      (state === 'waiting' || state === 'approved') && validatorPassed(detail.events),
    approved:
      film.formats.length > 0
        ? { hookId: film.chosenHook, ctaId: film.chosenCta, formats: film.formats }
        : null,
    rewriteNote: rewriteNote(film, detail.approvals),
    durationSeconds: campaign.durationSeconds,
    brand: {
      name: campaign.brand.name,
      background: colors.background,
      foreground: colors.foreground,
      primary: colors.primary,
      muted: colors.muted ?? colors.foreground,
      radius: campaign.brand.radius ?? 0,
      displayFont: campaign.brand.fonts.display.family,
      bodyFont: campaign.brand.fonts.body.family,
    },
    scenes,
    hooks,
    ctas: campaign.variants.ctas.map(({ id, label, href }) => ({ id, label, href })),
    formats: [...campaign.variants.formats],
    claims,
    unconfirmed,
    music: campaign.audio?.musicAssetId ?? null,
    sfx: (campaign.audio?.sfx ?? []).map(({ assetId, at }) => ({ assetId, at })),
    ticks: rulerTicks(campaign.durationSeconds),
    campaignJson: JSON.stringify(campaign, null, 2),
  };
}

function reviewScene(campaign: Campaign, scene: Scene, number: number): ReviewScene {
  const limits = sceneRegistry[scene.type]?.text ?? {};
  const text: ReviewText[] = scene.text.map((item) => ({
    id: item.id,
    role: item.role,
    label: ROLE_LABELS[item.role],
    value: item.value,
    length: [...item.value].length,
    limit: limits[item.role] ?? DEFAULT_TEXT_LIMITS[item.role],
    claimIds: [...item.claimIds],
  }));
  const claimIds = [
    ...new Set([
      ...scene.text.flatMap((item) => item.claimIds),
      ...(scene.voiceover?.claimIds ?? []),
    ]),
  ];
  return {
    id: scene.id,
    number,
    name: words(scene.id),
    type: scene.type,
    start: scene.start,
    end: scene.end,
    transitionOut: scene.transitionOut ?? null,
    props: Object.entries(scene.props)
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
      .map(([key, value]) => ({ key: words(key), value: String(value) })),
    text,
    voiceover: scene.voiceover
      ? { text: scene.voiceover.text, claimIds: [...scene.voiceover.claimIds] }
      : null,
    claimIds,
    showsProduct: scene.assetIds.some((id) => PRODUCT_ASSETS.has(campaign.assets[id]?.kind ?? '')),
  };
}

function reviewState(film: FilmDetail['film'], approvals: ApprovalView[]): ReviewState {
  if (film.status === 'failed') return 'failed';
  if (film.status === 'needs_you' && film.stage === 'approval') return 'waiting';
  if (approvals.some((row) => row.decision === 'approved')) return 'approved';
  if (rewriteNote(film, approvals) !== null) return 'rewriting';
  return 'checking';
}

/** The founder's note, while the Director rewrites the version it was written on. */
function rewriteNote(film: FilmDetail['film'], approvals: ApprovalView[]): string | null {
  if (film.status === 'needs_you' || film.status === 'done' || film.status === 'failed') {
    return null;
  }
  const last = approvals[approvals.length - 1];
  return last?.decision === 'changes_requested' && last.scriptVersion === film.scriptVersion
    ? (last.note ?? '')
    : null;
}

function validatorPassed(events: FilmEventView[]): boolean {
  const last = events.filter((event) => event.agent === 'validator').at(-1);
  return last?.kind === 'passed';
}

function headlineOf(scene: Scene): string {
  return (scene.text.find((item) => item.role === 'headline') ?? scene.text[0])?.value ?? scene.id;
}

/** `hero-shot` reads "Hero shot". */
export function words(id: string): string {
  const spaced = id.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function sourceLabel(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** Five or so evenly spaced marks: every 2s for a short film, 5s up to 30s, then 10s. */
export function rulerTicks(duration: number): number[] {
  const step = duration <= 12 ? 2 : duration <= 30 ? 5 : 10;
  const ticks: number[] = [];
  for (let at = 0; at < duration - step / 2; at += step) ticks.push(at);
  ticks.push(duration);
  return ticks;
}
