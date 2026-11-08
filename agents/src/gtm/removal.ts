import { normaliseWhitespace } from '../researcher/text.ts';
import { FOOTER_PHRASES } from './copy.ts';
import { opaqueId, registrableDomain } from './domain.ts';
import type { LeadRow, StoreData, SuppressionReason } from './store.ts';
import { suppress } from './suppression.ts';

/**
 * Opt-outs and removals. Both only take things down, so they run in every mode, under halt and
 * under hold. A false match only suppresses someone, which is the safe mistake.
 */

export const STOP_PHRASES = [
  'unsubscribe',
  'stop emailing',
  'stop contacting',
  'stop sending',
  'opt out',
  'opt-out',
  'remove me',
  'not interested',
  'no thanks',
  'do not contact',
  "don't contact",
  'do not email',
  "don't email",
] as const;

export const REMOVAL_PHRASES = [
  'take it down',
  'take this down',
  'take that down',
  'remove the film',
  'remove the video',
  'remove the post',
  'delete the film',
  'delete the video',
  'delete the post',
  'remove it',
  'delete it',
] as const;

export interface InboundMessage {
  subject: string;
  /** AgentMail's `extracted_text`: the new text, with quoted history dropped. */
  extracted_text: string | null;
  /** The whole plain-text body. */
  text: string;
}

/**
 * The text a stop phrase is looked for in: the subject, the whole `extracted_text`, and the raw
 * text with `>`-quoted lines and our own footer lines removed. Our footer says "unsubscribe", so a
 * scan that kept it would suppress every lead that replies.
 */
export function scanText(message: InboundMessage): string {
  const raw = message.text
    .split(/\r?\n/)
    .filter((line) => !/^\s*>/.test(line))
    .filter((line) => !FOOTER_PHRASES.some((phrase) => line.includes(phrase)))
    .filter((line) => !/^\s*On .{4,120} wrote:\s*$/.test(line))
    .join('\n');
  const extracted = (message.extracted_text ?? '')
    .split(/\r?\n/)
    .filter((line) => !FOOTER_PHRASES.some((phrase) => line.includes(phrase)))
    .join('\n');
  return normaliseWhitespace([message.subject, extracted, raw].join('\n')).toLowerCase();
}

export type StopKind = 'removal' | 'opt_out';

/** A removal phrase wins over a stop phrase: it asks for more. */
export function stopMatch(message: InboundMessage): { kind: StopKind; phrase: string } | null {
  const text = scanText(message);
  const has = (phrase: string) =>
    new RegExp(
      `(?<![\\p{L}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`,
      'u',
    ).test(text);
  const removal = REMOVAL_PHRASES.find(has);
  if (removal) return { kind: 'removal', phrase: removal };
  const stop = STOP_PHRASES.find(has);
  if (stop) return { kind: 'opt_out', phrase: stop };
  return null;
}

/** One request to stop or take down, from any channel. */
export interface RemovalRequest {
  kind: StopKind;
  /** `optout_link`, `remove_form`, `reply`, `board`. */
  channel: string;
  /** The domain the request is about, when known. */
  domain: string | null;
  /** The address it came from or is about, when known. */
  email: string | null;
  /** The film page share id, when the request names one. */
  share_id: string | null;
  /** The lead the request names, for a board command. */
  lead_id: string | null;
  at: string;
  /** The board comment that gave a `REMOVE` command. */
  comment_id?: string;
}

/** What one request asks code to take down. Code then deletes and withdraws through the ports. */
export interface RemovalPlan {
  id: string;
  request: RemovalRequest;
  domain: string | null;
  leads: LeadRow[];
  /** X posts of ours to delete: `actions` keys and provider ids. */
  posts: { key: string; provider_id: string }[];
  /** Film orders to withdraw. */
  films: { key: string; provider_id: string }[];
  suppressed: number;
  /** True when no lead, film or post of ours matches: the request is counted and nothing else. */
  unmatched: boolean;
}

/**
 * Applies a request to the store: suppression on every channel it covers, and the list of our live
 * assets to take down. An opt-out suppresses the address and the domain for email; a removal
 * suppresses the domain on every channel and takes down our post and film.
 */
export function planRemoval(store: StoreData, request: RemovalRequest): RemovalPlan {
  const leads = store.leads.filter(
    (lead) =>
      (request.lead_id && lead.id === request.lead_id) ||
      (request.domain && lead.domain === registrableDomain(request.domain)),
  );
  const domain = request.domain
    ? registrableDomain(request.domain)
    : (leads[0]?.domain ??
      (request.email ? registrableDomain(request.email.split('@')[1] ?? '') : null));
  const reason: SuppressionReason = request.kind === 'removal' ? 'removal' : 'opt_out';
  let suppressed = 0;
  const add = (kind: 'email' | 'domain' | 'x_handle', raw: string | null | undefined) => {
    if (!raw) return;
    const before = store.suppression.length;
    suppress(store, { kind, raw, reason, source: request.channel, at: request.at });
    suppressed += store.suppression.length - before;
  };
  add('email', request.email);
  add('domain', domain);
  for (const lead of leads) {
    for (const address of lead.addresses) add('email', address.address);
  }

  const leadIds = new Set(leads.map((lead) => lead.id));
  const live = (kind: 'x-post' | 'film') =>
    store.actions
      .filter(
        (row) =>
          row.kind === kind &&
          row.status === 'sent' &&
          row.provider_id &&
          ((row.lead_id && leadIds.has(row.lead_id)) ||
            (request.share_id && row.detail.includes(`share=${request.share_id}`))),
      )
      .map((row) => ({ key: row.key, provider_id: row.provider_id as string }));
  const posts = request.kind === 'removal' ? live('x-post') : [];
  const films = request.kind === 'removal' ? live('film') : [];
  const unmatched = leads.length === 0 && posts.length === 0 && films.length === 0;
  return {
    id: opaqueId('rm'),
    request,
    domain,
    leads,
    posts,
    films,
    suppressed,
    unmatched,
  };
}

// ---------------------------------------------------------------------------------------------
// Commands a person writes on the day card

export type Command =
  | { kind: 'hold'; lead_id: string | null }
  | { kind: 'unhold'; lead_id: string | null }
  | { kind: 'resume_email' }
  | { kind: 'remove'; lead_id: string }
  | { kind: 'posted'; url: string };

const LEAD_ID = /^ld-[a-z0-9]{4,12}$/;

/** Reads one comment's first line as a command, or null. Anything else is not a command. */
export function parseCommand(body: string): Command | null {
  const line = (body.split('\n')[0] ?? '').trim();
  const [word = '', arg, ...rest] = line.split(/\s+/);
  if (rest.length) return null;
  const upper = word.toUpperCase();
  if (upper === 'HOLD' || upper === 'UNHOLD') {
    if (arg !== undefined && !LEAD_ID.test(arg)) return null;
    return { kind: upper === 'HOLD' ? 'hold' : 'unhold', lead_id: arg ?? null };
  }
  if (upper === 'RESUME' && arg?.toLowerCase() === 'email') return { kind: 'resume_email' };
  if (upper === 'REMOVE' && arg && LEAD_ID.test(arg)) return { kind: 'remove', lead_id: arg };
  if (
    upper === 'POSTED' &&
    arg &&
    /^https:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(arg)
  ) {
    return { kind: 'posted', url: arg };
  }
  return null;
}

/** Commands that let something go out again. Only the founder may give them. */
const PERSON_ONLY = new Set(['unhold', 'resume_email', 'posted']);

export interface BoardComment {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

/**
 * Whether a command counts. Anyone may stop or take down. A command that lets something go out
 * again counts only from the founder's own `usr_` id, and never from a comment the executor wrote
 * itself, because a comment made with an API key may carry the key owner's `usr_` id.
 */
export function commandAllowed(
  command: Command,
  comment: BoardComment,
  founderUserId: string | null,
  ownCommentIds: ReadonlySet<string>,
): boolean {
  if (!PERSON_ONLY.has(command.kind)) return true;
  if (!founderUserId || comment.author !== founderUserId) return false;
  return !ownCommentIds.has(comment.id);
}

export interface Holds {
  day: boolean;
  leads: Set<string>;
  resumeEmail: boolean;
  /** `REMOVE <lead id>` commands, with the comment that gave each, so each runs once. */
  removals: { lead_id: string; comment_id: string }[];
  posted: string[];
}

/** Folds the day card's comments, oldest first, into the holds and requests that stand now. */
export function readCommands(
  comments: readonly BoardComment[],
  founderUserId: string | null,
  ownCommentIds: ReadonlySet<string>,
): Holds {
  const holds: Holds = {
    day: false,
    leads: new Set(),
    resumeEmail: false,
    removals: [],
    posted: [],
  };
  const sorted = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const comment of sorted) {
    if (ownCommentIds.has(comment.id)) continue;
    const command = parseCommand(comment.body);
    if (!command || !commandAllowed(command, comment, founderUserId, ownCommentIds)) continue;
    if (command.kind === 'hold') {
      if (command.lead_id) holds.leads.add(command.lead_id);
      else holds.day = true;
    } else if (command.kind === 'unhold') {
      if (command.lead_id) holds.leads.delete(command.lead_id);
      else holds.day = false;
    } else if (command.kind === 'resume_email') holds.resumeEmail = true;
    else if (command.kind === 'remove')
      holds.removals.push({ lead_id: command.lead_id, comment_id: comment.id });
    else if (command.kind === 'posted') holds.posted.push(command.url);
  }
  return holds;
}
