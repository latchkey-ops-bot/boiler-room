/**
 * Reads what the render service writes beside a film: `film.mp4`, `film.manifest.json` and the
 * quality artifacts in `film.quality/` with their `index.json`. Only the fields Quality Check uses
 * are read, and any other field is allowed, so the render service can add to its manifest freely.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { Campaign, Scene } from '@boiler-room/schema';
import { z } from 'zod';

const manifestSchema = z.looseObject({
  manifestVersion: z.literal(1),
  runId: z.string().optional(),
  output: z.looseObject({ file: z.string(), sha256: z.string() }),
  campaign: z.looseObject({ id: z.string(), file: z.string(), fileSha256: z.string() }),
  settings: z.looseObject({
    format: z.string(),
    hookId: z.string().nullable().optional(),
    ctaId: z.string().nullable().optional(),
    width: z.number(),
    height: z.number(),
    fps: z.number(),
    durationInFrames: z.number(),
    muted: z.boolean().optional(),
  }),
  template: z.looseObject({ commit: z.string().optional() }).optional(),
});

const frameRef = z.looseObject({ frame: z.number().int().min(0) });

const indexSchema = z.looseObject({
  film: z.looseObject({
    file: z.string(),
    width: z.number(),
    height: z.number(),
    fps: z.number(),
    durationInFrames: z.number(),
  }),
  contactSheet: z.looseObject({
    file: z.string(),
    frames: z.array(frameRef.extend({ second: z.number(), scene: z.string() })),
  }),
  transitionSheet: z.looseObject({ file: z.string() }).nullable(),
  transitions: z.array(
    z.looseObject({
      index: z.number(),
      name: z.string(),
      boundary: z.number(),
      from: z.number(),
      to: z.number(),
      stills: z.array(z.looseObject({ when: z.string(), frame: z.number() })),
      files: z.record(z.string(), z.string()),
    }),
  ),
  phoneSheet: z.looseObject({
    file: z.string(),
    widthPx: z.number(),
    frames: z.array(frameRef.extend({ scene: z.string() })),
  }),
});

export type RenderManifest = z.infer<typeof manifestSchema>;
export type QualityIndex = z.infer<typeof indexSchema>;

export interface RenderDir {
  dir: string;
  film: string;
  manifestFile: string;
  manifest: RenderManifest;
  qualityDir: string;
  index: QualityIndex;
  /** Maps a path the index names to the file in this folder, which may have been moved. */
  local: (path: string) => string;
}

/** The film in a render folder: the one `.mp4` with a manifest beside it. */
function findFilm(dir: string): string {
  const films = readdirSync(dir).filter(
    (name) =>
      name.endsWith('.mp4') && existsSync(join(dir, name.replace(/\.mp4$/, '.manifest.json'))),
  );
  if (films.length !== 1) {
    throw new Error(
      `${dir} must hold exactly one film with a manifest beside it (name.mp4 and name.manifest.json); found ${films.length}.`,
    );
  }
  return join(dir, films[0] as string);
}

export function readRenderDir(input: string): RenderDir {
  const dir = resolve(input);
  const film = findFilm(dir);
  const stem = basename(film, '.mp4');
  const manifestFile = join(dir, `${stem}.manifest.json`);
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestFile, 'utf8')));
  const qualityDir = join(dir, `${stem}.quality`);
  const indexFile = join(qualityDir, 'index.json');
  if (!existsSync(indexFile)) {
    throw new Error(
      `${indexFile} is missing. Render with quality artifacts (without --no-quality) so there are frames to inspect.`,
    );
  }
  const index = indexSchema.parse(JSON.parse(readFileSync(indexFile, 'utf8')));
  const marker = `${basename(qualityDir)}${sep}`;
  const local = (path: string) => {
    if (existsSync(path)) return path;
    const at = path.lastIndexOf(marker);
    if (at >= 0) return join(qualityDir, path.slice(at + marker.length));
    return join(dirname(manifestFile), basename(path));
  };
  return { dir, film, manifestFile, manifest, qualityDir, index, local };
}

/**
 * The film a hook and CTA selection describes, as the render step cut it: the hook replaces the
 * first scene and keeps its way out, and the CTA's label replaces every `cta` text item.
 */
export function cutOf(
  campaign: Campaign,
  hookId: string | null | undefined,
  ctaId: string | null | undefined,
): Campaign {
  const hook = campaign.variants.hooks.find(({ id }) => id === hookId);
  const cta = campaign.variants.ctas.find(({ id }) => id === ctaId);
  const [first, ...rest] = campaign.scenes;
  let scenes: Scene[] = campaign.scenes;
  if (hook && first) {
    const transitionOut = hook.transitionOut ?? first.transitionOut;
    scenes = [{ ...hook, ...(transitionOut ? { transitionOut } : {}) }, ...rest];
  }
  if (cta) {
    scenes = scenes.map((scene) => ({
      ...scene,
      text: scene.text.map((item) =>
        item.role === 'cta' ? { ...item, value: cta.label, claimIds: [] } : item,
      ),
    }));
  }
  return { ...campaign, scenes, variants: { ...campaign.variants, hooks: [] } };
}
