import type {
  PipelineClient,
  PipelineDeliverable,
  PipelineEvent,
  PipelineStatus,
  ScriptApproval,
} from './types.ts';
import { PipelineUnavailableError } from './types.ts';

/**
 * The real film pipeline: the production crew on Naive. Not wired yet. Every call fails with
 * `PipelineUnavailableError`, which the API answers as 503, so production never shows a film that
 * nobody is making.
 *
 * To wire it: start a crew session per film with the app's scoped Naive key (an app secret), read
 * the session's events and output, and map them onto `PipelineEvent` and `PipelineStatus`.
 */
export class NaivePipeline implements PipelineClient {
  readonly kind = 'naive' as const;

  async start(_input: { filmId: string; url: string }): Promise<{ runId: string }> {
    throw notWired();
  }

  async status(_runId: string): Promise<PipelineStatus> {
    throw notWired();
  }

  async events(_runId: string, _options?: { after?: string }): Promise<PipelineEvent[]> {
    throw notWired();
  }

  async approveScript(_runId: string, _input: ScriptApproval): Promise<void> {
    throw notWired();
  }

  async sendBackScript(_runId: string, _input: { version: number; note: string }): Promise<void> {
    throw notWired();
  }

  async deliverables(_runId: string): Promise<PipelineDeliverable[]> {
    throw notWired();
  }
}

function notWired(): PipelineUnavailableError {
  return new PipelineUnavailableError(
    'The film crew is not connected yet, so no film can be started here.',
  );
}
