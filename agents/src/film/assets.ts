/**
 * The campaign the render service is given. The crew names its pictures as Naive files
 * (`naive://files/<id>`), and the render service reads an asset only from a file beside the
 * campaign or from an http(s) URL. So before a render, each Naive file is put beside a copy of the
 * campaign, under `assets/`, and its `src` points there. The copy comes from what the film already
 * holds (the Researcher's `files/`, the Art Director's `assets/generated/`), and only a file found
 * in neither is downloaded. Nothing else in the campaign changes, and the gate checks the copy
 * again before any computer starts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { sniff } from '../capture/logo.ts';
import { fileIdOf } from '../researcher/output.ts';

export interface LocalizeOptions {
  campaignFile: string;
  /** Where the render campaign and its `assets/` go. */
  outDir: string;
  /** Folders whose files are named `<asset id>.<extension>`, searched in order. */
  searchDirs: readonly string[];
  /** Fetches a Naive file's bytes, for one found nowhere on disk. */
  download: (fileId: string) => Promise<Uint8Array>;
}

export interface Localized {
  campaignFile: string;
  /** Asset id to the file now beside the campaign. */
  files: Record<string, string>;
  downloaded: string[];
}

function onDisk(dirs: readonly string[], assetId: string): string | undefined {
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const name = readdirSync(dir).find((each) => {
      const extension = extname(each);
      return extension !== '' && each.slice(0, -extension.length) === assetId;
    });
    if (name) return join(dir, name);
  }
  return undefined;
}

const extensionOf = (bytes: Uint8Array) => {
  const kind = sniff(Buffer.from(bytes));
  return kind === 'jpeg' ? '.jpg' : kind === 'unknown' || kind === 'html' ? '.bin' : `.${kind}`;
};

export async function localizeCampaign(options: LocalizeOptions): Promise<Localized> {
  const campaign = JSON.parse(readFileSync(options.campaignFile, 'utf8')) as {
    assets?: Record<string, { src: string }>;
  };
  const assetsDir = join(options.outDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const files: Record<string, string> = {};
  const downloaded: string[] = [];
  for (const [id, asset] of Object.entries(campaign.assets ?? {})) {
    const fileId = fileIdOf(asset.src);
    if (!fileId) continue;
    const found = onDisk(options.searchDirs, id);
    let bytes: Uint8Array;
    let extension: string;
    if (found) {
      bytes = readFileSync(found);
      extension = extname(found);
    } else {
      bytes = await options.download(fileId);
      extension = extensionOf(bytes);
      downloaded.push(id);
    }
    const name = `${id}${extension}`;
    writeFileSync(join(assetsDir, name), bytes);
    asset.src = `assets/${name}`;
    files[id] = join(assetsDir, name);
  }
  const campaignFile = join(options.outDir, 'campaign.json');
  writeFileSync(campaignFile, `${JSON.stringify(campaign, null, 2)}\n`);
  return { campaignFile, files, downloaded };
}
