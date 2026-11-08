import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { approvals, films } from '../../db/schema.ts';
import { FORMATS, type Format, PIPELINE_KINDS, type PipelineKind } from '../../lib/film.ts';
import { NaivePipeline } from './naive.ts';
import { SimulatedPipeline, type SimulationLedger } from './simulated.ts';
import type { PipelineClient } from './types.ts';

export { NaivePipeline } from './naive.ts';
export { SimulatedPipeline } from './simulated.ts';
export * from './types.ts';

/** The pipeline new films use in this environment: the `PIPELINE` var in wrangler.jsonc. */
export function pipelineKindFrom(value: string | undefined): PipelineKind {
  return PIPELINE_KINDS.includes(value as PipelineKind) ? (value as PipelineKind) : 'naive';
}

export function createPipeline(kind: PipelineKind, db: Db, clock?: () => Date): PipelineClient {
  if (kind === 'simulated') return new SimulatedPipeline(d1Ledger(db), { clock });
  return new NaivePipeline();
}

/** Reads a simulated run from D1: the film's start time and the customer's decisions. */
export function d1Ledger(db: Db): SimulationLedger {
  return {
    async run(runId) {
      const film = await db.query.films.findFirst({ where: eq(films.pipelineRunId, runId) });
      if (!film) return null;
      const rows = await db
        .select()
        .from(approvals)
        .where(eq(approvals.filmId, film.id))
        .orderBy(asc(approvals.decidedAt));
      return {
        url: film.url,
        startedAt: film.createdAt,
        decisions: rows.map((row) => ({
          version: row.scriptVersion,
          decision: row.decision,
          note: row.note,
          hookId: row.chosenHook,
          ctaId: row.chosenCta,
          formats: parseFormats(row.formatsJson),
          at: row.decidedAt,
        })),
      };
    },
  };
}

export function parseFormats(json: string | null): Format[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value)
      ? value.filter((item): item is Format => FORMATS.includes(item as Format))
      : [];
  } catch {
    return [];
  }
}
