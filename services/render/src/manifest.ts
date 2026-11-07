/**
 * The record written beside every film: what was rendered, from which campaign and templates, with
 * which settings, how each chunk went, which computers ran it and what it cost.
 */
import { createHash } from 'node:crypto';
import type { Format } from '@boiler-room/motion';
import type { FrameRange } from './chunks.ts';
import type { ComputerSize, CostEstimate } from './cost.ts';
import type { BaseRecord } from './naive/base.ts';
import type { ComputerRecord } from './naive/pool.ts';
import type { QualityIndex } from './quality.ts';
import type { FilmCheck, SeamReport } from './verify.ts';
import type { TemplateVersion } from './versions.ts';

/** JSON with its keys sorted at every level, so equal campaigns hash equally however they are laid out. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

export interface ChunkAttempt {
  attempt: number;
  computerId: string | null;
  fromSnapshot: boolean;
  startedAt: string;
  /** Create sent to Naive reporting the computer running. */
  provisionSeconds: number | null;
  /** Create sent to the renderer ready on the computer: provisioning, then the check or the setup. */
  readySeconds: number | null;
  fetchSeconds: number | null;
  /** As the worker measured it, from the first frame to the file written. */
  renderSeconds: number | null;
  /** The render command, as seen from here. */
  renderWallSeconds: number | null;
  returnSeconds: number | null;
  totalSeconds: number;
  ok: boolean;
  error: string | null;
}

export interface ChunkRecord {
  index: number;
  frameRange: FrameRange;
  frames: number;
  bytes: number | null;
  sha256: string | null;
  attempts: ChunkAttempt[];
}

export interface Manifest {
  manifestVersion: 1;
  runId: string;
  createdAt: string;
  output: { file: string; bytes: number; sha256: string };
  campaign: {
    id: string;
    file: string;
    /** Of the file's bytes, which anyone can check with `sha256sum`. */
    fileSha256: string;
    /** Of the validated campaign as canonical JSON, which ignores layout and key order. */
    sha256: string;
    /** Of the one cut rendered, with its hook and CTA resolved. */
    cutSha256: string;
  };
  template: TemplateVersion & {
    /** Of the bundled templates, without the campaign's files. */
    bundleSha256: string;
    remotion: string;
  };
  settings: {
    format: Format;
    hookId: string | null;
    ctaId: string | null;
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
    codec: 'h264';
    chunkCodec: 'h264-ts';
    imageFormat: 'jpeg';
    jpegQuality: number;
    muted: true;
    concurrency: number | null;
    runner: 'naive' | 'local';
    workersRequested: number;
    chunks: number;
    framesPerChunk: number;
    workerSize: ComputerSize | null;
  };
  base: {
    mode: 'snapshot' | 'cold';
    snapshotId: string | null;
    recipeHash: string;
    /** Set when this run made the snapshot. */
    built: BaseRecord | null;
    /** Measured on the base, when a snapshot was used: the setup a fork skipped. */
    coldSetupSeconds: number | null;
  } | null;
  chunks: ChunkRecord[];
  computers: Omit<ComputerRecord, 'createdMs' | 'destroyedMs'>[];
  timings: Record<string, number>;
  cost: {
    limitUsd: number;
    estimate: CostEstimate | null;
    /** From the published rates and each computer's life, block by block. */
    computedUsd: number;
    /** What the Naive ledger booked for these computers, read after they were destroyed. */
    ledgerUsd: number | null;
  };
  verification: { film: FilmCheck; seams: SeamReport | null };
  quality: QualityIndex | null;
  cleanup: {
    /** Computers named for this run that Naive still listed after the run. Always empty on success. */
    computersLeft: string[];
    filesDeleted: number;
  };
  warnings: string[];
}
