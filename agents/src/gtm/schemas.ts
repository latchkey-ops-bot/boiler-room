import { z } from 'zod';
import { CAPTION_TEMPLATES } from './copy.ts';

/**
 * What each GTM agent may return. Every agent's only output is `submit_output` against one of
 * these. Each also accepts `{"error": "not_my_trigger"}`, which an agent returns when its first
 * message is not an executor brief, so a card or a chat that starts it gets nothing done.
 */

const notMyTrigger = z.literal('not_my_trigger').optional();
const id = (max: number) => z.string().max(max);

const quoteRef = z
  .object({ page: z.string().regex(/^p[1-9]$/), quote: z.string().max(100) })
  .nullable();

export const REJECT_REASONS = [
  'not_a_launch',
  'not_a_startup',
  'big_company',
  'github_only',
  'site_unreadable',
  'excluded_category',
  'duplicate',
  'other',
] as const;
export const CATEGORIES = [
  'devtools',
  'ai',
  'b2b_saas',
  'consumer',
  'fintech',
  'health',
  'other',
] as const;
export const JURISDICTIONS = ['us', 'uk_ltd', 'eu', 'de', 'other', 'unknown'] as const;

export const scoutVerdictSchema = z.object({
  candidate_id: id(4),
  verdict: z.enum(['qualified', 'rejected']),
  reject_reason: z.enum(REJECT_REASONS).nullable(),
  category: z.enum(CATEGORIES),
  fit: z.number().int().min(0).max(5),
  line: quoteRef,
  email_option: z.number().int().min(0).max(9).nullable(),
  jurisdiction: z.enum(JURISDICTIONS),
  jurisdiction_quote: z
    .object({ page: z.string().regex(/^p[1-9]$/), quote: z.string().max(200) })
    .nullable(),
  why: z.string().max(200),
});
export type ScoutVerdict = z.infer<typeof scoutVerdictSchema>;

export const scoutOutputSchema = z.object({
  error: notMyTrigger,
  verdicts: z.array(scoutVerdictSchema).max(10).optional(),
});

export const PASS_REASONS = ['weaker_fit', 'no_address', 'jurisdiction', 'other'] as const;

export const pickOutputSchema = z.object({
  error: notMyTrigger,
  x_pick: z
    .object({ lead_id: id(16), why: z.string().max(200) })
    .nullable()
    .optional(),
  email_picks: z
    .array(
      z.object({
        lead_id: id(16),
        why: z.string().max(200),
        subject: z.string().max(60),
        opener: z.string().max(240),
      }),
    )
    .max(5)
    .optional(),
  passed_over: z
    .array(z.object({ lead_id: id(16), reason: z.enum(PASS_REASONS) }))
    .max(15)
    .optional(),
});
export type PickOutput = z.infer<typeof pickOutputSchema>;

/** The GTM lead's answers to replies. The reply lane is not built yet; the schema is its contract. */
export const REPLY_TEMPLATES = [
  'thanks',
  'how_to_change',
  'removal_done',
  'pricing_from_facts',
] as const;
export const answersOutputSchema = z.object({
  error: notMyTrigger,
  answers: z
    .array(
      z.object({
        reply_id: id(16),
        action: z.enum(['template', 'founder', 'none']),
        template: z.enum(REPLY_TEMPLATES).nullable(),
        draft: z.string().max(1200).nullable(),
        why: z.string().max(200),
      }),
    )
    .max(20)
    .optional(),
});

export const socialOutputSchema = z.object({
  error: notMyTrigger,
  lead_id: id(16).optional(),
  template_id: z.enum(CAPTION_TEMPLATES.map((item) => item.id) as [string, ...string[]]).optional(),
  quote_ref: z
    .string()
    .regex(/^q[1-9]$/)
    .nullable()
    .optional(),
});
export type SocialOutput = z.infer<typeof socialOutputSchema>;

/**
 * The inbox reader's fields. No `sender`: a recipient is always taken from the provider's message
 * metadata, never from a model. `consent_to_post` is advisory and shown only in the review file;
 * consent is recorded only by the film page's button.
 */
export const INTENTS = [
  'lead_reply',
  'customer_request',
  'revision',
  'unsubscribe',
  'removal',
  'not_interested',
  'auto_reply',
  'other',
] as const;
export const readerOutputSchema = z.object({
  error: notMyTrigger,
  intent: z.enum(INTENTS).optional(),
  consent_to_post: z.enum(['yes', 'no', 'unclear']).optional(),
  needs_human: z.boolean().optional(),
  summary: z.string().max(280).optional(),
});

/** The JSON Schema Naive's `output_schema` takes, without the `$schema` key. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** The GTM lead's definition carries one schema for both of its briefs. */
export const leadOutputSchema = pickOutputSchema.extend({
  answers: answersOutputSchema.shape.answers,
});
