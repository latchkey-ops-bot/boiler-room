import { cap } from './caps.ts';
import { DISCOVERY } from './config.ts';
import {
  buildCaption,
  type CaptionResult,
  openerProblems,
  quoteProblem,
  subjectProblems,
  type VerifiedQuote,
} from './copy.ts';
import type { Candidate } from './discover.ts';
import { jurisdictionOverride, ukLtdEvidence, usEvidence } from './extract.ts';
import { pickOutputSchema, scoutOutputSchema, socialOutputSchema } from './schemas.ts';
import { verifyQuote } from './site.ts';
import type { CopyRow, Jurisdiction, LeadRow, LeadVerdict, StoreData } from './store.ts';
import { contactedWithin, suppressedBy } from './suppression.ts';

/**
 * Code's checks on what the agents decided. Every model field is data: ids must come from the
 * executor's own input, quotes are verified with `checkQuote` and the boundary rule, and a field
 * that fails becomes null rather than being trusted.
 */

export interface ScoutCheck {
  verdicts: Map<string, LeadVerdict>;
  error: string | null;
  /** Fields code set to null or `unknown`, for the review file. */
  corrections: string[];
}

/** The jurisdiction a scout verdict proves, after code's overrides. */
export function provenJurisdiction(
  claimed: Jurisdiction,
  quote: { page: string; quote: string } | null,
  candidate: Pick<Candidate, 'read' | 'lead'>,
): Jurisdiction {
  let proven: Jurisdiction = claimed;
  if (claimed === 'us' || claimed === 'uk_ltd') {
    const found = quote
      ? verifyQuote(candidate.read, quote.page, quote.quote).verdict === 'found'
      : false;
    const evidence = quote
      ? claimed === 'us'
        ? usEvidence(quote.quote)
        : ukLtdEvidence(quote.quote)
      : false;
    proven = found && evidence ? claimed : 'unknown';
  }
  return jurisdictionOverride(candidate.lead.domain, candidate.read) ?? proven;
}

/** The pages a scout's line may come from. */
export const LINE_PAGES: readonly string[] = ['homepage', 'about page'];

export function checkScout(
  output: unknown,
  batch: readonly Candidate[],
  sessionId: string | null,
): ScoutCheck {
  const verdicts = new Map<string, LeadVerdict>();
  const corrections: string[] = [];
  const parsed = scoutOutputSchema.safeParse(output);
  if (!parsed.success) return { verdicts, error: 'schema', corrections };
  if (parsed.data.error) return { verdicts, error: parsed.data.error, corrections };
  const byId = new Map(batch.map((candidate) => [candidate.candidate_id, candidate]));
  for (const verdict of parsed.data.verdicts ?? []) {
    const candidate = byId.get(verdict.candidate_id);
    if (!candidate || verdicts.has(candidate.candidate_id)) {
      corrections.push(`${verdict.candidate_id}: not an input id, ignored`);
      continue;
    }
    let line: LeadVerdict['line'] = null;
    if (verdict.line) {
      const page = candidate.read.pages.find((item) => item.id === verdict.line?.page);
      // Copy quotes what the product does, from its homepage or about page: never a privacy
      // policy, terms, an imprint or a contact page ("Their website says: We never sell your data").
      const problem =
        page && !LINE_PAGES.includes(page.label)
          ? `not_homepage_or_about: ${page.label}`
          : quoteProblem(candidate.read, verdict.line.page, verdict.line.quote);
      if (problem || !page)
        corrections.push(`${candidate.candidate_id}: line refused (${problem ?? 'no page'})`);
      else line = { page: page.id, url: page.final_url, quote: verdict.line.quote.trim() };
    }
    const option = verdict.email_option;
    const emailOption =
      option !== null && option >= 0 && option < candidate.lead.addresses.length ? option : null;
    if (option !== null && emailOption === null)
      corrections.push(`${candidate.candidate_id}: email_option out of range`);
    const jurisdiction = provenJurisdiction(
      verdict.jurisdiction,
      verdict.jurisdiction_quote,
      candidate,
    );
    if (jurisdiction !== verdict.jurisdiction) {
      corrections.push(
        `${candidate.candidate_id}: jurisdiction ${verdict.jurisdiction} became ${jurisdiction}`,
      );
    }
    let qualified = verdict.verdict === 'qualified';
    let reason: string | null = qualified ? null : (verdict.reject_reason ?? 'other');
    if (qualified && !candidate.lead.product_name) {
      // Code's own reason: the site was read, but no name copy may use was on it.
      qualified = false;
      reason = 'no_product_name';
      corrections.push(`${candidate.candidate_id}: no verified product name, rejected`);
    }
    verdicts.set(candidate.candidate_id, {
      verdict: qualified ? 'qualified' : 'rejected',
      reject_reason: reason,
      category: verdict.category,
      fit: verdict.fit,
      line,
      email_option: emailOption,
      jurisdiction,
      session_id: sessionId,
    });
  }
  return { verdicts, error: null, corrections };
}

/** The lead's verified quotes: the scout's line, if it passed. */
export function quotesOf(lead: LeadRow, read: Candidate['read'] | null): VerifiedQuote[] {
  const line = lead.verdict?.line;
  if (!line) return [];
  const page = read?.pages.find((item) => item.id === line.page);
  return [
    {
      ref: 'q1',
      page: line.page,
      url: line.url,
      path: page?.path ?? new URL(line.url).pathname,
      quote: line.quote,
    },
  ];
}

/** The address an email to this lead goes to: the scout's choice, or the best one code found. */
export function chosenAddress(lead: LeadRow) {
  const index = lead.verdict?.email_option ?? 0;
  const address = lead.addresses[index] ?? lead.addresses[0];
  return address?.address ? address : null;
}

/** Why the X lane is closed for a lead today, or null when it is open. */
export function xBlocker(
  store: StoreData,
  lead: LeadRow,
  now: Date,
  /**
   * `post`: code posts it, so a verified X launch post is needed. `pack`: the founder posts it by
   * hand and quotes the launch post only if there is one, so the social-proof floor alone holds.
   */
  how: 'post' | 'pack' = 'post',
): string | null {
  if (lead.verdict?.verdict !== 'qualified') return 'not_qualified';
  if (!lead.product_name) return 'no_product_name';
  if (how === 'post' && !lead.x_post?.verified) return 'no_verified_x_post';
  const proof =
    (lead.hn_points ?? 0) >= DISCOVERY.hn_min_points_x || lead.x_post?.verified === true;
  if (!proof) return 'social_proof';
  if (lead.brand_flags.length) return 'brand_safety';
  if (suppressedBy(store, { domain: lead.domain })) return 'suppressed';
  if (contactedWithin(store, lead.domain, 'x_post', now)) return 'posted_before';
  // A pack post counts as made only once the founder says so, so a startup already in a pack is
  // never packed again: one the founder posted but did not report is never posted twice.
  if (
    (store.packs ?? []).some((pack) => pack.entries.some((entry) => entry.domain === lead.domain))
  )
    return 'packed_before';
  return null;
}

/** Why the email lane is closed for a lead today, or null when it is open. */
export function emailBlocker(store: StoreData, lead: LeadRow, now: Date): string | null {
  if (lead.verdict?.verdict !== 'qualified') return 'not_qualified';
  if (!lead.product_name) return 'no_product_name';
  if (lead.email_closed) return lead.email_closed;
  const jurisdiction = lead.verdict.jurisdiction;
  if (jurisdiction !== 'us' && jurisdiction !== 'uk_ltd') return `jurisdiction_${jurisdiction}`;
  const address = chosenAddress(lead);
  if (!address?.address) return 'no_address';
  if (suppressedBy(store, { email: address.address, domain: lead.domain })) return 'suppressed';
  if (contactedWithin(store, lead.domain, 'email', now)) return 'emailed_90d';
  if (lead.source === 'hn' && (lead.hn_points ?? 0) < DISCOVERY.hn_min_points_email)
    return 'hn_points';
  return null;
}

export interface PickCheck {
  x: string | null;
  emails: { lead_id: string; subject: string; opener: string }[];
  /** What a repair round is told. Empty when the pick passed. */
  problems: string[];
  error: string | null;
}

/**
 * Checks the GTM lead's pick. Any id it names must be a qualified lead whose lane is open; subjects
 * and openers pass the copy checks. The X pick and the email picks share the day's film cap.
 */
export function checkPick(
  output: unknown,
  input: {
    store: StoreData;
    leads: ReadonlyMap<string, LeadRow>;
    xOpen: ReadonlySet<string>;
    emailOpen: ReadonlySet<string>;
    quotes: ReadonlyMap<string, VerifiedQuote[]>;
    xCap: number;
    emailCap: number;
  },
): PickCheck {
  const parsed = pickOutputSchema.safeParse(output);
  if (!parsed.success)
    return {
      x: null,
      emails: [],
      problems: ['the output does not match the schema'],
      error: 'schema',
    };
  if (parsed.data.error) return { x: null, emails: [], problems: [], error: parsed.data.error };
  const problems: string[] = [];
  let x: string | null = null;
  const pick = parsed.data.x_pick ?? null;
  if (pick && input.xCap > 0) {
    if (!input.xOpen.has(pick.lead_id))
      problems.push(`x_pick ${pick.lead_id}: not a lead whose X lane is allowed`);
    else x = pick.lead_id;
  }
  const emails: PickCheck['emails'] = [];
  const filmCap = cap(input.store, 'films_day');
  for (const [index, item] of (parsed.data.email_picks ?? []).entries()) {
    const path = `email_picks[${index}] ${item.lead_id}`;
    const lead = input.leads.get(item.lead_id);
    if (!lead || !input.emailOpen.has(item.lead_id)) {
      problems.push(`${path}: not a lead whose email lane is allowed`);
      continue;
    }
    if (emails.some((email) => email.lead_id === item.lead_id)) continue;
    if (emails.length >= input.emailCap) {
      problems.push(`${path}: more than ${input.emailCap} email picks`);
      continue;
    }
    const films = new Set([
      ...(x ? [x] : []),
      ...emails.map((email) => email.lead_id),
      item.lead_id,
    ]);
    if (films.size > filmCap) {
      problems.push(`${path}: more than ${filmCap} films today`);
      continue;
    }
    const context = {
      productName: lead.product_name ?? '',
      quotes: input.quotes.get(item.lead_id) ?? [],
      blockedNames: lead.x_post?.author_name ? [lead.x_post.author_name] : [],
    };
    const subject = subjectProblems(item.subject, context);
    const opener = openerProblems(item.opener, context);
    if (subject.length) problems.push(`${path} subject: ${subject.join(', ')}`);
    if (opener.length) problems.push(`${path} opener: ${opener.join(', ')}`);
    if (subject.length || opener.length) continue;
    emails.push({
      lead_id: item.lead_id,
      subject: item.subject.trim(),
      opener: item.opener.trim(),
    });
  }
  return { x, emails, problems, error: null };
}

export type SocialCheck = { caption: CaptionResult; error: string | null };

/** Checks br-social's choice and fills the template. The caption is code's alone. */
export function checkSocial(
  output: unknown,
  input: {
    lead: LeadRow;
    quotes: readonly VerifiedQuote[];
    history: readonly CopyRow[];
    now: Date;
  },
): SocialCheck {
  const parsed = socialOutputSchema.safeParse(output);
  if (!parsed.success)
    return {
      caption: { ok: false, problems: ['the output does not match the schema'] },
      error: 'schema',
    };
  if (parsed.data.error) return { caption: { ok: false, problems: [] }, error: parsed.data.error };
  if (parsed.data.lead_id !== input.lead.id) {
    return { caption: { ok: false, problems: [`lead_id must be ${input.lead.id}`] }, error: null };
  }
  const ref = parsed.data.quote_ref ?? null;
  const quote = ref ? (input.quotes.find((item) => item.ref === ref) ?? null) : null;
  if (ref && !quote)
    return {
      caption: { ok: false, problems: [`quote_ref ${ref} is not a verified quote`] },
      error: null,
    };
  return {
    caption: buildCaption({
      lead: input.lead,
      template_id: parsed.data.template_id ?? '',
      quote,
      history: input.history,
      now: input.now,
    }),
    error: null,
  };
}
