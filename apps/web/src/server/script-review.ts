import type { Campaign, Scene, TextItem, TextRole } from '@boiler-room/schema';
import {
  type BrandLook,
  type BrandSceneData,
  brandLook,
  brandScene,
  sceneWords,
} from '../lib/brand-scene.ts';
import type { FilmStatus, Format, Stage } from '../lib/film.ts';
import type { ApprovalView, FilmDetail } from './api/films.ts';

/**
 * What the script review screen shows, built on the server from a film and its campaign: the whole
 * script as a customer reads it, scene by scene, with the source of every number. Plain data only:
 * the screen is a client component, and importing `@boiler-room/schema` there would put zod in the
 * browser bundle. Developer detail (templates, props, character limits, the JSON) stays out.
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
  /** The founder's choices, once they approved. */
  approved: {
    hookId: string | null;
    ctaId: string | null;
    formats: Format[];
    confirmedClaimIds: string[];
  } | null;
  /** The note on the version the Director is rewriting, while they rewrite it. */
  rewriteNote: string | null;
  durationSeconds: number;
  look: BrandLook;
  scenes: ReviewScene[];
  /** Alternate first scenes. Each replaces scene 1 and keeps its timing. */
  hooks: ReviewHook[];
  ctas: { id: string; label: string; href: string }[];
  formats: Format[];
  claims: ReviewClaim[];
  /** Lines that cite a claim nobody has confirmed, first use of each claim. */
  unconfirmed: UnconfirmedUse[];
  /** How many times a delivered film can be changed. Said before the founder approves. */
  maxRevisions: number;
}

/**
 * `waiting`: the script is the founder's to approve or send back.
 * `checking`: the crew is still writing or checking it. `rewriting`: the Director is working from
 * the founder's note. `approved`: approved, and the crew is making the film or has delivered it.
 * `failed`: the run stopped.
 */
export type ReviewState = 'waiting' | 'checking' | 'rewriting' | 'approved' | 'failed';

export interface ReviewScene {
  id: string;
  /** 1 for the first scene. */
  number: number;
  name: string;
  start: number;
  end: number;
  /**
   * What is on screen, as the script reads it: the headline first, or the scene's first line when
   * it has no headline (a site-hero's address, an end-card's button), then the rest in the order
   * the scene shows them. Empty for a scene with no words, such as a tile wall.
   */
  lines: ReviewText[];
  voiceover: { text: string; claimIds: string[] } | null;
  /** Cited by any line or the voiceover, first use first. */
  claimIds: string[];
  /** The scene as the preview draws it. */
  frame: BrandSceneData;
}

export interface ReviewText {
  id: string;
  role: TextRole;
  label: string;
  value: string;
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
  /** The claim in a few words: "Plans start at $29 per seat". */
  text: string;
  quote: string;
  sourceUrl: string;
  /** The source without its scheme, as the design shows it: `nova.example.com/customers`. */
  sourceLabel: string;
  /** The crew checked it against the site. */
  checked: boolean;
  /** The founder confirmed it when they approved. */
  confirmedByYou: boolean;
  /** Scene numbers that cite it. Empty when the film does not use it. */
  usedIn: number[];
}

export interface UnconfirmedUse {
  claimId: string;
  sceneNumber: number;
  /** The line that cites the claim, as it reads in the video. */
  says: string;
  /** The number in the claim, such as "$29", for the button that confirms it. */
  figure: string | null;
  /** Set when only an alternate opening cites it: then it matters only if that opening is picked. */
  hookId: string | null;
}

export const ROLE_LABELS: Record<TextRole, string> = {
  headline: 'Headline',
  subhead: 'Subhead',
  body: 'Body',
  cta: 'Call to action',
  label: 'Label',
};

const FIGURE = /\$?\d[\d,.]*(?:%|x\b)?/;

export function buildReviewModel(
  detail: FilmDetail & { campaign: Campaign },
  { maxRevisions }: { maxRevisions: number },
): ReviewModel {
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

  const state = reviewState(film, detail.approvals);
  const approval = state === 'approved' ? approvalOf(film.scriptVersion, detail.approvals) : null;
  const confirmedByYou = new Set(approval?.confirmedClaimIds ?? []);

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
    text: claim.text,
    quote: claim.quote,
    sourceUrl: claim.sourceUrl,
    sourceLabel: sourceLabel(claim.sourceUrl),
    checked: claim.status === 'approved',
    confirmedByYou: confirmedByYou.has(claim.id),
    usedIn: [...(usage.get(claim.id) ?? [])].sort((a, b) => a - b),
  }));

  const pending = new Map(
    campaign.claims.filter((claim) => claim.status !== 'approved').map((c) => [c.id, c]),
  );
  const unconfirmed: UnconfirmedUse[] = [];
  const seen = new Set<string>();
  const cuts: [ReviewScene, string | null][] = [
    ...scenes.map((scene): [ReviewScene, null] => [scene, null]),
    ...hooks.map((hook): [ReviewScene, string] => [hook.scene, hook.id]),
  ];
  for (const [scene, hookId] of cuts) {
    const lines = [
      ...scene.lines.map((item) => ({ says: item.value, claimIds: item.claimIds })),
      ...(scene.voiceover
        ? [{ says: scene.voiceover.text, claimIds: scene.voiceover.claimIds }]
        : []),
    ];
    for (const line of lines) {
      for (const claimId of line.claimIds) {
        const claim = pending.get(claimId);
        if (!claim || seen.has(claimId)) continue;
        seen.add(claimId);
        unconfirmed.push({
          claimId,
          sceneNumber: scene.number,
          says: line.says,
          figure: FIGURE.exec(claim.text)?.[0] ?? FIGURE.exec(claim.quote)?.[0] ?? null,
          hookId,
        });
      }
    }
  }

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
    approved:
      film.formats.length > 0
        ? {
            hookId: film.chosenHook,
            ctaId: film.chosenCta,
            formats: film.formats,
            confirmedClaimIds: [...confirmedByYou],
          }
        : null,
    rewriteNote: rewriteNote(film, detail.approvals),
    durationSeconds: campaign.durationSeconds,
    look: brandLook(campaign),
    scenes,
    hooks,
    ctas: campaign.variants.ctas.map(({ id, label, href }) => ({ id, label, href })),
    formats: [...campaign.variants.formats],
    claims,
    unconfirmed,
    maxRevisions,
  };
}

function reviewScene(campaign: Campaign, scene: Scene, number: number): ReviewScene {
  const lead = leadOf(scene);
  const ordered = lead ? [lead, ...scene.text.filter((item) => item !== lead)] : scene.text;
  const lines: ReviewText[] = ordered.map((item) => ({
    id: item.id,
    role: item.role,
    label: ROLE_LABELS[item.role],
    value: item.value,
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
    name: sceneWords(scene.id),
    start: scene.start,
    end: scene.end,
    lines,
    voiceover: scene.voiceover
      ? { text: scene.voiceover.text, claimIds: [...scene.voiceover.claimIds] }
      : null,
    claimIds,
    frame: brandScene(campaign, scene),
  };
}

function reviewState(film: FilmDetail['film'], approvals: ApprovalView[]): ReviewState {
  if (film.status === 'failed') return 'failed';
  if (film.status === 'needs_you' && film.stage === 'approval') return 'waiting';
  if (approvals.some((row) => row.decision === 'approved')) return 'approved';
  if (rewriteNote(film, approvals) !== null) return 'rewriting';
  return 'checking';
}

/** The approval of `version`, or the latest approval when that version has none yet. */
function approvalOf(version: number, approvals: ApprovalView[]): ApprovalView | null {
  const approved = approvals.filter((row) => row.decision === 'approved');
  return approved.find((row) => row.scriptVersion === version) ?? approved.at(-1) ?? null;
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

/**
 * The line a scene leads with: its headline, or its first line when the scene type has none. Scene
 * types differ in their roles (`docs/motion/scenes`): a site-hero has only its address label, an
 * end-card its button and address.
 */
function leadOf(scene: Scene): TextItem | undefined {
  return scene.text.find((item) => item.role === 'headline') ?? scene.text[0];
}

function headlineOf(scene: Scene): string {
  return leadOf(scene)?.value ?? scene.id;
}

/** `hero-shot` reads "Hero shot". */
export const words = sceneWords;

export function sourceLabel(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
