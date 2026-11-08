import { GTM_LEAD, SCOUT, SOCIAL_AGENT } from '../definitions/company/common.ts';
import { GTM } from '../definitions/company/index.ts';
import { findAction, runAction, skipAction } from './actions.ts';
import { applySenderEvents } from './bounces.ts';
import { newNonce, pickBrief, repairBrief, scoutBrief, socialBrief } from './brief.ts';
import { canRunData, canSpend, cap, recordSpend, sessionBudget, settleSpend } from './caps.ts';
import {
  commentHead,
  dayBody,
  dayKey,
  dayTitle,
  definitionDrift,
  founderBody,
  founderKey,
  founderTitle,
  handRemovalBody,
  type PackPost,
  packBody,
  packKey,
  packReview,
  packTitle,
} from './cards.ts';
import {
  AT_MOST_ONCE,
  BOT_USER_AGENT,
  DISCOVERY,
  EMAIL_FORCED_DRY_RUN,
  type FounderNeed,
  type GtmAgentName,
  HOLD_WINDOW_MINUTES,
  KEY_ROTATION_DAY,
  MAX_EMAIL_PICKS,
  type PhaseName,
  PRICES,
  SCOUT_BATCH,
  SCOUT_SESSIONS,
} from './config.ts';
import {
  composeEmail,
  emailProblems,
  freshTemplates,
  sourcePhrase,
  type VerifiedQuote,
} from './copy.ts';
import {
  checkPick,
  checkScout,
  checkSocial,
  chosenAddress,
  emailBlocker,
  quotesOf,
  xBlocker,
} from './decide.ts';
import { type DiscoverResult, discover } from './discover.ts';
import { emailDomain, optOutToken, stableId } from './domain.ts';
import { brandFlags, finderAddresses, isRoleAddressOn } from './extract.ts';
import { type LaneState, resolveLanes } from './lanes.ts';
import { DryRunFilmOrder, type FilmFile, type FilmOrder, LocalBoard } from './ports.ts';
import {
  type Holds,
  planRemoval,
  type RemovalPlan,
  type RemovalRequest,
  readCommands,
  readPackPosts,
} from './removal.ts';
import { dayMetrics, reportText } from './report.ts';
import { jsonSchema, pickOutputSchema, scoutOutputSchema, socialOutputSchema } from './schemas.ts';
import type { SiteRead } from './site.ts';
import { dataRunNote, type GuardedDataRun } from './sources.ts';
import {
  type ActionKind,
  handPosted,
  type LeadRow,
  phaseOf,
  recordPhase,
  type StoreData,
  setFlag,
} from './store.ts';
import { contactedWithin, pruneLeads, recordContact, suppressedBy } from './suppression.ts';
import { type Clock, daysSince, pacific } from './time.ts';
import type { Ports } from './wiring.ts';

/**
 * One GTM day as a sequence of phases: open, removals, discover, qualify, pick, order, films,
 * compose, execute, report. `runDay` runs them in order from a terminal (`pnpm gtm:day`); the
 * hosted executor will run each one when its time comes. Every phase is recorded per date, so a
 * second run of the same day does nothing twice. Removals run first and in every mode.
 */

export interface DayOptions {
  store: StoreData;
  ports: Ports;
  clock: Clock;
  /** A Pacific date to run, default today. */
  date?: string;
  forcedDryRun: boolean;
  gtmActive: boolean;
  save: () => void | Promise<void>;
  /** Writes one file into the day's folder. */
  writeFile: (name: string, content: string) => void;
  log: (line: string) => void;
  /** How long to wait for real films. Dry-run films need three reads and no wait. */
  filmWaitMs?: number;
  filmPollMs?: number;
  sessionWaitMs?: number;
  /** Waits, for the films' polls and the hold window. Tests pass one that moves their clock. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Only for tests of the email lane's own machinery: false lifts `EMAIL_FORCED_DRY_RUN`. The CLI
   * never passes it, so the founder's no-email ruling holds on every real run.
   */
  emailForcedDryRun?: boolean;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface DayResult {
  date: string;
  lanes: LaneState;
  report: string;
  review: string;
  needs: FounderNeed[];
  phases: { phase: PhaseName; status: string; detail: string }[];
}

interface Picked {
  x: string | null;
  emails: { lead_id: string; subject: string; opener: string }[];
  caption: { caption: string; variable: string; template_id: string } | null;
}

interface FilmState {
  orderId: string;
  port: FilmOrder;
  ready: boolean;
  usable: boolean;
  pageUrl: string | null;
  shareId: string | null;
  file: FilmFile | null;
  scriptFlags: string[];
}

interface Draft {
  lead_id: string;
  lane: 'x' | 'email';
  text: string;
  subject?: string;
  to?: string;
  headers?: Record<string, string>;
  /** For an X draft: what a person needs to quote-post the launch post by hand (`pack` mode). */
  pack?: { launchPost: string; filmPage: string | null };
  problems: string[];
  usable: boolean;
}

/** What one removal attempt took down, and what is still up. */
interface TakeDown {
  deleted: number;
  withdrawn: number;
  /** Each post or film still up, with why. Empty when the request is done. */
  waiting: string[];
}

/**
 * What a refused session start means when the agent's stored budget is $0: the stored GTM agents
 * predate `GTM_ACTIVE`, because `company:sync` has not run since.
 */
export function unsyncedHint(message: string): string {
  return /budget cap \(0 micro-USD\)/i.test(message)
    ? '. The agent stored on Naive has a $0 budget: company:sync has not run since GTM_ACTIVE.'
    : '';
}

/** A ledger outcome as a board comment's state. */
function outcomeState(state: string, pack: boolean, done = 'live'): string {
  if (state === 'done') return done;
  if (state === 'pending' || state === 'unknown') return 'unknown';
  if (state === 'failed') return 'failed';
  return pack ? 'pack' : 'dry run';
}

class Day {
  readonly o: DayOptions;
  readonly store: StoreData;
  readonly ports: Ports;
  /** The day the run is for: its phases, leads and action keys. */
  readonly date: string;
  /** Today on the Pacific clock. Every cap and every spend row is counted on it, never on `date`. */
  readonly today: string;
  /** `date`, when it is not today: the run is a replay, and every lane is dry run. */
  readonly replay: string | null;
  lanes: LaneState;
  dayCard: string | null = null;
  readonly ownComments = new Set<string>();
  readonly needs = new Set<FounderNeed>();
  readonly phases: DayResult['phases'] = [];
  readonly review: string[] = [];
  readonly reads = new Map<string, SiteRead>();
  discovery: DiscoverResult | null = null;
  picked: Picked = { x: null, emails: [], caption: null };
  readonly films = new Map<string, FilmState>();
  readonly drafts: Draft[] = [];
  holds: Holds = { day: false, leads: new Set(), resumeEmailAt: null, removals: [], posted: [] };
  ceoHalted: boolean | null = null;
  lockdownOk: boolean | null = null;
  untampered: boolean | null = null;
  holdCards: string[] = [];
  socialReady = false;
  /** Why an agent's session did not start, by agent, for the review and the phase's detail. */
  readonly notStarted = new Map<GtmAgentName, string>();

  constructor(options: DayOptions) {
    this.o = options;
    this.store = options.store;
    this.ports = options.ports;
    this.today = pacific(options.clock.now()).date;
    this.date = options.date ?? this.today;
    this.replay = this.date === this.today ? null : this.date;
    this.lanes = this.resolve();
  }

  now = () => this.o.clock.now();
  iso = () => this.o.clock.now().toISOString();
  save = async () => {
    await this.o.save();
  };
  log = (line: string) => this.o.log(line);

  resolve(): LaneState {
    return resolveLanes({
      store: this.store,
      forcedDryRun: this.o.forcedDryRun,
      replay: this.replay,
      boardLive: this.ports.board.kind === 'naive',
      gtmActive: this.o.gtmActive,
      ceoHalted: this.ceoHalted,
      held: this.holds.day || this.holdCards.length > 0,
      lockdownOk: this.lockdownOk,
      untampered: this.untampered,
      film: this.ports.film,
      social: this.ports.social,
      socialReady: this.socialReady,
      sender: this.ports.sender,
      replyInbox: this.ports.replyInbox,
      ...(this.o.emailForcedDryRun === undefined
        ? {}
        : { emailForcedDryRun: this.o.emailForcedDryRun }),
    });
  }

  /**
   * How an X pick would reach X today: posted by code in `standalone`, otherwise by the founder's
   * hand from the pack, where a launch post to quote is welcome but not needed.
   */
  xHow(): 'post' | 'pack' {
    return this.lanes.x === 'standalone' ? 'post' : 'pack';
  }

  /**
   * Every waiting pack, read again on each run. A post counts as POSTED only once the founder's own
   * `POSTED <lead id> <url>` comment for it is on the pack card (`readPackPosts`, through
   * `commandAllowed` with `founder_user_id`); its startup then counts as posted for good (one X post
   * per domain, ever). Who moved the card is not on the card, so its status is only a hint: once it
   * is done the pack is `done`, and every post without such a comment stays NOT POSTED. The
   * executor never writes a command on a pack card: each of its comments starts `commentHead`, which
   * no command parses as, so one it wrote in an earlier run cannot count either.
   */
  async settlePacks() {
    const founderId = this.store.flags.founder_user_id;
    for (const pack of this.store.packs) {
      if (pack.status !== 'waiting') continue;
      // Listing the card first also lets the guard read the comments of a card an earlier run made.
      const status = await this.ports.board.cardStatus(pack.card_id).catch(() => null);
      const comments = await this.ports.board.comments(pack.card_id).catch(() => null);
      if (!comments) continue;
      pack.checked_at = this.iso();
      const posted = readPackPosts(comments, founderId, this.ownComments);
      const counted: string[] = [];
      for (const entry of pack.entries) {
        const url = posted.get(entry.lead_id);
        if (!url || handPosted(entry)) continue;
        entry.posted_at = this.iso();
        entry.posted_url = url;
        recordContact(this.store, {
          domain: entry.domain,
          channel: 'x_post',
          at: this.iso(),
          lead_id: entry.lead_id,
        });
        counted.push(entry.lead_id);
      }
      if (counted.length) {
        await this.comment('PACK', pack.date, 'posted', [
          `The founder posted ${counted.join(', ')} from ${packTitle(pack.date)} by hand.`,
        ]);
      }
      if (status !== 'done') continue;
      pack.status = 'done';
      pack.done_at = this.iso();
      const made = pack.entries.filter(handPosted).length;
      await this.comment('PACK', pack.date, 'done', [
        `${packTitle(pack.date)} is done: ${made} POSTED, ${pack.entries.length - made} NOT POSTED. Only a POSTED <lead id> <url> comment of the founder's counts a post.${founderId ? '' : ' founder_user_id is not set, so no comment could count.'}`,
      ]);
    }
    await this.save();
  }

  /**
   * Re-reads the day card's commands. A founder's `RESUME email` lifts only a pause that began
   * before it, and lifting it clears the flag, so the lane stays resumed on later days.
   */
  async readHolds() {
    if (!this.dayCard) return;
    const comments = await this.ports.board.comments(this.dayCard).catch(() => []);
    this.holds = readCommands(comments, this.store.flags.founder_user_id, this.ownComments);
    const paused = this.store.flags.email_paused;
    const resumed = this.holds.resumeEmailAt;
    if (paused && resumed && Date.parse(resumed) > Date.parse(paused.at)) {
      setFlag(this.store, 'email_paused', null, 'founder: RESUME email', this.iso());
    }
  }

  async comment(type: string, id: string, state: string, lines: string[] = []) {
    if (!this.dayCard) return;
    try {
      const comment = await this.ports.board.comment(
        this.dayCard,
        [commentHead(type, id, state), ...lines].join('\n'),
      );
      this.ownComments.add(comment.id);
    } catch (error) {
      this.log(
        `board     comment failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async founder(need: FounderNeed, scope = 'open') {
    this.needs.add(need);
    try {
      await this.ports.board.ensureCard({
        title: founderTitle(need),
        body: founderBody(need),
        status: 'blocked',
        key: founderKey(need, scope),
      });
    } catch (error) {
      this.log(
        `board     FOUNDER card failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async phase(
    name: PhaseName,
    run: () => Promise<{
      status: 'done' | 'skipped' | 'failed';
      detail: string;
      sessions?: string[];
    }>,
  ) {
    const before = phaseOf(this.store, this.date, name);
    if (before && name !== 'removals') {
      this.phases.push({ phase: name, status: `already ${before.status}`, detail: before.detail });
      return;
    }
    const started = this.iso();
    let result: { status: 'done' | 'skipped' | 'failed'; detail: string; sessions?: string[] };
    try {
      result = await run();
    } catch (error) {
      result = {
        status: 'failed',
        detail: error instanceof Error ? error.message.slice(0, 300) : String(error),
      };
    }
    if (name !== 'removals') {
      recordPhase(this.store, {
        date: this.date,
        phase: name,
        status: result.status,
        detail: result.detail,
        session_ids: result.sessions ?? [],
        started_at: started,
        finished_at: this.iso(),
      });
    }
    await this.save();
    this.phases.push({ phase: name, status: result.status, detail: result.detail });
    this.log(`${name.padEnd(9)} ${result.status}: ${result.detail}`);
  }

  // -------------------------------------------------------------------------------------------

  /**
   * Runs on every tick, before any phase: the halt marker, the lockdown check, the tamper check,
   * holds, and the day card (its create is keyed, so a second tick finds the same card).
   */
  async prepare() {
    const naive = this.ports.naive;
    if (naive) {
      this.ceoHalted = await naive.ceoHalted().catch(() => null);
      this.lockdownOk = await naive
        .lockdownExposure()
        .then((exposure) => exposure.length === 0)
        .catch(() => null);
      const drift: string[] = [];
      for (const definition of GTM) {
        try {
          const stored = await naive.storedAgent(definition.name as GtmAgentName);
          const differs = definitionDrift(stored, definition);
          if (differs.length) drift.push(`${definition.name}: ${differs.join(', ')}`);
        } catch {
          drift.push(`${definition.name}: unreadable`);
        }
      }
      this.untampered = drift.length === 0;
      if (drift.length)
        this.review.push(`## Tamper check\n\n${drift.map((line) => `- ${line}`).join('\n')}\n`);
      this.socialReady = (await this.ports.social.ready().catch(() => ({ ok: false }))).ok;
      this.holdCards = await this.ports.board.holdCards().catch(() => []);
    }
    this.lanes = this.resolve();
    const card = await this.ports.board.ensureCard({
      title: dayTitle(this.date),
      body: dayBody(this.store, this.date, this.lanes),
      status: 'todo',
      key: dayKey(this.date),
    });
    this.dayCard = card.id;
    await this.settlePacks();
  }

  /** Once a day: what a person must do, each as one `FOUNDER: gtm <need>` card. */
  async open() {
    const naive = this.ports.naive;
    if (!naive) await this.founder('executor-key');
    if (naive && this.untampered === false) await this.founder('tampered', this.date);
    if (naive && this.lockdownOk === false) await this.founder('lockdown');
    // Email is dry run in code for the hackathon: asking for its address and sender is noise.
    if (!(this.o.emailForcedDryRun ?? EMAIL_FORCED_DRY_RUN)) {
      if (!this.store.flags.postal_address) await this.founder('postal-address');
      if (this.ports.sender.kind === 'dry-run') await this.founder('cold-sender');
    }
    const minted = this.store.flags.executor_key_minted_at;
    if (minted && daysSince(minted, this.now()) >= KEY_ROTATION_DAY)
      await this.founder('rotate-key', minted.slice(0, 10));
    return {
      status: 'done' as const,
      detail: `day card ${this.dayCard}; films ${this.lanes.film}, x ${this.lanes.x}, email ${this.lanes.email}`,
    };
  }

  /**
   * Every post or email whose answer was lost, from any day: a `planned` at-most-once row. Each
   * tick looks it up at the provider; after two ticks without a provider id it becomes `unknown`
   * and `FOUNDER: gtm unknown-send` opens. Never retried. Adds no rows.
   */
  async reconcilePending() {
    const planned = this.store.actions.filter(
      (row) => row.status === 'planned' && (AT_MOST_ONCE as readonly string[]).includes(row.kind),
    );
    for (const row of planned) {
      const outcome = await runAction(
        this.store,
        {
          key: row.key,
          kind: row.kind,
          lead_id: row.lead_id,
          detail: row.detail,
          dryRun: false,
          call: async () => {
            throw new Error('a planned post or email is never called again');
          },
          ...(row.kind === 'x-post' ? { reconcile: () => this.ports.social.find(row.key) } : {}),
        },
        this.save,
        this.iso,
      );
      if (outcome.state === 'unknown') {
        await this.founder('unknown-send', row.key);
        await this.comment(
          row.kind === 'x-post' ? 'POST' : 'EMAIL',
          row.lead_id ?? '-',
          'unknown',
          [
            `The call for ${row.key} errored and no provider id turned up in ${outcome.row.planned_ticks} runs. It may have gone out; it is never retried.`,
          ],
        );
      }
    }
  }

  /**
   * Opt-outs and removals from the app and the board. Runs in every mode, under halt and hold.
   * Each request is queued in the store before the app cursor moves on or the board comment is
   * marked received, then every queued request is applied. One that cannot take everything down
   * (a delete fails, or the run has only dry-run ports) stays queued and is retried on every run.
   */
  async removals() {
    const queue = (request: RemovalRequest & { key: string }) => {
      if (this.store.pending_removals.some((item) => item.key === request.key)) return;
      this.store.pending_removals.push({
        key: request.key,
        request,
        received_at: this.iso(),
        attempts: 0,
        last_error: null,
      });
    };
    try {
      const pulled = await this.ports.app.requests(this.store.flags.cursors.requests);
      for (const item of pulled.requests) {
        const token = item.token_hash
          ? this.store.optout_tokens.find((row) => row.hash === item.token_hash)
          : undefined;
        const lead = token ? this.store.leads.find((row) => row.id === token.lead_id) : undefined;
        queue({
          kind: item.kind,
          channel: item.channel,
          domain: token?.domain ?? item.domain,
          email: lead ? (chosenAddress(lead)?.address ?? null) : null,
          share_id: item.share_id,
          lead_id: lead?.id ?? null,
          at: item.at,
          key: `app:${item.id}`,
        });
      }
      this.store.flags.cursors.requests = pulled.cursor;
    } catch (error) {
      this.log(
        `removals  app requests unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await this.readHolds();
    for (const removal of this.holds.removals) {
      const key = `removal:${removal.comment_id}`;
      if (findAction(this.store, key)) continue;
      queue({
        kind: 'removal',
        channel: 'board',
        domain: null,
        email: null,
        share_id: null,
        lead_id: removal.lead_id,
        at: this.iso(),
        comment_id: removal.comment_id,
        key,
      });
      skipAction(this.store, {
        key,
        kind: 'comment',
        lead_id: removal.lead_id,
        reason: 'removal received',
        at: this.iso(),
      });
    }
    if (this.ports.sender.capabilities.bounceEvents) {
      try {
        const events = await this.ports.sender.events(this.store.flags.cursors.sender_events);
        const applied = applySenderEvents(this.store, events.events, this.now());
        this.store.flags.cursors.sender_events = events.cursor;
        if (applied.paused) await this.founder('email-paused', this.date);
      } catch (error) {
        this.log(
          `removals  sender events unreadable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    await this.save();
    let done = 0;
    let unmatched = 0;
    for (const pending of [...this.store.pending_removals]) {
      const plan = planRemoval(this.store, pending.request);
      if (plan.unmatched) unmatched += 1;
      const result = await this.takeDown(plan);
      pending.attempts += 1;
      if (result.waiting.length) {
        pending.last_error = result.waiting.join('; ').slice(0, 300);
        await this.founder('removal', stableId('rq', pending.key));
        continue;
      }
      done += 1;
      this.store.pending_removals = this.store.pending_removals.filter(
        (item) => item.key !== pending.key,
      );
      const received = findAction(this.store, pending.key);
      if (received) received.detail = 'removal applied';
    }
    await this.save();
    const left = this.store.pending_removals.length;
    return {
      status: 'done' as const,
      detail: `${done} request(s) applied, ${unmatched} for domains GTM never touched, ${left} still taking down`,
    };
  }

  /**
   * Takes one plan's live assets down. Counts only what really came down: a post is down when the
   * provider deleted it, a film when the app withdrew it. A dry-run port deletes nothing, so with
   * one the asset is still up and the request waits for a run with live ports.
   */
  async takeDown(plan: RemovalPlan): Promise<TakeDown> {
    // A second lock behind our own list: the provider refuses later sends to these addresses.
    if (this.ports.blockList) {
      const addresses = new Set(
        [
          plan.request.email,
          ...plan.leads.flatMap((lead) => lead.addresses.map((item) => item.address)),
        ].filter((item): item is string => Boolean(item)),
      );
      for (const address of addresses) {
        await this.ports.blockList(address, plan.request.kind).catch((error: unknown) => {
          this.log(
            `removals  block list failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    }
    const result: TakeDown = { deleted: 0, withdrawn: 0, waiting: [] };
    if (plan.unmatched) {
      this.store.unmatched_removals[this.today] =
        (this.store.unmatched_removals[this.today] ?? 0) + 1;
      return result;
    }
    const lead = plan.leads[0]?.id ?? null;
    for (const post of plan.posts) {
      if (this.ports.social.kind !== 'naive') {
        result.waiting.push(`post ${post.provider_id}: no live X port in this run`);
        continue;
      }
      try {
        await this.ports.social.remove(post.provider_id);
        skipAction(this.store, {
          key: `x-delete:${post.provider_id}`,
          kind: 'x-delete',
          lead_id: lead,
          reason: 'deleted on removal',
          at: this.iso(),
        });
        result.deleted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.waiting.push(`post ${post.provider_id}: ${message.slice(0, 120)}`);
        this.log(`removals  post delete failed: ${message}`);
      }
    }
    for (const film of plan.films) {
      if (this.ports.film.kind !== 'app') {
        result.waiting.push(`film ${film.provider_id}: no live film port in this run`);
        continue;
      }
      try {
        await this.ports.film.withdraw(
          film.provider_id,
          plan.request.kind === 'removal' ? 'removal' : 'opt_out',
        );
        skipAction(this.store, {
          key: `film-withdraw:${film.provider_id}`,
          kind: 'film-withdraw',
          lead_id: lead,
          reason: 'withdrawn on removal',
          at: this.iso(),
        });
        result.withdrawn += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.waiting.push(`film ${film.provider_id}: ${message.slice(0, 120)}`);
        this.log(`removals  film withdraw failed: ${message}`);
      }
    }
    // A pack post is the founder's own: only the founder can delete it, or not make it.
    if (plan.hand.length && !(await this.handRemoval(plan)))
      result.waiting.push(
        `hand posts of ${plan.hand.map((entry) => entry.lead_id).join(', ')}: the founder's card could not be written`,
      );
    for (const item of plan.leads) {
      this.picked.emails = this.picked.emails.filter((pick) => pick.lead_id !== item.id);
      if (this.picked.x === item.id) this.picked.x = null;
    }
    const complete = result.waiting.length === 0;
    const liveDown = result.deleted + result.withdrawn;
    // A removal that took a live asset down is a card, moved to done only once nothing is left up.
    if (complete && liveDown > 0 && plan.domain) {
      const summary = `Removal ${plan.id} by ${plan.request.channel}: ${result.deleted} X post(s) deleted, ${result.withdrawn} film(s) withdrawn, ${plan.suppressed} suppression row(s). Written by the GTM executor.`;
      try {
        // A card reaches done only with a note, so it is created todo and moved to done with one.
        const card = await this.ports.board.ensureCard({
          title: `REMOVE: ${plan.id}`,
          body: summary,
          status: 'todo',
          key: `gtm-remove:${plan.domain}:${this.date}`,
        });
        await this.ports.board.move(card.id, 'done', summary);
        this.log(`removals  REMOVE: ${plan.id}`);
      } catch (error) {
        this.log(
          `removals  REMOVE card failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    await this.comment('REMOVAL', plan.id, complete ? 'done' : 'pending', [
      `${plan.request.kind === 'removal' ? 'Removal' : 'Opt-out'} by ${plan.request.channel} for ${plan.domain ?? 'an address'}: ${plan.suppressed} suppression row(s), ${result.deleted} of ${plan.posts.length} post(s) deleted, ${result.withdrawn} of ${plan.films.length} film(s) withdrawn.`,
      ...(plan.hand.length
        ? [
            `Pack posts for the founder to delete or never make: ${plan.hand.map((entry) => `${entry.lead_id} (${packTitle(entry.pack_date)}${entry.posted ? ', POSTED' : ''})`).join(', ')}. See ${founderTitle('hand-removal')}.`,
          ]
        : []),
      ...(complete
        ? []
        : [
            `Still up: ${result.waiting.join('; ')}. Retried on every run; FOUNDER: gtm removal is open.`,
          ]),
    ]);
    return result;
  }

  /**
   * A removal that reached a startup in a pack. The executor cannot delete a post the founder made
   * by hand, so it writes one `FOUNDER: gtm hand-removal` card naming each lead (posted or not), and
   * tells each waiting pack's card never to post it. Each entry is marked so a later run does not
   * raise it again. False when the founder's card could not be written: the removal then waits.
   */
  async handRemoval(plan: RemovalPlan): Promise<boolean> {
    this.needs.add('hand-removal');
    try {
      await this.ports.board.ensureCard({
        title: founderTitle('hand-removal'),
        body: handRemovalBody(plan.hand),
        status: 'blocked',
        key: founderKey('hand-removal', stableId('rq', plan.request.key ?? plan.id)),
      });
    } catch (error) {
      this.log(
        `removals  hand-removal card failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
    for (const item of plan.hand) {
      const pack = this.store.packs.find((row) => row.date === item.pack_date);
      const entry = pack?.entries.find((row) => row.lead_id === item.lead_id);
      if (!pack || !entry) continue;
      entry.removed_at = this.iso();
      if (pack.status !== 'waiting') continue;
      try {
        const comment = await this.ports.board.comment(
          pack.card_id,
          [
            commentHead('REMOVAL', entry.lead_id, 'do not post'),
            `A removal request came in for ${entry.lead_id}: never post it, and if you already did, delete that post. Its film page is withdrawn. See ${founderTitle('hand-removal')}.`,
          ].join('\n'),
        );
        this.ownComments.add(comment.id);
      } catch (error) {
        this.log(
          `removals  pack card comment failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    await this.save();
    return true;
  }

  // -------------------------------------------------------------------------------------------

  dataRun: GuardedDataRun = async (tool, input, price) => {
    if (!this.ports.data) return { ok: false, reason: 'refused', detail: 'no data runs are wired' };
    const check = canRunData(this.store, this.today, price);
    if (!check.ok) return { ok: false, reason: 'cap', detail: check.reason ?? 'cap' };
    const key = `data-run:${tool}:${stableId('dr', JSON.stringify(input))}:${this.date}`;
    let data: unknown = null;
    let cost = 0;
    const outcome = await runAction(
      this.store,
      {
        key,
        kind: 'data-run',
        lead_id: null,
        detail: tool,
        dryRun: false,
        call: async () => {
          const result = await (this.ports.data as NonNullable<Ports['data']>).run(tool, input);
          data = result.data;
          cost = result.costMicroUsd;
          return { provider_id: null, cost_micro_usd: cost };
        },
      },
      this.save,
      this.iso,
    );
    if (outcome.state === 'failed') {
      // The guard refuses a tool it could not resolve; that is not the run failing.
      return {
        ok: false,
        reason: /^refused:/.test(outcome.error) ? 'refused' : 'failed',
        detail: outcome.error,
      };
    }
    if (outcome.state !== 'done' || data === null)
      return { ok: false, reason: 'failed', detail: `the run answered no data (${outcome.state})` };
    recordSpend(this.store, { date: this.today, category: 'data', micro_usd: cost, ref: key });
    return { ok: true, data, costMicroUsd: cost };
  };

  async discover() {
    const userAgent = BOT_USER_AGENT(this.ports.appBase);
    const result = await discover({
      store: this.store,
      transport: this.ports.transport,
      userAgent,
      now: this.now(),
      date: this.date,
      dataRun: this.ports.data ? this.dataRun : null,
      log: this.log,
    });
    this.discovery = result;
    for (const candidate of result.candidates) {
      this.store.leads.push(candidate.lead);
      this.reads.set(candidate.lead.id, candidate.read);
      this.o.writeFile(
        `pages/${candidate.lead.id}.json`,
        `${JSON.stringify(candidate.read.bundle)}\n`,
      );
    }
    const sources = result.reports.map((report) => `${report.source} ${report.kept}`).join(', ');
    this.review.push(
      `## Candidates\n\n| Lead | Domain | Source | Product name | Addresses | Jurisdiction hint | Brand flags |\n| --- | --- | --- | --- | --- | --- | --- |\n${result.candidates
        .map(
          (candidate) =>
            `| ${candidate.lead.id} | ${candidate.lead.domain} | ${candidate.lead.source} ${candidate.lead.hn_points ?? ''} | ${candidate.lead.product_name ?? '-'} | ${candidate.lead.addresses.map((item) => item.address).join(', ') || '-'} | ${candidate.lead.jurisdiction_hint} | ${candidate.lead.brand_flags.join(', ') || '-'} |`,
        )
        .join('\n')}\n\nDropped before the scout: ${JSON.stringify(result.dropped)}\n`,
    );
    return {
      status: 'done' as const,
      detail: `${result.candidates.length} candidates (${sources}); dropped ${JSON.stringify(result.dropped)}`,
    };
  }

  agentsBlocked(): string | null {
    if (!this.o.gtmActive) return 'agents inactive: GTM_ACTIVE is false and every GTM budget is $0';
    if (!this.ports.agents) return 'no executor key: no agent session can start';
    return null;
  }

  async session(
    agent: GtmAgentName,
    message: string,
    schema: Record<string, unknown>,
    purpose: string,
  ) {
    const runner = this.ports.agents;
    if (!runner) return null;
    const { budget } = sessionBudget(agent);
    const check = canSpend(this.store, this.today, budget);
    if (!check.ok) {
      this.notStarted.set(agent, `${agent} skipped: ${check.reason}`);
      this.log(`${purpose.padEnd(9)} ${agent} skipped: ${check.reason}`);
      return null;
    }
    let id: string;
    try {
      id = await runner.start({
        agent,
        message,
        outputSchema: schema,
        budgetMicroUsd: budget,
        metadata: { phase: purpose, date: this.date },
      });
    } catch (error) {
      // One agent that cannot start (a $0 budget, a refused session) costs only its own step.
      const message = error instanceof Error ? error.message.slice(0, 160) : String(error);
      this.notStarted.set(agent, `${agent} could not start: ${message}${unsyncedHint(message)}`);
      this.log(`${purpose.padEnd(9)} ${this.notStarted.get(agent)}`);
      return null;
    }
    const result = await runner.wait(id, this.o.sessionWaitMs ?? 8 * 60_000);
    recordSpend(this.store, {
      date: this.today,
      category: 'agents',
      micro_usd: result.consumedMicroUsd,
      ref: id,
    });
    await this.save();
    return result;
  }

  async qualify() {
    const blocked = this.agentsBlocked();
    if (blocked) return { status: 'skipped' as const, detail: blocked };
    const candidates = this.discovery?.candidates ?? [];
    if (!candidates.length) return { status: 'skipped' as const, detail: 'no candidates' };
    const sessions: string[] = [];
    const corrections: string[] = [];
    for (let index = 0; index < SCOUT_SESSIONS; index++) {
      const batch = candidates.slice(index * SCOUT_BATCH, (index + 1) * SCOUT_BATCH);
      if (!batch.length) break;
      const nonce = newNonce();
      const brief = scoutBrief(
        this.date,
        batch.map((candidate) => ({
          candidate_id: candidate.candidate_id,
          source: candidate.lead.source,
          source_points: candidate.lead.hn_points,
          domain: candidate.lead.domain,
          product_name: candidate.lead.product_name,
          addresses: candidate.lead.addresses.map((item) => item.address ?? ''),
          jurisdiction_hint: candidate.lead.jurisdiction_hint,
          source_title: candidate.raw.title,
          read: candidate.read,
        })),
        nonce,
      );
      const result = await this.session(SCOUT, brief, jsonSchema(scoutOutputSchema), 'qualify');
      if (!result) break;
      sessions.push(result.sessionId);
      const check = checkScout(result.output, batch, result.sessionId);
      corrections.push(...check.corrections);
      if (check.error) corrections.push(`${result.sessionId}: ${check.error}`);
      for (const candidate of batch) {
        const lead = this.store.leads.find((row) => row.id === candidate.lead.id);
        const verdict = check.verdicts.get(candidate.candidate_id);
        if (lead) {
          lead.verdict = verdict ?? {
            verdict: 'rejected',
            reject_reason: 'other',
            category: 'other',
            fit: 0,
            line: null,
            email_option: null,
            jurisdiction: 'unknown',
            session_id: result.sessionId,
          };
        }
      }
    }
    if (!sessions.length) {
      // Nobody judged a candidate: say so, rather than report every one as not qualified.
      const why = this.notStarted.get(SCOUT) ?? 'br-scout did not start';
      this.review.push(
        `## Scout verdicts\n\nThe scout did not run, so no candidate was judged and none is qualified: ${why}\n`,
      );
      await this.comment('LEADS', this.date, 'not judged', [
        `${candidates.length} candidate(s) found; the scout did not run, so none was judged.`,
      ]);
      return {
        status: 'skipped' as const,
        detail: `${candidates.length} candidates not judged: ${why}`,
      };
    }
    // At most 15 qualified a day, best fit first.
    const qualified = this.todayLeads().filter((lead) => lead.verdict?.verdict === 'qualified');
    qualified.sort((a, b) => (b.verdict?.fit ?? 0) - (a.verdict?.fit ?? 0));
    for (const lead of qualified.slice(cap(this.store, 'qualified_day'))) {
      if (lead.verdict) {
        lead.verdict.verdict = 'rejected';
        lead.verdict.reject_reason = 'other';
      }
    }
    const kept = qualified.slice(0, cap(this.store, 'qualified_day'));
    const finder = await this.findAddresses(kept);
    await this.comment('LEADS', this.date, `${kept.length} qualified of ${candidates.length}`, [
      `Qualified: ${kept.map((lead) => `${lead.id} (fit ${lead.verdict?.fit}, ${lead.verdict?.jurisdiction}, email ${emailBlocker(this.store, lead, this.now()) ? 'no' : 'yes'}, x ${xBlocker(this.store, lead, this.now()) ? 'no' : 'yes'})`).join(', ') || 'none'}`,
      `Scout: br-scout ${sessions.join(', ')}`,
      `Address finder: ${finder.runs} run(s) for qualified leads, ${finder.found} with an address${finder.note ? `; ${finder.note}` : ''}.`,
    ]);
    this.review.push(
      `## Scout verdicts\n\n${this.todayLeads()
        .map(
          (lead) =>
            `- ${lead.id} ${lead.domain}: ${lead.verdict?.verdict ?? 'none'} ${lead.verdict?.reject_reason ?? ''} fit ${lead.verdict?.fit ?? '-'}; line ${lead.verdict?.line ? JSON.stringify(lead.verdict.line.quote) : 'none'}`,
        )
        .join(
          '\n',
        )}\n\nCode corrections:\n${corrections.map((line) => `- ${line}`).join('\n') || '- none'}\n\nAddress finder: ${finder.runs} run(s), ${finder.found} lead(s) given an address${finder.note ? ` (${finder.note})` : ''}.\n`,
    );
    return {
      status: 'done' as const,
      detail: `${kept.length} qualified of ${candidates.length}; finder ${finder.runs} run(s), ${finder.found} found`,
      sessions,
    };
  }

  /**
   * The paid address finder, after the scout: one `Find Domain Emails` run for each qualified lead,
   * best fit first, whose email lane is closed only by a missing address, at most
   * `finder_runs_day`. A candidate the scout rejects never costs a finder run.
   */
  async findAddresses(qualified: readonly LeadRow[]) {
    const out = { runs: 0, found: 0, note: null as string | null };
    if (!this.ports.data) return { ...out, note: 'no data runs' };
    const now = this.now();
    for (const lead of qualified) {
      if (emailBlocker(this.store, lead, now) !== 'no_address') continue;
      if (lead.source === 'hn' && (lead.hn_points ?? 0) < DISCOVERY.hn_min_points_email) continue;
      if (out.runs >= cap(this.store, 'finder_runs_day')) {
        out.note = 'finder cap reached';
        break;
      }
      const run = await this.dataRun(
        'domainEmails',
        { body: { domain: lead.domain, limit: 10, type: 'generic' } },
        PRICES.find_domain_emails,
      );
      if (!run.ok) {
        out.note = dataRunNote(run);
        if (run.reason === 'failed') continue;
        break;
      }
      out.runs += 1;
      lead.addresses = finderAddresses(run.data, lead.domain);
      if (lead.addresses.length) out.found += 1;
    }
    return out;
  }

  todayLeads(): LeadRow[] {
    return this.store.leads.filter((lead) => lead.date === this.date);
  }

  quotes(lead: LeadRow): VerifiedQuote[] {
    return quotesOf(lead, this.reads.get(lead.id) ?? null);
  }

  async pick() {
    const blocked = this.agentsBlocked();
    if (blocked) return { status: 'skipped' as const, detail: blocked };
    const now = this.now();
    const qualified = this.todayLeads().filter((lead) => lead.verdict?.verdict === 'qualified');
    if (!qualified.length) return { status: 'skipped' as const, detail: 'no qualified leads' };
    const xOpen = new Set(
      this.lanes.x === 'off'
        ? []
        : qualified
            .filter((lead) => !xBlocker(this.store, lead, now, this.xHow()))
            .map((lead) => lead.id),
    );
    const emailOpen = new Set(
      this.lanes.email === 'off'
        ? []
        : qualified.filter((lead) => !emailBlocker(this.store, lead, now)).map((lead) => lead.id),
    );
    if (!xOpen.size && !emailOpen.size)
      return { status: 'skipped' as const, detail: 'no lead is open on any lane' };
    const nonce = newNonce();
    const quotes = new Map(qualified.map((lead) => [lead.id, this.quotes(lead)]));
    const recentSubjects = this.store.copy_history
      .filter((row) => row.lane === 'email' && daysSince(`${row.date}T12:00:00Z`, now) < 14)
      .map((row) => row.variable);
    const brief = pickBrief({
      date: this.date,
      leads: qualified.map((lead) => ({
        lead_id: lead.id,
        product_name: lead.product_name ?? '',
        source: lead.source,
        category: lead.verdict?.category ?? 'other',
        fit: lead.verdict?.fit ?? 0,
        jurisdiction: lead.verdict?.jurisdiction ?? 'unknown',
        x_allowed: xOpen.has(lead.id)
          ? 'allowed'
          : `closed (${xBlocker(this.store, lead, now, this.xHow())})`,
        email_allowed: emailOpen.has(lead.id)
          ? 'allowed'
          : `closed (${emailBlocker(this.store, lead, now)})`,
        quotes: quotes.get(lead.id) ?? [],
      })),
      xLane: this.lanes.x,
      emailLane: this.lanes.email,
      xToday: cap(this.store, 'x_posts_day'),
      emailToday: Math.min(cap(this.store, 'cold_emails_day'), MAX_EMAIL_PICKS),
      recentSubjects,
      nonce,
    });
    const sessions: string[] = [];
    let result = await this.session(GTM_LEAD, brief, jsonSchema(pickOutputSchema), 'pick');
    if (!result)
      return {
        status: 'skipped' as const,
        detail: this.notStarted.get(GTM_LEAD) ?? 'the GTM lead could not start; see the log',
      };
    sessions.push(result.sessionId);
    const leads = new Map(qualified.map((lead) => [lead.id, lead]));
    const pickInput = {
      store: this.store,
      leads,
      xOpen,
      emailOpen,
      quotes,
      xCap: cap(this.store, 'x_posts_day'),
      emailCap: Math.min(cap(this.store, 'cold_emails_day'), MAX_EMAIL_PICKS),
    };
    let check = checkPick(result.output, pickInput);
    if (check.problems.length && !check.error && this.ports.agents) {
      await this.ports.agents.repair(result.sessionId, repairBrief(nonce, check.problems));
      const repaired = await this.ports.agents.wait(
        result.sessionId,
        this.o.sessionWaitMs ?? 8 * 60_000,
      );
      recordSpend(this.store, {
        date: this.today,
        category: 'agents',
        micro_usd: Math.max(0, repaired.consumedMicroUsd - result.consumedMicroUsd),
        ref: `${result.sessionId}:repair`,
      });
      result = repaired;
      check = checkPick(result.output, pickInput);
    }
    this.picked = { x: check.x, emails: check.emails, caption: null };
    if (check.problems.length)
      this.review.push(
        `## Pick: refused by code\n\n${check.problems.map((line) => `- ${line}`).join('\n')}\n`,
      );

    if (this.picked.x) {
      const lead = leads.get(this.picked.x) as LeadRow;
      const templates = freshTemplates(this.store.copy_history, now);
      const socialNonce = newNonce();
      const social = await this.session(
        SOCIAL_AGENT,
        socialBrief({
          date: this.date,
          lead: {
            lead_id: lead.id,
            product_name: lead.product_name ?? '',
            source_phrase: sourcePhrase(lead.source, lead.source_at),
          },
          quotes: quotes.get(lead.id) ?? [],
          templates,
          nonce: socialNonce,
        }),
        jsonSchema(socialOutputSchema),
        'pick',
      );
      if (social) {
        sessions.push(social.sessionId);
        const input = {
          lead,
          quotes: quotes.get(lead.id) ?? [],
          history: this.store.copy_history,
          now,
        };
        let socialCheck = checkSocial(social.output, input);
        if (!socialCheck.caption.ok && !socialCheck.error && this.ports.agents) {
          await this.ports.agents.repair(
            social.sessionId,
            repairBrief(socialNonce, socialCheck.caption.problems),
          );
          const repaired = await this.ports.agents.wait(
            social.sessionId,
            this.o.sessionWaitMs ?? 8 * 60_000,
          );
          recordSpend(this.store, {
            date: this.today,
            category: 'agents',
            micro_usd: Math.max(0, repaired.consumedMicroUsd - social.consumedMicroUsd),
            ref: `${social.sessionId}:repair`,
          });
          socialCheck = checkSocial(repaired.output, input);
        }
        if (socialCheck.caption.ok) {
          this.picked.caption = {
            caption: socialCheck.caption.caption,
            variable: socialCheck.caption.variable,
            template_id: socialCheck.caption.template_id,
          };
        } else {
          this.review.push(
            `## Caption: refused by code\n\n${socialCheck.caption.problems.map((line) => `- ${line}`).join('\n') || `- ${socialCheck.error}`}\n`,
          );
          this.picked.x = null;
        }
      } else {
        this.picked.x = null;
      }
    }
    for (const lead of qualified) {
      lead.picked = [
        ...(this.picked.x === lead.id ? (['x'] as const) : []),
        ...(this.picked.emails.some((item) => item.lead_id === lead.id)
          ? (['email'] as const)
          : []),
      ];
    }
    if (this.picked.x)
      await this.comment('PICK', this.picked.x, 'x', [
        `By br-gtm-lead ${sessions[0]}. Lane x: ${this.lanes.x}. Caption template ${this.picked.caption?.template_id}.`,
      ]);
    await this.comment('PICK', this.date, 'email', [
      `By br-gtm-lead ${sessions[0]}. Lane email: ${this.lanes.email}. Email picks: ${this.picked.emails.map((item) => item.lead_id).join(', ') || 'none'}.`,
    ]);
    return {
      status: 'done' as const,
      detail: `x ${this.picked.x ?? 'none'}, email ${this.picked.emails.length}`,
      sessions,
    };
  }

  pickedLeads(): LeadRow[] {
    const ids = [
      ...new Set([
        ...(this.picked.x ? [this.picked.x] : []),
        ...this.picked.emails.map((item) => item.lead_id),
      ]),
    ];
    return ids
      .map((id) => this.store.leads.find((lead) => lead.id === id))
      .filter((lead): lead is LeadRow => Boolean(lead));
  }

  async order() {
    const leads = this.pickedLeads();
    if (!leads.length) return { status: 'skipped' as const, detail: 'nothing picked' };
    const live = this.lanes.film === 'live';
    // A film is ordered for real only while the film lane is live. Otherwise the dry-run pipeline simulates it.
    const port: FilmOrder = live ? this.ports.film : new DryRunFilmOrder(this.ports.appBase);
    let ordered = 0;
    for (const lead of leads) {
      const key = `film:${lead.domain}:${this.date}`;
      if (ordered >= this.lanes.filmCap) {
        skipAction(this.store, {
          key,
          kind: 'film',
          lead_id: lead.id,
          reason: 'film_cap',
          at: this.iso(),
        });
        continue;
      }
      if (live && contactedWithin(this.store, lead.domain, 'film', this.now())) {
        skipAction(this.store, {
          key,
          kind: 'film',
          lead_id: lead.id,
          reason: 'filmed_90d',
          at: this.iso(),
        });
        continue;
      }
      const budget = cap(this.store, 'film_budget_micro');
      if (live) {
        const check = canSpend(this.store, this.today, budget, { keepReplyReserve: true });
        if (!check.ok) {
          skipAction(this.store, {
            key,
            kind: 'film',
            lead_id: lead.id,
            reason: check.reason ?? 'spend',
            at: this.iso(),
          });
          continue;
        }
      }
      let orderId: string | null = null;
      const outcome = await runAction(
        this.store,
        {
          key,
          kind: 'film',
          lead_id: lead.id,
          detail: `${port.kind} order`,
          dryRun: !live,
          call: async () => {
            const result = await port.order({
              url: lead.site_url,
              idempotencyKey: key,
              budgetMicroUsd: budget,
              leadRef: lead.id,
            });
            return { provider_id: result.orderId };
          },
        },
        this.save,
        this.iso,
      );
      if (!live)
        orderId = (
          await port.order({
            url: lead.site_url,
            idempotencyKey: key,
            budgetMicroUsd: budget,
            leadRef: lead.id,
          })
        ).orderId;
      else if (outcome.state === 'done') orderId = outcome.row.provider_id;
      if (!orderId) continue;
      ordered += 1;
      if (live) {
        recordSpend(this.store, {
          date: this.today,
          category: 'films',
          micro_usd: budget,
          ref: key,
          reserved: true,
        });
        recordContact(this.store, {
          domain: lead.domain,
          channel: 'film',
          at: this.iso(),
          lead_id: lead.id,
        });
      }
      this.store.films.push({
        key,
        date: this.date,
        lead_id: lead.id,
        domain: lead.domain,
        order_id: orderId,
        kind: port.kind,
        state: 'queued',
        qc: 'pending',
        simulated: !live,
        cost_micro_usd: null,
        page_url: null,
        share_id: null,
        duration_seconds: null,
      });
      this.films.set(lead.id, {
        orderId,
        port,
        ready: false,
        usable: false,
        pageUrl: null,
        shareId: null,
        file: null,
        scriptFlags: [],
      });
      await this.comment('FILM', lead.id, live ? 'ordered' : 'dry run', [
        `Order ${orderId}. Short, 16:9, budget $${(budget / 1e6).toFixed(2)}, kind ${port.kind}.`,
      ]);
    }
    await this.save();
    return { status: 'done' as const, detail: `${ordered} film(s), ${live ? 'live' : 'dry run'}` };
  }

  async filmsPhase() {
    if (!this.films.size) return { status: 'skipped' as const, detail: 'no films' };
    const live = [...this.films.values()].some((film) => film.port.kind === 'app');
    const deadline = this.now().getTime() + (live ? (this.o.filmWaitMs ?? 3 * 3_600_000) : 0);
    const poll = live ? (this.o.filmPollMs ?? 60_000) : 0;
    // Dry-run films are ready after three reads, so a dry run polls a few rounds without waiting.
    for (let round = 0; ; round++) {
      let waiting = 0;
      for (const [leadId, film] of this.films) {
        if (film.ready) continue;
        const row = this.store.films.find((item) => item.order_id === film.orderId);
        const status = await film.port.status(film.orderId);
        if (row) {
          row.state = status.state;
          row.qc = status.qc;
          row.simulated = status.simulated;
          if (status.costMicroUsd !== null) {
            row.cost_micro_usd = status.costMicroUsd;
            if (film.port.kind === 'app') settleSpend(this.store, row.key, status.costMicroUsd);
          }
        }
        if (status.state === 'failed' || status.state === 'withdrawn' || status.qc === 'fail') {
          film.ready = true;
          await this.comment('FILM', leadId, 'failed', [
            `${status.qc === 'fail' ? 'QC fail' : status.state}. No outreach for ${leadId} today.`,
          ]);
          continue;
        }
        if (status.state !== 'ready') {
          waiting += 1;
          continue;
        }
        film.ready = true;
        film.usable = status.qc === 'pass' && !status.simulated;
        film.scriptFlags = brandFlags(status.script ?? '');
        const shared = await film.port.share(film.orderId);
        film.pageUrl = shared.pageUrl;
        film.shareId = shared.shareId;
        if (film.usable) film.file = await film.port.file(film.orderId).catch(() => null);
        if (row) {
          row.page_url = shared.pageUrl;
          row.share_id = shared.shareId;
          row.duration_seconds = film.file?.durationSeconds ?? null;
        }
        const action = findAction(this.store, row?.key ?? '');
        if (action) action.detail = `${action.detail}; share=${shared.shareId}`;
        await this.comment('FILM', leadId, film.usable ? 'ready' : 'dry run', [
          `QC ${status.qc}. Page ${shared.pageUrl}${status.simulated ? ' (simulated, not real)' : ''}.`,
        ]);
      }
      await this.save();
      if (!waiting) break;
      if (live ? this.now().getTime() >= deadline : round >= 5) {
        // A late film is withdrawn, so it stops spending and does not count against tomorrow's orders.
        for (const [leadId, film] of this.films) {
          if (film.ready) continue;
          await film.port.withdraw(film.orderId, 'failed').catch(() => undefined);
          const row = this.store.films.find((item) => item.order_id === film.orderId);
          if (row) row.state = 'late';
          film.ready = true;
          await this.comment('FILM', leadId, 'late', [
            'Not ready by compose: withdrawn. No backfill.',
          ]);
        }
        break;
      }
      if (poll) await (this.o.sleep ?? realSleep)(poll);
    }
    await this.save();
    return {
      status: 'done' as const,
      detail: `${[...this.films.values()].filter((film) => film.pageUrl).length} ready of ${this.films.size}`,
    };
  }

  /** When a live draft goes out: the hold window after compose, on the Pacific clock. */
  goesOutAt(): string {
    const composed = phaseOf(this.store, this.date, 'compose');
    const from = composed ? Date.parse(composed.finished_at) : this.now().getTime();
    return pacific(new Date(from + HOLD_WINDOW_MINUTES * 60_000)).clock;
  }

  async compose() {
    const now = this.now();
    const appBase = this.ports.appBase;
    const after = pacific(new Date(now.getTime() + HOLD_WINDOW_MINUTES * 60_000)).clock;
    if (this.picked.x && this.picked.caption) {
      const lead = this.store.leads.find((row) => row.id === this.picked.x) as LeadRow;
      const film = this.films.get(lead.id);
      const problems: string[] = [];
      const blocker = xBlocker(this.store, lead, now, this.xHow());
      if (blocker) problems.push(blocker);
      if (!film?.pageUrl) problems.push('no ready film');
      if (film && !film.usable) problems.push('the film is simulated or did not pass QC');
      if (film?.scriptFlags.length)
        problems.push(`film script brand flags: ${film.scriptFlags.join(', ')}`);
      if (film?.usable && !film.file) problems.push('no film file');
      this.drafts.push({
        lead_id: lead.id,
        lane: 'x',
        text: this.picked.caption.caption,
        // A quote-post of the launch post is made only by a person; this is what they need.
        ...(lead.x_post?.verified
          ? { pack: { launchPost: lead.x_post.url, filmPage: film?.pageUrl ?? null } }
          : {}),
        problems,
        usable: problems.length === 0,
      });
      const when =
        this.lanes.x === 'standalone'
          ? `Goes out after ${after} Pacific unless someone comments HOLD or HOLD ${lead.id}.`
          : this.lanes.x === 'pack'
            ? `Pack mode: the executor posts nothing; once checked it goes on ${packTitle(this.date)} for the founder to post by hand.`
            : 'Dry run: the executor does not post it. With a real film it goes on the pack card.';
      await this.comment('POST', lead.id, this.lanes.x === 'standalone' ? 'draft' : 'dry run', [
        `Lane x: ${this.lanes.x}. ${when} Caption by br-social, template ${this.picked.caption.template_id}, ${this.picked.caption.caption.length} characters. Checks: ${problems.length ? problems.join('; ') : 'passed'}.`,
      ]);
    }
    for (const pick of this.picked.emails) {
      const lead = this.store.leads.find((row) => row.id === pick.lead_id) as LeadRow;
      const film = this.films.get(lead.id);
      const address = chosenAddress(lead);
      const problems: string[] = [];
      const blocker = emailBlocker(this.store, lead, now);
      if (blocker) problems.push(blocker);
      if (!film?.pageUrl) problems.push('no ready film');
      if (film && !film.usable) problems.push('the film is simulated or did not pass QC');
      if (!address?.address) {
        problems.push('no_address');
        continue;
      }
      if (!isRoleAddressOn(address.address, lead.domain)) problems.push('bad_recipient');
      const { token, hash } = optOutToken();
      // The app registers a token only for an email that can go out. While the email lane is dry
      // run (EMAIL_FORCED_DRY_RUN for the hackathon) the app is not asked, and the draft says why.
      if (this.ports.app.kind === 'app' && this.lanes.email !== 'live') {
        problems.push('opt-out token not registered: the email lane is dry run');
      } else {
        try {
          await this.ports.app.registerOptOutToken(hash, lead.id);
          this.store.optout_tokens.push({
            hash,
            lead_id: lead.id,
            domain: lead.domain,
            created_at: this.iso(),
          });
        } catch {
          problems.push('opt-out token not registered');
        }
      }
      const draft = composeEmail({
        lead,
        address: { address: address.address, page_label: address.page_label },
        subject: pick.subject,
        opener: pick.opener,
        filmPageUrl: film?.pageUrl ?? `${appBase}/f/not-ready`,
        durationSeconds: film?.file?.durationSeconds ?? null,
        optOutUrl: `${appBase}/u/${token}`,
        postalAddress: this.store.flags.postal_address,
      });
      problems.push(...emailProblems(draft, this.store.flags.postal_address));
      this.drafts.push({
        lead_id: lead.id,
        lane: 'email',
        subject: draft.subject,
        text: draft.text,
        to: address.address,
        headers: draft.headers,
        problems,
        usable: problems.length === 0,
      });
      await this.comment('EMAIL', lead.id, this.lanes.email === 'live' ? 'draft' : 'dry run', [
        `To the published address at ${lead.domain} (a role address, from its ${address.page_label}). Jurisdiction ${lead.verdict?.jurisdiction}. ${this.lanes.email === 'live' ? `Goes out after ${after} Pacific unless someone comments HOLD or HOLD ${lead.id}.` : 'Dry run: it does not go out.'}`,
        `Lines by br-gtm-lead. Checks: ${problems.length ? problems.join('; ') : 'suppression, 90 days, quote, numbers, links (2), footer'}.`,
      ]);
    }
    this.review.push(
      `## Drafts\n\n${this.drafts
        .map(
          (draft) =>
            `### ${draft.lane} · ${draft.lead_id}${draft.usable ? '' : ` (not sendable: ${draft.problems.join('; ')})`}\n\n${draft.to ? `To: ${draft.to}\nSubject: ${draft.subject}\n\n` : ''}\`\`\`text\n${draft.text}\n\`\`\`\n${draft.pack ? `\nQuote pack, for a person posting by hand from the X app (pack mode): quote-post ${draft.pack.launchPost} with the film from ${draft.pack.filmPage ?? 'the film page, once ready'}, and paste the caption above. It is on ${packTitle(this.date)} when the film is real; once posted, comment POSTED ${draft.lead_id} <your post's address> on that card.\n` : ''}`,
        )
        .join('\n')}`,
    );
    return {
      status: 'done' as const,
      detail: `${this.drafts.length} draft(s), ${this.drafts.filter((draft) => draft.usable).length} sendable`,
    };
  }

  /**
   * The hold window. When a lane is live and a draft can go out, execute waits until
   * HOLD_WINDOW_MINUTES after compose, so the people who read the board can comment HOLD; execute
   * then re-reads every hold. Nothing waits in dry run.
   */
  async holdWindow() {
    const live = this.lanes.x === 'standalone' || this.lanes.email === 'live';
    if (!live || !this.drafts.some((draft) => draft.usable)) return;
    const composed = phaseOf(this.store, this.date, 'compose');
    const from = composed ? Date.parse(composed.finished_at) : this.now().getTime();
    const wait = from + HOLD_WINDOW_MINUTES * 60_000 - this.now().getTime();
    if (wait <= 0) return;
    this.log(`hold      execute waits until ${this.goesOutAt()} Pacific for a HOLD`);
    await (this.o.sleep ?? realSleep)(wait);
  }

  /** Posts and emails already out today, by the real date, in any run. */
  outToday(kind: ActionKind): number {
    return this.store.actions.filter(
      (row) =>
        row.kind === kind &&
        ['sent', 'planned', 'unknown'].includes(row.status) &&
        pacific(new Date(row.executed_at ?? row.created_at)).date === this.today,
    ).length;
  }

  async execute() {
    // Re-read holds and re-resolve every lane right before anything goes out.
    await this.readHolds();
    this.holdCards = this.ports.naive
      ? await this.ports.board.holdCards().catch(() => ['unreadable'])
      : [];
    this.lanes = this.resolve();
    const now = this.now();
    // Every cap counts what already went out today on the real clock, whatever the run's label.
    let posts = this.outToday('x-post');
    let emails = this.outToday('email');
    const pack: PackPost[] = [];
    // A hold or a halt stops everything going out today, by code or by the founder's hand.
    const stopped =
      this.holds.day ||
      this.holdCards.length > 0 ||
      this.ceoHalted !== false ||
      this.store.flags.mode === 'halted';
    for (const draft of this.drafts) {
      const lead = this.store.leads.find((row) => row.id === draft.lead_id) as LeadRow;
      if (draft.lane === 'x') {
        const key = `x-post:${this.date}`;
        const reasons = [...draft.problems];
        if (this.holds.leads.has(lead.id)) reasons.push('held');
        const blocker = xBlocker(this.store, lead, now, this.xHow());
        if (blocker) reasons.push(blocker);
        if (posts >= cap(this.store, 'x_posts_day')) reasons.push('x_cap');
        if (!canSpend(this.store, this.today, PRICES.x_post).ok) reasons.push('spend');
        const film = this.films.get(lead.id);
        // What the founder needs to post it by hand: a real, QC-passed film with a page, and every
        // check passed but those that only code posting needs (the file, the post's price).
        const packable =
          !stopped &&
          Boolean(film?.usable && film.pageUrl) &&
          reasons.every((reason) => reason === 'no film file' || reason === 'spend');
        const toPack = (refused: boolean) => {
          if (!packable || !film?.pageUrl) return false;
          pack.push({
            lead_id: lead.id,
            product: lead.product_name ?? lead.domain,
            domain: lead.domain,
            film_page: film.pageUrl,
            quote_post: lead.x_post?.verified ? lead.x_post.url : null,
            caption: draft.text,
            refused,
          });
          return true;
        };
        const live = this.lanes.x === 'standalone' && reasons.length === 0;
        if (this.lanes.x === 'standalone' && reasons.length) {
          skipAction(this.store, {
            key,
            kind: 'x-post',
            lead_id: lead.id,
            reason: reasons.join('; '),
            at: this.iso(),
          });
          const packed = toPack(false);
          await this.comment('POST', lead.id, packed ? 'pack' : 'skipped', [
            `Reason: ${reasons.join('; ')}.${packed ? ` It goes on ${packTitle(this.date)} for the founder to post by hand.` : ''}`,
          ]);
          continue;
        }
        let contact: ReturnType<typeof recordContact> | null = null;
        const outcome = await runAction(
          this.store,
          {
            key,
            kind: 'x-post',
            lead_id: lead.id,
            detail: `lead ${lead.id}`,
            dryRun: !live,
            call: async () => {
              // Recorded before the call: a post whose answer is lost still counts as made.
              contact = recordContact(this.store, {
                domain: lead.domain,
                channel: 'x_post',
                at: this.iso(),
                lead_id: lead.id,
              });
              await this.save();
              const result = await this.ports.social.post({
                caption: draft.text,
                filmFileUrl: film?.file?.url ?? '',
                idempotencyKey: key,
              });
              return { provider_id: result.postId, cost_micro_usd: PRICES.x_post };
            },
            reconcile: () => this.ports.social.find(key),
          },
          this.save,
          this.iso,
        );
        if (outcome.state === 'unknown') await this.founder('unknown-send', key);
        // A post the provider refused did not go out (only a refusal is `failed` for a post): it
        // is not a contact, and it goes on the pack for the founder.
        const refused = outcome.state === 'failed';
        if (refused && contact)
          this.store.contacts = this.store.contacts.filter((row) => row !== contact);
        const packed = outcome.state === 'dry_run' ? toPack(false) : refused ? toPack(true) : false;
        if (outcome.state === 'done') {
          posts += 1;
          recordSpend(this.store, {
            date: this.today,
            category: 'posts',
            micro_usd: PRICES.x_post,
            ref: key,
          });
        }
        if (outcome.state === 'done' || outcome.state === 'dry_run') {
          this.store.copy_history.push({
            date: this.date,
            lane: 'x',
            template_id: this.picked.caption?.template_id ?? null,
            variable: this.picked.caption?.variable ?? '',
            lead_id: lead.id,
          });
        }
        await this.comment('POST', lead.id, packed ? 'pack' : outcomeState(outcome.state, false), [
          outcome.state === 'done'
            ? `Posted as ${outcome.row.provider_id}.`
            : outcome.state === 'pending' || outcome.state === 'unknown'
              ? 'The call errored, so the post may have gone out. It is never retried; the domain counts as posted, and a person is asked if no provider id turns up.'
              : packed
                ? `Not posted by the executor${refused ? ': the network refused it' : ''}. It goes on ${packTitle(this.date)} for the founder to post by hand; it counts as posted only once that card is done.`
                : `Not posted: ${reasons.join('; ') || this.lanes.reasons.x.slice(0, 3).join('; ')}.`,
        ]);
        continue;
      }
      const key = `email:${lead.domain}:${this.date}`;
      const reasons = [...draft.problems];
      if (this.holds.leads.has(lead.id)) reasons.push('held');
      // The recipient is checked again: exactly one role address on the lead's own domain.
      if (!draft.to || !isRoleAddressOn(draft.to, lead.domain)) reasons.push('bad_recipient');
      // Suppression and the 90-day rule are checked again here: an opt-out may have come in since compose.
      if (draft.to && suppressedBy(this.store, { email: draft.to, domain: lead.domain }))
        reasons.push('suppressed');
      if (contactedWithin(this.store, lead.domain, 'email', now)) reasons.push('emailed_90d');
      if (emails >= cap(this.store, 'cold_emails_day')) reasons.push('email_cap');
      if (this.lanes.email === 'live' && !reasons.length && draft.to) {
        if (!(await this.ports.mx(emailDomain(draft.to) ?? ''))) reasons.push('no_mx');
      }
      const live = this.lanes.email === 'live' && reasons.length === 0;
      if (reasons.length && this.lanes.email === 'live') {
        skipAction(this.store, {
          key,
          kind: 'email',
          lead_id: lead.id,
          reason: reasons.join('; '),
          at: this.iso(),
        });
        await this.comment('EMAIL', lead.id, 'skipped', [`Reason: ${reasons.join('; ')}.`]);
        continue;
      }
      const sender = this.ports.sender;
      const outcome = await runAction(
        this.store,
        {
          key,
          kind: 'email',
          lead_id: lead.id,
          detail: `lead ${lead.id}`,
          dryRun: !live,
          call: async () => {
            // Recorded before the call: an email whose answer is lost still counts for 90 days.
            recordContact(this.store, {
              domain: lead.domain,
              channel: 'email',
              at: this.iso(),
              lead_id: lead.id,
            });
            await this.save();
            const result = await sender.send({
              from: sender.from,
              replyTo: sender.replyTo,
              to: draft.to as string,
              subject: draft.subject as string,
              text: draft.text,
              headers: sender.capabilities.customHeaders ? (draft.headers ?? {}) : {},
              idempotencyKey: key,
            });
            return { provider_id: result.messageId };
          },
        },
        this.save,
        this.iso,
      );
      if (outcome.state === 'unknown') await this.founder('unknown-send', key);
      if (outcome.state === 'done') emails += 1;
      if (outcome.state === 'done' || outcome.state === 'dry_run') {
        this.store.copy_history.push({
          date: this.date,
          lane: 'email',
          template_id: null,
          variable: draft.subject ?? '',
          lead_id: lead.id,
        });
      }
      await this.comment('EMAIL', lead.id, outcomeState(outcome.state, false, 'sent'), [
        outcome.state === 'done'
          ? `Sent as ${outcome.row.provider_id} by ${sender.kind}.`
          : outcome.state === 'pending' || outcome.state === 'unknown'
            ? 'The call errored, so the email may have gone out. It is never retried; the domain counts as emailed for 90 days, and a person is asked if no provider id turns up.'
            : `Not sent: ${reasons.join('; ') || this.lanes.reasons.email.slice(0, 3).join('; ')}.`,
      ]);
    }
    if (pack.length) await this.writePack(pack);
    return {
      status: 'done' as const,
      detail: `${posts} post(s), ${emails} email(s) out today; ${pack.length} in the founder's pack; the rest dry run`,
    };
  }

  /**
   * The day's pack: ONE `FOUNDER: gtm pack <date>` card with every post the executor did not make,
   * for the founder to post by hand. The card carries lead ids and our film pages only; the startup,
   * the X post to quote and the caption go in the review file. A post is never called posted until
   * the founder's own POSTED comment for it is read.
   */
  async writePack(posts: PackPost[]) {
    this.needs.add('pack');
    let cardId: string;
    try {
      cardId = (
        await this.ports.board.ensureCard({
          title: packTitle(this.date),
          body: packBody(this.date, posts),
          status: 'blocked',
          key: packKey(this.date),
        })
      ).id;
    } catch (error) {
      this.log(
        `board     pack card failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (!this.store.packs.some((row) => row.date === this.date)) {
      this.store.packs.push({
        date: this.date,
        card_id: cardId,
        key: packKey(this.date),
        entries: posts.map((post) => ({
          lead_id: post.lead_id,
          domain: post.domain,
          film_page: post.film_page,
          refused: post.refused,
          posted_at: null,
          posted_url: null,
          removed_at: null,
        })),
        status: 'waiting',
        done_at: null,
        checked_at: null,
      });
    }
    await this.comment('PACK', this.date, 'waiting', [
      `${posts.length} post(s) on ${packTitle(this.date)}: ${posts.map((post) => post.lead_id).join(', ')}. The founder posts them by hand and comments POSTED <lead id> <url> on the card for each; until then none counts as posted.`,
    ]);
    this.review.push(packReview(this.date, posts));
    await this.save();
  }

  reviewText(): string {
    const lanes = this.lanes;
    return [
      `# GTM review ${this.date}`,
      '',
      'This file holds text from outside the company (site quotes, captions, emails). It is for the founder only: never paste it on the board.',
      '',
      '## Lanes',
      '',
      `- films ${lanes.film}: ${lanes.reasons.film.join('; ') || 'live'}`,
      `- x ${lanes.x}: ${lanes.reasons.x.join('; ') || 'live'}`,
      `- email ${lanes.email}: ${lanes.reasons.email.join('; ') || 'live'}`,
      `- replies ${lanes.reply}: ${lanes.reasons.reply.join('; ')}`,
      '',
      ...this.review,
    ].join('\n');
  }

  async report() {
    pruneLeads(this.store, this.now());
    const metrics = dayMetrics(this.store, this.date);
    const holds = [
      ...(this.holds.day ? ['HOLD'] : []),
      ...[...this.holds.leads].map((id) => `HOLD ${id}`),
      ...this.holdCards,
    ];
    const text = reportText(metrics, {
      mode: this.store.flags.mode,
      lanes: this.lanes,
      holds,
      needs: [...this.needs],
      review: null,
    });
    this.o.writeFile('report.txt', `${text}\n`);
    this.o.writeFile('metrics.json', `${JSON.stringify(metrics, null, 2)}\n`);
    this.o.writeFile('review.md', `${this.reviewText()}\n`);
    if (this.dayCard) await this.ports.board.move(this.dayCard, 'done', text);
    return { status: 'done' as const, detail: text.split('\n')[0] ?? '' };
  }
}

/** Runs one whole GTM day from a terminal, in phase order. */
export async function runDay(options: DayOptions): Promise<DayResult> {
  const day = new Day(options);
  await day.prepare();
  await day.reconcilePending();
  await day.phase('open', () => day.open());
  await day.phase('removals', () => day.removals());
  await day.phase('discover', () => day.discover());
  await day.phase('qualify', () => day.qualify());
  await day.phase('pick', () => day.pick());
  await day.phase('order', () => day.order());
  await day.phase('films', () => day.filmsPhase());
  await day.phase('compose', () => day.compose());
  // A live draft waits out the hold window, so people reading the board can comment HOLD.
  await day.holdWindow();
  // Removals run again right before anything goes out, as they do on every tick of the hosted executor.
  await day.phase('removals', () => day.removals());
  await day.phase('execute', () => day.execute());
  await day.phase('report', () => day.report());
  if (options.ports.board instanceof LocalBoard)
    options.writeFile('board.md', options.ports.board.markdown());
  const report = reportText(dayMetrics(options.store, day.date), {
    mode: options.store.flags.mode,
    lanes: day.lanes,
    holds: [],
    needs: [...day.needs],
    review: null,
  });
  return {
    date: day.date,
    lanes: day.lanes,
    report,
    review: day.reviewText(),
    needs: [...day.needs],
    phases: day.phases,
  };
}
