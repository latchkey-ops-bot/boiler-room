/**
 * Helpers for the scripts that run on a developer's machine: the keys in the env file, git, and
 * what a computer has cost. Never prints a key.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FILM_COMPUTER_SIZE } from '../src/launcher.ts';

export const ENV_FILE = process.env.BOILER_ROOM_ENV ?? join(homedir(), '.boiler-room.env');

/** One value from the env file, or undefined. The value is never printed. */
export function envValue(name: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(ENV_FILE, 'utf8');
  } catch {
    throw new Error(`Cannot read ${ENV_FILE}.`);
  }
  const pattern = new RegExp(`^(?:export\\s+)?${name}=["']?([^"'\\s]+)`, 'm');
  return pattern.exec(text)?.[1];
}

export function requireEnv(name: string): string {
  const value = envValue(name);
  if (!value) throw new Error(`${ENV_FILE} has no ${name}.`);
  return value;
}

export function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** The origin as a public https URL. */
export function repoUrl(): string {
  const url = git('remote', 'get-url', 'origin').replace(/\.git$/, '');
  const ssh = /^git@github\.com:(.+)$/.exec(url);
  return ssh ? `https://github.com/${ssh[1]}` : url;
}

/** A branch's head on the remote, as a full SHA. */
export function remoteHead(branch: string): string {
  const line = git('ls-remote', 'origin', `refs/heads/${branch}`);
  const sha = line.split(/\s+/)[0];
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`origin has no branch ${branch}.`);
  return sha;
}

/** Throws unless `sha` is on some branch of the remote, so a computer can clone it. */
export function assertPushed(sha: string) {
  git('fetch', '--quiet', 'origin');
  const branches = git('branch', '-r', '--contains', sha);
  if (!branches) throw new Error(`${sha.slice(0, 12)} is not on origin. Push it first.`);
}

const BLOCK_MS = 600_000;
/** USD a second for the film computer: 4 vCPU at $0.000014 and 8 GiB at $0.0000045. */
export const FILM_RATE =
  FILM_COMPUTER_SIZE.vcpu * 0.000014 + (FILM_COMPUTER_SIZE.memory_mb / 1024) * 0.0000045;

/** What a film-sized computer has been charged: from create to the end of the clock block it ended in. */
export function chargedUsd(createdMs: number, endedMs: number): number {
  const end = Math.ceil(endedMs / BLOCK_MS) * BLOCK_MS;
  return (FILM_RATE * (end - createdMs)) / 1000;
}

export const stamp = (line: string) =>
  console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
