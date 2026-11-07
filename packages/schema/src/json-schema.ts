import { z } from 'zod';
import { campaignSchema } from './campaign.ts';

/**
 * The campaign contract as JSON Schema, for Naive `output_schema`. Naive offers it to the agent as
 * the parameters of `submit_output`, checks each call against it and hands a failure back to the
 * agent to correct. That is why this stays unmodified `z.toJSONSchema` output, with open records
 * and optional fields, and not a provider's strict subset. Naive only serves this on the `pi`
 * harness. Set `structured_output_required`, or a run that never conforms ends with a null result.
 *
 * `io: 'input'` because an agent's output is what `campaignSchema` parses. Business rules such as
 * timing and claim backing are not expressible here: run `validateCampaign` on the result.
 */
export const campaignJsonSchema = z.toJSONSchema(campaignSchema, {
  target: 'draft-2020-12',
  io: 'input',
});
