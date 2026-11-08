import { campaignJsonSchema, FORMATS } from '@boiler-room/schema';
import { z } from 'zod';
import { TEMPLATES } from './templates.ts';

/**
 * What the Director is given beside the research, and what it hands back. Keep these free of
 * `.transform()`, `.default()` and `.pipe()`, so the JSON Schema the agent submits against and the
 * types here are one shape.
 */

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug');
const httpUrl = z.httpUrl();

/** The Orchestrator's brief for one film. */
export const directorBriefSchema = z.strictObject({
  kind: z
    .enum(['outreach-sample', 'social-cut', 'customer-order'])
    .describe(
      'An outreach sample is made unasked for a lead; a social cut is a customer order for a Short film; a customer order is paid for.',
    ),
  audience: z.string().min(1).nullable(),
  citeExtracted: z
    .boolean()
    .describe('True when claims with status "extracted" may be cited on screen.'),
  formats: z.array(z.enum(FORMATS)).min(1),
  ctaPages: z.array(httpUrl).describe('CTA pages the brief names. Empty: take them from research.'),
  narrationPaid: z.boolean(),
  asksFor45s: z.boolean().describe('True when the brief asks for a 45 s film.'),
  music: z
    .strictObject({
      assetId: slug,
      src: z.string().min(1),
      provenance: z.enum(['stock', 'library']),
      license: z.string().min(1),
    })
    .nullable()
    .describe('The licensed track from the music library, or null when none is given.'),
});

export type DirectorBrief = z.infer<typeof directorBriefSchema>;

export const OUTREACH_BRIEF: DirectorBrief = {
  kind: 'outreach-sample',
  audience: null,
  citeExtracted: true,
  formats: ['16:9'],
  ctaPages: [],
  narrationPaid: false,
  asksFor45s: false,
  music: null,
};

const templateLabels = Object.values(TEMPLATES).map((template) => template.label) as [
  'Short',
  'Standard',
  'Long',
];

/** The Director's handoff to the Art Director and the approval step, as typed data. */
export const handoffSchema = z.strictObject({
  template: z.enum(templateLabels),
  reason: z.string().min(1).describe('Which rule of the length choice applied, with the counts.'),
  counts: z.strictObject({
    usableClaims: z.number().int().min(0),
    verifiedClaims: z.number().int().min(0),
    numericClaims: z.number().int().min(0),
    productSurfaces: z.number().int().min(0),
    capturedTiles: z.number().int().min(0),
  }),
  substitutions: z.array(
    z.strictObject({
      row: z.number().int().min(1).describe('The template row, counting from 1.'),
      from: z.string().min(1),
      to: z.string().min(1),
    }),
  ),
  tier4SceneIds: z.array(slug).describe('Every tier 4 scene, for script approval.'),
  noNumericProof: z.boolean(),
  formatsBeyond16x9: z.array(z.enum(FORMATS)),
  issuesLeft: z
    .array(
      z.strictObject({
        code: z.string().min(1),
        path: z.string().min(1),
        owner: z.enum(['art-director', 'researcher']),
        note: z.string().min(1),
      }),
    )
    .describe('Validator issues left to other agents.'),
  notes: z.string().describe('Anything else the next agents need, such as no music given.'),
});

export type Handoff = z.infer<typeof handoffSchema>;

/** The parsed shape of a submission. The campaign is checked by `validateCampaign`, not here. */
export const directorOutputSchema = z.strictObject({
  campaign: z.unknown(),
  handoff: handoffSchema,
});

function withoutDialect(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = schema;
  return rest;
}

/**
 * The output contract for `output_schema`: `campaignJsonSchema` unmodified under `campaign`, and
 * the handoff beside it, so the handoff never leaks into `campaign.json`.
 */
export const directorOutputJsonSchema: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    campaign: withoutDialect(campaignJsonSchema as Record<string, unknown>),
    handoff: withoutDialect(
      z.toJSONSchema(handoffSchema, { target: 'draft-2020-12', io: 'input' }) as Record<
        string,
        unknown
      >,
    ),
  },
  required: ['campaign', 'handoff'],
  additionalProperties: false,
};
