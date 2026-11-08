import {
  type Campaign,
  contrastRatio,
  fromOklch,
  MIN_CONTRAST,
  oklchLightness,
  readableOn,
  type StyleFamily,
  styleFamily,
  tintedGround,
  toOklch,
} from '@boiler-room/schema';

/**
 * The Art Director's colour decision, in code: which style family the film renders in and the
 * smallest changes to the brand colours that make it land cleanly there and pass the validator.
 * It follows `skills/art-director/SKILL.md` sections 1 and 2. The model never chooses colours.
 */

export type Colors = Campaign['brand']['colors'];
export type Lean = 'light' | 'dark';

export const FAMILY_NAMES: Record<StyleFamily, string> = {
  'neutral-cut': 'Neutral Cut',
  'kinetic-plate': 'Kinetic Plate',
};

/** Subheads and labels use `muted` only when it clears body-text contrast. */
export const MUTED_MIN_CONTRAST = MIN_CONTRAST.foreground;

/**
 * A primary this dark, this pale or this grey reads as nothing at full bleed, so `colour-event`
 * needs a generated field instead [N]: the skill names the rule but gives no numbers.
 */
export const EVENT_MIN_L = 0.25;
export const EVENT_MAX_L = 0.9;
export const EVENT_MIN_CHROMA = 0.04;

export interface ColourChange {
  token: keyof Colors;
  from: string;
  /** `null` when the colour was removed, so the renderer falls back to `ink`. */
  to: string | null;
  why: string;
}

export interface StyleDecision {
  family: StyleFamily;
  familyName: string;
  /** OKLCH lightness of the brand's own background. */
  backgroundL: number;
  /** OKLCH lightness of the ground the film renders on. */
  groundL: number;
  /** Set only when the background was mid-tone and had to lean one way. */
  lean: Lean | undefined;
  leanFrom: 'research' | 'contrast' | undefined;
  colors: Colors;
  changes: ColourChange[];
  contrast: { ink: number; accent: number; muted: number | null };
  primaryReadsAsNothing: boolean;
  flags: string[];
}

const round2 = (value: number) => Math.floor(value * 100) / 100;

/**
 * The colour nearest `colour` in OKLCH lightness, with its hue and chroma, that has at least
 * `minimum` contrast on `ground`. It moves away from the ground: darker on a light ground, lighter
 * on a dark one. Black or white is the last resort, and one of them always clears 4.5:1.
 */
export function withContrast(colour: string, ground: string, minimum: number): string {
  if (contrastRatio(colour, ground) >= minimum) return colour;
  const start = toOklch(colour);
  const darker = oklchLightness(ground) >= 0.5;
  const target = darker ? 0 : 1;
  const at = (l: number) => fromOklch({ ...start, l });
  // Contrast with the ground rises as lightness moves away from it, so a bisection finds the
  // smallest move that clears the minimum.
  let near = start.l;
  let far = target;
  if (contrastRatio(at(far), ground) < minimum) return readableOn(ground);
  for (let step = 0; step < 30; step++) {
    const mid = (near + far) / 2;
    if (contrastRatio(at(mid), ground) >= minimum) far = mid;
    else near = mid;
  }
  const found = at(far);
  return contrastRatio(found, ground) >= minimum ? found : readableOn(ground);
}

export function readsAsNothing(primary: string): boolean {
  const { l, c } = toOklch(primary);
  return l <= EVENT_MIN_L || l >= EVENT_MAX_L || c < EVENT_MIN_CHROMA;
}

/**
 * Chooses the family and fixes the colours. `mode` is the Researcher's reading of the site's own
 * hero (`brand_details.mode`), which decides the lean of a mid-tone background. Without it the
 * lean goes to the side where `ink` has the higher contrast.
 */
export function decideStyle(input: Colors, hints: { mode?: Lean | undefined } = {}): StyleDecision {
  const colors: Colors = { ...input };
  const changes: ColourChange[] = [];
  const flags: string[] = [];
  const backgroundL = oklchLightness(input.background);

  let family = styleFamily(input.background);
  let lean: Lean | undefined;
  let leanFrom: StyleDecision['leanFrom'];
  if (!family) {
    if (hints.mode) {
      lean = hints.mode;
      leanFrom = 'research';
    } else {
      const light = contrastRatio(input.foreground, tintedGround(input.primary, 'light'));
      const dark = contrastRatio(input.foreground, tintedGround(input.primary, 'dark'));
      lean = light >= dark ? 'light' : 'dark';
      leanFrom = 'contrast';
    }
    colors.background = tintedGround(input.primary, lean);
    family = lean === 'light' ? 'neutral-cut' : 'kinetic-plate';
    changes.push({
      token: 'background',
      from: input.background,
      to: colors.background,
      why: `Mid-tone ground (OKLCH L ${backgroundL.toFixed(3)}) fails contrast in both families. Leaning ${lean} by the ${leanFrom === 'research' ? "site's own hero" : 'higher ink contrast'}, it becomes 3% primary in ${lean === 'light' ? 'white' : '#0b0b0b'}.`,
    });
  }
  const ground = colors.background;

  if (contrastRatio(colors.foreground, ground) < MIN_CONTRAST.foreground) {
    const next = readableOn(ground);
    changes.push({
      token: 'foreground',
      from: colors.foreground,
      to: next,
      why: `Ink ${colors.foreground} has ${round2(contrastRatio(colors.foreground, ground))}:1 on the ground, under ${MIN_CONTRAST.foreground}:1.`,
    });
    colors.foreground = next;
  }

  if (contrastRatio(colors.primary, ground) < MIN_CONTRAST.primary) {
    const next = withContrast(colors.primary, ground, MIN_CONTRAST.primary);
    changes.push({
      token: 'primary',
      from: colors.primary,
      to: next,
      why: `Accent ${colors.primary} has ${round2(contrastRatio(colors.primary, ground))}:1 on the ground, under ${MIN_CONTRAST.primary}:1. Lightness moved the least that clears it, keeping hue and chroma.`,
    });
    flags.push(
      `The brand primary ${colors.primary} was changed to ${next} for contrast. The schema has one primary, so the original cannot be kept for fills only.`,
    );
    colors.primary = next;
  }

  if (colors.muted && contrastRatio(colors.muted, ground) < MUTED_MIN_CONTRAST) {
    changes.push({
      token: 'muted',
      from: colors.muted,
      to: null,
      why: `Muted ${colors.muted} has ${round2(contrastRatio(colors.muted, ground))}:1 on the ground, under ${MUTED_MIN_CONTRAST}:1, so subheads and labels use ink.`,
    });
    delete colors.muted;
  }

  const primaryReadsAsNothing = readsAsNothing(colors.primary);
  return {
    family,
    familyName: FAMILY_NAMES[family],
    backgroundL,
    groundL: oklchLightness(ground),
    lean,
    leanFrom,
    colors,
    changes,
    contrast: {
      ink: contrastRatio(colors.foreground, ground),
      accent: contrastRatio(colors.primary, ground),
      muted: colors.muted ? contrastRatio(colors.muted, ground) : null,
    },
    primaryReadsAsNothing,
    flags,
  };
}
