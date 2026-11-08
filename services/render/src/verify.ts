/**
 * Checks a stitched film: its frame count, frame rate, size and timing always, and, given a full
 * render of the same film, the frames on both sides of every seam.
 *
 * Two encodes of the same frames differ a little, because a chunk opens on a key frame. So a seam
 * frame is compared with the same frame of the full render and held to the bar set by frames well
 * inside a chunk, and it must be closer to its own frame of the full render than to the frame next
 * to it, which is what a dropped or repeated frame would break.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { type ChunkPlan, interiorPair, type Seam, seamsOf } from './chunks.ts';
import { compareFrames, type Difference } from './compare.ts';
import { extractFrames, probeVideo, readPng, type VideoFacts } from './media.ts';

export interface ExpectedFilm {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

export interface FilmCheck {
  facts: VideoFacts;
  frameCount: boolean;
  duration: boolean;
  size: boolean;
  fps: boolean;
  evenlySpaced: boolean;
  silent: boolean;
  ok: boolean;
}

export async function checkFilm(file: string, expected: ExpectedFilm): Promise<FilmCheck> {
  const facts = await probeVideo(file);
  const frameCount = facts.frames === expected.durationInFrames;
  const duration =
    Math.abs(facts.durationSeconds - expected.durationInFrames / expected.fps) < 0.5 / expected.fps;
  const size = facts.width === expected.width && facts.height === expected.height;
  const fps = Math.abs(facts.fps - expected.fps) < 1e-6;
  const silent = !facts.hasAudio;
  return {
    facts,
    frameCount,
    duration,
    size,
    fps,
    evenlySpaced: facts.evenlySpaced,
    silent,
    ok: frameCount && duration && size && fps && facts.evenlySpaced && silent,
  };
}

/** The frames a seam check reads from both films: each side of each seam, and each interior pair. */
export function framesToCompare(plan: ChunkPlan): number[] {
  const frames = new Set<number>();
  for (const seam of seamsOf(plan)) {
    frames.add(seam.before);
    frames.add(seam.after);
  }
  for (const chunk of plan.chunks) {
    for (const frame of interiorPair(chunk) ?? []) frames.add(frame);
  }
  return [...frames].sort((a, b) => a - b);
}

export interface SeamCheck {
  seam: Seam;
  /** Each side of the seam, against the same frame of the full render. */
  before: Difference;
  after: Difference;
  /** Each side against the other side's frame of the full render. */
  beforeAgainstAfter: Difference;
  afterAgainstBefore: Difference;
  /** The two frames of the full render, against each other: how much the picture moves. */
  motion: Difference;
  aligned: boolean;
  withinBar: boolean;
  ok: boolean;
}

export interface SeamReport {
  /** The worst PSNR of the interior frames, less the allowance: the bar a seam frame must clear. */
  barPsnr: number;
  interior: { frame: number; difference: Difference }[];
  seams: SeamCheck[];
  ok: boolean;
}

/** How far below the worst interior frame a seam frame may fall, in dB. */
export const SEAM_ALLOWANCE_DB = 3;
/** Above this the full render's frames on either side of a seam are the same picture. */
const STILL_PSNR = 50;

/**
 * Decides a seam from the measured differences. Pure, so the rule is tested without a video. When
 * the picture does not move across the seam, a frame out of place would not show, so alignment is
 * only required where the full render's two frames differ.
 */
export function judgeSeam(
  measured: Omit<SeamCheck, 'aligned' | 'withinBar' | 'ok'>,
  barPsnr: number,
): SeamCheck {
  const moving = measured.motion.psnr < STILL_PSNR;
  const aligned =
    !moving ||
    (measured.before.psnr > measured.beforeAgainstAfter.psnr &&
      measured.after.psnr > measured.afterAgainstBefore.psnr);
  const withinBar = Math.min(measured.before.psnr, measured.after.psnr) >= barPsnr;
  return { ...measured, aligned, withinBar, ok: aligned && withinBar };
}

/** Compares the stitched film with a full render at every seam. */
export async function compareSeams(
  stitched: string,
  reference: string,
  plan: ChunkPlan,
  workDir: string,
): Promise<SeamReport> {
  const dir = path.join(workDir, 'seams');
  await mkdir(dir, { recursive: true });
  const frames = framesToCompare(plan);
  const file = (which: string, frame: number) => path.join(dir, `${which}-${frame}.png`);
  await extractFrames(
    stitched,
    frames.map((frame) => ({ frame, output: file('stitched', frame) })),
  );
  await extractFrames(
    reference,
    frames.map((frame) => ({ frame, output: file('reference', frame) })),
  );
  const load = async (which: string, frame: number) => readPng(file(which, frame));
  const diff = async (frameA: number, frameB: number) =>
    compareFrames(await load('stitched', frameA), await load('reference', frameB));

  const interior: SeamReport['interior'] = [];
  for (const chunk of plan.chunks) {
    for (const frame of interiorPair(chunk) ?? []) {
      interior.push({ frame, difference: await diff(frame, frame) });
    }
  }
  const worst = Math.min(...interior.map(({ difference }) => difference.psnr));
  const barPsnr = Number.isFinite(worst) ? worst - SEAM_ALLOWANCE_DB : 40;

  const seams: SeamCheck[] = [];
  for (const seam of seamsOf(plan)) {
    seams.push(
      judgeSeam(
        {
          seam,
          before: await diff(seam.before, seam.before),
          after: await diff(seam.after, seam.after),
          beforeAgainstAfter: await diff(seam.before, seam.after),
          afterAgainstBefore: await diff(seam.after, seam.before),
          motion: compareFrames(
            await load('reference', seam.before),
            await load('reference', seam.after),
          ),
        },
        barPsnr,
      ),
    );
  }
  return { barPsnr, interior, seams, ok: seams.every(({ ok }) => ok) };
}
