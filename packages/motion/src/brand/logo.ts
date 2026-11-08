import { contrastRatio } from '@boiler-room/schema';

/** What was learned by trying to load a logo. */
export interface LogoProbe {
  loaded: boolean;
  width?: number;
  height?: number;
  /**
   * Its ink as a few colours, each with its share of the ink, when the browser let the pixels be
   * read. A mark is often two tone, so one average colour would hide a part that vanishes.
   */
  palette?: readonly { color: string; share: number }[];
  /** How much of it is ink, from 0 to 1, when the browser let it be read. */
  coverage?: number;
  /**
   * The colour of an opaque box the mark sits on, such as a JPEG's white, when it has one. It is not
   * counted as ink, and the ink is judged against it, since that is what the ink is seen on.
   */
  plate?: string;
  /**
   * Whether the file has more than one frame, or animates as an SVG. Undefined when the browser
   * would not let its bytes be read, so it cannot be told.
   */
  animated?: boolean;
}

export type ResolvedLogo =
  /** `plate` is set when the logo sits on an opaque box of one colour, which is drawn as a plate. */
  | { kind: 'image'; src: string; aspect: number; plate?: string }
  | { kind: 'wordmark'; reason: LogoRejection };

export type LogoRejection =
  | 'missing'
  | 'too-small'
  | 'wrong-shape'
  | 'animated'
  | 'blank'
  | 'invisible'
  | 'unreadable';

/** A raster below this is a favicon, which falls apart at film size. */
const MIN_LONG_EDGE = 48;
const MAX_ASPECT = 12;
const MIN_COVERAGE = 0.005;
/** Ink below this contrast with the background can barely be seen. */
const FAINT_CONTRAST = 1.5;
/** A mark with more of its ink faint than this has lost a part, such as its name. */
const MAX_FAINT_SHARE = 0.25;

/** The share of a logo's ink that can barely be seen on this background. */
export const faintShare = (
  palette: NonNullable<LogoProbe['palette']>,
  background: string,
): number =>
  palette
    .filter(({ color }) => contrastRatio(color, background) < FAINT_CONTRAST)
    .reduce((sum, { share }) => sum + share, 0);

/** Why this logo cannot be used on this background, or undefined when it can. */
export function rejectLogo(probe: LogoProbe, background: string): LogoRejection | undefined {
  const { loaded, width = 0, height = 0, palette, coverage, animated } = probe;
  if (!loaded) return 'missing';
  if (width > 0 && height > 0) {
    if (Math.max(width, height) < MIN_LONG_EDGE) return 'too-small';
    const aspect = width / height;
    if (aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT) return 'wrong-shape';
  }
  // The mark is in every scene, so a logo that moves on the browser's clock would flicker in all.
  if (animated) return 'animated';
  if (coverage !== undefined && coverage < MIN_COVERAGE) return 'blank';
  // Ink on a plate is seen against the plate, whatever the background around it.
  if (palette && faintShare(palette, probe.plate ?? background) > MAX_FAINT_SHARE)
    return 'invisible';
  // A file whose bytes the browser hides could be animated, and nothing here could tell.
  if (animated === undefined) return 'unreadable';
  return undefined;
}

/** A logo that can be shown, or the name set as a wordmark. Never nothing. */
export function resolveLogo(probe: LogoProbe, src: string, background: string): ResolvedLogo {
  const reason = rejectLogo(probe, background);
  if (reason) return { kind: 'wordmark', reason };
  const { width = 0, height = 0, plate } = probe;
  const aspect = width > 0 && height > 0 ? width / height : 1;
  // Even a plate of the background's colour shows its edge against the backdrop's glow.
  return plate ? { kind: 'image', src, aspect, plate } : { kind: 'image', src, aspect };
}
