/**
 * The model's part of a review: upload the images taken from the film to Naive files, start one
 * `br-quality-check` session with a typed result, and record which images it actually opened. The
 * images are deleted afterwards; the agent is kept, as it is part of the crew.
 *
 * The review is read from the `session.idle` event that ends the turn, never from `sessions.get`,
 * which can still answer the previous turn's output. A session paused on its budget is cancelled,
 * recorded, and the review retried once as two smaller sessions, each with half the images.
 *
 * What the agent reports on a frame stands only when that session's own events show it was shown
 * the image the frame is in (`ViewEvidence`): an issue on a frame of an image it was not shown, a
 * check that rests only on such frames, and an image it says it inspected but never opened are
 * taken out of its review. When the review leaves any image unseen, it is asked for once more in a
 * fresh session with every image attached again; if that one does not see them all either, the
 * review that saw more stands, the rest is chosen by rule and not reviewed, and the report is
 * blocked on the images nobody opened.
 *
 * No session is given more images than the model can see at once. Naive shows the model only the
 * pictures of the latest `view_image` calls, about twelve of them: on 8 November every review of
 * 15 or 22 images (ses_97xh2k226hs1k8hhjkks2gsbs8, ses_a806xhwn7nk893y9cegckjenck,
 * ses_s4j9xmtj5dkrbq27gd3n701qhr) saw the last twelve and none of the first, which were the
 * sheets, and a session that opened three sheets again in a later turn
 * (ses_x0959kb9rps4vrnmv5zpprhtkk) then saw only those three. So the images are split into groups
 * (`groupImages`), each reviewed in its own session that opens all of its images in one turn, and
 * the groups' reviews are merged.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { AgentDefinition } from '../define.ts';
import { type Naive, type StreamRetry, scrub, sessionEvents, usd } from '../naive/client.ts';
import { ViewEvidence } from '../naive/evidence.ts';
import { closeSession, type InputSize, pausedOnBudget, SessionTracker } from '../naive/session.ts';
import { type AgentSync, ensureAgents } from '../sync.ts';
import { pngSize } from './media.ts';
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

/** Records the file ids every successful `view_image` call opened, before the submission. */
export { ViewEvidence as ViewTracker };

/**
 * The most images one review session is given, by count and by pixels. Twelve images of about
 * 24.4 million pixels in all were the most a session was seen to show at once; these stay under
 * both, whichever of the two Naive counts, in as few sessions as that allows: each costs about
 * $0.20, and the stage's cap must hold every group and one more session for a group asked again.
 */
export const SESSION_IMAGES = { count: 10, pixels: 22_000_000 } as const;

/** The size an image is counted at when its file cannot be read as a PNG: a 1080p frame. */
const UNKNOWN_SIZE = { width: 1920, height: 1080 };

/**
 * Splits images into groups for separate sessions, in the order given: each group takes the next
 * image while it stays within `limit`. An image larger than the limit on its own gets a group of
 * its own. Returns the indexes of the images in each group.
 */
export function groupImages(
  sizes: readonly { width: number; height: number }[],
  limit: { count: number; pixels: number } = SESSION_IMAGES,
): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  let pixels = 0;
  for (const [index, size] of sizes.entries()) {
    const area = size.width * size.height;
    if (current.length > 0 && (current.length >= limit.count || pixels + area > limit.pixels)) {
      groups.push(current);
      current = [];
      pixels = 0;
    }
    current.push(index);
    pixels += area;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** A claim the agent made that no image it was shown can back: taken out of its review. */
export interface Unreviewed {
  session_id: string;
  /** `issue`, `check` or `inspected`. */
  kind: 'issue' | 'check' | 'inspected';
  id: string;
  frame: number | null;
  what: string;
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
  /** What the agent reported on frames of images its session was not shown, taken out. */
  unreviewed: Unreviewed[];
  /** Why a review was asked for once more, when it was. */
  askedAgain: string | null;
}

export interface ReviewSession extends InputSize {
  session_id: string;
  images: number;
  task_chars: number;
  consumed_micro_usd: number;
  /** The session was paused on its budget, and has been cancelled. */
  budget_paused: boolean;
  outcome: string;
  /** File ids the session's events show it was shown before it submitted. */
  viewed?: string[];
  /** The agent's words, when it said afterwards that the images did not reach it. */
  retraction?: string;
}

const worst = (results: readonly QcReview['checks'][number]['result'][]) =>
  results.includes('fail') ? 'fail' : results.includes('pass') ? 'pass' : 'n/a';

/**
 * One review from the reviews of parts of the images (groups, or the halves of a group): a check
 * fails when any part fails it and passes when any passes it and none fails it. It keeps the words
 * and frames of the parts that gave that result: a part that could not see the check says so, and
 * that must not stand in a pass another part made (`unsupportedPasses` blocks a pass that says it
 * could not check).
 */
export function mergeReviews(reviews: readonly QcReview[]): QcReview {
  const checks = new Map<string, QcReview['checks']>();
  for (const check of reviews.flatMap((review) => review.checks))
    checks.set(check.id, [...(checks.get(check.id) ?? []), check]);
  return {
    verdict: reviews.every((review) => review.verdict === 'pass') ? 'pass' : 'fail',
    inspected: reviews.flatMap((review) => review.inspected),
    checks: [...checks.entries()].map(([id, parts]) => {
      const result = worst(parts.map((part) => part.result));
      const gave = parts.filter((part) => part.result === result);
      return {
        id,
        result,
        measured: gave.map((part) => part.measured).join(' | '),
        frames: [...new Set(gave.flatMap((part) => part.frames))].sort((a, b) => a - b),
      };
    }),
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

/**
 * The part of `review` that the images its session was shown can back. `framesOf` gives the frames
 * each uploaded image shows; a frame no image shows cannot be checked against any, and is kept.
 */
export function supportedReview(
  review: QcReview,
  shown: readonly ReviewImage[],
  viewed: ReadonlySet<string>,
  framesOf: (image: ReviewImage) => readonly number[],
  sessionId: string,
): { review: QcReview; unreviewed: Unreviewed[] } {
  const seenFrames = new Set(
    shown.filter((image) => viewed.has(image.fileId)).flatMap((image) => framesOf(image)),
  );
  const unseenFrames = new Set(
    shown
      .filter((image) => !viewed.has(image.fileId))
      .flatMap((image) => framesOf(image))
      .filter((frame) => !seenFrames.has(frame)),
  );
  const sawAny = shown.some((image) => viewed.has(image.fileId));
  const unreviewed: Unreviewed[] = [];
  const issues = review.issues.filter((issue) => {
    const backed = issue.frame === null ? sawAny : !unseenFrames.has(issue.frame);
    if (!backed)
      unreviewed.push({
        session_id: sessionId,
        kind: 'issue',
        id: issue.check,
        frame: issue.frame,
        what: issue.what,
      });
    return backed;
  });
  const checks = review.checks.map((check) => {
    const frames = check.frames.filter((frame) => !unseenFrames.has(frame));
    if (check.frames.length === 0 || frames.length > 0 || check.result === 'n/a')
      return { ...check, frames };
    unreviewed.push({
      session_id: sessionId,
      kind: 'check',
      id: check.id,
      frame: check.frames[0] ?? null,
      what: `${check.result}: ${check.measured}`,
    });
    return {
      ...check,
      result: 'n/a' as const,
      measured: `not reviewed: it rests only on frames ${check.frames.join(', ')}, of images the session was not shown`,
      frames: [],
    };
  });
  const inspected = review.inspected.filter((entry) => {
    if (viewed.has(entry.file_id)) return true;
    unreviewed.push({
      session_id: sessionId,
      kind: 'inspected',
      id: entry.file_id,
      frame: null,
      what: entry.saw,
    });
    return false;
  });
  return { review: { ...review, issues, checks, inspected }, unreviewed };
}

/** The note a review's second session starts with, after its first left images unseen. */
export function againNote(why: string): string {
  return [
    `This review was asked for once already, and it could not be used in full: ${why}.`,
    'Every image is attached again by the same file ids. Open them all at once with view_image, in one turn, and do not open any again; report only on frames of images that arrived.',
  ].join(' ');
}

/** One review session over `images`, which are already uploaded. */
async function reviewSession(
  options: ReviewOptions,
  agentId: string,
  images: readonly ReviewImage[],
  note?: string,
): Promise<SessionOutcome> {
  const { client, definition, say } = options;
  const views = new ViewEvidence();
  const tracker = new SessionTracker();
  const task = note ? `${note}\n\n${options.task(images)}` : options.task(images);
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
    const viewed = views.viewed;
    Object.assign(record, tracker.inputSize(), {
      consumed_micro_usd: consumed ?? options.budgetMicroUsd,
      budget_paused: paused,
      outcome: problem ?? `reviewed: ${review?.verdict}`,
      viewed: [...viewed],
      ...(views.retracted ? { retraction: views.retractionText } : {}),
    });
    return { record, review, problem, viewed, paused };
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
  /** `verify` never creates or changes the agent: it checks the deployed one matches. */
  agentSync?: AgentSync;
}

/**
 * Runs the review. `say` prints progress; `eventsFile` keeps every event with the key scrubbed.
 * Images are uploaded before and deleted after, whatever happens. They are reviewed in groups no
 * larger than the model can see at once (`groupImages`), one session per group, and the groups'
 * reviews are merged. A session paused on its budget is cancelled and its group retried once in
 * two smaller sessions, each with half the images, whose reviews are merged; the halves are not
 * split again. Each session's review keeps only what the images it was shown can back
 * (`supportedReview`). A group whose review leaves any of its images unseen is asked for once more,
 * in one fresh session with every image of the group attached again; the review that saw more
 * images is the one that stands.
 */
export async function runReview(options: ReviewOptions): Promise<ReviewRun> {
  const { client, definition, say } = options;
  const [synced] = await ensureAgents(client, [definition], options.agentSync);
  if (!synced) throw new Error('Agent sync returned nothing.');
  say(`agent ${synced.name} ${synced.id} v${synced.version} (${synced.action})`);
  writeFileSync(options.eventsFile, '');
  const images = await uploadImages(client, options.images, options.folder);
  say(`uploaded ${images.length} images: ${images.map((image) => image.fileId).join(', ')}`);
  // `uploadImages` keeps the order it was given, so each upload is the local image at its index.
  const frames = new Map(
    images.map((image, index) => [image.fileId, options.images[index]?.frames ?? []]),
  );
  const framesOf = (image: ReviewImage) => frames.get(image.fileId) ?? [];
  const sessions: ReviewSession[] = [];
  interface Attempt {
    review: QcReview | null;
    problem: string | null;
    viewed: Set<string>;
    unreviewed: Unreviewed[];
  }
  const result = (attempt: Attempt, askedAgain: string | null): ReviewRun => ({
    agentId: synced.id,
    agentVersion: synced.version,
    sessionId: sessions.map((each) => each.session_id).join(', '),
    images: images.map((image) => ({ ...image, viewed: attempt.viewed.has(image.fileId) })),
    review: attempt.review,
    problem: attempt.problem,
    costMicroUsd: sessions.reduce((sum, each) => sum + each.consumed_micro_usd, 0),
    sessions,
    unreviewed: attempt.unreviewed,
    askedAgain,
  });
  /** One session, its review cut to what the images it was shown can back. */
  const run = async (shown: readonly ReviewImage[], note?: string) => {
    const outcome = await reviewSession(options, synced.id, shown, note);
    sessions.push(outcome.record);
    const supported = outcome.review
      ? supportedReview(outcome.review, shown, outcome.viewed, framesOf, outcome.record.session_id)
      : null;
    return {
      ...outcome,
      review: supported?.review ?? null,
      unreviewed: supported?.unreviewed ?? [],
    };
  };
  /** A group's first review, in one session, or in two halves after a budget pause. */
  const firstReview = async (group: readonly ReviewImage[]): Promise<Attempt> => {
    const first = await run(group);
    if (!first.paused || group.length < 2) return { ...first, viewed: new Set(first.viewed) };
    const cut = Math.ceil(group.length / 2);
    say(`retrying the review in two sessions of ${cut} and ${group.length - cut} images`);
    const halves = [await run(group.slice(0, cut)), await run(group.slice(cut))];
    const problems = halves.flatMap((half, index) =>
      half.problem ? [`half ${index + 1}: ${half.problem}`] : [],
    );
    const reviews = halves.flatMap((half) => (half.review ? [half.review] : []));
    const viewed = new Set(halves.flatMap((half) => [...half.viewed]));
    const unreviewed = halves.flatMap((half) => half.unreviewed);
    return reviews.length === halves.length
      ? { review: mergeReviews(reviews), problem: null, viewed, unreviewed }
      : {
          review: null,
          problem: `${first.problem}; the retry in halves failed (${problems.join('; ')})`,
          viewed,
          unreviewed,
        };
  };
  const unseenIn = (group: readonly ReviewImage[], attempt: Attempt) =>
    group.filter((image) => !attempt.viewed.has(image.fileId));
  /** A group's review, asked for once more when it left any of the group's images unseen. */
  const groupReview = async (
    group: readonly ReviewImage[],
  ): Promise<{ attempt: Attempt; askedAgain: string | null }> => {
    const before = sessions.length;
    const first = await firstReview(group);
    const unseen = unseenIn(group, first);
    const retracted = sessions.slice(before).find((each) => each.retraction)?.retraction;
    if (!first.review || unseen.length === 0) return { attempt: first, askedAgain: null };
    // Not done: once more, with every image of the group attached again.
    const why = retracted
      ? `the agent said afterwards that the images did not reach it ("${retracted}")`
      : `its session's events show no view_image result for ${unseen.map((image) => `${image.name} (${image.fileId})`).join(', ')}`;
    say(
      `the review left ${unseen.length} image(s) unseen; asking once more with every image attached again`,
    );
    const again = await run(group, againNote(why));
    const second: Attempt = { ...again, viewed: new Set(again.viewed) };
    // The review that was shown more stands; on a tie, the second, which was told what went wrong.
    const better =
      second.review && unseenIn(group, second).length <= unseen.length ? second : first;
    return { attempt: better, askedAgain: why };
  };
  try {
    const sizes = await Promise.all(
      options.images.map((image) => pngSize(image.file).catch(() => UNKNOWN_SIZE)),
    );
    const groups = groupImages(sizes).map((indexes) =>
      indexes.map((index) => images[index] as ReviewImage),
    );
    if (groups.length > 1)
      say(
        `reviewing the ${images.length} images in ${groups.length} sessions of ${groups.map((group) => group.length).join(', ')}, as the model sees about twelve at once`,
      );
    const done: { attempt: Attempt; askedAgain: string | null }[] = [];
    for (const group of groups) done.push(await groupReview(group));
    const askedAgain = done.flatMap((each) => (each.askedAgain ? [each.askedAgain] : []));
    const viewed = new Set(done.flatMap((each) => [...each.attempt.viewed]));
    const unreviewed = done.flatMap((each) => each.attempt.unreviewed);
    const reviews = done.flatMap((each) => (each.attempt.review ? [each.attempt.review] : []));
    const only = done.length === 1 ? done[0] : undefined;
    if (only) return result(only.attempt, only.askedAgain);
    const problems = done.flatMap((each, index) =>
      each.attempt.problem ? [`group ${index + 1}: ${each.attempt.problem}`] : [],
    );
    return result(
      reviews.length === done.length
        ? { review: mergeReviews(reviews), problem: null, viewed, unreviewed }
        : { review: null, problem: problems.join('; '), viewed, unreviewed },
      askedAgain.length > 0 ? askedAgain.join('; ') : null,
    );
  } finally {
    const deleted = await deleteImages(client, images);
    say(`deleted ${deleted} of ${images.length} uploaded images`);
  }
}

export const imageName = (file: string) => basename(file);
