import { z } from 'zod';

/**
 * What the Art Director agent submits: its picks per scene and its verdict on each generated
 * image. Colours, fonts, generation and the merge into `campaign.json` stay in code, so the agent
 * never writes the campaign. Keep it free of `.transform()`, `.default()` and `.pipe()`.
 */

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug such as "home-screen"');

export const artDecisionSchema = z.strictObject({
  scenes: z
    .array(
      z.strictObject({
        scene_id: slug,
        asset_ids: z
          .array(slug)
          .describe("In order. Only ids from this scene's candidates, within its min and max."),
        reason: z
          .string()
          .min(1)
          .describe('One sentence: what the chosen pictures show, and why they fit the copy.'),
      }),
    )
    .describe('One entry for every scene in the review list.'),
  generated: z
    .array(
      z.strictObject({
        asset_id: slug,
        accept: z
          .boolean()
          .describe(
            'True only if the image is abstract: no text, letters, digits, logos, interface, people, or anything that could pass for a screenshot or proof.',
          ),
        reason: z.string().min(1).describe('What you saw.'),
      }),
    )
    .describe('One entry for every generated image in the task.'),
  flags: z
    .array(z.string().min(1))
    .describe('Anything a human must decide, such as a capture that is broken or blank.'),
});

export type ArtDecision = z.infer<typeof artDecisionSchema>;

export const artDecisionJsonSchema = z.toJSONSchema(artDecisionSchema, {
  target: 'draft-2020-12',
  io: 'input',
}) as Record<string, unknown>;
