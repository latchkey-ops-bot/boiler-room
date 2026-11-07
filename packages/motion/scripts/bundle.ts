import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { openBrowser, selectComposition } from '@remotion/renderer';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXAMPLES = path.resolve(PACKAGE_ROOT, '../schema/examples');
export const OUT = path.join(PACKAGE_ROOT, 'out');

export type Format = '16:9' | '9:16' | '1:1';
export const FORMATS: Format[] = ['16:9', '9:16', '1:1'];

export interface FilmInput {
  campaign: unknown;
  format: Format;
  hookId?: string;
  ctaId?: string;
}

export const readCampaign = (file: string): unknown =>
  JSON.parse(readFileSync(path.resolve(EXAMPLES, file), 'utf8'));

/**
 * Bundles the package once. Campaign assets are relative to the campaign file, so the folder that
 * holds the campaign is the public folder.
 */
export async function bundleFilm(publicDir = EXAMPLES): Promise<string> {
  return bundle({
    entryPoint: path.join(PACKAGE_ROOT, 'src/root.tsx'),
    publicDir,
    onProgress: () => undefined,
  });
}

export const openRenderBrowser = () =>
  openBrowser('chrome', { chromiumOptions: { gl: 'swangle' } });

export type RenderBrowser = Awaited<ReturnType<typeof openRenderBrowser>>;

/** Runs `calculateMetadata`, which validates the campaign and throws when it is rejected. */
export async function selectFilm(serveUrl: string, input: FilmInput, browser: RenderBrowser) {
  const inputProps = { ...input } as Record<string, unknown>;
  const composition = await selectComposition({
    serveUrl,
    id: 'CampaignFilm',
    inputProps,
    puppeteerInstance: browser,
  });
  return { composition, inputProps };
}

export const formatSlug = (format: Format) => format.replace(':', 'x');

export function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
