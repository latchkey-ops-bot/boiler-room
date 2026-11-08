/**
 * One scene of a customer's film, drawn in the customer's brand from `campaign.json`, never ours.
 * Script review, delivery and the landing page's sample all draw scenes from this one model, so the
 * preview a founder approves is the preview they get back: the same fonts, colours, radius and
 * alignment. Types only from the schema, so the browser bundle never pulls in zod.
 */
import type { Campaign, Scene, TextRole } from '@boiler-room/schema';

export interface BrandLook {
  name: string;
  background: string;
  foreground: string;
  primary: string;
  muted: string;
  /** Corner radius in px. The customer's shape, not ours. */
  radius: number;
  displayFont: string;
  bodyFont: string;
}

export interface BrandLine {
  id: string;
  role: TextRole;
  value: string;
}

export interface BrandSceneData {
  id: string;
  /** The scene id as words: `open-question` is "Open question". */
  name: string;
  start: number;
  end: number;
  align: 'left' | 'center';
  /** Shows a product image or video, so the preview draws a screenshot stand-in beside the copy. */
  showsProduct: boolean;
  lines: BrandLine[];
}

/**
 * Used when the customer's font does not load. A neutral system face, never one of Boiler Room's
 * own: a fallback in our faces would show the founder our brand in place of theirs.
 */
export const BRAND_FALLBACK_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const PRODUCT_ASSETS = new Set(['image', 'video']);

export function brandLook(campaign: Campaign): BrandLook {
  const { brand } = campaign;
  return {
    name: brand.name,
    background: brand.colors.background,
    foreground: brand.colors.foreground,
    primary: brand.colors.primary,
    muted: brand.colors.muted ?? brand.colors.foreground,
    radius: brand.radius ?? 0,
    displayFont: brand.fonts.display.family,
    bodyFont: brand.fonts.body.family,
  };
}

/** One campaign scene as the preview draws it. */
export function brandScene(campaign: Campaign, scene: Scene): BrandSceneData {
  return {
    id: scene.id,
    name: sceneWords(scene.id),
    start: scene.start,
    end: scene.end,
    align: scene.props.align === 'center' ? 'center' : 'left',
    showsProduct: scene.assetIds.some((id) => PRODUCT_ASSETS.has(campaign.assets[id]?.kind ?? '')),
    lines: scene.text.map((item) => ({ id: item.id, role: item.role, value: item.value })),
  };
}

/**
 * The film as it would be cut: the chosen opening in place of scene 1, then the rest. With a call
 * to action chosen, the closing button says that call to action's words.
 */
export function brandScenes(
  campaign: Campaign,
  { hookId = null, ctaId = null }: { hookId?: string | null; ctaId?: string | null } = {},
): BrandSceneData[] {
  const first = campaign.scenes[0];
  const hook = hookId ? campaign.variants.hooks.find((item) => item.id === hookId) : undefined;
  const scenes =
    hook && first
      ? [{ ...hook, start: first.start, end: first.end }, ...campaign.scenes.slice(1)]
      : campaign.scenes;
  const cta = ctaId ? campaign.variants.ctas.find((item) => item.id === ctaId) : undefined;
  return scenes.map((scene) => {
    const drawn = brandScene(campaign, scene);
    if (!cta) return drawn;
    return {
      ...drawn,
      lines: drawn.lines.map((line) =>
        line.role === 'cta' ? { ...line, value: cta.label } : line,
      ),
    };
  });
}

/** A family name, stripped to safe characters, as Google Fonts and CSS both name it. */
export function cleanFamily(family: string): string {
  return family
    .replace(/[^A-Za-z0-9 -]/g, '')
    .trim()
    .slice(0, 64);
}

/** A CSS font-family list: the customer's face, then the neutral fallback. */
export function fontStack(family: string): string {
  const name = cleanFamily(family);
  return name ? `'${name}', ${BRAND_FALLBACK_STACK}` : BRAND_FALLBACK_STACK;
}

/**
 * The Google Fonts stylesheets for the brand's faces, by name: one per face, so a face Google does
 * not have fails alone, and the neutral fallback shows for it. Headlines take 700, body text 400
 * and 700, weights nearly every Google face has.
 */
export function brandFontsHrefs(look: Pick<BrandLook, 'displayFont' | 'bodyFont'>): string[] {
  const display = cleanFamily(look.displayFont);
  const body = cleanFamily(look.bodyFont);
  const wanted = new Map<string, Set<number>>();
  const want = (family: string, weights: number[]) => {
    if (!family) return;
    const set = wanted.get(family) ?? new Set<number>();
    for (const weight of weights) set.add(weight);
    wanted.set(family, set);
  };
  want(display, [700]);
  want(body, [400, 700]);
  return [...wanted].map(([family, weights]) => {
    const name = encodeURIComponent(family).replace(/%20/g, '+');
    const list = [...weights].sort((a, b) => a - b).join(';');
    return `https://fonts.googleapis.com/css2?family=${name}:wght@${list}&display=swap`;
  });
}

/** `open-question` reads "Open question". */
export function sceneWords(id: string): string {
  const spaced = id.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
