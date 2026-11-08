import { researchPartsSchema } from '@boiler-room/schema';
import { z } from 'zod';

/**
 * What the Researcher hands on: the brand, assets and claims parts of the campaign contract,
 * unchanged, plus a brief, what it could not get, and the evidence the gate checks it against.
 * Keep it free of `.transform()`, `.default()` and `.pipe()`, so the JSON Schema the agent submits
 * against and the type here are one shape.
 */

/** Assets live in Naive files. An asset's `src` names its file this way. */
export const NAIVE_FILE_PREFIX = 'naive://files/';

const FILE_ID = /^fil_[a-z0-9]+$/;

export function naiveFileSrc(fileId: string): string {
  return `${NAIVE_FILE_PREFIX}${fileId}`;
}

/** The `fil_` id an asset `src` names, or undefined when it does not name one. */
export function fileIdOf(src: string): string | undefined {
  if (!src.startsWith(NAIVE_FILE_PREFIX)) return undefined;
  const id = src.slice(NAIVE_FILE_PREFIX.length);
  return FILE_ID.test(id) ? id : undefined;
}

export const PAGE_KINDS = [
  'home',
  'pricing',
  'product',
  'docs',
  'about',
  'demo',
  'customers',
  'blog',
  'material',
  'other',
] as const;

export const NEED_KINDS = [
  'product-ui',
  'logo',
  'font',
  'video',
  'screenshot',
  'brand-guide',
  'proof',
  'pricing',
  'other',
] as const;

export const LOGO_SOURCES = [
  'svg',
  'inline-svg',
  'png',
  'favicon',
  'uploaded',
  'generated',
] as const;

/**
 * Where the logo was found, best first: inside the header's home link (in any variant it holds),
 * elsewhere in the header or on the first screen, an apple-touch-icon or another icon, and last
 * the Open Graph image. `uploaded` is the customer's file; `generated` is the name set in type,
 * only when no picture of a logo could be had.
 */
export const LOGO_PLACEMENTS = [
  'header-home-link',
  'header',
  'page',
  'apple-touch-icon',
  'icon',
  'og-image',
  'uploaded',
  'generated',
] as const;

/** The brand colours a measured colour can be set as. `accents` is `brand_details.accents`. */
export const COLOR_TOKENS = [
  'background',
  'foreground',
  'primary',
  'accent',
  'muted',
  'accents',
] as const;

export const FONT_METHODS = [
  'google-fonts',
  'adobe-fonts',
  'self-hosted',
  'other-host',
  'system',
  'substitute',
] as const;

const httpUrl = z.httpUrl();

/**
 * Why a site address cannot be researched, or null when it can. Every claim cites its page by
 * address and the campaign schema takes only http(s) addresses with a domain name, so a bare IP or
 * `localhost` could never be cited: the run is refused before it spends anything.
 */
export function siteUrlProblem(url: string): string | null {
  if (httpUrl.safeParse(url).success) return null;
  return `${url} cannot be researched: the campaign schema accepts only http(s) addresses with a domain name, so claims could not cite its pages. A bare IP address or localhost is refused; serve the site under a domain name.`;
}
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug such as "pricing-page"');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be an opaque #RRGGBB colour');
const claim_ids = z
  .array(slug)
  .min(1)
  .describe(
    'Ids of claims in `claims` that back this item, at least one. Every number in the item must be in the quote of a claim it cites.',
  );
/** A brief fact in plain words, with the claims whose quotes back it. */
const cited = (what: string) =>
  z.strictObject({ text: z.string().min(1).describe(what), claim_ids });
const fileId = z.string().regex(FILE_ID, 'must be a Naive file id such as "fil_abc123"');

const brief = z.strictObject({
  product_name: z.string().min(1),
  one_liner: cited('What the product is, in one plain sentence.'),
  what_it_is: cited('A short paragraph in plain words, from the live site.'),
  audiences: z.array(z.strictObject({ who: z.string().min(1), claim_ids })),
  features: z.array(
    z.strictObject({ name: z.string().min(1), what_it_does: z.string().min(1), claim_ids }),
  ),
  pricing: z
    .strictObject({
      summary: z.string().min(1),
      free_trial: cited('The free trial, as the site states it.')
        .nullable()
        .describe('Null when the site offers no free trial.'),
      plans: z.array(
        z.strictObject({
          name: z.string().min(1),
          price: z
            .string()
            .min(1)
            .describe('As written on the site, such as "$19/mo" or "Custom".'),
          claim_ids,
        }),
      ),
      claim_ids,
    })
    .nullable()
    .describe('Null when the site publishes no pricing.'),
  ctas: z
    .array(
      z.strictObject({
        label: z.string().min(1).describe('The exact button or link text, as on the page.'),
        href: httpUrl,
        source_url: httpUrl.describe('The captured page the label is on.'),
        placement: z.enum(['nav', 'hero', 'body', 'pricing', 'footer', 'other']),
      }),
    )
    .describe('Calls to action, verbatim.'),
  headline_claim_id: slug.nullable().describe('The claim that quotes the home page headline.'),
  positioning_note: cited(
    'How the live site differs from any description you were given, citing what the site says.',
  )
    .nullable()
    .describe('Null when you were given no description, or the site matches it.'),
  non_claims: z
    .array(
      z.strictObject({ text: z.string().min(1), source_url: httpUrl, reason: z.string().min(1) }),
    )
    .describe('Sample, illustrative or mock figures that must never be shown as facts.'),
  conflicts: z.array(z.strictObject({ description: z.string().min(1), claim_ids })),
  pages: z.array(
    z.strictObject({
      url: httpUrl,
      kind: z.enum(PAGE_KINDS),
      title: z.string(),
      screenshot_asset_id: slug.nullable(),
    }),
  ),
  product_ui: z.strictObject({
    status: z.enum(['public', 'mock-only', 'login-required', 'none']),
    notes: z.string().min(1),
    asset_ids: z.array(slug),
  }),
});

const needUpload = z.strictObject({
  id: slug,
  kind: z.enum(NEED_KINDS),
  what: z.string().min(1).describe('What could not be captured.'),
  why: z.string().min(1).describe('What the film loses without it.'),
  request: z.string().min(1).describe('A plain-language request to the customer.'),
  blocking: z.boolean().describe('True when the film cannot be made well without it.'),
  evidence_url: httpUrl.nullable().describe('Where the gap was seen, such as a sign-in page.'),
});

/**
 * A colour the capture read from a computed style, at a recorded point on a captured page. Only
 * these may be brand colours: the background must be one painted as a page surface.
 */
export const measuredColorSchema = z.strictObject({
  hex: hexColor,
  property: z
    .enum(['background-color', 'color', 'border-color', 'canvas'])
    .describe(
      'The computed style read. `canvas` is the browser canvas, where html and body are transparent.',
    ),
  seen_as: z
    .enum(['surface', 'text', 'link', 'button'])
    .describe('What painted it: a page surface, text, a link or a button.'),
  element: z
    .string()
    .min(1)
    .describe('The element whose computed style gave it, as tag#id.class, or "canvas".'),
  page_url: httpUrl.describe('The captured page it was read on.'),
  x: z.number().describe('CSS px from the left of the page, in a 1920 x 1080 viewport.'),
  y: z.number().describe('CSS px from the top of the page.'),
  share: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .describe('For a page surface, its share of the background samples; null otherwise.'),
  tokens: z.array(z.enum(COLOR_TOKENS)).describe('The brand colours the capture set to it.'),
});

export type MeasuredColor = z.infer<typeof measuredColorSchema>;

const brandDetails = z.strictObject({
  mode: z.enum(['light', 'dark']),
  accents: z.array(hexColor),
  fonts: z.array(
    z.strictObject({
      role: z.enum(['display', 'body', 'mono', 'other']),
      family: z.string().min(1),
      method: z.enum(FONT_METHODS),
      url: httpUrl.nullable(),
    }),
  ),
  radius_px: z.number().min(0).nullable(),
  css_variables: z.boolean().describe('Whether the site defines colour custom properties.'),
  measured: z
    .array(measuredColorSchema)
    .min(1)
    .describe(
      "Every colour the capture measured, with where. Copy the template's list unchanged: every brand colour and accent must be one of these, and the background one with seen_as surface.",
    ),
  notes: z.array(z.string()),
});

const evidence = z.strictObject({
  pages_file_id: fileId.describe('The published pages.json the capture tool wrote.'),
  capture_file_id: fileId.describe('The published capture.json the capture tool wrote.'),
  logo: z.strictObject({
    asset_id: slug,
    source: z.enum(LOGO_SOURCES),
    found_in: z
      .enum(LOGO_PLACEMENTS)
      .describe(
        "Where the logo was found, as the template has it: 'uploaded' for the customer's file.",
      ),
    aspect: z
      .number()
      .positive()
      .nullable()
      .describe('Width over height of the logo file, as the template has it.'),
    url: httpUrl.nullable().describe('Where the logo came from, or null when generated.'),
  }),
  material: z.array(
    z.strictObject({ file_id: fileId, name: z.string().min(1), used_for: z.string().min(1) }),
  ),
});

export const researchOutputSchema = z.strictObject({
  ...researchPartsSchema.shape,
  brand_details: brandDetails,
  brief,
  needs_upload: z.array(needUpload),
  evidence,
});

export type ResearchOutput = z.infer<typeof researchOutputSchema>;
export type Brief = ResearchOutput['brief'];
export type NeedUpload = ResearchOutput['needs_upload'][number];

/** The output contract as JSON Schema, for the agent's `output_schema`. */
export const researchOutputJsonSchema = z.toJSONSchema(researchOutputSchema, {
  target: 'draft-2020-12',
  io: 'input',
}) as Record<string, unknown>;
