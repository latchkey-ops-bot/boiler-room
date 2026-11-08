/**
 * FFmpeg and FFprobe, through the binaries Remotion ships (`remotion ffmpeg`, `remotion ffprobe`).
 * A Naive computer has no system FFmpeg, and Remotion's build is the one that encoded the film.
 * That build is small: it has `trim`, `split` and `scale` but not `select`, `fps` or `tile`, so
 * frames are picked by index with `trim` and sheets are laid out in `sheets.ts`.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const REMOTION_CLI = path.join(
  path.dirname(require.resolve('@remotion/cli/package.json')),
  'remotion-cli.js',
);

function run(tool: 'ffmpeg' | 'ffprobe', args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [REMOTION_CLI, tool, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (data: Buffer) => out.push(data));
    child.stderr.on('data', (data: Buffer) => err.push(data));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else {
        const tail = Buffer.concat(err).toString('utf8').slice(-2000);
        reject(new Error(`${tool} exited with ${code}: ${tail}`));
      }
    });
  });
}

export const ffmpeg = (args: string[]) => run('ffmpeg', ['-hide_banner', '-v', 'error', ...args]);
export const ffprobe = (args: string[]) => run('ffprobe', ['-v', 'error', ...args]);

export interface VideoFacts {
  codec: string;
  width: number;
  height: number;
  pixelFormat: string;
  fps: number;
  /** Frames decoded, counted one by one. */
  frames: number;
  durationSeconds: number;
  /** Whether every frame follows the one before by exactly one frame's time. */
  evenlySpaced: boolean;
  /** Frames where the gap to the previous frame was not one frame's time. */
  uneven: number[];
  /** Whether the file has an audio stream. A routine render has none. */
  hasAudio: boolean;
}

const fraction = (text: string | undefined): number => {
  const [num, den] = (text ?? '0/1').split('/').map(Number);
  return (num ?? 0) / (den || 1);
};

/** Counts the frames of a video and checks that their times are evenly spaced. */
export async function probeVideo(file: string): Promise<VideoFacts> {
  const json = JSON.parse(
    await ffprobe([
      '-count_frames',
      '-show_entries',
      'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,time_base,nb_read_frames:format=duration',
      '-of',
      'json',
      file,
    ]),
  ) as {
    streams: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
      r_frame_rate?: string;
      time_base?: string;
      nb_read_frames?: string;
    }[];
    format: { duration?: string };
  };
  const video = json.streams.find(({ codec_type }) => codec_type === 'video');
  if (!video) throw new Error(`${file} has no video stream.`);
  const fps = fraction(video.r_frame_rate);
  const timeBase = fraction(video.time_base);

  // Presentation times of every frame, in the stream's own ticks, in display order.
  const pts = (
    await ffprobe(['-select_streams', 'v:0', '-show_entries', 'packet=pts', '-of', 'csv=p=0', file])
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  const step = 1 / (fps * timeBase);
  const uneven: number[] = [];
  for (let index = 1; index < pts.length; index += 1) {
    const gap = (pts[index] as number) - (pts[index - 1] as number);
    if (Math.abs(gap - step) > 1) uneven.push(index);
  }

  return {
    codec: video.codec_name,
    width: video.width ?? 0,
    height: video.height ?? 0,
    pixelFormat: video.pix_fmt ?? '',
    fps,
    frames: Number(video.nb_read_frames ?? 0),
    durationSeconds: Number(json.format.duration ?? 0),
    evenlySpaced: uneven.length === 0 && pts.length === Number(video.nb_read_frames ?? 0),
    uneven,
    hasAudio: json.streams.some(({ codec_type }) => codec_type === 'audio'),
  };
}

export interface FrameRequest {
  frame: number;
  output: string;
  /** Scaled to this width, keeping the aspect ratio. The full frame when left out. */
  width?: number;
}

/** How many frames one FFmpeg pass picks out. Each is a branch of one `split`. */
const FRAMES_PER_PASS = 24;

/**
 * Writes the given frames of a video as PNG files. Frames are picked by their index with `trim`,
 * which counts decoded frames, so there is no rounding from a time to a frame.
 */
export async function extractFrames(file: string, requests: FrameRequest[]): Promise<void> {
  for (let start = 0; start < requests.length; start += FRAMES_PER_PASS) {
    const batch = requests.slice(start, start + FRAMES_PER_PASS);
    const labels = batch.map((_, index) => `s${index}`);
    const branches = batch.map(({ frame, width }, index) => {
      const scale = width ? `,scale=${width}:-2:flags=lanczos` : '';
      return `[s${index}]trim=start_frame=${frame}:end_frame=${frame + 1}${scale}[o${index}]`;
    });
    const graph = `[0:v]split=${batch.length}${labels.map((label) => `[${label}]`).join('')};${branches.join(';')}`;
    const outputs = batch.flatMap(({ output }, index) => [
      '-map',
      `[o${index}]`,
      '-frames:v',
      '1',
      '-y',
      output,
    ]);
    await ffmpeg(['-i', file, '-filter_complex', graph, ...outputs]);
  }
}

export interface Raster {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8Array;
}

export async function readPng(file: string): Promise<Raster> {
  const png = PNG.sync.read(await readFile(file));
  return { width: png.width, height: png.height, data: png.data };
}

export function encodePng({ width, height, data }: Raster): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return PNG.sync.write(png);
}
