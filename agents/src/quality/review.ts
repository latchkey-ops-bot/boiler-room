/**
 * The model's part of a review: upload the images taken from the film to Naive files, start one
 * `br-quality-check` session with a typed result, and record which images it actually opened. The
 * images are deleted afterwards; the agent is kept, as it is part of the crew.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { AgentDefinition } from '../define.ts';
import { type Naive, type StreamRetry, scrub, sessionEvents, usd } from '../naive/client.ts';
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
  sessionId: string;
  images: (ReviewImage & { viewed: boolean })[];
  review: QcReview | null;
  /** Why the typed result is missing or was refused. */
  problem: string | null;
  costMicroUsd: number;
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

/**
 * Runs one review session. `say` prints progress; `eventsFile` keeps every event with the key
 * scrubbed. Images are uploaded before and deleted after, whatever happens.
 */
export async function runReview(options: {
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
}): Promise<ReviewRun> {
  const { client, definition, say } = options;
  const [synced] = await syncAgents(client, [definition]);
  if (!synced) throw new Error('Agent sync returned nothing.');
  say(`agent ${synced.name} ${synced.id} v${synced.version} (${synced.action})`);
  writeFileSync(options.eventsFile, '');
  const images = await uploadImages(client, options.images, options.folder);
  say(`uploaded ${images.length} images: ${images.map((image) => image.fileId).join(', ')}`);
  const tracker = new ViewTracker();
  let sessionId = '';
  try {
    const session = await client.sessions.create({
      agent_id: synced.id,
      message: options.task(images),
      budget_micro_usd: options.budgetMicroUsd,
      ...(definition.output_schema ? { output_schema: definition.output_schema } : {}),
      structured_output_required: definition.structured_output_required,
      metadata: { run: 'quality-check', folder: options.folder },
    });
    sessionId = session.id;
    say(`session ${session.id} started, budget ${usd(options.budgetMicroUsd)}`);
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
            const record = event as unknown as { type: string; data: Record<string, unknown> };
            tracker.handle(record);
            if (event.type !== 'message.delta' && !event.type.startsWith('span.'))
              appendFileSync(options.eventsFile, `${scrub(JSON.stringify(event))}\n`);
            const line = describe(record);
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

    let state: Awaited<ReturnType<typeof settle>>;
    try {
      state = await settle();
      while (
        !(tracker.submissions > 0 && state.structured_output) &&
        state.status === 'idle' &&
        RESUMABLE.has(state.stop_reason ?? '') &&
        continues < MAX_CONTINUES &&
        Date.now() < deadline
      ) {
        continues += 1;
        say(
          `no review submitted yet; asking the agent to continue (${continues}/${MAX_CONTINUES})`,
        );
        const sent = await client.sessions.send(session.id, {
          message: CONTINUE_MESSAGE,
          queue: true,
        });
        afterSeq = sent.accepted_seq;
        state = await settle();
      }
      if (state.status === 'running' || state.status === 'queued') {
        await client.sessions.interrupt(session.id).catch(() => {});
        state = await client.sessions.get(session.id);
      }
    } catch (cause) {
      // The stream or the API failed for good, and the session may still be running and
      // spending: stop it, and keep its cost for the report. A cost that cannot be read is
      // counted as the session's whole budget.
      await client.sessions.interrupt(session.id).catch(() => {});
      const after = await client.sessions.get(session.id).catch(() => undefined);
      say(`the event stream failed; session ${session.id} stopped`);
      return {
        agentId: synced.id,
        agentVersion: synced.version,
        sessionId,
        images: images.map((image) => ({ ...image, viewed: tracker.viewed.has(image.fileId) })),
        review: null,
        problem: `the event stream failed: ${cause instanceof Error ? cause.message.slice(0, 200) : String(cause)}`,
        costMicroUsd: after?.consumed_micro_usd ?? options.budgetMicroUsd,
      };
    }

    let review: QcReview | null = null;
    let problem: string | null = null;
    if (!state.structured_output || tracker.submissions === 0) {
      problem = `the session stopped (${state.status}/${state.stop_reason ?? 'none'}) without submitting a review`;
    } else {
      const parsed = qcReviewSchema.safeParse(state.structured_output);
      if (parsed.success) review = parsed.data;
      else
        problem = `the submitted review does not match the schema: ${parsed.error.message.slice(0, 300)}`;
    }
    return {
      agentId: synced.id,
      agentVersion: synced.version,
      sessionId,
      images: images.map((image) => ({ ...image, viewed: tracker.viewed.has(image.fileId) })),
      review,
      problem,
      costMicroUsd: state.consumed_micro_usd ?? 0,
    };
  } finally {
    const deleted = await deleteImages(client, images);
    say(`deleted ${deleted} of ${images.length} uploaded images`);
  }
}

export const imageName = (file: string) => basename(file);
