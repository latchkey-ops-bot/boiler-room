import { campaignSchema } from '@boiler-room/schema';
import { and, asc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { type FilmRun, filmRuns, films, runEvents, runFiles } from '../../db/schema.ts';
import { displayHost, FORMATS, type Format } from '../../lib/film.ts';
import { newId } from '../ids.ts';
import { advance, computerName } from '../runner/advance.ts';
import { approvalCaps, approvalRefusal } from '../runner/caps.ts';
import { runnerReady } from '../runner/config.ts';
import type { ApprovalInput } from '../runner/contract.ts';
import { addWebEvent, getRun, moveRun, type RunnerDeps } from '../runner/runs.ts';
import { asStage, visibleStatus } from '../runner/states.ts';
import type {
  PipelineClient,
  PipelineDeliverable,
  PipelineEvent,
  PipelineStatus,
  ScriptApproval,
} from './types.ts';
import { PipelineConflictError, PipelineUnavailableError } from './types.ts';

/** How long `start()` waits, inside `waitUntil`, for the new computer to be running. */
const START_WAIT_MS = 25_000;

/**
 * The real film pipeline. Each film runs on its own Naive computer, forked from a prebuilt
 * snapshot, and the runner on it reports back through signed callbacks that fill D1. This class
 * only reads D1 and queues steps for `advance()`: no page poll ever calls Naive.
 *
 * Unconfigured (no website key, signing secret, snapshot or public URL), every call that would
 * start or move a film fails with `PipelineUnavailableError`, which the API answers as 503.
 */
export class NaivePipeline implements PipelineClient {
  readonly kind = 'naive' as const;
  readonly #deps: RunnerDeps | null;

  constructor(deps: RunnerDeps | null = null) {
    this.#deps = deps;
  }

  #ready(): RunnerDeps {
    const deps = this.#deps;
    if (!deps?.naive || !runnerReady(deps.config)) throw notWired();
    return deps;
  }

  #reader(): RunnerDeps {
    if (!this.#deps) throw notWired();
    return this.#deps;
  }

  async #run(runId: string): Promise<FilmRun> {
    const run = await getRun(this.#reader().db, runId);
    if (!run) throw new PipelineConflictError('There is no such run.');
    return run;
  }

  async start(input: {
    filmId: string;
    url: string;
    mode?: 'customer' | 'sample';
    costCapMicroUsd?: number;
  }): Promise<{ runId: string }> {
    const deps = this.#ready();
    const naive = deps.naive as NonNullable<RunnerDeps['naive']>;
    const { config } = deps;
    const runId = newId('run');
    const now = deps.now().getTime();
    const mode = input.mode ?? 'customer';
    // The run row first, and the film pointed at it, so a callback never finds a film without one.
    await deps.db.batch([
      deps.db.insert(filmRuns).values({
        id: runId,
        filmId: input.filmId,
        mode,
        state: 'provisioning',
        phase: mode === 'sample' ? 'all' : 'script',
        stage: 'research',
        status: 'queued',
        computerState: 'creating',
        runningSince: now,
        baseSnapshotId: config.snapshotId as string,
        // A caller's own cap (a GTM sample's budget) may lower the website's, never raise it.
        costCapMicroUsd: Math.min(
          config.filmCapMicroUsd,
          input.costCapMicroUsd ?? config.filmCapMicroUsd,
        ),
        createdAt: now,
        updatedAt: now,
      }),
      deps.db.update(films).set({ pipelineRunId: runId }).where(eq(films.id, input.filmId)),
    ]);
    try {
      const computer = await naive.createComputer(
        {
          name: computerName(deps, input.filmId),
          vcpu: config.size.vcpu,
          memory_mb: config.size.memoryMb,
          disk_gb: config.size.diskGb,
          snapshot_id: config.snapshotId as string,
        },
        `${runId}:create`,
      );
      await deps.db
        .update(filmRuns)
        .set({
          computerId: computer.id,
          computerCreatedAt: Date.parse(computer.created_at) || now,
          computerState: computer.status === 'running' ? 'running' : 'creating',
          updatedAt: now,
        })
        .where(eq(filmRuns.id, runId));
    } catch (error) {
      deps.log?.(
        `naive: film ${input.filmId}: create refused (${error instanceof Error ? error.message : error})`,
      );
      await deps.db.batch([
        deps.db.delete(filmRuns).where(eq(filmRuns.id, runId)),
        deps.db.update(films).set({ pipelineRunId: null }).where(eq(films.id, input.filmId)),
      ]);
      throw new PipelineUnavailableError(
        "The crew can't start right now. Try again in a few minutes.",
      );
    }
    deps.waitUntil(advance(deps, runId, { waitMs: START_WAIT_MS }));
    return { runId };
  }

  async status(runId: string): Promise<PipelineStatus> {
    const run = await this.#run(runId);
    const { stage, status } = visibleStatus(run);
    return {
      runId,
      stage,
      status,
      scriptVersion: run.scriptVersion,
      campaign: parseCampaignJson(run.campaignJson),
    };
  }

  async events(runId: string, options: { after?: string } = {}): Promise<PipelineEvent[]> {
    const { db } = this.#reader();
    let afterFeed = 0;
    if (options.after) {
      const [source, seq] = options.after.split(':');
      if ((source === 'runner' || source === 'web') && seq) {
        const row = await db.query.runEvents.findFirst({
          where: and(
            eq(runEvents.runId, runId),
            eq(runEvents.source, source),
            eq(runEvents.sourceSeq, Number(seq)),
          ),
        });
        afterFeed = row?.feedSeq ?? 0;
      }
    }
    const rows = await db
      .select()
      .from(runEvents)
      .where(
        and(
          eq(runEvents.runId, runId),
          isNotNull(runEvents.feedSeq),
          gt(runEvents.feedSeq, afterFeed),
        ),
      )
      .orderBy(asc(runEvents.feedSeq))
      .limit(200);
    return rows.flatMap((row) =>
      row.feedSeq !== null && row.agent && row.kind && row.message
        ? [
            {
              id: `${row.source}:${row.sourceSeq}`,
              seq: row.feedSeq - 1,
              at: new Date(row.at),
              agent: row.agent,
              kind: row.kind,
              stage: asStage(row.stage),
              status: row.status ?? 'working',
              message: row.message,
            },
          ]
        : [],
    );
  }

  /**
   * Records the approval and queues the render. It does not wait for the computer to come back,
   * so a slow Naive call never turns an approval into an error: `advance()` resumes the computer,
   * or forks the checkpoint, from `waitUntil` now and from the cron after.
   *
   * The caps are checked again here, in the same statement that queues the render: a founder's
   * other film may have started while this script waited, and the rest of this film's cap must
   * still fit the day's. A refused approval leaves the script waiting.
   */
  async approveScript(runId: string, input: ScriptApproval): Promise<void> {
    const deps = this.#ready();
    const run = await this.#run(runId);
    if (run.mode === 'sample')
      throw new PipelineConflictError('A sample film has no approval step.');
    if (
      !['script_ready', 'awaiting_approval'].includes(run.state) ||
      run.scriptVersion !== input.version
    ) {
      throw new PipelineConflictError('The script is not waiting for approval.');
    }
    const approval: ApprovalInput = {
      version: input.version,
      hookId: input.hookId,
      ctaId: input.ctaId,
      formats: input.formats,
      confirmedClaimIds: input.confirmedClaimIds,
    };
    const film = await deps.db.query.films.findFirst({ where: eq(films.id, run.filmId) });
    if (!film) throw new PipelineConflictError('There is no such film.');
    const now = deps.now().getTime();
    const scope = { accountId: film.accountId, userId: film.createdBy, now };
    const [queued] = await deps.db
      .update(filmRuns)
      .set({
        state: 'render_queued',
        phase: 'render',
        stage: 'art_direction',
        status: 'working',
        approvalJson: JSON.stringify(approval),
        queuedAt: now,
        // Each phase gets its own launch tries.
        launchAttempts: 0,
        updatedAt: now,
      })
      .where(
        and(
          eq(filmRuns.id, runId),
          inArray(filmRuns.state, ['script_ready', 'awaiting_approval']),
          eq(filmRuns.scriptVersion, input.version),
          approvalCaps(deps.config, scope, runId),
        ),
      )
      .returning();
    if (!queued) {
      const current = await getRun(deps.db, runId);
      if (
        current &&
        ['script_ready', 'awaiting_approval'].includes(current.state) &&
        current.scriptVersion === input.version
      ) {
        const refusal = await approvalRefusal(deps.db, deps.config, scope, runId);
        if (refusal) throw refusal;
      }
      throw new PipelineConflictError('The script is not waiting for approval.');
    }
    const shapes = input.formats.join(', ');
    await addWebEvent(deps, queued, {
      agent: 'customer',
      kind: 'decision',
      type: 'web.approved',
      message: `You approved version ${input.version} in ${shapes}. The crew is getting back to work.`,
    });
    deps.waitUntil(advance(deps, runId, { waitMs: START_WAIT_MS }));
  }

  async sendBackScript(runId: string, input: { version: number; note: string }): Promise<void> {
    const deps = this.#ready();
    if (!deps.config.reviseSupported) {
      throw new PipelineUnavailableError(
        'Sending a script back is not ready for real films yet. Approve it, or start a new video.',
      );
    }
    const queued = await moveRun(deps, runId, ['script_ready', 'awaiting_approval'], {
      state: 'revise_queued',
      phase: 'script',
      stage: 'script',
      status: 'working',
      reviseJson: JSON.stringify({ version: input.version, note: input.note }),
      queuedAt: deps.now().getTime(),
      launchAttempts: 0,
    });
    if (!queued || queued.scriptVersion !== input.version) {
      throw new PipelineConflictError('The script is not waiting for approval.');
    }
    await addWebEvent(deps, queued, {
      agent: 'customer',
      kind: 'sent_back',
      type: 'web.sent_back',
      message: `You sent version ${input.version} back to the Director.`,
    });
    deps.waitUntil(advance(deps, runId, { waitMs: START_WAIT_MS }));
  }

  async deliverables(runId: string): Promise<PipelineDeliverable[]> {
    const { db } = this.#reader();
    const run = await this.#run(runId);
    if (visibleStatus(run).status !== 'done') return [];
    const film = await db.query.films.findFirst({ where: eq(films.id, run.filmId) });
    const rows = await db
      .select()
      .from(runFiles)
      .where(
        and(
          eq(runFiles.runId, runId),
          eq(runFiles.kind, 'mp4'),
          eq(runFiles.scriptVersion, run.scriptVersion),
        ),
      )
      .orderBy(asc(runFiles.variantKey));
    const campaign = parseCampaignJson(run.campaignJson);
    return rows.flatMap((row) => {
      const [format, opening, cta] = (row.variantKey ?? '').split('.');
      if (!FORMATS.includes(format as Format) || !opening || !cta) return [];
      return [
        {
          variantKey: row.variantKey as string,
          format: format as Format,
          hookId: opening === 'main' ? null : opening,
          ctaId: cta === 'none' ? null : cta,
          fileName: deliverableFileName(
            film?.url ?? '',
            row.variantKey as string,
            row.scriptVersion,
          ),
          contentType: row.contentType,
          r2Key: row.r2Key,
          bytes: row.bytes,
          durationSeconds: campaign ? Math.round(campaign.durationSeconds) : null,
          scriptVersion: row.scriptVersion,
        },
      ];
    });
  }

  async requestRevision(_runId: string, _input: { version: number; note: string }): Promise<void> {
    this.#ready();
    // After delivery the computer and the checkpoint are gone, so a revision is a new run: later.
    throw new PipelineUnavailableError(
      'Revisions of real films are not ready yet. Start a new video for another take.',
    );
  }
}

/** A deliverable's file name for the founder: the site, the shape and the opening. */
export function deliverableFileName(url: string, variant: string, version: number): string {
  const [format = '16:9', opening = 'main'] = variant.split('.');
  const slug = displayHost(url).replace(/[^a-z0-9]+/g, '-');
  return `${slug}-${format.replace(':', 'x')}-${opening}${version > 1 ? `-v${version}` : ''}.mp4`;
}

function parseCampaignJson(json: string | null) {
  if (!json) return null;
  try {
    const parsed = campaignSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function notWired(): PipelineUnavailableError {
  return new PipelineUnavailableError(
    'The film crew is not connected yet, so no film can be started here.',
  );
}
