import { boardOffered } from '../company/seats.ts';
import { allowedTools } from '../company/tools.ts';
import type { AgentDefinition } from '../define.ts';
import { cap } from './caps.ts';
import { CAPS, type FounderNeed, SCHEDULE } from './config.ts';
import type { LaneState } from './lanes.ts';
import type { StoreData } from './store.ts';

/**
 * Card and comment text. Everything the executor puts on the company board is code-written from
 * opaque ids, enums, counts, money, times and URLs on our own domain: no text from outside the
 * company, because br-ceo reads digested cards and holds `board_write`. Domains appear only in
 * day-card comments, never in a title or a body.
 */

export const dayTitle = (date: string) => `GTM: ${date}`;
export const dayKey = (date: string) => `gtm-day:${date}`;

const money = (micro: number) => `$${(micro / 1e6).toFixed(2)}`;
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function dayBody(store: StoreData, date: string, lanes: LaneState): string {
  return [
    `GTM day ${date}. Written by the GTM executor, which is code. Times are Pacific.`,
    `Mode ${store.flags.mode}. Lanes: films ${lanes.film}, x ${lanes.x}, email ${lanes.email}, replies ${lanes.reply}.`,
    `Caps today: ${cap(store, 'x_posts_day')} X post, ${cap(store, 'cold_emails_day')} emails, ${lanes.filmCap} films at ${money(cap(store, 'film_budget_micro'))} each, spend ${money(cap(store, 'spend_day_micro'))} a day (hard maximum ${money(CAPS.spend_day_micro.max)}).`,
    `Schedule: ${SCHEDULE.map((item) => `${item.phase} ${clock(item.at)}`).join(', ')}.`,
    'To stop the day, comment HOLD. To stop one startup, comment HOLD <lead id>. Only the founder can comment UNHOLD or RESUME email.',
  ].join('\n');
}

/** A comment's first line: `<TYPE> · <id> · <state>`. */
export const commentHead = (type: string, id: string, state: string) =>
  `${type} · ${id} · ${state}`;

const FOUNDER_STEPS: Record<FounderNeed, string> = {
  'executor-key':
    'Mint a Naive API key named gtm-executor with sessions:write, sessions:read, agents:read, agents:write and files:write, and put it in ~/.boiler-room.env as GTM_NAIVE_API_KEY. Until then discovery uses free sources only and no agent runs.',
  'postal-address':
    'Supply the postal address for the email footer: a street address, a USPS PO box or a registered CMRA mailbox. Emails stay in dry run until it is set.',
  'cold-sender':
    'Choose the cold-email sender and a sending domain separate from the app, with SPF, DKIM and DMARC. AgentMail cannot be it: its terms forbid cold outreach.',
  'connect-x':
    'Open the Naive social portal link for the GTM identity and connect the X account, then set the bio.',
  'x-volume':
    'The social provider refused a post for volume. Ask Naive which bundle.social tier the workspace uses.',
  'email-paused':
    'The email lane paused on bounces or a complaint. Read the report, then comment RESUME email on the day card.',
  'budget-floor':
    'Naive quoted a session budget above the hard maximum in code. The lane stays in dry run until the maximum is reviewed.',
  tampered:
    'A GTM agent stored on Naive does not match this repo. Every lane is dry run until company:sync restores it.',
  'unknown-send':
    'An X post or an email may or may not have gone out: its answer was lost. Check the provider by hand; the executor never retries it.',
  'rotate-key':
    'The executor key is 25 days old. Mint a new gtm-executor key and revoke the old one.',
  'ledger-mismatch':
    "The store's spend and the Naive ledger differ this week. Compare them before raising any cap.",
  lockdown:
    'company:verify --lockdown fails: an agent that reads untrusted sites is offered board tools. Films stay in dry run until it passes.',
  reply: 'A reply needs a person. The draft is in the review file.',
};

export const founderTitle = (need: FounderNeed) => `FOUNDER: gtm ${need}`;
export const founderKey = (need: FounderNeed, scope: string) => `gtm-founder:${need}:${scope}`;
export const founderBody = (need: FounderNeed) =>
  `${FOUNDER_STEPS[need]}\nWritten by the GTM executor. It moves this card to done when the need is met.`;

/**
 * What a stored GTM agent differs from its definition in: model, prompt, the tools it may use, its
 * board tools, and its budget. Any difference means someone changed it outside this repo.
 */
export function definitionDrift(
  stored: Record<string, unknown>,
  definition: AgentDefinition,
): string[] {
  const drift: string[] = [];
  if (stored.model !== definition.model) drift.push('model');
  if (stored.system !== definition.system) drift.push('system');
  const tools = stored.tools as AgentDefinition['tools'] | undefined;
  if (!tools?.configs) drift.push('tools');
  else {
    if (allowedTools(tools).join(',') !== allowedTools(definition.tools).join(','))
      drift.push('tools');
    if (boardOffered(tools.configs, 'board_read') || boardOffered(tools.configs, 'board_write'))
      drift.push('board');
  }
  const budget = stored.budget as
    | { cap_micro_usd?: number; max_task_micro_usd?: number }
    | undefined;
  if (
    budget?.cap_micro_usd !== definition.budget?.cap_micro_usd ||
    budget?.max_task_micro_usd !== definition.budget?.max_task_micro_usd
  ) {
    drift.push('budget');
  }
  return drift;
}
