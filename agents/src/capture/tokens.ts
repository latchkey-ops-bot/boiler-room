import { blend, chroma, contrast, distance, hueDistance, luminance, readableOn } from './color.ts';
import type { RawStyles, SeenColor, WeightedColor } from './types.ts';

/** Contrast the campaign validator demands: 4.5:1 for text and 3:1 for the primary colour. */
const MIN_TEXT = 4.5;
const MIN_PRIMARY = 3;
/** Below this chroma a colour reads as grey, so it cannot be the brand's colour. */
const MIN_BRAND_CHROMA = 0.18;
/** Colours closer than this are one colour with rounding or antialiasing differences. */
const SAME = 14;
/** Link colours a browser uses when the site sets none. They say nothing about the brand. */
const BROWSER_DEFAULTS = new Set(['#0000EE', '#551A8B', '#0000FF', '#EE0000']);

export interface Candidate {
  hex: string;
  score: number;
  sources: string[];
}

export interface DerivedColors {
  background: string;
  foreground: string;
  primary: string;
  accent: string | null;
  muted: string | null;
  accents: string[];
  mode: 'light' | 'dark';
  radius: number | null;
  cssVariables: boolean;
  /** Every candidate brand colour, best first, with where it was seen. */
  candidates: Candidate[];
  notes: string[];
}

function opaque(color: SeenColor, over: string): string {
  return blend(color.hex, color.alpha, over);
}

/** Adds weight to the colour already in the list that matches, or adds the colour. */
function tally<T extends { hex: string; score: number }>(
  list: T[],
  hex: string,
  add: number,
  make: () => T,
): T {
  const found = list.find((item) => distance(item.hex, hex) < SAME);
  if (found) {
    found.score += add;
    return found;
  }
  const item = make();
  item.score = add;
  list.push(item);
  return item;
}

/** Share of samples the body colour needs to count as the page background. */
const ROOT_SHARE = 0.25;

/**
 * The colour the page is painted with. The body's own colour wins when it covers at least a
 * quarter of the first screens, so a large dark product shot does not turn a light site dark.
 * Otherwise the most sampled colour wins, which handles a site that paints a wrapper instead of
 * the body.
 */
export function pickBackground(styles: RawStyles): { hex: string; surfaces: string[] } {
  const totals: { hex: string; score: number }[] = [];
  for (const sample of styles.backgrounds) {
    if (sample.alpha < 0.5) continue;
    tally(totals, sample.hex.toUpperCase(), sample.weight, () => ({
      hex: sample.hex.toUpperCase(),
      score: 0,
    }));
  }
  totals.sort((a, b) => b.score - a.score);
  const all = totals.reduce((sum, item) => sum + item.score, 0);
  const surfaces = totals.filter((item) => item.score >= all * 0.05).map((item) => item.hex);
  const root = styles.root?.toUpperCase();
  const rootShare = root
    ? (totals.find((item) => distance(item.hex, root) < SAME)?.score ?? 0) / (all || 1)
    : 0;
  if (root && (all === 0 || rootShare >= ROOT_SHARE)) return { hex: root, surfaces };
  return { hex: totals[0]?.hex ?? root ?? '#FFFFFF', surfaces };
}

function textTotals(texts: WeightedColor[], background: string): { hex: string; score: number }[] {
  const totals: { hex: string; score: number }[] = [];
  for (const text of texts) {
    const hex = opaque(text, background);
    tally(totals, hex, text.weight, () => ({ hex, score: 0 }));
  }
  return totals.sort((a, b) => b.score - a.score);
}

/** Saturated colours the brand uses, scored by how prominently they appear. */
export function brandCandidates(styles: RawStyles, background: string): Candidate[] {
  const list: Candidate[] = [];
  const add = (color: SeenColor | null, weight: number, source: string) => {
    if (!color || color.alpha < 0.5) return;
    const hex = opaque(color, background);
    if (chroma(hex) < MIN_BRAND_CHROMA || distance(hex, background) < SAME) return;
    if (BROWSER_DEFAULTS.has(hex)) return;
    const item = tally(list, hex, weight, () => ({ hex, score: 0, sources: [] }));
    if (!item.sources.includes(source)) item.sources.push(source);
  };
  for (const cta of styles.ctas) {
    const prominence = cta.placement === 'nav' || cta.placement === 'hero' ? 2 : 1;
    const filled =
      cta.background &&
      cta.background.alpha >= 0.5 &&
      distance(opaque(cta.background, background), background) >= SAME;
    if (filled) add(cta.background, 6 * prominence, `${cta.placement} button fill`);
    else {
      add(cta.border, 3 * prominence, `${cta.placement} button border`);
      add(cta.color, 2 * prominence, `${cta.placement} button text`);
    }
  }
  for (const link of styles.links) add(link, Math.min(link.weight, 8), 'links');
  for (const text of styles.texts) {
    add(
      text,
      Math.min(text.weight / (text.heading ? 10 : 40), text.heading ? 8 : 4),
      text.heading ? 'headings' : 'text',
    );
  }
  for (const variable of styles.colorVariables) {
    if (/primary|brand|accent|main/i.test(variable.name)) add(variable, 3, `var ${variable.name}`);
  }
  return list.sort((a, b) => b.score - a.score);
}

/** The radius of the brand's buttons, or of its cards when it has no buttons. 999 means pill. */
export function pickRadius(styles: RawStyles): number | null {
  const counts = new Map<number, number>();
  for (const cta of styles.ctas) {
    const px = cta.pill ? 999 : Math.round(cta.radius);
    counts.set(px, (counts.get(px) ?? 0) + 1);
  }
  if (counts.size === 0) {
    for (const card of styles.cardRadii) {
      const px = Math.round(card.px);
      counts.set(px, (counts.get(px) ?? 0) + card.weight);
    }
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [px, count] of counts) {
    if (count > bestCount) {
      best = px;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Brand colours from computed styles. Works whether or not the site uses CSS variables, because
 * it measures what is painted. Every colour returned was seen on the page, except a black or
 * white foreground when no text colour clears 4.5:1, which is noted. When the measured brand colour
 * fails 3:1 on the background, the next real candidate or another real page surface is used, and
 * the adjustment is noted.
 */
export function deriveColors(styles: RawStyles): DerivedColors {
  const notes: string[] = [];
  let { hex: background, surfaces } = pickBackground(styles);
  if (styles.backgrounds.length === 0)
    notes.push('No painted background was sampled, so white was assumed.');

  const candidates = brandCandidates(styles, background);
  let primary = candidates[0]?.hex;

  const chooseForeground = (bg: string) =>
    textTotals(styles.texts, bg).find((item) => contrast(item.hex, bg) >= MIN_TEXT)?.hex;

  if (primary && contrast(primary, background) < MIN_PRIMARY) {
    const measured = primary;
    const alternative = candidates.find((item) => contrast(item.hex, background) >= MIN_PRIMARY);
    const surface = surfaces.find(
      (hex) =>
        hex !== background && contrast(measured, hex) >= MIN_PRIMARY && chooseForeground(hex),
    );
    if (surface) {
      notes.push(
        `The brand colour ${measured} has ${contrast(measured, background).toFixed(2)}:1 on ${background}, so the page surface ${surface} it also sits on was used as the background.`,
      );
      background = surface;
    } else if (alternative) {
      notes.push(
        `The most used brand colour ${measured} has only ${contrast(measured, background).toFixed(2)}:1 on ${background}, so the next brand colour seen on the site, ${alternative.hex}, is primary. ${measured} is kept as an accent.`,
      );
      primary = alternative.hex;
    } else {
      notes.push(
        `The brand colour ${measured} has only ${contrast(measured, background).toFixed(2)}:1 on ${background} and no other site colour clears 3:1, so the text colour is primary. ${measured} is kept as an accent.`,
      );
      primary = undefined;
    }
  }

  let foreground = chooseForeground(background);
  if (!foreground) {
    foreground = readableOn(background);
    notes.push(
      `No text colour on the site clears 4.5:1 on ${background}, so ${foreground} is used as foreground.`,
    );
  }
  if (!primary) {
    primary = foreground;
    if (candidates.length === 0)
      notes.push('The site uses no saturated colour, so the text colour is primary.');
  }

  const accents = candidates
    .map((item) => item.hex)
    .filter((hex) => hex !== primary && distance(hex, primary) >= SAME)
    .filter((hex, index, list) => list.findIndex((other) => distance(other, hex) < 40) === index)
    .slice(0, 4);
  const accent =
    accents.find((hex) => hueDistance(hex, primary) >= 25 || distance(hex, primary) > 80) ?? null;

  const muted =
    textTotals(styles.texts, background).find(
      (item) =>
        distance(item.hex, foreground) >= 40 &&
        chroma(item.hex) < MIN_BRAND_CHROMA &&
        contrast(item.hex, background) >= MIN_PRIMARY,
    )?.hex ?? null;

  return {
    background,
    foreground,
    primary,
    accent,
    muted,
    accents,
    mode: luminance(background) < 0.18 ? 'dark' : 'light',
    radius: pickRadius(styles),
    cssVariables: styles.colorVariables.length > 0,
    candidates: candidates.slice(0, 8),
    notes,
  };
}
