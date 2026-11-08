import { appendFileSync } from 'node:fs';
import type { AgentDefinition } from '../define.ts';
import { type Naive, type StreamRetry, scrub, sessionEvents, usd } from '../naive/client.ts';
import { closeSession, inputTokens, pausedOnBudget, SessionTracker } from '../naive/session.ts';
import { describe } from '../researcher/run.ts';
import { syncAgents } from '../sync.ts';
import { type Batch, type BatchResult, batchFiles, smallerBatches } from './apply.ts';
import { reviewSchema } from './decision.ts';
import { type ReviewContext, reviewTask } from './prompt.ts';

/**
 * Runs each review batch as its own short session of `br-art-director`, a few at a time. Cost is
 * held in code, not by the prompt: a session that starts a second `view_image` call or runs past
 * its time is interrupted, and once the run has spent its budget no further batch starts. A batch
 * that ends without a valid review leaves the code's ranking for its scenes. The review is read
 * from the `session.idle` event that ends the turn, never from `sessions.get`. A session paused on
 * its budget is cancelled, recorded, and its batch retried once as smaller batches.
 */

export interface ReviewOptions {
  /** Stop starting batches once the sessions have spent this much, in micro-USD. */
  budgetMicroUsd: number;
  /** Sessions running at once. */
  concurrency: number;
  /** Wall-clock limit for one batch's session. */
  maxMinutesPerBatch: number;
  eventsPath: string;
  campaignId: string;
  /** How a dropped event stream is resumed before the session is stopped. */
  streamRetry?: StreamRetry;
}

export interface SessionRecord {
  batch: string;
  kind: Batch['kind'];
  session_id: string | null;
  consumed_micro_usd: number;
  views: number;
  outcome: string;
  /** Every input token the session read, over all its model requests. */
  input_tokens?: number;
  /** Characters of the task message, the part of the input this code writes. */
  task_chars?: number;
  /** The session was paused on its budget, and has been cancelled. */
  budget_paused?: boolean;
}

export interface ReviewRun {
  results: BatchResult[];
  sessions: SessionRecord[];
  spentMicroUsd: number;
  agentId: string;
  agentVersion: number;
}

const NUDGE =
  'Call submit_output now with seen, scene, tiles, generated and flags, from what you have seen. Do not view anything again.';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (message: string) =>
  console.log(scrub(`${new Date().toISOString().slice(11, 19)} ${message}`));

async function runBatch(
  client: Naive,
  definition: AgentDefinition,
  agentId: string,
  batch: Batch,
  task: string,
  options: ReviewOptions,
): Promise<{ result: BatchResult; record: SessionRecord; paused: boolean }> {
  const record: SessionRecord = {
    batch: batch.id,
    kind: batch.kind,
    session_id: null,
    consumed_micro_usd: 0,
    views: 0,
    outcome: '',
    task_chars: task.length,
  };
  const tracker = new SessionTracker();
  const fail = (failure: string, paused = false) => {
    record.outcome = failure;
    record.input_tokens = inputTokens(tracker.usage);
    if (paused) record.budget_paused = true;
    return { result: { batch, review: undefined, failure }, record, paused };
  };
  const session = await client.sessions.create({
    agent_id: agentId,
    message: task,
    budget_micro_usd: definition.session.budget_micro_usd,
    ...(definition.output_schema ? { output_schema: definition.output_schema } : {}),
    structured_output_required: definition.structured_output_required,
    metadata: { run: 'art', campaign: options.campaignId, batch: batch.id },
  });
  record.session_id = session.id;
  const deadline = Date.now() + options.maxMinutesPerBatch * 60_000;
  let afterSeq = 0;
  let stopped: string | undefined;
  const stop = (why: string) => {
    if (stopped) return;
    stopped = why;
    client.sessions.interrupt(session.id).catch(() => {});
  };

  const settle = async () => {
    for (;;) {
      const timer = setTimeout(
        () => stop(`ran past ${options.maxMinutesPerBatch} minutes`),
        Math.max(1000, deadline - Date.now()),
      );
      try {
        for await (const event of sessionEvents(
          client,
          session.id,
          afterSeq,
          options.streamRetry,
        )) {
          afterSeq = event.seq;
          const record_ = event as unknown as { type: string; data: Record<string, unknown> };
          const data = record_.data ?? {};
          tracker.handle(record_);
          if (event.type === 'tool.started' && data.name === 'view_image') {
            record.views += 1;
            if (record.views > 1) stop('started a second view_image call');
          }
          if (event.type !== 'message.delta' && !event.type.startsWith('span.'))
            appendFileSync(
              options.eventsPath,
              `${scrub(JSON.stringify({ batch: batch.id, ...event }))}\n`,
            );
          const line = describe(record_);
          if (line && !line.includes('view_image: [image]')) say(`[${batch.id}] ${line}`);
        }
      } finally {
        clearTimeout(timer);
      }
      const state = await client.sessions.get(session.id);
      if ((state.status !== 'running' && state.status !== 'queued') || Date.now() > deadline)
        return state;
      await sleep(1000);
    }
  };

  try {
    const state = await settle();
    const paused = pausedOnBudget(tracker, state);
    if (!tracker.submissions && !stopped && !paused && state.status === 'idle') {
      if (Date.now() < deadline) {
        afterSeq = (await client.sessions.send(session.id, { message: NUDGE, queue: true }))
          .accepted_seq;
        await settle();
      }
    }
  } catch (cause) {
    // The stream or the API failed for good. The session may still be running and spending: stop
    // it, and count what it spent, so the run's budget sees it and the report lists it. A cost
    // that cannot be read is counted as the session's whole budget.
    const after = await closeSession(client, session.id);
    record.consumed_micro_usd = after.consumedMicroUsd ?? definition.session.budget_micro_usd;
    const message = cause instanceof Error ? cause.message.slice(0, 200) : String(cause);
    return fail(
      `stream failed: ${message}${after.consumedMicroUsd === undefined ? '; cost unread, counted at the session budget' : ''}`,
      after.budgetPaused,
    );
  }
  // Left neither running nor parked: a session paused on its budget is cancelled here.
  const final = await closeSession(client, session.id);
  record.consumed_micro_usd = final.consumedMicroUsd ?? 0;

  if (final.budgetPaused || tracker.budgetPaused)
    return fail(
      `paused on its budget and ${final.cancelled ? 'cancelled' : 'could not be cancelled'}`,
      true,
    );
  if (stopped) return fail(`interrupted: ${stopped}`);
  if (!tracker.submissions || tracker.output == null)
    return fail(`no review submitted (${final.status}/${final.stopReason})`);
  const parsed = reviewSchema.safeParse(tracker.output);
  if (!parsed.success)
    return fail(`review does not match the schema: ${parsed.error.message.slice(0, 200)}`);
  record.outcome = parsed.data.seen ? 'reviewed' : 'reviewed, not seen';
  record.input_tokens = inputTokens(tracker.usage ?? final.tokenUsage);
  return { result: { batch, review: parsed.data, failure: undefined }, record, paused: false };
}

export async function reviewBatches(
  client: Naive,
  definition: AgentDefinition,
  batches: readonly Batch[],
  context: ReviewContext,
  options: ReviewOptions,
): Promise<ReviewRun> {
  const [synced] = await syncAgents(client, [definition]);
  if (!synced) throw new Error('Agent sync returned nothing.');
  say(
    `agent ${synced.name} ${synced.id} v${synced.version} (${synced.action}); ${batches.length} review(s)`,
  );
  const results: BatchResult[] = [];
  const sessions: SessionRecord[] = [];
  let spent = 0;
  let next = 0;
  // A batch paused on its budget is retried once, as smaller batches added to the end.
  const queue: Batch[] = [...batches];
  const retries = new Set<Batch>();

  const worker = async () => {
    for (;;) {
      const batch = queue[next];
      next += 1;
      if (!batch) return;
      if (spent >= options.budgetMicroUsd) {
        const failure = `not started: the run's review budget of ${usd(options.budgetMicroUsd)} is spent`;
        results.push({ batch, review: undefined, failure });
        sessions.push({
          batch: batch.id,
          kind: batch.kind,
          session_id: null,
          consumed_micro_usd: 0,
          views: 0,
          outcome: failure,
        });
        continue;
      }
      if (batchFiles(batch, context.infos).length === 0) {
        results.push({ batch, review: undefined, failure: 'no picture can be viewed' });
        continue;
      }
      try {
        const { result, record, paused } = await runBatch(
          client,
          definition,
          synced.id,
          batch,
          reviewTask(batch, context),
          options,
        );
        spent += record.consumed_micro_usd;
        sessions.push(record);
        const smaller = paused && !retries.has(batch) ? smallerBatches(batch) : [];
        if (smaller.length > 0) {
          for (const each of smaller) retries.add(each);
          queue.push(...smaller);
          record.outcome += `; retried as ${smaller.map((each) => each.id).join(' and ')}`;
        } else results.push(result);
        say(
          `[${batch.id}] ${record.outcome}, ${usd(record.consumed_micro_usd)}${record.input_tokens ? `, ${record.input_tokens} input tokens` : ''}`,
        );
      } catch (cause) {
        // Only starting the session throws now, so nothing ran and nothing was spent.
        const failure = `session failed: ${cause instanceof Error ? cause.message.slice(0, 200) : cause}`;
        results.push({ batch, review: undefined, failure });
        sessions.push({
          batch: batch.id,
          kind: batch.kind,
          session_id: null,
          consumed_micro_usd: 0,
          views: 0,
          outcome: failure,
        });
        say(`[${batch.id}] ${failure}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
  // Keep the batches in plan order for the report, with any retries last.
  const order = new Map(queue.map((batch, index) => [batch.id, index]));
  results.sort((a, b) => (order.get(a.batch.id) ?? 0) - (order.get(b.batch.id) ?? 0));
  sessions.sort((a, b) => (order.get(a.batch) ?? 0) - (order.get(b.batch) ?? 0));
  return {
    results,
    sessions,
    spentMicroUsd: spent,
    agentId: synced.id,
    agentVersion: synced.version,
  };
}
