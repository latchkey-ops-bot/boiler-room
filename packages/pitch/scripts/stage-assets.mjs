/**
 * Copies what the pitch shows into public/ and writes public/manifest.json, which the composition
 * reads in calculateMetadata. Run it before every render: the time-lapse uses whatever frames the
 * recording holds at that moment.
 *
 *   node scripts/stage-assets.mjs [--run <dir with frames/ and events.jsonl>] [--films <dir of mp4s>]
 *
 * Defaults come from PITCH_RUN_DIR and PITCH_FILMS_DIR, then the founder's scratchpad. A narration
 * track is used when public/narration.mp3 exists.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const SCRATCH =
  '/tmp/claude-1000/-home-moss-YC-hack/a4ff2f83-e504-404d-bfb3-6285b0456490/scratchpad';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

export function stageAssets({
  runDir = arg('run') ?? process.env.PITCH_RUN_DIR ?? path.join(SCRATCH, 'pitch/run'),
  filmsDir = arg('films') ?? process.env.PITCH_FILMS_DIR ?? path.join(SCRATCH, 'films-for-founder'),
} = {}) {
  const timeline = JSON.parse(readFileSync(path.join(ROOT, 'timeline.json'), 'utf8'));

  // The time-lapse: every frame the recording holds now, named by ms since it started.
  const framesOut = path.join(PUBLIC, 'run/frames');
  rmSync(path.join(PUBLIC, 'run'), { recursive: true, force: true });
  mkdirSync(framesOut, { recursive: true });
  const framesIn = path.join(runDir, 'frames');
  const frames = existsSync(framesIn)
    ? readdirSync(framesIn)
        .filter((f) => /^\d{8}\.jpg$/.test(f))
        .sort()
    : [];
  for (const f of frames) copyFileSync(path.join(framesIn, f), path.join(framesOut, f));
  const eventsFile = path.join(runDir, 'events.jsonl');
  const events = existsSync(eventsFile)
    ? readFileSync(eventsFile, 'utf8')
        .split('\n')
        .filter((line) => line.trim())
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        })
        .sort((a, b) => a.ms - b.ms)
    : [];

  // The films named in timeline.json: the finished film and the closing montage.
  const filmsOut = path.join(PUBLIC, 'films');
  rmSync(filmsOut, { recursive: true, force: true });
  mkdirSync(filmsOut, { recursive: true });
  const wanted = new Set([timeline.finishedFilm.file, ...timeline.montage.map((m) => m.file)]);
  const films = [];
  for (const file of wanted) {
    const from = path.isAbsolute(file) ? file : path.join(filmsDir, file);
    if (!existsSync(from)) {
      console.warn(`stage: film not found, its scene will be empty: ${from}`);
      continue;
    }
    // Staged under its last part, as filmFile() in src/manifest.ts expects.
    copyFileSync(from, path.join(filmsOut, path.basename(file)));
    films.push(file);
  }

  copyFileSync(path.join(ROOT, '../../apps/web/src/app/icon.svg'), path.join(PUBLIC, 'logo.svg'));

  const manifest = {
    frames: frames.map((f) => Number(f.slice(0, 8))),
    events,
    films,
    narration: existsSync(path.join(PUBLIC, 'narration.mp3')),
  };
  writeFileSync(path.join(PUBLIC, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  const last = manifest.frames.at(-1) ?? 0;
  console.log(
    `stage: ${frames.length} frames (${(last / 60000).toFixed(1)} min of recording), ${events.length} events, ${films.length} films, narration ${manifest.narration ? 'yes' : 'no'}`,
  );
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stageAssets();
}
