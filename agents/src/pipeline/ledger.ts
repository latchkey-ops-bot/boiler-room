/**
 * A film's spend ledger and the limits on sending it round again. Nothing routes Quality Check
 * failures back to the Director, the Art Director or motion yet; whatever does must stop at these
 * limits, because every film fails Quality Check today on motion's placeholder scenes, so a plain
 * "retry until it passes" loop would never end. `pnpm direct`, `pnpm art` and `pnpm qc` already
 * record what they spend here and refuse to start once the film is over its limits.
 *
 * The ledger lives beside the film's campaign.json, as `film-ledger.json`.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { QcIssue, QcReport } from '../quality/output.ts';

export const LEDGER_FILE = 'film-ledger.json';

export const STEPS = ['director', 'art-director', 'art-images', 'quality-check'] as const;
export type Step = (typeof STEPS)[number];

export interface FilmLimits {
  /** Quality Check reviews per film: the first, and the re-reviews after a route-back. */
  maxRounds: number;
  /** Everything spent on the film, sessions and generated media together, in micro-USD. */
  maxMicroUsd: number;
}

/** Two Quality Check rounds, so one route-back, and $5 a film. A first pass costs about $1.26. */
export const FILM_LIMITS: FilmLimits = { maxRounds: 2, maxMicroUsd: 5_000_000 };

const entrySchema = z.object({
  step: z.enum(STEPS),
  microUsd: z.number().int().min(0),
  at: z.string(),
  session: z.string().nullable(),
  note: z.string(),
});

const ledgerSchema = z.object({
  film: z.string(),
  entries: z.array(entrySchema),
});

export type LedgerEntry = z.infer<typeof entrySchema>;
export type FilmLedger = z.infer<typeof ledgerSchema>;

export const ledgerPath = (campaignDir: string) => join(campaignDir, LEDGER_FILE);

export function readLedger(file: string, film: string): FilmLedger {
  if (!existsSync(file)) return { film, entries: [] };
  return ledgerSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export function recordSpend(
  file: string,
  film: string,
  entry: Omit<LedgerEntry, 'at'> & { at?: string },
): FilmLedger {
  const ledger = readLedger(file, film);
  ledger.entries.push(entrySchema.parse({ at: new Date().toISOString(), ...entry }));
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}

export const spentMicroUsd = (ledger: FilmLedger) =>
  ledger.entries.reduce((sum, entry) => sum + entry.microUsd, 0);

/** Quality Check reviews the film has had. */
export const rounds = (ledger: FilmLedger) =>
  ledger.entries.filter((entry) => entry.step === 'quality-check').length;

/**
 * Whether a step may start on this film. Nothing starts once the film has spent its limit. After
 * `maxRounds` Quality Check reviews, nothing upstream starts again and no further review starts:
 * the film goes to a person.
 */
export function mayStart(
  ledger: FilmLedger,
  step: Step,
  limits: FilmLimits = FILM_LIMITS,
): { ok: true } | { ok: false; why: string } {
  const spent = spentMicroUsd(ledger);
  if (spent >= limits.maxMicroUsd) {
    return {
      ok: false,
      why: `${step} not started: film ${ledger.film} has spent $${(spent / 1e6).toFixed(4)}, at or over its limit of $${(limits.maxMicroUsd / 1e6).toFixed(2)}`,
    };
  }
  const done = rounds(ledger);
  if (done >= limits.maxRounds) {
    return {
      ok: false,
      why: `${step} not started: film ${ledger.film} has had ${done} Quality Check round(s), the limit; it goes to a person, not round again`,
    };
  }
  return { ok: true };
}

/**
 * Quality Check failures that come from motion's placeholder scenes, which every render shows
 * until motion builds the 15 registry scene types: an empty frame 0, story text too small for a
 * phone, and headlines over 2 lines. They are expected, whoever the agent names as owner, and
 * never send a film round again.
 */
export const EXPECTED_PLACEHOLDER_FAILURES: ReadonlySet<string> = new Set([
  'frame-0',
  'words-recovered',
  'lines',
  'scene-registry',
]);

/** The issues of a review that would send the film back to an owner, by owner. */
export function routable(report: Pick<QcReport, 'issues'>): Map<QcIssue['owner'], QcIssue[]> {
  const byOwner = new Map<QcIssue['owner'], QcIssue[]>();
  for (const issue of report.issues) {
    if (issue.severity === 'minor' || EXPECTED_PLACEHOLDER_FAILURES.has(issue.check)) continue;
    byOwner.set(issue.owner, [...(byOwner.get(issue.owner) ?? []), issue]);
  }
  return byOwner;
}

/** A JSON report this run wrote: the file exists and was written at or after `since`, in ms. */
export function freshReport(file: string, since: number): Record<string, unknown> | undefined {
  if (!existsSync(file) || statSync(file).mtimeMs < since) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** Refuses a step the ledger does not allow: prints why and exits 1. */
export function refuseUnlessAllowed(file: string, film: string, step: Step): void {
  const allowed = mayStart(readLedger(file, film), step);
  if (!allowed.ok) {
    console.log(`${allowed.why}. Ledger: ${file}`);
    process.exit(1);
  }
}
