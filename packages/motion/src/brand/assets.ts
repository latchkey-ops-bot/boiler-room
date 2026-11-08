import { staticFile } from 'remotion';

const ABSOLUTE = /^(?:https?:|data:)/i;

/** A campaign's `src` as a URL. A relative path is a file in the render's public folder. */
export const assetUrl = (src: string): string =>
  ABSOLUTE.test(src) ? src : staticFile(src.replace(/^(?:\.?\/)+/, ''));
