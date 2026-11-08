import { describe, expect, it } from 'vitest';
import { stationState, stationWord, trackerSummary } from '../src/components/pipeline-tracker.tsx';
import { splitClaims } from '../src/lib/claims.ts';
import { STAGES } from '../src/lib/film.ts';
import {
  filmPollDelay,
  filmsPollDelay,
  POLL_MS,
  type PollResult,
  startPolling,
} from '../src/lib/poll.ts';
import { relativeTime } from '../src/lib/relative-time.ts';
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

describe('pipeline tracker', () => {
  it('reads the stations as the dashboard sample does at step 4', () => {
    const words = STAGES.map((station) =>
      stationWord(station, stationState(station, 'approval', 'needs_you')),
    );
    expect(words).toEqual([
      'Done',
      'Done',
      'Passed',
      'Waiting',
      'Queued',
      'Queued',
      'Queued',
      'Queued',
      'Queued',
      'Queued',
    ]);
    expect(trackerSummary('approval', 'needs_you')).toBe('Step 4 of 10 · paused for you');
  });

  it('says what the crew is doing, and marks every station done once delivered', () => {
    expect(trackerSummary('render', 'working')).toBe('Step 8 of 10 · rendering');
    expect(stationWord('approval', stationState('approval', 'render', 'working'))).toBe('Approved');
    expect(STAGES.every((station) => stationState(station, 'delivery', 'done') === 'done')).toBe(
      true,
    );
    expect(trackerSummary('delivery', 'done')).toBe('Delivered');
    expect(stationWord('script', stationState('script', 'script', 'failed'))).toBe('Stopped');
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
