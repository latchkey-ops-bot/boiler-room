import { z } from 'zod';
import { campaignSchema } from './campaign.ts';

/**
 * The campaign contract as JSON Schema, for Naive `output_schema`. It is unmodified `z.toJSONSchema`
 * output. `io: 'input'` because an agent's output is what `campaignSchema` parses. Business rules
 * such as timing and claim backing are not expressible here: run `validateCampaign` on the result.
 */
export const campaignJsonSchema = z.toJSONSchema(campaignSchema, {
  target: 'draft-2020-12',
  io: 'input',
});
