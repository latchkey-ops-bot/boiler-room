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

/** Share of all text the body copy needs before it alone decides the text colours. */
const COPY_SHARE = 0.15;
/** Share of readable copy a colour needs to count as one of the site's main text colours. */
const MAIN_SHARE = 0.1;

/**
 * The body copy: text that is not in a link or button (which take the link colour, the browser's
 * blue on a site that sets none) and not in the navigation, header or footer. Falls back to all
 * text that is not a link, then to all text, when the page has too little copy to judge.
 */
export function copyTexts(styles: RawStyles): RawStyles['texts'] {
  const all = styles.texts;
  const total = all.reduce((sum, item) => sum + item.weight, 0);
  const share = (list: RawStyles['texts']) =>
    list.reduce((sum, item) => sum + item.weight, 0) / (total || 1);
  const copy = all.filter((item) => !item.link && !item.chrome);
  if (copy.length && share(copy) >= COPY_SHARE) return copy;
  const unlinked = all.filter((item) => !item.link);
  if (unlinked.length && share(unlinked) >= COPY_SHARE) return unlinked;
  return all;
}

/**
 * The text colour: of the colours the body copy is set in that clear 4.5:1, the one with the most
 * contrast among those carrying at least a tenth of the copy. Design systems rank text colours by
 * emphasis, and the primary text colour is the strongest one; the most characters can be in a
 * secondary grey (descriptions, captions), which would set every headline in the film dim.
 */
export function pickForeground(styles: RawStyles, background: string): string | undefined {
  const readable = textTotals(copyTexts(styles), background).filter(
    (item) => contrast(item.hex, background) >= MIN_TEXT,
  );
  const total = readable.reduce((sum, item) => sum + item.score, 0);
  const main = readable.filter((item) => item.score >= total * MAIN_SHARE);
  return main.sort((a, b) => contrast(b.hex, background) - contrast(a.hex, background))[0]?.hex;
}

/**
 * Secondary text: the most used grey of the body copy that is clearly a different colour from the
 * foreground, still clears 3:1, and has less contrast than the foreground. Muted is quieter than
 * the text colour by definition, so it can never be the brighter of the two.
 */
export function pickMuted(
  styles: RawStyles,
  background: string,
  foreground: string,
): string | null {
  const strongest = contrast(foreground, background);
  return (
    textTotals(copyTexts(styles), background).find(
      (item) =>
        distance(item.hex, foreground) >= 40 &&
        chroma(item.hex) < MIN_BRAND_CHROMA &&
        contrast(item.hex, background) >= MIN_PRIMARY &&
        contrast(item.hex, background) < strongest,
    )?.hex ?? null
  );
}

/** Words that make a colour variable something other than the brand colour itself. */
const NOT_THE_BRAND = new Set([
  'text',
  'fg',
  'foreground',
  'on',
  'ink',
  'border',
  'line',
  'outline',
  'ring',
  'shadow',
  'overlay',
  'hover',
  'active',
  'focus',
  'pressed',
  'disabled',
  'muted',
  'subtle',
  'tint',
  'soft',
  'weak',
  'light',
  'dark',
  'lighter',
  'darker',
  'sidebar',
  'chart',
  'link',
  'placeholder',
  'selection',
  'scrollbar',
  'input',
  'inverse',
  'contrast',
]);
/** Words that make a "primary" or "main" variable a page surface: `--bg-primary` is a background. */
const SURFACE = new Set(['bg', 'background', 'surface', 'canvas', 'page', 'base', 'body']);

export type VariableRole = { role: 'brand' | 'accent'; weight: number } | null;

/**
 * What a colour custom property declares, from its name. `--primary`, `--color-primary`,
 * `--brand` and `--color-brand-bg` declare the brand colour; `--accent` declares an accent. A name
 * qualified as text, a border, a state or a part of the page (`--color-text-primary`,
 * `--primary-foreground`, `--color-accent-hover`, `--bg-primary`) does not. A palette shade such as
 * `--primary-600` counts for less, since only one shade is the brand colour.
 */
export function variableRole(name: string): VariableRole {
  const words = name.replace(/^--/, '').toLowerCase().split(/[-_]+/).filter(Boolean);
  if (words.some((word) => NOT_THE_BRAND.has(word))) return null;
  const shade = words.some((word) => /^\d+$/.test(word));
  if (words.includes('brand')) return { role: 'brand', weight: shade ? 3 : 8 };
  if (words.includes('primary') || words.includes('main')) {
    if (words.some((word) => SURFACE.has(word))) return null;
    return { role: 'brand', weight: shade ? 3 : 8 };
  }
  if (words.includes('accent')) return { role: 'accent', weight: shade ? 1 : 2 };
  return null;
}

/**
 * Colours the brand uses, scored by how prominently they appear. A grey or black only counts when
 * the site both declares it as its primary or brand colour in a custom property and paints its
 * buttons with it: a monochrome brand, whose buttons are its brand colour.
 */
export function brandCandidates(styles: RawStyles, background: string): Candidate[] {
  const list: Candidate[] = [];
  const fills = styles.ctas
    .filter((cta) => cta.placement !== 'footer' && cta.background && cta.background.alpha >= 0.5)
    .map((cta) => opaque(cta.background as SeenColor, background));
  const declaredNeutral = styles.colorVariables
    .filter((variable) => variableRole(variable.name)?.role === 'brand' && variable.alpha >= 0.5)
    .map((variable) => opaque(variable, background))
    .filter(
      (hex) => chroma(hex) < MIN_BRAND_CHROMA && fills.some((fill) => distance(fill, hex) < SAME),
    );
  const add = (color: SeenColor | null, weight: number, source: string) => {
    if (!color || color.alpha < 0.5) return;
    const hex = opaque(color, background);
    if (distance(hex, background) < SAME || BROWSER_DEFAULTS.has(hex)) return;
    const neutralBrand = declaredNeutral.some((item) => distance(item, hex) < SAME);
    if (chroma(hex) < MIN_BRAND_CHROMA && !neutralBrand) return;
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
    const role = variableRole(variable.name);
    if (role) add(variable, role.weight, `var ${variable.name}`);
  }
  return list.sort((a, b) => b.score - a.score);
}

/**
 * The radius of the brand's buttons, or of its cards when it has no drawn buttons. 999 means pill.
 * Only a button with a fill or a border shows its corners: a text link or a menu toggle styled as a
 * button has a radius nobody sees, and a page full of them would otherwise read as square.
 */
export function pickRadius(styles: RawStyles): number | null {
  const counts = new Map<number, number>();
  for (const cta of styles.ctas) {
    if (!cta.background && !cta.border) continue;
    const px = cta.pill ? 999 : Math.round(cta.radius);
    const weight = cta.placement === 'nav' || cta.placement === 'hero' ? 2 : 1;
    counts.set(px, (counts.get(px) ?? 0) + weight);
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

  const chooseForeground = (bg: string) => pickForeground(styles, bg);

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
    if (candidates.length === 0) {
      const defaults = [...styles.links, ...styles.texts]
        .map((item) => item.hex.toUpperCase())
        .filter((hex, index, list) => BROWSER_DEFAULTS.has(hex) && list.indexOf(hex) === index);
      notes.push(
        defaults.length
          ? `The site sets no brand colour of its own: its links use the browser's default ${defaults.join(' and ')}, so the text colour is primary.`
          : 'The site uses no saturated colour, so the text colour is primary.',
      );
    }
  }

  const accents = candidates
    .map((item) => item.hex)
    .filter((hex) => hex !== primary && distance(hex, primary) >= SAME)
    .filter((hex, index, list) => list.findIndex((other) => distance(other, hex) < 40) === index)
    .slice(0, 4);
  const accent =
    accents.find((hex) => hueDistance(hex, primary) >= 25 || distance(hex, primary) > 80) ?? null;

  const muted = pickMuted(styles, background, foreground);
  const mode = luminance(background) < 0.18 ? 'dark' : 'light';
  const schemes = styles.colorScheme.toLowerCase().split(/\s+/);
  if (schemes.includes('light') && schemes.includes('dark'))
    notes.push(
      `The page declares both light and dark colour schemes; these colours are its ${mode} scheme, the one it showed the capture.`,
    );

  return {
    background,
    foreground,
    primary,
    accent,
    muted,
    accents,
    mode,
    radius: pickRadius(styles),
    cssVariables: styles.colorVariables.length > 0,
    candidates: candidates.slice(0, 8),
    notes,
  };
}
