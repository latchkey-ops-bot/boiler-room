/**
 * What the website needs to make real films, read from the Worker's vars and secrets. Missing
 * anything essential, real films are off: `NaivePipeline.start` answers 503 and nobody is given a
 * real film. That is production's state today.
 */

/** The bindings this reads. Every one is optional, so an environment without them still runs. */
export interface RunnerBindings {
  APP_ENV?: string;
  /** Secret. The website's own Naive key: `computers:write` and `billing:read`, nothing else. */
  NAIVE_WEB_KEY?: string;
  /** Secret. The master key every per-run signing key is derived from. */
  RUNNER_SIGNING_SECRET?: string;
  /** Secret. Comma-separated Clerk user ids who get real films. Everyone else gets simulated ones. */
  REAL_FILM_USERS?: string;
  /** `snp_…`: the base snapshot every film computer is forked from. */
  RUNNER_SNAPSHOT_ID?: string;
  /** The callback base the runner reaches, with no trailing slash. The cron has no request URL. */
  RUNNER_PUBLIC_URL?: string;
  RUNNER_COMMIT?: string;
  RUNNER_FILM_COMMIT?: string;
  NAIVE_API_URL?: string;
  FILM_CAP_USD?: string;
  FILM_COMPUTE_RESERVE_USD?: string;
  ACCOUNT_DAILY_CAP_USD?: string;
  GLOBAL_DAILY_CAP_USD?: string;
  MAX_REAL_PER_ACCOUNT?: string;
  MAX_REAL_GLOBAL?: string;
  /** `true` once the film command can rewrite a script from a note (`--revise`). */
  RUNNER_REVISE_SUPPORTED?: string;
}

export interface ComputerSize {
  vcpu: number;
  memoryMb: number;
  diskGb: number;
}

export interface RunnerConfig {
  appEnv: string;
  naiveKey: string | null;
  naiveApiUrl: string;
  signingSecret: string | null;
  realFilmUsers: ReadonlySet<string>;
  snapshotId: string | null;
  publicUrl: string | null;
  runnerCommit: string | null;
  filmCommit: string | null;
  /** The whole film: crew and compute. */
  filmCapMicroUsd: number;
  /** Kept back from the crew for compute. The crew gets the cap less this. */
  computeReserveMicroUsd: number;
  accountDailyCapMicroUsd: number;
  globalDailyCapMicroUsd: number;
  maxRealPerAccount: number;
  maxRealGlobal: number;
  reviseSupported: boolean;
  size: ComputerSize;
}

/** Naive's public API. */
export const NAIVE_API_URL = 'https://api.vetta.sh';

/** Every film computer: the size the base snapshot was built on. A fork may not be smaller. */
export const FILM_COMPUTER: ComputerSize = { vcpu: 4, memoryMb: 8192, diskGb: 20 };

/** Naive's rates, per second. Billing is ahead, in 10-minute clock blocks. */
export const RATES = { vcpuPerSecond: 0.000014, gibPerSecond: 0.0000045 } as const;
export const BLOCK_MS = 600_000;

/** What one 10-minute block of a computer this size costs, in micro-USD. */
export function blockMicroUsd(size: ComputerSize): number {
  const perSecond = size.vcpu * RATES.vcpuPerSecond + (size.memoryMb / 1024) * RATES.gibPerSecond;
  return Math.round(perSecond * (BLOCK_MS / 1000) * 1_000_000);
}

const usd = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Math.round((Number.isFinite(parsed) && parsed > 0 ? parsed : fallback) * 1_000_000);
};

const count = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const present = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export function runnerConfig(bindings: RunnerBindings): RunnerConfig {
  const publicUrl = present(bindings.RUNNER_PUBLIC_URL);
  const snapshotId = present(bindings.RUNNER_SNAPSHOT_ID);
  return {
    appEnv: present(bindings.APP_ENV) ?? 'development',
    naiveKey: present(bindings.NAIVE_WEB_KEY),
    naiveApiUrl: present(bindings.NAIVE_API_URL) ?? NAIVE_API_URL,
    signingSecret: present(bindings.RUNNER_SIGNING_SECRET),
    realFilmUsers: new Set(
      (bindings.REAL_FILM_USERS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
    snapshotId: snapshotId && /^snp_[A-Za-z0-9]+$/.test(snapshotId) ? snapshotId : null,
    publicUrl: publicUrl?.startsWith('https://') ? publicUrl.replace(/\/+$/, '') : null,
    runnerCommit: present(bindings.RUNNER_COMMIT),
    filmCommit: present(bindings.RUNNER_FILM_COMMIT),
    filmCapMicroUsd: usd(bindings.FILM_CAP_USD, 2.5),
    computeReserveMicroUsd: usd(bindings.FILM_COMPUTE_RESERVE_USD, 0.5),
    accountDailyCapMicroUsd: usd(bindings.ACCOUNT_DAILY_CAP_USD, 5),
    globalDailyCapMicroUsd: usd(bindings.GLOBAL_DAILY_CAP_USD, 5.25),
    maxRealPerAccount: count(bindings.MAX_REAL_PER_ACCOUNT, 1),
    maxRealGlobal: count(bindings.MAX_REAL_GLOBAL, 1),
    reviseSupported: bindings.RUNNER_REVISE_SUPPORTED === 'true',
    size: FILM_COMPUTER,
  };
}

/** Everything a real film needs is configured. */
export function runnerReady(config: RunnerConfig): boolean {
  return Boolean(config.naiveKey && config.signingSecret && config.snapshotId && config.publicUrl);
}

/** This Clerk user's new films are real ones. */
export function realFilmsFor(config: RunnerConfig, userId: string): boolean {
  return runnerReady(config) && config.realFilmUsers.has(userId);
}
