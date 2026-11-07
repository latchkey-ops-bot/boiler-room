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
  /** How much of it is not transparent, from 0 to 1, when the browser let it be read. */
  coverage?: number;
}

export type ResolvedLogo =
  | { kind: 'image'; src: string; aspect: number }
  | { kind: 'wordmark'; reason: LogoRejection };

export type LogoRejection = 'missing' | 'too-small' | 'wrong-shape' | 'blank' | 'invisible';

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
  const { loaded, width = 0, height = 0, palette, coverage } = probe;
  if (!loaded) return 'missing';
  if (width > 0 && height > 0) {
    if (Math.max(width, height) < MIN_LONG_EDGE) return 'too-small';
    const aspect = width / height;
    if (aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT) return 'wrong-shape';
  }
  if (coverage !== undefined && coverage < MIN_COVERAGE) return 'blank';
  if (palette && faintShare(palette, background) > MAX_FAINT_SHARE) return 'invisible';
  return undefined;
}

/** A logo that can be shown, or the name set as a wordmark. Never nothing. */
export function resolveLogo(probe: LogoProbe, src: string, background: string): ResolvedLogo {
  const reason = rejectLogo(probe, background);
  if (reason) return { kind: 'wordmark', reason };
  const { width = 0, height = 0 } = probe;
  return { kind: 'image', src, aspect: width > 0 && height > 0 ? width / height : 1 };
}
