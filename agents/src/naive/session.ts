import type { Naive } from './client.ts';

/** One event of a session's stream, as the loops read it. */
export interface SessionEvent {
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

/** Tokens one session used, as `session.usage` and `sessions.get` report them. */
export interface TokenUsage {
  input: number;
  cache_write: number;
  cache_read: number;
  output: number;
  reasoning: number;
}

/** Every input token a usage counts: uncached, written to the cache, and read from it. */
export const inputTokens = (usage: Partial<TokenUsage> | null | undefined): number =>
  usage ? (usage.input ?? 0) + (usage.cache_write ?? 0) + (usage.cache_read ?? 0) : 0;

/** The stop reason of a session parked on its budget, waiting for someone to raise it. */
export const BUDGET_PAUSED = 'budget_paused';

/**
 * The budget a `budget.exceeded` event names when the agent's own cap, over its period, has no room
 * for the call, rather than the session's budget. No smaller session of that agent fits either.
 */
export const AGENT_CAP = 'budget.cap_micro_usd';

/**
 * Stop reasons that leave a session idle but waiting for a person: the dashboard shows it as
 * waiting for the founder. A loop never leaves one: it cancels it.
 */
export const PARKED: ReadonlySet<string> = new Set([
  BUDGET_PAUSED,
  'awaiting_approval',
  'awaiting_answer',
]);

/**
 * Follows one session's events: the `submit_output` calls Naive accepted, the `structured_output`
 * the `session.idle` event of each turn carries, why the session stopped, and what it spent.
 *
 * `sessions.get` can still answer the previous turn's `structured_output` right after a turn ends
 * (seen live on a repair round), so the output is read from the idle event, never from
 * `sessions.get`. The accepted call's arguments stand in only until that event arrives, for a
 * stream that dropped before it.
 */
export class SessionTracker {
  /** `submit_output` calls Naive accepted. */
  submissions = 0;
  /** The latest accepted output, from the idle event that ended its turn. */
  output: unknown = undefined;
  /** The stop reason of the latest idle event. */
  stopReason: string | undefined;
  /** True once the session was paused on its budget. */
  budgetPaused = false;
  /** The budget the last `budget.exceeded` event named, such as `AGENT_CAP`. */
  budgetExceeded: string | undefined;
  /** The latest `session.usage`: tokens and spend so far. */
  usage: TokenUsage | undefined;
  consumedMicroUsd = 0;
  /** Model requests the session made, and the most input any one of them read. */
  modelRequests = 0;
  largestRequestInput = 0;
  private readonly pending = new Map<string, unknown>();

  handle(event: { type: string; data?: Record<string, unknown> }): void {
    const data = event.data ?? {};
    switch (event.type) {
      case 'tool.started':
        if (data.name === 'submit_output') this.pending.set(String(data.tool_call_id), data.args);
        return;
      case 'tool.completed':
        if (data.name === 'submit_output' && !data.is_error) {
          this.submissions += 1;
          this.output = this.pending.get(String(data.tool_call_id)) ?? this.output;
        }
        return;
      case 'session.idle':
        this.stopReason = typeof data.stop_reason === 'string' ? data.stop_reason : undefined;
        if (this.stopReason === BUDGET_PAUSED) this.budgetPaused = true;
        if (this.submissions > 0 && data.structured_output != null)
          this.output = data.structured_output;
        return;
      case 'budget.exceeded':
        this.budgetPaused = true;
        if (typeof data.param === 'string') this.budgetExceeded = data.param;
        return;
      case 'session.usage': {
        const usage = data.token_usage as TokenUsage | undefined;
        if (usage) this.usage = usage;
        if (typeof data.consumed_micro_usd === 'number')
          this.consumedMicroUsd = data.consumed_micro_usd;
        return;
      }
      case 'span.model_request.end': {
        this.modelRequests += 1;
        const used = inputTokens(data.token_usage as TokenUsage | undefined);
        this.largestRequestInput = Math.max(this.largestRequestInput, used);
        return;
      }
      default:
        return;
    }
  }

  /** What the events said about input size, for a report. */
  inputSize(): InputSize {
    return {
      input_tokens: inputTokens(this.usage),
      model_requests: this.modelRequests,
      largest_request_input_tokens: this.largestRequestInput,
    };
  }
}

/** How much a session read, from its events. */
export interface InputSize {
  /** Every input token of the session, summed over its model requests. */
  input_tokens: number;
  model_requests: number;
  /** The most input one model request read: the context the session grew to. */
  largest_request_input_tokens: number;
}

/** The part of the Naive client that `closeSession` uses, so a test can hand it a fake. */
export type CloseClient = { sessions: Pick<Naive['sessions'], 'get' | 'interrupt' | 'cancel'> };

export interface ClosedSession {
  status: string | undefined;
  stopReason: string | null | undefined;
  /** What the session spent, or undefined when it could not be read. */
  consumedMicroUsd: number | undefined;
  tokenUsage: TokenUsage | undefined;
  /** The session was parked on its budget when it was closed. */
  budgetPaused: boolean;
  /** The session was parked, and has been cancelled. */
  cancelled: boolean;
}

/**
 * Leaves a session in no state that spends or waits: one still running or queued is interrupted,
 * and one parked on its budget or on a person (`PARKED`) is cancelled, so it never shows in the
 * dashboard as waiting for the founder. Every loop calls this on every way out of a session.
 */
export async function closeSession(client: CloseClient, id: string): Promise<ClosedSession> {
  type State = Awaited<ReturnType<CloseClient['sessions']['get']>>;
  let state: State | undefined = await client.sessions.get(id).catch(() => undefined);
  if (!state || state.status === 'running' || state.status === 'queued') {
    await client.sessions.interrupt(id).catch(() => {});
    state = (await client.sessions.get(id).catch(() => undefined)) ?? state;
  }
  const stopReason = state?.stop_reason;
  const budgetPaused = stopReason === BUDGET_PAUSED;
  let cancelled = false;
  if (state?.status === 'idle' && PARKED.has(stopReason ?? '')) {
    for (let attempt = 0; attempt < 2 && !cancelled; attempt += 1) {
      const after = await client.sessions.cancel(id).catch(() => undefined);
      if (after) {
        cancelled = true;
        state = { ...state, ...after };
      }
    }
  }
  return {
    status: state?.status,
    stopReason,
    consumedMicroUsd: state?.consumed_micro_usd,
    tokenUsage: (state as { token_usage?: TokenUsage } | undefined)?.token_usage,
    budgetPaused,
    cancelled,
  };
}

/** True when a session stopped on its budget, by its events or by its state. */
export const pausedOnBudget = (
  tracker: Pick<SessionTracker, 'budgetPaused'>,
  state: { status?: string; stop_reason?: string | null } | undefined,
): boolean =>
  tracker.budgetPaused || (state?.status === 'idle' && state.stop_reason === BUDGET_PAUSED);
