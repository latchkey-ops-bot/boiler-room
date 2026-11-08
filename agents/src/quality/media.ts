/**
 * FFmpeg and FFprobe, run from the system path. Every measurement Quality Check makes in code is
 * taken from the rendered file itself, never from what the render step says it wrote.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { FrameScanner, type FrameStats } from './measure.ts';

function run(command: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else
        reject(
          new Error(
            `${command} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0, 500)}`,
          ),
        );
    });
  });
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export interface FilmFacts {
  width: number;
  height: number;
  fps: number;
  /** Decoded, not read from the container header. */
  frames: number;
  durationSeconds: number;
  hasAudio: boolean;
  codec: string;
}

const rate = (value: string) => {
  const [num, den] = value.split('/').map(Number);
  return den ? (num ?? 0) / den : (num ?? 0);
};

/** Size, rate, decoded frame count and streams of a film. */
export async function probeFilm(file: string): Promise<FilmFacts> {
  const json = JSON.parse(
    (
      await run('ffprobe', [
        '-v',
        'error',
        '-count_frames',
        '-show_entries',
        'stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames:format=duration',
        '-of',
        'json',
        file,
      ])
    ).toString('utf8'),
  ) as {
    streams: {
      codec_type: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      nb_read_frames?: string;
    }[];
    format: { duration?: string };
  };
  const video = json.streams.find((stream) => stream.codec_type === 'video');
  if (!video) throw new Error(`${file} has no video stream.`);
  return {
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: rate(video.r_frame_rate ?? '0'),
    frames: Number(video.nb_read_frames ?? 0),
    durationSeconds: Number(json.format.duration ?? 0),
    hasAudio: json.streams.some((stream) => stream.codec_type === 'audio'),
    codec: video.codec_name ?? '',
  };
}

/** The size frames are scanned at, area-scaled, as the skill's static-run measure defines. */
export const SCAN_WIDTH = 320;
export const SCAN_HEIGHT = 180;

/**
 * Decodes every frame at 320 x 180 RGB and measures each one as it arrives: brightest channel,
 * mean, spread, and the mean absolute difference from the frame before. Nothing is held but the
 * previous frame.
 */
export function scanFrames(file: string): Promise<FrameStats[]> {
  return new Promise((resolve, reject) => {
    const scanner = new FrameScanner(SCAN_WIDTH, SCAN_HEIGHT);
    const child = spawn(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        file,
        '-vf',
        `scale=${SCAN_WIDTH}:${SCAN_HEIGHT}:flags=area,format=rgb24`,
        '-f',
        'rawvideo',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => scanner.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString('utf8')}`));
        return;
      }
      resolve(scanner.finish());
    });
  });
}

/**
 * Writes the listed frames of a film as PNG files, `<prefix>-<frame>.png`, in one decode. `width`
 * scales with the same filter the render service uses for its stills.
 */
export async function extractFrames(
  film: string,
  frames: readonly number[],
  dir: string,
  prefix: string,
  width?: number,
): Promise<Map<number, string>> {
  const wanted = [...new Set(frames)].sort((a, b) => a - b);
  const result = new Map<number, string>();
  if (wanted.length === 0) return result;
  const work = join(dir, `.${prefix}-work`);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const select = wanted.map((frame) => `eq(n\\,${frame})`).join('+');
  const scale = width ? `,scale=${width}:-2:flags=lanczos` : '';
  await run('ffmpeg', [
    '-v',
    'error',
    '-i',
    film,
    '-vf',
    `select='${select}'${scale}`,
    '-fps_mode',
    'vfr',
    join(work, '%05d.png'),
  ]);
  const written = (await readdir(work)).filter((name) => name.endsWith('.png')).sort();
  if (written.length !== wanted.length) {
    throw new Error(`Asked ffmpeg for ${wanted.length} frames of ${film}, got ${written.length}.`);
  }
  for (const [index, frame] of wanted.entries()) {
    const target = join(dir, `${prefix}-${String(frame).padStart(5, '0')}.png`);
    await rename(join(work, written[index] as string), target);
    result.set(frame, target);
  }
  await rm(work, { recursive: true, force: true });
  return result;
}

export interface RgbImage {
  width: number;
  height: number;
  /** Packed RGB, row by row. */
  data: Buffer;
}

/** The size a PNG declares in its header. */
export async function pngSize(file: string): Promise<{ width: number; height: number }> {
  const head = await readFile(file);
  if (head.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error(`${file} is not a PNG.`);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

/** Decodes an image file to packed RGB. */
export async function readRgb(file: string): Promise<RgbImage> {
  const { width, height } = await pngSize(file);
  const data = await run('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ]);
  if (data.length !== width * height * 3) {
    throw new Error(`${file} decoded to ${data.length} bytes, expected ${width * height * 3}.`);
  }
  return { width, height, data };
}
