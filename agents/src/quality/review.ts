/**
 * The model's part of a review: upload the images taken from the film to Naive files, start one
 * `br-quality-check` session with a typed result, and record which images it actually opened. The
 * images are deleted afterwards; the agent is kept, as it is part of the crew.
 *
 * The review is read from the `session.idle` event that ends the turn, never from `sessions.get`,
 * which can still answer the previous turn's output. A session paused on its budget is cancelled,
 * recorded, and the review retried once as two smaller sessions, each with half the images.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { AgentDefinition } from '../define.ts';
import { type Naive, type StreamRetry, scrub, sessionEvents, usd } from '../naive/client.ts';
import { closeSession, type InputSize, pausedOnBudget, SessionTracker } from '../naive/session.ts';
import { syncAgents } from '../sync.ts';
import { type QcReview, qcReviewSchema } from './output.ts';
import { CONTINUE_MESSAGE, type ReviewImage } from './prompt.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_CONTINUES = 2;
const RESUMABLE = new Set(['end_turn', 'max_iterations', 'awaiting_input']);

export interface LocalImage {
  file: string;
  name: string;
  what: string;
  /** Every frame of the film the image shows. */
  frames?: number[];
}

/** Records the file ids every successful `view_image` call opened. */
export class ViewTracker {
  readonly viewed = new Set<string>();
  submissions = 0;
  private readonly started = new Map<string, { name: string; args: Record<string, unknown> }>();

  handle(event: { type: string; data: Record<string, unknown> }): void {
    const data = event.data ?? {};
    if (event.type === 'tool.started') {
      this.started.set(String(data.tool_call_id), {
        name: String(data.name),
        args: (data.args as Record<string, unknown>) ?? {},
      });
      return;
    }
    if (event.type !== 'tool.completed' || data.is_error) return;
    const call = this.started.get(String(data.tool_call_id));
    const name = String(data.name ?? call?.name);
    if (name === 'submit_output') this.submissions += 1;
    if (name !== 'view_image') return;
    const ids = call?.args.file_ids;
    const output = typeof data.output === 'string' ? data.output : '';
    for (const id of Array.isArray(ids) ? ids : []) {
      // An id the tool could not open is not listed in its output.
      if (typeof id === 'string' && output.includes(id)) this.viewed.add(id);
    }
  }
}

export interface ReviewRun {
  agentId: string;
  agentVersion: number;
  /** The session, or the sessions joined by ", " when a paused review was retried in halves. */
  sessionId: string;
  images: (ReviewImage & { viewed: boolean })[];
  review: QcReview | null;
  /** Why the typed result is missing or was refused. */
  problem: string | null;
  costMicroUsd: number;
  /** Each session the review ran, with what it read and how it ended. */
  sessions: ReviewSession[];
}

export interface ReviewSession extends InputSize {
  session_id: string;
  images: number;
  task_chars: number;
  consumed_micro_usd: number;
  /** The session was paused on its budget, and has been cancelled. */
  budget_paused: boolean;
  outcome: string;
}

const worst = (results: readonly QcReview['checks'][number]['result'][]) =>
  results.includes('fail') ? 'fail' : results.includes('pass') ? 'pass' : 'n/a';

/**
 * One review from the reviews of two halves of the images: a check fails when either half fails
 * it and passes when either passes it and neither fails it, on the frames of both.
 */
export function mergeReviews(reviews: readonly QcReview[]): QcReview {
  const checks = new Map<string, QcReview['checks']>();
  for (const check of reviews.flatMap((review) => review.checks))
    checks.set(check.id, [...(checks.get(check.id) ?? []), check]);
  return {
    verdict: reviews.every((review) => review.verdict === 'pass') ? 'pass' : 'fail',
    inspected: reviews.flatMap((review) => review.inspected),
    checks: [...checks.entries()].map(([id, parts]) => ({
      id,
      result: worst(parts.map((part) => part.result)),
      measured: parts.map((part) => part.measured).join(' | '),
      frames: [...new Set(parts.flatMap((part) => part.frames))].sort((a, b) => a - b),
    })),
    issues: reviews.flatMap((review) => review.issues),
    summary: reviews.map((review) => review.summary).join(' '),
  };
}

export async function uploadImages(
  client: Naive,
  images: readonly LocalImage[],
  folder: string,
): Promise<ReviewImage[]> {
  const uploaded: ReviewImage[] = [];
  for (const image of images) {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(image.file)], { type: 'image/png' }), image.name);
    form.append('title', `qc ${image.name}`);
    form.append('tags', 'boiler-room,quality-check');
    form.append('folder', folder);
    const file = await client.files.upload(form);
    uploaded.push({ fileId: file.id, name: image.name, what: image.what });
  }
  return uploaded;
}

export async function deleteImages(client: Naive, images: readonly ReviewImage[]): Promise<number> {
  let deleted = 0;
  for (const image of images) {
    const done = await client.files.delete(image.fileId).catch(() => null);
    if (done?.deleted) deleted += 1;
  }
  return deleted;
}

function describe(event: { type: string; data: Record<string, unknown> }): string | undefined {
  const data = event.data ?? {};
  if (event.type === 'tool.started') {
    const args = (data.args as Record<string, unknown>) ?? {};
    if (data.name === 'view_image') return `-> view_image ${JSON.stringify(args.file_ids)}`;
    if (data.name === 'submit_output') return `-> submit_output (${String(args.verdict)})`;
    return `-> ${String(data.name)}`;
  }
  if (event.type === 'tool.completed' && data.is_error) {
    return `!! ${String(data.name)}: ${String(data.output).slice(0, 200)}`;
  }
  if (event.type === 'session.idle') return `idle: ${String(data.stop_reason)}`;
  if (event.type === 'budget.exceeded') return 'budget exceeded';
  return undefined;
}

interface SessionOutcome {
  record: ReviewSession;
  review: QcReview | null;
  problem: string | null;
  viewed: ReadonlySet<string>;
  paused: boolean;
}

/** One review session over `images`, which are already uploaded. */
async function reviewSession(
  options: ReviewOptions,
  agentId: string,
  images: readonly ReviewImage[],
): Promise<SessionOutcome> {
  const { client, definition, say } = options;
  const views = new ViewTracker();
  const tracker = new SessionTracker();
  const task = options.task(images);
  const record: ReviewSession = {
    session_id: '',
    images: images.length,
    task_chars: task.length,
    consumed_micro_usd: 0,
    budget_paused: false,
    outcome: '',
    ...tracker.inputSize(),
  };
  const done = (
    problem: string | null,
    review: QcReview | null,
    consumed: number | undefined,
    paused = false,
  ): SessionOutcome => {
    Object.assign(record, tracker.inputSize(), {
      consumed_micro_usd: consumed ?? options.budgetMicroUsd,
      budget_paused: paused,
      outcome: problem ?? `reviewed: ${review?.verdict}`,
    });
    return { record, review, problem, viewed: views.viewed, paused };
  };

  const session = await client.sessions.create({
    agent_id: agentId,
    message: task,
    budget_micro_usd: options.budgetMicroUsd,
    ...(definition.output_schema ? { output_schema: definition.output_schema } : {}),
    structured_output_required: definition.structured_output_required,
    metadata: { run: 'quality-check', folder: options.folder },
  });
  record.session_id = session.id;
  say(
    `session ${session.id} started, ${images.length} images, budget ${usd(options.budgetMicroUsd)}`,
  );
  const deadline = Date.now() + definition.session.max_minutes * 60_000;
  let afterSeq = 0;
  let continues = 0;

  const settle = async () => {
    for (;;) {
      const timer = setTimeout(
        () => client.sessions.interrupt(session.id).catch(() => {}),
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
          views.handle(record_);
          tracker.handle(record_);
          if (event.type !== 'message.delta' && !event.type.startsWith('span.'))
            appendFileSync(options.eventsFile, `${scrub(JSON.stringify(event))}\n`);
          const line = describe(record_);
          if (line) say(line);
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
    let state = await settle();
    while (
      !(tracker.submissions > 0 && tracker.output != null) &&
      !pausedOnBudget(tracker, state) &&
      state.status === 'idle' &&
      RESUMABLE.has(state.stop_reason ?? '') &&
      continues < MAX_CONTINUES &&
      Date.now() < deadline
    ) {
      continues += 1;
      say(`no review submitted yet; asking the agent to continue (${continues}/${MAX_CONTINUES})`);
      const sent = await client.sessions.send(session.id, {
        message: CONTINUE_MESSAGE,
        queue: true,
      });
      afterSeq = sent.accepted_seq;
      state = await settle();
    }
  } catch (cause) {
    // The stream or the API failed for good, and the session may still be running and
    // spending: stop it, and keep its cost for the report. A cost that cannot be read is
    // counted as the session's whole budget.
    const after = await closeSession(client, session.id);
    say(`the event stream failed; session ${session.id} stopped`);
    return done(
      `the event stream failed: ${cause instanceof Error ? cause.message.slice(0, 200) : String(cause)}`,
      null,
      after.consumedMicroUsd,
      after.budgetPaused,
    );
  }
  // Left neither running nor parked: a session paused on its budget is cancelled here.
  const final = await closeSession(client, session.id);
  if (final.budgetPaused || tracker.budgetPaused) {
    say(`session ${session.id} was paused on its budget and has been cancelled`);
    return done(
      `the session was paused on its budget and ${final.cancelled ? 'has been cancelled' : 'could not be cancelled'}`,
      null,
      final.consumedMicroUsd,
      true,
    );
  }
  if (tracker.output == null || tracker.submissions === 0) {
    return done(
      `the session stopped (${final.status}/${final.stopReason ?? 'none'}) without submitting a review`,
      null,
      final.consumedMicroUsd,
    );
  }
  const parsed = qcReviewSchema.safeParse(tracker.output);
  if (!parsed.success) {
    return done(
      `the submitted review does not match the schema: ${parsed.error.message.slice(0, 300)}`,
      null,
      final.consumedMicroUsd,
    );
  }
  return done(null, parsed.data, final.consumedMicroUsd);
}

interface ReviewOptions {
  client: Naive;
  definition: AgentDefinition;
  images: readonly LocalImage[];
  folder: string;
  task: (images: readonly ReviewImage[]) => string;
  budgetMicroUsd: number;
  eventsFile: string;
  say: (line: string) => void;
  /** How a dropped event stream is resumed before the session is stopped. */
  streamRetry?: StreamRetry;
}

/**
 * Runs the review. `say` prints progress; `eventsFile` keeps every event with the key scrubbed.
 * Images are uploaded before and deleted after, whatever happens. A session paused on its budget
 * is cancelled and the review retried once in two smaller sessions, each with half the images,
 * whose reviews are merged; the halves are not split again.
 */
export async function runReview(options: ReviewOptions): Promise<ReviewRun> {
  const { client, definition, say } = options;
  const [synced] = await syncAgents(client, [definition]);
  if (!synced) throw new Error('Agent sync returned nothing.');
  say(`agent ${synced.name} ${synced.id} v${synced.version} (${synced.action})`);
  writeFileSync(options.eventsFile, '');
  const images = await uploadImages(client, options.images, options.folder);
  say(`uploaded ${images.length} images: ${images.map((image) => image.fileId).join(', ')}`);
  const sessions: ReviewSession[] = [];
  const viewed = new Set<string>();
  const result = (review: QcReview | null, problem: string | null): ReviewRun => ({
    agentId: synced.id,
    agentVersion: synced.version,
    sessionId: sessions.map((each) => each.session_id).join(', '),
    images: images.map((image) => ({ ...image, viewed: viewed.has(image.fileId) })),
    review,
    problem,
    costMicroUsd: sessions.reduce((sum, each) => sum + each.consumed_micro_usd, 0),
    sessions,
  });
  const run = async (shown: readonly ReviewImage[]) => {
    const outcome = await reviewSession(options, synced.id, shown);
    sessions.push(outcome.record);
    for (const id of outcome.viewed) viewed.add(id);
    return outcome;
  };
  try {
    const first = await run(images);
    if (!first.paused || images.length < 2) return result(first.review, first.problem);
    const cut = Math.ceil(images.length / 2);
    say(`retrying the review in two sessions of ${cut} and ${images.length - cut} images`);
    const halves = [await run(images.slice(0, cut)), await run(images.slice(cut))];
    const problems = halves.flatMap((half, index) =>
      half.problem ? [`half ${index + 1}: ${half.problem}`] : [],
    );
    const reviews = halves.flatMap((half) => (half.review ? [half.review] : []));
    return reviews.length === halves.length
      ? result(mergeReviews(reviews), null)
      : result(null, `${first.problem}; the retry in halves failed (${problems.join('; ')})`);
  } finally {
    const deleted = await deleteImages(client, images);
    say(`deleted ${deleted} of ${images.length} uploaded images`);
  }
}

export const imageName = (file: string) => basename(file);
