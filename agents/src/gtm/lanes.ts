import { cap } from './caps.ts';
import { EMAIL_FORCED_DRY_RUN } from './config.ts';
import { templatesHash } from './copy.ts';
import type { EmailSender, FilmOrder, SocialPoster } from './ports.ts';
import type { StoreData, XLane } from './store.ts';

/**
 * Which lanes are live right now. A lane is live only when its flag says so **and** every
 * precondition passes at run time; each failed precondition is named. So flipping a flag can never
 * send anything on its own, and a lane whose check fails is dry run, with the reason in the report.
 */

export type FilmState = 'live' | 'dry_run' | 'off';
export type XState = 'standalone' | 'pack' | 'dry_run' | 'off';
export type EmailState = 'live' | 'dry_run' | 'off';

export interface LaneState {
  film: FilmState;
  x: XState;
  email: EmailState;
  reply: 'off';
  /** Films that may be ordered today. One, the canary, while no outreach lane is live. */
  filmCap: number;
  /** Why each lane is not live. */
  reasons: { film: string[]; x: string[]; email: string[]; reply: string[] };
}

/** The customer inbox. Cold-email replies never go there: two consumers would hide customer mail. */
export const CUSTOMER_INBOX = 'boilerroom@agentmail.to';

export interface LaneInput {
  store: StoreData;
  /** The CLI's `--dry-run`, on by default: forces every lane to dry run whatever the flags say. */
  forcedDryRun: boolean;
  /**
   * The date the run is for, when it is not today on the Pacific clock. Every cap is counted per
   * real day, so a run for another date is a replay, and a replay is dry run.
   */
  replay: string | null;
  /**
   * The day card is on the company board (`--board`), where people see each draft and can comment
   * HOLD. A local board file is seen by no one before execute, so nothing goes live with it.
   */
  boardLive: boolean;
  /** `GTM_ACTIVE` in the definitions: the agents have their budgets. */
  gtmActive: boolean;
  /** `company:halt` stopped br-ceo. Null when it could not be read: that also stops. */
  ceoHalted: boolean | null;
  /** Open `GTM-HOLD:` cards and a day-level `HOLD`. */
  held: boolean;
  /** Zero agents over-exposed on the company board. Null when it could not be checked. */
  lockdownOk: boolean | null;
  /** The four GTM agents as stored match this repo. */
  untampered: boolean | null;
  film: FilmOrder;
  social: SocialPoster;
  socialReady: boolean;
  sender: EmailSender;
  /** The mailbox the inbox phase reads for reply opt-outs, if one is wired. */
  replyInbox: { account: string } | null;
  /**
   * `EMAIL_FORCED_DRY_RUN`, the founder's no-email ruling, unless a test of the email lane's own
   * machinery passes false. The CLI never passes it, and no store flag reaches it.
   */
  emailForcedDryRun?: boolean;
}

export function resolveLanes(input: LaneInput): LaneState {
  const { store } = input;
  const flags = store.flags;
  const base: string[] = [];
  if (input.forcedDryRun) base.push('the run is a dry run (--dry-run)');
  if (input.replay) base.push(`the run is for ${input.replay}, not today: a replay is dry run`);
  if (!input.boardLive)
    base.push('the day card is a local file: nobody sees the drafts or can comment HOLD (--board)');
  if (flags.mode !== 'live') base.push(`mode is ${flags.mode}`);
  if (!input.gtmActive) base.push('GTM is not activated (GTM_ACTIVE is false; agents are at $0)');
  if (input.ceoHalted !== false)
    base.push(input.ceoHalted ? 'company:halt is set' : 'the halt marker could not be read');
  if (input.held) base.push('a HOLD is open');
  if (input.untampered !== true)
    base.push('the GTM agents do not match this repo, or could not be checked');
  if (store.suppression.length < flags.suppression_high_water) {
    base.push(
      `the store holds ${store.suppression.length} suppression rows, fewer than the ${flags.suppression_high_water} it once held`,
    );
  }

  const film: string[] = [...base];
  if (flags.film_lane !== 'live') film.push(`film_lane is ${flags.film_lane}`);
  if (input.film.kind !== 'app') film.push('no app film pipeline is configured');
  if (input.lockdownOk !== true) {
    film.push(
      'company:verify --lockdown does not pass: an agent is offered a board tool its definition does not give it, so an agent that reads untrusted sites could write company cards',
    );
  }
  if (!flags.rulings.film_canary_cost_reported)
    film.push('the canary film has not reported a non-null cost');
  const filmLive = film.length === 0;

  const x: string[] = [...base];
  const xFlag: XLane = flags.x_lane;
  if (!filmLive) x.push('the film lane is not live');
  if (xFlag === 'off') x.push('x_lane is off');
  else if (xFlag === 'dry_run') x.push('x_lane is dry_run');
  else if (xFlag === 'consent')
    x.push('consent mode needs the film page consent button (web job), not built');
  // In pack mode the founder posts by hand from the FOUNDER: gtm pack card, reading each caption
  // first, so nothing about posting by code applies: no Naive social account, no approved template
  // hash, no bundle.social tier, no canary post. Only the film lane and the base checks above.
  if (xFlag !== 'pack') {
    if (input.social.kind !== 'naive' || !input.socialReady)
      x.push('no X account is connected through Naive social');
    if (!flags.rulings.x_policy_accepted)
      x.push("the founder has not accepted posting other companies' films");
    if (!flags.rulings.x_bio_set) x.push('the X bio is not set');
    if (flags.rulings.x_templates_approved !== templatesHash())
      x.push('the caption templates are not the approved set');
    if (!flags.rulings.bundle_tier_known) x.push('the bundle.social tier is not known');
    if (!flags.rulings.x_canary_done) x.push('the canary post has not been made and deleted');
  }
  const xState: XState =
    xFlag === 'off'
      ? 'off'
      : x.length === 0
        ? xFlag === 'pack'
          ? 'pack'
          : 'standalone'
        : 'dry_run';

  const email: string[] = [...base];
  if (input.emailForcedDryRun ?? EMAIL_FORCED_DRY_RUN)
    email.push(
      "email is dry run in code for the hackathon (EMAIL_FORCED_DRY_RUN), whatever the store's flags say",
    );
  if (!filmLive) email.push('the film lane is not live');
  if (flags.email_lane !== 'live') email.push(`email_lane is ${flags.email_lane}`);
  if (input.sender.kind === 'dry-run') email.push('no cold sender is chosen');
  if (input.sender.kind === 'agentmail')
    email.push('AgentMail forbids cold outreach; it cannot be the cold sender');
  if (!input.sender.capabilities.bounceEvents) email.push('the sender reports no bounces');
  if (input.sender.replyTo.toLowerCase().includes(CUSTOMER_INBOX))
    email.push('Reply-To is the customer inbox');
  if (!input.replyInbox || input.replyInbox.account !== input.sender.account) {
    email.push("no reply opt-out mailbox on the sender's own account is read");
  }
  if (!flags.postal_address?.trim()) email.push('the footer has no postal address');
  if (!flags.app_base) email.push('the app has no GTM routes yet (film pages, /u, /remove)');
  if (!flags.rulings.optout_routes_verified)
    email.push('the opt-out token round trip is not verified');
  if (!flags.rulings.email_jurisdiction_accepted)
    email.push('the founder has not accepted the jurisdiction rule');
  if (!flags.rulings.email_canary_done) email.push('the canary email has not been sent');
  // A RESUME email newer than the pause clears the flag (day.ts), so a set flag always stops.
  if (flags.email_paused) email.push(`the email lane is paused: ${flags.email_paused.reason}`);
  const emailState: EmailState =
    flags.email_lane === 'off' ? 'off' : email.length === 0 ? 'live' : 'dry_run';

  const outreachLive = xState === 'standalone' || emailState === 'live';
  const filmCap =
    filmLive && !outreachLive ? cap(store, 'films_day_canary') : cap(store, 'films_day');
  return {
    film: flags.film_lane === 'off' ? 'off' : filmLive ? 'live' : 'dry_run',
    x: xState,
    email: emailState,
    reply: 'off',
    filmCap,
    reasons: { film, x, email, reply: ['the reply lane is not built yet (S6)'] },
  };
}
