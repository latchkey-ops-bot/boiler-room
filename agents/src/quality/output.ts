import { z } from 'zod';

/**
 * The Quality Check contract. The agent submits a `QcReview` through `output_schema`; code merges
 * it with its own measurements into a `QcReport`, which is what `pnpm qc` prints and what the other
 * agents act on. Keep both free of `.transform()`, `.default()` and `.pipe()`, so the JSON Schema
 * the agent submits against and the type here are one shape.
 */

/** Who fixes an issue: copy, claims, timing and seams; colour, assets and look; or a template. */
export const OWNERS = ['director', 'art-director', 'motion'] as const;

/**
 * `blocker`: claims, invented content, validation, or a render that is not the one under review.
 * `major`: any other failed check. `minor`: taste, with no failed threshold.
 */
export const SEVERITIES = ['blocker', 'major', 'minor'] as const;

export const CHECK_RESULTS = ['pass', 'fail', 'n/a'] as const;

export type Owner = (typeof OWNERS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type CheckResult = (typeof CHECK_RESULTS)[number];

const FILE_ID = /^fil_[a-z0-9]+$/;
const frame = z.int().min(0);

const issue = z.strictObject({
  severity: z.enum(SEVERITIES),
  check: z.string().min(1).describe('The id of the check this issue fails.'),
  sceneId: z
    .string()
    .min(1)
    .nullable()
    .describe('The scene the issue is in, or null for the film.'),
  frame: frame.nullable().describe('The absolute frame the issue is seen on, or null.'),
  timecode: z
    .string()
    .regex(/^\d+:\d{2}\.\d{2}$/, 'must be minutes:seconds.frames, such as 0:03.15')
    .nullable()
    .describe('The frame as minutes:seconds.frames at the film fps, such as 0:03.15, or null.'),
  what: z.string().min(1).describe('What is wrong, as measured or seen.'),
  fix: z.string().min(1).describe('What to change, specific enough to act on without asking.'),
  owner: z.enum(OWNERS),
});

const check = z.strictObject({
  id: z.string().min(1),
  result: z.enum(CHECK_RESULTS),
  measured: z.string().min(1).describe('What you measured or saw, with the value.'),
  frames: z.array(frame).describe('The frames this result rests on.'),
});

/** What the agent submits. */
export const qcReviewSchema = z.strictObject({
  verdict: z
    .enum(['pass', 'fail'])
    .describe('pass only when every check is pass or n/a and every listed image was opened.'),
  inspected: z
    .array(
      z.strictObject({
        file_id: z.string().regex(FILE_ID, 'must be a Naive file id such as "fil_abc123"'),
        saw: z.string().min(1).describe('What this image actually shows, in one or two sentences.'),
      }),
    )
    .describe('Every image you opened with view_image, and what it showed.'),
  checks: z.array(check).describe('One entry per visual check listed in the task.'),
  issues: z.array(issue).describe('One per failed check, and minor notes of taste.'),
  summary: z.string().min(1).describe('Three sentences at most, for the people who made the film.'),
});

export type QcReview = z.infer<typeof qcReviewSchema>;
export type QcIssue = z.infer<typeof issue> & { source: 'code' | 'model' };
export type QcCheck = z.infer<typeof check> & { threshold: string; source: 'code' | 'model' };

/** The output contract as JSON Schema, for the agent's `output_schema`. */
export const qcReviewJsonSchema = z.toJSONSchema(qcReviewSchema, {
  target: 'draft-2020-12',
  io: 'input',
}) as Record<string, unknown>;

export interface QcReport {
  /** `pass` only when nothing failed and the agent opened every rendered image it was given. */
  verdict: 'pass' | 'fail';
  /** Why the review could not be completed, when it could not. A blocked review never passes. */
  blocked: string | null;
  renderDir: string;
  campaignId: string;
  render: {
    file: string;
    sha256: string;
    width: number;
    height: number;
    fps: number;
    frames: number;
    format: string | null;
  };
  campaignFile: string;
  researchFile: string | null;
  checks: QcCheck[];
  issues: QcIssue[];
  review: {
    agent: string;
    agentVersion: number;
    sessionId: string;
    model: string;
    costMicroUsd: number;
    images: { fileId: string; name: string; what: string; viewed: boolean }[];
    modelVerdict: 'pass' | 'fail' | null;
    summary: string | null;
    /** Each session the review ran: input tokens, task size, spend and how it ended. */
    sessions?: {
      session_id: string;
      images: number;
      task_chars: number;
      input_tokens: number;
      model_requests: number;
      largest_request_input_tokens: number;
      consumed_micro_usd: number;
      budget_paused: boolean;
      outcome: string;
      viewed?: string[];
      retraction?: string;
    }[];
    /** Why the review was asked for once more, when its first left images unseen. */
    askedAgain?: string | null;
    /**
     * What the agent reported on frames of images its session was not shown, by that session's
     * own events: taken out of the review, so the code's checks stand there, not reviewed.
     */
    notReviewed?: {
      session_id: string;
      kind: 'issue' | 'check' | 'inspected';
      id: string;
      frame: number | null;
      what: string;
    }[];
  } | null;
  createdAt: string;
}
