import { describe, expect, it } from 'vitest';
import { eventBadge, LOG_PREVIEW, visibleEntries } from '../src/components/decisions-feed.tsx';
import { progressLine, stopState, waitLine } from '../src/components/film-progress.tsx';
import { splitClaims } from '../src/lib/claims.ts';
import { STAGE_LABELS, STAGES, STOP_OF, STOPS } from '../src/lib/film.ts';
import {
  filmPollDelay,
  filmsPollDelay,
  POLL_MS,
  type PollResult,
  startPolling,
} from '../src/lib/poll.ts';
import { relativeTime } from '../src/lib/relative-time.ts';
import type { FilmEventView } from '../src/server/api/films.ts';
import { SAMPLE_CAMPAIGN } from '../src/server/pipeline/simulated.ts';

/** Timers the test runs by hand, and a page that can be hidden. */
function harness() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  let hidden = false;
  const visible: (() => void)[] = [];
  return {
    timers: {
      set(run: () => void, ms: number) {
        const id = next++;
        pending.set(id, { at: now + ms, run });
        return id;
      },
      clear(id: unknown) {
        pending.delete(id as number);
      },
    },
    visibility: {
      hidden: () => hidden,
      onVisible(run: () => void) {
        visible.push(run);
        return () => visible.splice(visible.indexOf(run), 1);
      },
    },
    /** Moves time on, running every timer that comes due, and lets loads settle. */
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].run();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      now = until;
    },
    scheduled: () => [...pending.values()].map((timer) => timer.at - now),
    hide() {
      hidden = true;
    },
    async show() {
      hidden = false;
      for (const run of visible.splice(0)) run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

type Film = { status: 'working' | 'needs_you' | 'done' };
const delay = (film: Film) => filmPollDelay(film.status);

describe('live updates', () => {
  it('polls every few seconds while the crew works, slows while it waits, stops when done', async () => {
    const page = harness();
    const answers: Film[] = [{ status: 'working' }, { status: 'needs_you' }, { status: 'done' }];
    const seen: Film[] = [];
    let loads = 0;
    startPolling<Film>({
      first: { status: 'working' },
      load: async () => ({ ok: true, data: answers[loads++] as Film }),
      delayFor: delay,
      onData: (film) => seen.push(film),
      timers: page.timers,
      visibility: page.visibility,
    });
    expect(page.scheduled()).toEqual([POLL_MS.working]);
    await page.advance(POLL_MS.working);
    expect(seen.map((film) => film.status)).toEqual(['working']);
    await page.advance(POLL_MS.working);
    expect(seen.map((film) => film.status)).toEqual(['working', 'needs_you']);
    expect(page.scheduled()).toEqual([POLL_MS.waiting]);
    await page.advance(POLL_MS.waiting);
    expect(seen.map((film) => film.status)).toEqual(['working', 'needs_you', 'done']);
    expect(page.scheduled()).toEqual([]);
    expect(loads).toBe(3);
  });

  it('does not start for a film that is already delivered', () => {
    const page = harness();
    startPolling<Film>({
      first: { status: 'done' },
      load: async () => ({ ok: true, data: { status: 'done' } }),
      delayFor: delay,
      onData: () => {},
      timers: page.timers,
      visibility: page.visibility,
    });
    expect(page.scheduled()).toEqual([]);
  });

  it('makes no request while the tab is hidden, and catches up when it comes back', async () => {
    const page = harness();
    let loads = 0;
    startPolling<Film>({
      first: { status: 'working' },
      load: async () => {
        loads += 1;
        return { ok: true, data: { status: 'working' } };
      },
      delayFor: delay,
      onData: () => {},
      timers: page.timers,
      visibility: page.visibility,
    });
    page.hide();
    await page.advance(60_000);
    expect(loads).toBe(0);
    await page.show();
    expect(loads).toBe(1);
  });

  it('backs off when the API fails, and stops on a 4xx', async () => {
    const page = harness();
    const results: PollResult<Film>[] = [
      { ok: false, retry: true },
      { ok: false, retry: true },
      { ok: true, data: { status: 'working' } },
      { ok: false, retry: false },
    ];
    let loads = 0;
    startPolling<Film>({
      first: { status: 'working' },
      load: async () => results[loads++] as PollResult<Film>,
      delayFor: delay,
      onData: () => {},
      timers: page.timers,
      visibility: page.visibility,
    });
    await page.advance(POLL_MS.working);
    expect(page.scheduled()).toEqual([POLL_MS.working * 2]);
    await page.advance(POLL_MS.working * 2);
    expect(page.scheduled()).toEqual([POLL_MS.working * 4]);
    await page.advance(POLL_MS.working * 4);
    expect(page.scheduled()).toEqual([POLL_MS.working]);
    await page.advance(POLL_MS.working);
    expect(page.scheduled()).toEqual([]);
    expect(loads).toBe(4);
  });

  it('treats a thrown load as a failure worth retrying', async () => {
    const page = harness();
    startPolling<Film>({
      first: { status: 'working' },
      load: async () => {
        throw new TypeError('offline');
      },
      delayFor: delay,
      onData: () => {},
      timers: page.timers,
      visibility: page.visibility,
    });
    await page.advance(POLL_MS.working);
    expect(page.scheduled()).toEqual([POLL_MS.working * 2]);
  });

  it('stops for good when the page goes away', async () => {
    const page = harness();
    let loads = 0;
    const stop = startPolling<Film>({
      first: { status: 'working' },
      load: async () => {
        loads += 1;
        return { ok: true, data: { status: 'working' } };
      },
      delayFor: delay,
      onData: () => {},
      timers: page.timers,
      visibility: page.visibility,
    });
    stop();
    await page.advance(60_000);
    expect(loads).toBe(0);
    expect(page.scheduled()).toEqual([]);
  });

  it('polls the list while any film is being made, and stops when all are finished', () => {
    expect(filmsPollDelay(['done', 'working'])).toBe(POLL_MS.listWorking);
    expect(filmsPollDelay(['queued'])).toBe(POLL_MS.listWorking);
    expect(filmsPollDelay(['done', 'needs_you'])).toBe(POLL_MS.waiting);
    expect(filmsPollDelay(['done', 'failed'])).toBeNull();
    expect(filmsPollDelay([])).toBeNull();
  });
});

describe('progress on four stops', () => {
  it('maps the ten stages onto the landing page’s four stops', () => {
    expect(STAGES.map((stage) => STOP_OF[stage])).toEqual([
      'research',
      'script',
      'script',
      'approve',
      'make',
      'make',
      'make',
      'make',
      'make',
      'make',
    ]);
    // "Review" is the founder's word for the script. The crew's last check is Quality check.
    expect(STAGE_LABELS.review).toBe('Quality check');
  });

  it('says where the film is in one line', () => {
    expect(progressLine('approval', 'needs_you')).toBe(
      'Step 3 of 4 · You approve: waiting for you',
    );
    expect(progressLine('checks', 'working')).toBe('Step 2 of 4 · Script');
    expect(progressLine('render', 'working')).toBe('Step 4 of 4 · Animate and deliver');
    expect(progressLine('research', 'queued')).toBe('Step 1 of 4 · Research: next in line');
    expect(progressLine('delivery', 'done')).toBe('All 4 steps done · Delivered');
    expect(progressLine('script', 'failed')).toBe('Step 2 of 4 · Script: stopped');
  });

  it('marks each stop done, now, waiting for you or still to come', () => {
    expect(STOPS.map((stop) => stopState(stop, 'approval', 'needs_you'))).toEqual([
      'done',
      'done',
      'needs',
      'next',
    ]);
    expect(STOPS.map((stop) => stopState(stop, 'motion', 'working'))).toEqual([
      'done',
      'done',
      'done',
      'now',
    ]);
    expect(STOPS.every((stop) => stopState(stop, 'delivery', 'done') === 'done')).toBe(true);
  });

  it('gives a wait only where it is known: the simulator’s fixed clock', () => {
    expect(waitLine({ simulated: true, stage: 'research' })).toBe(
      'A simulated film reaches its script about 30 seconds after it starts.',
    );
    expect(waitLine({ simulated: true, stage: 'render' })).toBe(
      'A simulated film is delivered about 40 seconds after you approve.',
    );
    expect(waitLine({ simulated: false, stage: 'research' })).toBeNull();
  });
});

describe('what the crew did', () => {
  const entry = (seq: number, agent: FilmEventView['agent'], kind: FilmEventView['kind']) =>
    ({
      id: `e${seq}`,
      seq,
      at: '2026-11-07T12:00:00.000Z',
      agent,
      kind,
      stage: 'script',
      status: 'working',
      message: `event ${seq}`,
    }) satisfies FilmEventView;

  it('shows the newest first, and only the latest three until asked', () => {
    const events = [0, 1, 2, 3, 4].map((seq) => entry(seq, 'director', 'decision'));
    expect(visibleEntries(events, false).map((event) => event.seq)).toEqual([4, 3, 2]);
    expect(LOG_PREVIEW).toBe(3);
    expect(visibleEntries(events, true).map((event) => event.seq)).toEqual([4, 3, 2, 1, 0]);
  });

  it('words a number the Validator caught as the system working, not as a failure', () => {
    expect(eventBadge(entry(1, 'validator', 'sent_back'))).toEqual(['badge badge-plain', 'Caught']);
    expect(eventBadge(entry(2, 'customer', 'sent_back'))).toEqual([
      'badge badge-plain',
      'Changes asked',
    ]);
    expect(eventBadge(entry(3, 'account_manager', 'needs_you'))).toBeNull();
  });
});

describe('claims in the decisions feed', () => {
  const claims = SAMPLE_CAMPAIGN.claims;

  it('highlights a figure quoted from a claim, with that claim', () => {
    const parts = splitClaims(
      'Rewrote scene 2 from the build-times quote: 40% faster builds.',
      claims,
    );
    expect(parts.map((part) => part.text).join('')).toBe(
      'Rewrote scene 2 from the build-times quote: 40% faster builds.',
    );
    const sourced = parts.filter((part) => part.claim);
    expect(sourced).toHaveLength(1);
    expect(sourced[0]).toMatchObject({ text: '40%', claim: { id: 'build-times' } });
  });

  it('never highlights a figure with no source, or a plain count', () => {
    const refused = '"Builds 73% faster" has no source. Cite a claim that states it, or remove it.';
    expect(splitClaims(refused, claims).some((part) => part.claim)).toBe(false);
    const counts = 'Wrote 4 scenes and 1 alternate opening, 20 seconds long.';
    expect(splitClaims(counts, claims).some((part) => part.claim)).toBe(false);
  });

  it('finds money, multipliers and thousands, and drops a full stop after a figure', () => {
    const parts = splitClaims('Kept 1,200 teams, 3x and $29.', claims);
    expect(parts.filter((part) => part.claim).map((part) => part.text)).toEqual([
      '1,200',
      '3x',
      '$29',
    ]);
    expect(parts.map((part) => part.text).join('')).toBe('Kept 1,200 teams, 3x and $29.');
  });
});

describe('relative time', () => {
  const now = new Date(2026, 10, 7, 12, 45);
  const ago = (ms: number) => relativeTime(new Date(now.getTime() - ms), now);

  it('reads as the dashboard sample does', () => {
    expect(ago(20_000)).toBe('Just now');
    expect(ago(3 * 60_000)).toBe('3 min ago');
    expect(ago(12 * 60_000)).toBe('12 min ago');
    expect(ago(2 * 3_600_000)).toBe('2 hours ago');
    expect(relativeTime(new Date(2026, 10, 6, 18, 0), now)).toBe('Yesterday');
    expect(relativeTime(new Date(2026, 10, 5, 9, 0), now)).toBe('2 days ago');
  });
});
