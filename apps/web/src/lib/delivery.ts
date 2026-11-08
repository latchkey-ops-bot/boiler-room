import type { Campaign } from '@boiler-room/schema';
import type { DeliverableView, FilmView, RevisionView } from '../server/api/films.ts';
import { FORMATS, type Format } from './film.ts';

/**
 * The delivery screen's words and choices, kept out of the components so they can be tested.
 * Types only from the server: nothing here pulls server code into the browser.
 */

/** Each shape, said the way a founder thinks about it: where it goes. */
export const SHAPES: Record<Format, { name: string; use: string }> = {
  '16:9': { name: 'Landscape', use: 'Your homepage, YouTube, X and Product Hunt' },
  '9:16': { name: 'Tall', use: 'Reels, TikTok, Shorts and stories' },
  '1:1': { name: 'Square', use: 'LinkedIn and the X feed' },
};

/** All the files cut from one script version. */
export interface Cut {
  version: number;
  files: DeliverableView[];
}

/** The film's cuts, newest first, each with its files in shape order. */
export function cutsOf(deliverables: DeliverableView[]): Cut[] {
  const byVersion = new Map<number, DeliverableView[]>();
  for (const file of deliverables) {
    const files = byVersion.get(file.scriptVersion) ?? [];
    files.push(file);
    byVersion.set(file.scriptVersion, files);
  }
  return [...byVersion.entries()]
    .sort(([a], [b]) => b - a)
    .map(([version, files]) => ({
      version,
      files: files.sort(
        (a, b) =>
          FORMATS.indexOf(a.format) - FORMATS.indexOf(b.format) ||
          a.fileName.localeCompare(b.fileName),
      ),
    }));
}

/**
 * Where the delivery screen is.
 * - `delivered`: the film is done and its files are here.
 * - `revising`: the founder asked for changes; the crew is on the next version, and the last
 *   cut's files stay here meanwhile.
 * - `waiting`: nothing has been delivered yet.
 * - `failed`: the crew could not finish the film.
 */
export type DeliveryState = 'delivered' | 'revising' | 'waiting' | 'failed';

export function deliveryState(film: FilmView, cuts: Cut[]): DeliveryState {
  if (film.status === 'failed') return 'failed';
  if (cuts.length === 0) return 'waiting';
  return film.status === 'done' ? 'delivered' : 'revising';
}

/** "Main opening" or the alternate opening's headline, from the campaign. */
export function openingName(hookId: string | null, campaign: Campaign | null): string {
  if (hookId === null) return 'Main opening';
  const hook = campaign?.variants.hooks.find((item) => item.id === hookId);
  const headline = hook?.text.find((item) => item.role === 'headline')?.value;
  return headline ? `Opening: “${headline}”` : 'Alternate opening';
}

/** The call to action's own words, from the campaign. */
export function ctaName(ctaId: string | null, campaign: Campaign | null): string | null {
  if (ctaId === null) return null;
  return campaign?.variants.ctas.find((item) => item.id === ctaId)?.label ?? ctaId;
}

/** One line naming a file's opening and call to action. */
export function variantName(file: DeliverableView, campaign: Campaign | null): string {
  const cta = ctaName(file.ctaId, campaign);
  return [openingName(file.hookId, campaign), cta ? `ends on “${cta}”` : null]
    .filter(Boolean)
    .join(', ');
}

/** 20 → "0:20", 75 → "1:15". */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** 2_400_000 → "2.4 MB". */
export function fileSize(bytes: number | null): string | null {
  if (bytes === null || bytes < 0) return null;
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** How many more times this film can be revised. */
export function revisionsLeft(revisions: RevisionView[], max: number): number {
  return Math.max(0, max - revisions.length);
}

/** A scene of the preview: what it says, and when. */
export interface PreviewScene {
  id: string;
  name: string;
  start: number;
  end: number;
  headline: string | null;
  lines: string[];
}

/** The film the founder approved, as preview scenes: the chosen opening first, then the rest. */
export function previewScenes(campaign: Campaign, hookId: string | null): PreviewScene[] {
  const hook = hookId ? campaign.variants.hooks.find((item) => item.id === hookId) : undefined;
  const scenes = hook ? [hook, ...campaign.scenes.slice(1)] : campaign.scenes;
  return scenes.map((scene) => ({
    id: scene.id,
    name: sceneName(scene.id),
    start: scene.start,
    end: scene.end,
    headline: scene.text.find((item) => item.role === 'headline')?.value ?? null,
    lines: scene.text
      .filter((item) => item.role !== 'headline' && item.role !== 'cta')
      .map((item) => item.value),
  }));
}

/** `open-question` → "Open question". */
function sceneName(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
