import { z } from 'zod';
import type { ResearchOutput } from './output.ts';
import { normaliseUrl, normaliseWhitespace, numbersIn } from './text.ts';

/**
 * The text the capture tool stored for one page or one piece of customer material. `rendered` is
 * what a reader sees (`innerText`), `dom` is everything in the document (`textContent`, without
 * scripts and styles), and `meta` is the title, meta tags and alt text. `illustrative` is the text
 * of product mockups, device frames and terminals, where sample figures live, and `clean` is `dom`
 * without it.
 */
export const storedPageSchema = z.object({
  url: z.string(),
  final_url: z.string(),
  origin: z.enum(['site', 'material']),
  file_id: z.string().nullable(),
  status: z.number().int().nullable(),
  content_type: z.string().nullable(),
  title: z.string(),
  text: z.object({
    rendered: z.string(),
    dom: z.string(),
    meta: z.string(),
    clean: z.string(),
    illustrative: z.string(),
  }),
});

export const pagesBundleSchema = z.object({
  version: z.literal(1),
  site: z.string(),
  captured_at: z.string(),
  pages: z.array(storedPageSchema),
});

export type StoredPage = z.infer<typeof storedPageSchema>;
export type PagesBundle = z.infer<typeof pagesBundleSchema>;

export const FAILURE_CODES = [
  'SOURCE_NOT_CAPTURED',
  'QUOTE_NOT_FOUND',
  'QUOTE_ILLUSTRATIVE',
  'CLAIM_STATUS',
  'CLAIM_UNKNOWN',
  'NUMBER_UNBACKED',
  'CTA_NOT_FOUND',
  'ASSET_UNKNOWN',
  'NEED_DUPLICATE',
  'LOGO_MISMATCH',
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

export interface Failure {
  code: FailureCode;
  /** Where the problem is, such as `claims[3].quote`. */
  path: string;
  message: string;
  /** What the agent should change. */
  fix: string;
  /** Set when the failure belongs to one claim, so the gate can drop that claim. */
  claimId?: string;
}

type Field = keyof StoredPage['text'];

/** Normalised text per field, computed once per page. */
class PageText {
  private readonly cache = new Map<Field, string>();
  readonly page: StoredPage;
  constructor(page: StoredPage) {
    this.page = page;
  }
  get(field: Field): string {
    let text = this.cache.get(field);
    if (text === undefined) {
      text = normaliseWhitespace(this.page.text[field]);
      this.cache.set(field, text);
    }
    return text;
  }
  has(fields: readonly Field[], needle: string): boolean {
    return fields.some((field) => this.get(field).includes(needle));
  }
}

const READABLE: readonly Field[] = ['rendered', 'dom', 'meta'];

/** Looks up a stored page by its requested or final address. */
export class PageIndex {
  private readonly byUrl = new Map<string, PageText>();
  readonly bundle: PagesBundle;
  constructor(bundle: PagesBundle) {
    this.bundle = bundle;
    for (const page of bundle.pages) {
      const text = new PageText(page);
      for (const url of [page.url, page.final_url]) {
        const key = normaliseUrl(url);
        if (key && !this.byUrl.has(key)) this.byUrl.set(key, text);
      }
    }
  }
  find(url: string): PageText | undefined {
    const key = normaliseUrl(url);
    return key ? this.byUrl.get(key) : undefined;
  }
  get urls(): string[] {
    return this.bundle.pages.map((page) => page.final_url);
  }
}

export type QuoteVerdict = 'found' | 'illustrative' | 'missing';

/**
 * Whether a quote is in the stored text of a page, after normalising whitespace on both sides. A
 * quote with a number that only appears inside a product mockup is `illustrative`: it is sample
 * data, not a claim.
 */
export function checkQuote(page: PageText, quote: string): QuoteVerdict {
  const needle = normaliseWhitespace(quote);
  if (!needle || !page.has(READABLE, needle)) return 'missing';
  if (
    /\d/.test(needle) &&
    page.has(['illustrative'], needle) &&
    !page.has(['clean', 'meta'], needle)
  ) {
    return 'illustrative';
  }
  return 'found';
}

function verifyClaims(output: ResearchOutput, pages: PageIndex): Failure[] {
  return output.claims.flatMap((claim, index): Failure[] => {
    const path = `claims[${index}]`;
    const failures: Failure[] = [];
    if (claim.status !== 'extracted') {
      failures.push({
        code: 'CLAIM_STATUS',
        path: `${path}.status`,
        message: `Claim "${claim.id}" has status "${claim.status}". Research cannot approve a claim.`,
        fix: `Set ${path}.status to "extracted".`,
        claimId: claim.id,
      });
    }
    const page = pages.find(claim.sourceUrl);
    if (!page) {
      failures.push({
        code: 'SOURCE_NOT_CAPTURED',
        path: `${path}.sourceUrl`,
        message: `Claim "${claim.id}" cites ${claim.sourceUrl}, which is not a captured page or material.`,
        fix: `Set ${path}.sourceUrl to the captured page the quote is on (one of: ${pages.urls.join(', ')}), or remove the claim.`,
        claimId: claim.id,
      });
      return failures;
    }
    const verdict = checkQuote(page, claim.quote);
    if (verdict === 'missing') {
      failures.push({
        code: 'QUOTE_NOT_FOUND',
        path: `${path}.quote`,
        message: `The quote of claim "${claim.id}" is not in the stored text of ${claim.sourceUrl}: "${claim.quote}".`,
        fix: `Copy the exact wording from the stored text of ${claim.sourceUrl} into ${path}.quote, or cite the page it is really on, or remove the claim. Never reword a quote.`,
        claimId: claim.id,
      });
    } else if (verdict === 'illustrative') {
      failures.push({
        code: 'QUOTE_ILLUSTRATIVE',
        path: `${path}.quote`,
        message: `The quote of claim "${claim.id}" only appears inside a product mockup or sample frame on ${claim.sourceUrl}, so its figures are sample data.`,
        fix: `Remove claim "${claim.id}" and list it in brief.non_claims instead.`,
        claimId: claim.id,
      });
    }
    return failures;
  });
}

interface Cited {
  path: string;
  text: string;
  ids: string[];
}

/** Every brief item that cites claims, with the text whose numbers those claims must state. */
function citedItems(brief: ResearchOutput['brief']): Cited[] {
  const items: Cited[] = [
    ...brief.audiences.map((item, index) => ({
      path: `brief.audiences[${index}]`,
      text: item.who,
      ids: item.claim_ids,
    })),
    ...brief.features.map((item, index) => ({
      path: `brief.features[${index}]`,
      text: `${item.name} ${item.what_it_does}`,
      ids: item.claim_ids,
    })),
    ...brief.conflicts.map((item, index) => ({
      path: `brief.conflicts[${index}]`,
      text: '',
      ids: item.claim_ids,
    })),
  ];
  if (brief.pricing) {
    const { pricing } = brief;
    items.push({ path: 'brief.pricing', text: pricing.summary, ids: pricing.claim_ids });
    pricing.plans.forEach((plan, index) => {
      items.push({
        path: `brief.pricing.plans[${index}]`,
        text: `${plan.name} ${plan.price}`,
        ids: [...plan.claim_ids, ...pricing.claim_ids],
      });
    });
  }
  if (brief.headline_claim_id) {
    items.push({ path: 'brief.headline_claim_id', text: '', ids: [brief.headline_claim_id] });
  }
  return items;
}

function verifyBrief(output: ResearchOutput, pages: PageIndex): Failure[] {
  const failures: Failure[] = [];
  const quotes = new Map(output.claims.map((claim) => [claim.id, claim.quote]));

  for (const item of citedItems(output.brief)) {
    for (const id of item.ids) {
      if (!quotes.has(id)) {
        failures.push({
          code: 'CLAIM_UNKNOWN',
          path: item.path,
          message: `${item.path} cites "${id}", which is not in claims.`,
          fix: `Add a claim "${id}" with its verbatim quote, or remove "${id}" from ${item.path}.`,
        });
      }
    }
    const stated = new Set(item.ids.flatMap((id) => numbersIn(quotes.get(id) ?? '')));
    for (const number of numbersIn(item.text)) {
      if (!stated.has(number)) {
        failures.push({
          code: 'NUMBER_UNBACKED',
          path: item.path,
          message: `${item.path} states "${number}", but no claim it cites quotes that number.`,
          fix: `Cite a claim whose quote states "${number}" in ${item.path}, or remove the number.`,
        });
      }
    }
  }

  output.brief.ctas.forEach((cta, index) => {
    const path = `brief.ctas[${index}]`;
    const page = pages.find(cta.source_url);
    const label = normaliseWhitespace(cta.label);
    if (!page?.has(['rendered', 'dom'], label)) {
      failures.push({
        code: 'CTA_NOT_FOUND',
        path: `${path}.label`,
        message: `The call to action "${cta.label}" is not in the stored text of ${cta.source_url}.`,
        fix: `Copy the exact label from a captured page into ${path}.label and set ${path}.source_url to that page, or remove the call to action.`,
      });
    }
  });

  return failures;
}

function verifyReferences(output: ResearchOutput): Failure[] {
  const failures: Failure[] = [];
  const assets = new Set(Object.keys(output.assets));
  const unknownAsset = (path: string, id: string) => {
    if (!assets.has(id)) {
      failures.push({
        code: 'ASSET_UNKNOWN',
        path,
        message: `${path} refers to asset "${id}", which is not declared in assets.`,
        fix: `Declare "${id}" in assets, or change ${path} to an asset that is declared.`,
      });
    }
  };
  output.brief.pages.forEach((page, index) => {
    if (page.screenshot_asset_id) {
      unknownAsset(`brief.pages[${index}].screenshot_asset_id`, page.screenshot_asset_id);
    }
  });
  output.brief.product_ui.asset_ids.forEach((id, index) => {
    unknownAsset(`brief.product_ui.asset_ids[${index}]`, id);
  });

  const seen = new Set<string>();
  output.needs_upload.forEach((need, index) => {
    if (seen.has(need.id)) {
      failures.push({
        code: 'NEED_DUPLICATE',
        path: `needs_upload[${index}].id`,
        message: `needs_upload[${index}] repeats the id "${need.id}".`,
        fix: `Give needs_upload[${index}] a unique id, or merge the two requests.`,
      });
    }
    seen.add(need.id);
  });

  if (output.evidence.logo.asset_id !== output.brand.logoAssetId) {
    failures.push({
      code: 'LOGO_MISMATCH',
      path: 'evidence.logo.asset_id',
      message: `evidence.logo.asset_id is "${output.evidence.logo.asset_id}", but brand.logoAssetId is "${output.brand.logoAssetId}".`,
      fix: 'Set evidence.logo.asset_id to brand.logoAssetId.',
    });
  }
  return failures;
}

/**
 * Checks research output against the text the capture stored. Every claim quote must be in the
 * stored text of its source page, after normalising whitespace, and a figure that only appears in
 * a product mockup is not a claim. Brief items may only cite claims that exist, and any number in
 * them must be stated by a claim they cite. Calls to action must be verbatim on their page.
 */
export function verifyResearch(output: ResearchOutput, bundle: PagesBundle): Failure[] {
  const pages = new PageIndex(bundle);
  return [
    ...verifyClaims(output, pages),
    ...verifyBrief(output, pages),
    ...verifyReferences(output),
  ];
}
