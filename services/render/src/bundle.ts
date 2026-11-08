/**
 * Bundles the Remotion project locally, with a public folder that holds only the files the campaign
 * names, and packs it with the chunk worker into one gzipped tarball for the computers to fetch.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Campaign } from '@boiler-room/schema';
import { bundle } from '@remotion/bundler';

const run = promisify(execFile);

/** `@boiler-room/motion` exports its source, so its Remotion entry sits beside its index. */
export const MOTION_ENTRY = path.join(
  path.dirname(fileURLToPath(import.meta.resolve('@boiler-room/motion'))),
  'root.tsx',
);

export const WORKER_SOURCE = fileURLToPath(new URL('../worker/render-chunk.ts', import.meta.url));

/** The biggest file Naive takes through a one-shot upload link. */
export const UPLOAD_LIMIT_BYTES = 60 * 1024 * 1024;

const ABSOLUTE = /^(?:https?:|data:)/i;

/** The relative file of each asset, by asset id. Assets at a URL are fetched by the browser. */
export function localAssets({ assets }: Pick<Campaign, 'assets'>): Map<string, string> {
  const local = new Map<string, string>();
  for (const [id, { src }] of Object.entries(assets)) {
    if (!ABSOLUTE.test(src)) local.set(id, src.replace(/^(?:\.?\/)+/, ''));
  }
  return local;
}

/** The assets a silent film cannot be made without: its fonts. A missing image is caught later. */
const fontIds = ({ brand }: Pick<Campaign, 'brand'>) =>
  new Set([brand.fonts.display.source, brand.fonts.body.source]);

export interface StagedAssets {
  staged: string[];
  /** Files named by assets a silent film does not draw, such as audio, that are not there. */
  missing: string[];
}

/**
 * Copies each asset the campaign names from beside the campaign file into `publicDir`. Only those
 * files are copied, so nothing else in the campaign's folder is ever uploaded. A path that leaves
 * the campaign's folder is refused, and so is a missing font. A missing scene image is reported
 * with its fix when the film is selected, by the same check `calculateMetadata` makes, and a
 * missing logo is drawn as the brand name, so neither stops the staging.
 */
export async function stagePublicDir(
  campaign: Pick<Campaign, 'assets' | 'brand'>,
  campaignDir: string,
  publicDir: string,
): Promise<StagedAssets> {
  const root = path.resolve(campaignDir);
  const fonts = fontIds(campaign);
  const staged = new Set<string>();
  const missing = new Set<string>();
  const missingFonts: string[] = [];
  for (const [id, relative] of localAssets(campaign)) {
    const source = path.resolve(root, relative);
    if (source !== root && !source.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Asset "${id}" (${relative}) is outside the campaign's folder ${root}.`);
    }
    try {
      await stat(source);
    } catch {
      if (fonts.has(id)) missingFonts.push(`${id} (${relative})`);
      else missing.add(relative);
      continue;
    }
    const target = path.join(publicDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    staged.add(relative);
  }
  if (missingFonts.length > 0) {
    throw new Error(
      `The campaign's fonts are not beside it in ${root}: ${missingFonts.join(', ')}. ` +
        'Put each file at its src, relative to the campaign file, or change the src.',
    );
  }
  return { staged: [...staged].sort(), missing: [...missing].sort() };
}

async function filesUnder(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(path.join(dir, prefix), { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relative = path.join(prefix, entry.name);
      return entry.isDirectory() ? filesUnder(dir, relative) : [relative];
    }),
  );
  return files.flat().sort();
}

/** One hash for a folder: every file's path and contents, in a fixed order. */
export async function hashTree(dir: string, skip: (relative: string) => boolean = () => false) {
  const hash = createHash('sha256');
  for (const relative of await filesUnder(dir)) {
    if (skip(relative)) continue;
    const content = createHash('sha256')
      .update(await readFile(path.join(dir, relative)))
      .digest('hex');
    hash.update(`${relative.split(path.sep).join('/')}\0${content}\n`);
  }
  return hash.digest('hex');
}

export interface PackedBundle {
  /** The bundle as served on this machine, for selecting the film and any local render. */
  serveUrl: string;
  /** The gzipped tarball of the bundle and the chunk worker. */
  tarball: string;
  tarballBytes: number;
  tarballSha256: string;
  /** The templates as bundled, without the campaign's files: what identifies the motion code. */
  templateSha256: string;
  assets: StagedAssets;
  bundleSeconds: number;
  compressSeconds: number;
}

/**
 * Bundles `@boiler-room/motion` with the campaign's files as its public folder, and packs it. The
 * payload is `bundle/` and `worker.ts`, which the computers unpack side by side.
 */
export async function packBundle(
  campaign: Pick<Campaign, 'assets' | 'brand'>,
  campaignDir: string,
  workDir: string,
): Promise<PackedBundle> {
  const payload = path.join(workDir, 'payload');
  const publicDir = path.join(workDir, 'public');
  await mkdir(payload, { recursive: true });
  const assets = await stagePublicDir(campaign, campaignDir, publicDir);

  const started = performance.now();
  const serveUrl = await bundle({
    entryPoint: MOTION_ENTRY,
    outDir: path.join(payload, 'bundle'),
    publicDir,
    symlinkPublicDir: false,
    onProgress: () => undefined,
  });
  const bundleSeconds = (performance.now() - started) / 1000;
  await copyFile(WORKER_SOURCE, path.join(payload, 'worker.ts'));
  const templateSha256 = await hashTree(payload, (relative) =>
    relative.startsWith(`bundle${path.sep}public${path.sep}`),
  );

  const packing = performance.now();
  const tarball = path.join(workDir, 'payload.tgz');
  await run('tar', ['-czf', tarball, '-C', payload, '.']);
  const compressSeconds = (performance.now() - packing) / 1000;
  const bytes = await readFile(tarball);
  if (bytes.byteLength > UPLOAD_LIMIT_BYTES) {
    throw new Error(
      `The bundle is ${(bytes.byteLength / 2 ** 20).toFixed(1)} MiB packed, over the ` +
        `${UPLOAD_LIMIT_BYTES / 2 ** 20} MiB a Naive upload link takes. Make the campaign's images smaller.`,
    );
  }
  return {
    serveUrl,
    tarball,
    tarballBytes: bytes.byteLength,
    tarballSha256: createHash('sha256').update(bytes).digest('hex'),
    templateSha256,
    assets,
    bundleSeconds,
    compressSeconds,
  };
}
