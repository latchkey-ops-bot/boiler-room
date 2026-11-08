import { z } from 'zod';

/**
 * What the Art Director agent submits for one review batch: a scene's pick, a keep or drop for
 * each tile of a wall, or a verdict on each generated image. Colours, fonts, generation and the
 * merge into `campaign.json` stay in code, so the agent never writes the campaign. Keep it free of
 * `.transform()`, `.default()` and `.pipe()`.
 */

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug such as "home-screen"');

export const reviewSchema = z.strictObject({
  seen: z
    .boolean()
    .describe('True only if every picture in this review arrived and you looked at all of it.'),
  scene: z
    .strictObject({
      scene_id: slug,
      asset_ids: z
        .array(slug)
        .describe("In order. Only ids from this scene's candidates, within its min and max."),
      reason: z
        .string()
        .min(1)
        .describe('One sentence: what the chosen pictures show, and why they fit the copy.'),
    })
    .nullable()
    .describe('Your pick, for a scene review. Null for any other review.'),
  tiles: z
    .array(
      z.strictObject({
        asset_id: slug,
        keep: z.boolean(),
        reason: z.string().min(1).describe('What the tile shows.'),
      }),
    )
    .describe('One entry per tile, for a tile review. Empty for any other review.'),
  generated: z
    .array(
      z.strictObject({
        asset_id: slug,
        accept: z
          .boolean()
          .describe(
            'True only if the image is abstract (no text, letters, digits, logos, interface, people, or anything that could pass for a screenshot or proof) and fills the frame edge to edge.',
          ),
        reason: z.string().min(1).describe('What you saw.'),
      }),
    )
    .describe('One entry per generated image, for a generated review. Empty for any other review.'),
  flags: z
    .array(z.string().min(1))
    .describe('Anything a human must decide, such as a capture that is broken or blank.'),
});

export type Review = z.infer<typeof reviewSchema>;

export const reviewJsonSchema = z.toJSONSchema(reviewSchema, {
  target: 'draft-2020-12',
  io: 'input',
}) as Record<string, unknown>;
