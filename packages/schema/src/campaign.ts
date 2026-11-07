import { z } from 'zod';

/**
 * Keep this schema free of `.transform()`, `.default()` and `.pipe()`. Without them, the inferred
 * type, the Remotion `defaultProps` type and the JSON Schema agents write against are one shape.
 */

export const ASSET_KINDS = ['image', 'svg', 'video', 'audio', 'lottie', 'font'] as const;
export const ASSET_PROVENANCES = ['captured', 'uploaded', 'generated', 'stock', 'library'] as const;
export const CLAIM_STATUSES = ['extracted', 'approved'] as const;
export const TEXT_ROLES = ['headline', 'subhead', 'body', 'cta', 'label'] as const;
export const FORMATS = ['16:9', '9:16', '1:1'] as const;

export type TextRole = (typeof TEXT_ROLES)[number];

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug such as "hero-shot"');

// Six digit and opaque, because a colour with alpha has no defined contrast ratio.
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be an opaque #RRGGBB colour');

const seconds = z.number().min(0);

const font = z.strictObject({
  family: z.string().min(1),
  source: z
    .string()
    .min(1)
    .describe('The id of a declared asset of kind font, or an http(s) URL to the font file.'),
});

const brand = z.strictObject({
  name: z.string().min(1),
  colors: z.strictObject({
    background: hexColor,
    foreground: hexColor,
    primary: hexColor,
    accent: hexColor.optional(),
    muted: hexColor.optional(),
  }),
  fonts: z.strictObject({ display: font, body: font }),
  logoAssetId: slug,
  radius: z.number().min(0).optional(),
});

const asset = z.strictObject({
  kind: z.enum(ASSET_KINDS),
  src: z.string().min(1),
  provenance: z.enum(ASSET_PROVENANCES),
  license: z.string().min(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sourceUrl: z.httpUrl().optional(),
});

const claim = z.strictObject({
  id: slug,
  text: z.string().min(1),
  sourceUrl: z.httpUrl(),
  quote: z.string().min(1).describe('The verbatim wording from sourceUrl. Never paraphrase it.'),
  status: z.enum(CLAIM_STATUSES),
});

const claimIds = z
  .array(slug)
  .describe('Claims backing this text. Every number in the text must appear in a cited quote.');

const textItem = z.strictObject({
  id: slug,
  role: z.enum(TEXT_ROLES),
  value: z.string().min(1),
  claimIds,
});

const voiceover = z.strictObject({
  text: z.string().min(1),
  claimIds,
});

const scene = z.strictObject({
  id: slug,
  type: z.string().min(1),
  start: seconds.describe('Seconds from the start of the video.'),
  end: seconds.describe('Seconds from the start of the video.'),
  props: z
    .record(z.string(), z.unknown())
    .describe('Template parameters. Visible copy belongs in text, never here.'),
  text: z.array(textItem),
  voiceover: voiceover.optional(),
  assetIds: z.array(slug),
  transitionOut: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The template that plays as this scene ends. Transitions take no timeline time: start and end stay true, so a transition is overlaid on the boundary and never shortens the video.',
    ),
});

const audio = z.strictObject({
  voice: z
    .strictObject({
      provider: z.literal('elevenlabs'),
      voiceId: z.string().min(1),
    })
    .optional(),
  musicAssetId: slug.optional(),
  sfx: z
    .array(
      z.strictObject({
        assetId: slug,
        at: seconds.describe('Seconds from the start of the video.'),
      }),
    )
    .optional(),
});

const cta = z.strictObject({
  id: slug,
  label: z.string().regex(/\S/, 'must not be blank'),
  href: z.httpUrl(),
});

const variants = z.strictObject({
  hooks: z
    .array(scene)
    .describe('Alternate opening scenes. Each replaces the first scene and matches its timing.'),
  formats: z.array(z.enum(FORMATS)).min(1),
  ctas: z.array(cta),
});

export const campaignSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: slug,
  sourceUrl: z.httpUrl(),
  fps: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  brand,
  assets: z.record(slug, asset),
  claims: z.array(claim),
  scenes: z.array(scene).min(1),
  audio: audio.optional(),
  variants,
});

export type Campaign = z.infer<typeof campaignSchema>;
export type Scene = z.infer<typeof scene>;
export type TextItem = z.infer<typeof textItem>;
export type Claim = z.infer<typeof claim>;
export type Asset = z.infer<typeof asset>;
