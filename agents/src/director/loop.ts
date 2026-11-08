import { type Naive, sessionEvents } from '../naive/client.ts';
import type { DirectorIssue } from './checks.ts';
import { CONTINUE_MESSAGE, repairMessage } from './prompt.ts';

/** The part of the Naive client the loop uses, so a test can hand it a fake. */
export type LoopClient = Pick<Naive, 'sessions' | 'stream'>;

export interface StreamEvent {
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

export interface CheckResult {
  blocking: DirectorIssue[];
  other: DirectorIssue[];
}

export interface RoundRecord {
  round: number;
  output: unknown;
  blocking: DirectorIssue[];
  other: DirectorIssue[];
}

export interface LoopOptions {
  client: LoopClient;
  agentId: string;
  task: string;
  outputSchema: Record<string, unknown>;
  budgetMicroUsd: number;
  /** Repair rounds after the first submission. */
  maxRepairs: number;
  maxMinutes: number;
  check: (output: unknown) => Promise<CheckResult>;
  onEvent?: (event: StreamEvent) => void;
  onSession?: (sessionId: string) => void;
  metadata?: Record<string, string>;
  /** Waits between polls. Tests pass one that does not wait. */
  sleep?: (ms: number) => Promise<void>;
}

export type LoopResult =
  | {
      ok: true;
      sessionId: string;
      rounds: RoundRecord[];
      output: unknown;
      consumedMicroUsd: number;
    }
  | {
      ok: false;
      sessionId: string | undefined;
      rounds: RoundRecord[];
      /** Why it failed: repairs ran out, or the session stopped without a new submission. */
      reason: string;
      remaining: DirectorIssue[];
      consumedMicroUsd: number;
    };

/** Stop reasons after which the agent can be asked to carry on. */
const RESUMABLE = new Set(['end_turn', 'max_iterations', 'awaiting_input']);
const MAX_CONTINUES = 3;

/**
 * Follows `submit_output` in the event stream: how many calls Naive accepted, and the latest
 * accepted output. `sessions.get` can still return the previous `structured_output` just after a
 * turn ends (seen live on a repair round), so the output is read from the events: the
 * `session.idle` event that ends the turn carries it, and the accepted call's arguments are the
 * fallback.
 */
export class SubmissionTracker {
  count = 0;
  latest: unknown = undefined;
  private readonly pending = new Map<string, unknown>();

  handle(event: { type: string; data: Record<string, unknown> }): void {
    const data = event.data ?? {};
    if (event.type === 'tool.started' && data.name === 'submit_output') {
      this.pending.set(String(data.tool_call_id), data.args);
    }
    if (event.type === 'tool.completed' && data.name === 'submit_output' && !data.is_error) {
      this.count += 1;
      this.latest = this.pending.get(String(data.tool_call_id)) ?? this.latest;
    }
    if (event.type === 'session.idle' && this.count > 0 && data.structured_output != null) {
      this.latest = data.structured_output;
    }
  }
}

/**
 * One Director session with its repair loop. The agent submits `{campaign, handoff}` through
 * `output_schema`; `check` runs `validateCampaign` and the Director checks; any issue the Director
 * owns goes back into the same session with its fix, up to `maxRepairs` rounds. Only a submission
 * seen since the last check counts, because a session keeps its last `structured_output`.
 */
export async function runDirectorSession(options: LoopOptions): Promise<LoopResult> {
  const { client } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const counter = new SubmissionTracker();
  const rounds: RoundRecord[] = [];

  const session = await client.sessions.create({
    agent_id: options.agentId,
    message: options.task,
    budget_micro_usd: options.budgetMicroUsd,
    output_schema: options.outputSchema,
    structured_output_required: true,
    ...(options.metadata ? { metadata: options.metadata } : {}),
  });
  options.onSession?.(session.id);
  const deadline = Date.now() + options.maxMinutes * 60_000;
  let afterSeq = 0;
  let checked = 0;
  let continues = 0;

  const settle = async () => {
    for (;;) {
      const timer = setTimeout(
        () => client.sessions.interrupt(session.id).catch(() => {}),
        Math.max(1000, deadline - Date.now()),
      );
      try {
        for await (const event of sessionEvents(client, session.id, afterSeq, { sleep })) {
          afterSeq = event.seq;
          const record = event as unknown as StreamEvent;
          counter.handle(record);
          options.onEvent?.(record);
        }
      } finally {
        clearTimeout(timer);
      }
      const state = await client.sessions.get(session.id);
      const working = state.status === 'running' || state.status === 'queued';
      if (!working || Date.now() > deadline) return state;
      await sleep(1000);
    }
  };

  try {
    return await repairLoop();
  } catch (cause) {
    // The stream or the API failed for good, and the session may still be running and spending.
    await client.sessions.interrupt(session.id).catch(() => {});
    const after = await client.sessions.get(session.id).catch(() => undefined);
    return {
      ok: false,
      sessionId: session.id,
      rounds,
      reason: `the event stream failed: ${cause instanceof Error ? cause.message.slice(0, 200) : String(cause)}`,
      remaining: rounds.at(-1)?.blocking ?? [],
      consumedMicroUsd: after?.consumed_micro_usd ?? options.budgetMicroUsd,
    };
  }

  // Each round: wait for a submission, check it, and send back what blocks it.
  async function repairLoop(): Promise<LoopResult> {
    for (;;) {
      const state = await settle();
      const consumedMicroUsd = state.consumed_micro_usd;
      const output = counter.latest ?? state.structured_output;
      const fresh = counter.count > checked && output != null;
      if (!fresh) {
        const resumable = state.status === 'idle' && RESUMABLE.has(state.stop_reason ?? '');
        if (resumable && continues < MAX_CONTINUES && Date.now() < deadline) {
          continues += 1;
          const sent = await client.sessions.send(session.id, {
            message: CONTINUE_MESSAGE,
            queue: true,
          });
          afterSeq = sent.accepted_seq;
          continue;
        }
        return {
          ok: false,
          sessionId: session.id,
          rounds,
          reason: `the session stopped (${state.status}/${state.stop_reason}) without a new submission`,
          remaining: rounds.at(-1)?.blocking ?? [],
          consumedMicroUsd,
        };
      }
      checked = counter.count;
      const { blocking, other } = await options.check(output);
      rounds.push({ round: rounds.length + 1, output, blocking, other });
      if (blocking.length === 0) {
        return { ok: true, sessionId: session.id, rounds, output, consumedMicroUsd };
      }
      const repair = rounds.length;
      if (repair > options.maxRepairs || Date.now() > deadline) {
        return {
          ok: false,
          sessionId: session.id,
          rounds,
          reason:
            repair > options.maxRepairs
              ? `${options.maxRepairs} repair rounds did not clear every issue`
              : 'the time limit was reached',
          remaining: blocking,
          consumedMicroUsd,
        };
      }
      const sent = await client.sessions.send(session.id, {
        message: repairMessage(blocking, repair, options.maxRepairs),
        queue: true,
      });
      afterSeq = sent.accepted_seq;
    }
  }
}
