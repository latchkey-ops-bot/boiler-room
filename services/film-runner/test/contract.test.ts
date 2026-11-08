import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as web from '../../../apps/web/src/lib/film.ts';
import {
  CREW,
  canonicalString,
  deriveRunKey,
  EMPTY_SHA256,
  FORMATS,
  filmCommandArgs,
  HEADERS,
  MAX_CLOCK_SKEW_SECONDS,
  parseBootstrap,
  parseFilmEvent,
  parseInstructions,
  STAGES,
  safeName,
  sha256Hex,
  signCanonical,
  signRequest,
  signWatchdog,
  uploadPath,
  variantKey,
  verifyCanonical,
  verifyRequest,
} from '../src/contract.ts';
import { FILM_ID, instructionsFor, MASTER, RUN_ID } from './helpers.ts';

describe('the words the website uses', () => {
  it('match apps/web/src/lib/film.ts', () => {
    expect(STAGES).toEqual(web.STAGES);
    expect(CREW).toEqual(web.CREW);
    expect(FORMATS).toEqual(web.FORMATS);
  });

  it('name a variant as the website does', () => {
    expect(variantKey('16:9', null, 'start-free')).toBe('16:9.main.start-free');
    expect(variantKey('1:1', 'open-question', null)).toBe('1:1.open-question.none');
  });
});

describe('the contract files', () => {
  it('load in a Worker: no Node built-ins, no Buffer, no process', () => {
    for (const file of ['../src/contract.ts', '../src/launcher.ts']) {
      const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect(text, file).not.toMatch(/from 'node:|require\(|\bBuffer\b|\bprocess\.[a-z]/);
    }
    const contract = readFileSync(
      fileURLToPath(new URL('../src/contract.ts', import.meta.url)),
      'utf8',
    );
    expect(contract).not.toMatch(/^import /m);
  });
});

describe('signatures', () => {
  it('derive the per-run key as HMAC-SHA256(master, "br-runner/v1/<film>/<run>")', async () => {
    const expected = createHmac('sha256', MASTER)
      .update(`br-runner/v1/${FILM_ID}/${RUN_ID}`)
      .digest('hex');
    expect(await deriveRunKey(MASTER, FILM_ID, RUN_ID)).toBe(expected);
    await expect(deriveRunKey('short', FILM_ID, RUN_ID)).rejects.toThrow();
  });

  it('sign one pinned canonical string, with an escaped colon in the query', async () => {
    const path = uploadPath(FILM_ID, {
      kind: 'mp4',
      version: 1,
      variant: '16:9.main.start-free',
      name: '16x9.mp4',
    });
    expect(path).toBe(
      `/api/runner/v1/films/${FILM_ID}/files?kind=mp4&version=1&variant=16%3A9.main.start-free&name=16x9.mp4`,
    );
    const canonical = canonicalString({
      method: 'put',
      pathAndQuery: path,
      filmId: FILM_ID,
      runId: RUN_ID,
      ts: 1794120000,
      nonce: '0123456789abcdef0123456789abcdef',
      bodySha256: EMPTY_SHA256,
      contentLength: 0,
    });
    expect(canonical).toBe(
      [
        'BR1',
        'PUT',
        path,
        FILM_ID,
        RUN_ID,
        '1794120000',
        '0123456789abcdef0123456789abcdef',
        EMPTY_SHA256,
        '0',
      ].join('\n'),
    );
    const key = await deriveRunKey(MASTER, FILM_ID, RUN_ID);
    const expected = createHmac('sha256', Buffer.from(key, 'hex')).update(canonical).digest('hex');
    expect(await signCanonical(key, canonical)).toBe(`v1=${expected}`);
    expect(await verifyCanonical(key, canonical, `v1=${expected}`)).toBe(true);
    expect(await verifyCanonical(key, `${canonical}x`, `v1=${expected}`)).toBe(false);
    expect(await verifyCanonical(key, canonical, expected)).toBe(false);
    expect(await sha256Hex('')).toBe(EMPTY_SHA256);
  });

  const now = 1794120000;
  async function signed(overrides: { ts?: number; path?: string; master?: string } = {}) {
    const url = new URL(
      `https://site.test${overrides.path ?? `/api/runner/v1/films/${FILM_ID}/events`}`,
    );
    const headers = await signRequest({
      keyHex: await deriveRunKey(overrides.master ?? MASTER, FILM_ID, RUN_ID),
      method: 'POST',
      url,
      filmId: FILM_ID,
      runId: RUN_ID,
      ts: overrides.ts ?? now,
      bodySha256: EMPTY_SHA256,
      contentLength: 0,
    });
    return { url, headers: new Headers(headers) };
  }
  const keyFor = async (filmId: string, runId: string) =>
    filmId === FILM_ID && runId === RUN_ID ? deriveRunKey(MASTER, filmId, runId) : null;

  it('verify a good request', async () => {
    const { url, headers } = await signed();
    const result = await verifyRequest({
      method: 'POST',
      url,
      headers,
      contentLength: 0,
      now,
      keyFor,
    });
    expect(result).toMatchObject({ ok: true, filmId: FILM_ID, runId: RUN_ID });
    expect(headers.get(HEADERS.nonce)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('refuse a stale one, a forged one, another film and an unknown run', async () => {
    const stale = await signed({ ts: now - MAX_CLOCK_SKEW_SECONDS - 1 });
    expect(
      await verifyRequest({ method: 'POST', ...stale, contentLength: 0, now, keyFor }),
    ).toMatchObject({
      ok: false,
      status: 401,
      code: 'stale',
    });
    const forged = await signed({ master: 'someone-else-entirely-0123456789abcdef' });
    expect(
      await verifyRequest({ method: 'POST', ...forged, contentLength: 0, now, keyFor }),
    ).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
    const otherFilm = await signed({
      path: '/api/runner/v1/films/flm_00000000000000000000/events',
    });
    expect(
      await verifyRequest({ method: 'POST', ...otherFilm, contentLength: 0, now, keyFor }),
    ).toMatchObject({
      ok: false,
      status: 400,
    });
    const good = await signed();
    expect(
      await verifyRequest({
        method: 'POST',
        ...good,
        contentLength: 0,
        now,
        keyFor: async () => null,
      }),
    ).toMatchObject({ ok: false, code: 'unauthorized' });
    // The method and length are signed too.
    expect(
      await verifyRequest({ method: 'PUT', ...good, contentLength: 0, now, keyFor }),
    ).toMatchObject({ ok: false });
    expect(
      await verifyRequest({ method: 'POST', ...good, contentLength: 5, now, keyFor }),
    ).toMatchObject({ ok: false });
  });

  it('sign the watchdog call with its own key', async () => {
    const url = 'https://site.test/api/runner/v1/watchdog';
    const headers = new Headers(await signWatchdog(MASTER, url, '{"tick":1}', now));
    const result = await verifyRequest({
      method: 'POST',
      url,
      headers,
      contentLength: 10,
      now,
      keyFor: async (film, run) =>
        film === 'watchdog' && run === 'watchdog'
          ? createHmac('sha256', MASTER).update('br-watchdog/v1').digest('hex')
          : null,
    });
    expect(result.ok).toBe(true);
  });
});

describe('bootstrap.json and instructions', () => {
  const good = {
    v: 1,
    filmId: FILM_ID,
    runId: RUN_ID,
    callbackBase: 'https://boiler-room-web-staging.example.workers.dev/api/runner/v1',
    key: 'a'.repeat(64),
    issuedAt: 1794120000,
  };

  it('accept the documented shapes', () => {
    expect(parseBootstrap(good)).toEqual(good);
    expect(parseInstructions(instructionsFor('render')).approval?.formats).toEqual([
      '16:9',
      '9:16',
    ]);
    expect(parseInstructions(instructionsFor('script')).approval).toBeNull();
  });

  it('refuse plain http to anywhere but this machine, and a bad key or id', () => {
    expect(() =>
      parseBootstrap({ ...good, callbackBase: 'http://evil.test/api/runner/v1' }),
    ).toThrow(/https/);
    expect(
      parseBootstrap({ ...good, callbackBase: 'http://127.0.0.1:8787/api/runner/v1' }).filmId,
    ).toBe(FILM_ID);
    expect(() => parseBootstrap({ ...good, key: 'nothex' })).toThrow(/key/);
    expect(() => parseBootstrap({ ...good, filmId: 'flm_x' })).toThrow(/filmId/);
    expect(() => parseInstructions({ ...instructionsFor('render'), approval: null })).toThrow(
      /approval/,
    );
    expect(() =>
      parseInstructions({
        ...instructionsFor('render'),
        approval: { ...instructionsFor('render').approval, formats: ['4:3'] },
      }),
    ).toThrow(/formats/);
  });
});

describe('the film command', () => {
  it('is called with exactly these flags', () => {
    expect(
      filmCommandArgs({
        url: 'https://linear.app/',
        phase: 'render',
        runDir: '/home/naive/br-run/film',
        eventsFile: '/home/naive/br-run/film/events-render-2.jsonl',
        approvalFile: '/home/naive/br-run/approval.json',
        maxUsd: 1.5,
      }),
    ).toEqual([
      'https://linear.app/',
      '--phase',
      'render',
      '--run-dir',
      '/home/naive/br-run/film',
      '--events',
      '/home/naive/br-run/film/events-render-2.jsonl',
      '--max-usd',
      '1.50',
      '--render',
      'local',
      '--no-sync',
      '--approval',
      '/home/naive/br-run/approval.json',
    ]);
  });

  const line = (event: Record<string, unknown>) =>
    JSON.stringify({ v: 1, seq: 1, at: '2026-11-07T23:41:07.214Z', ...event });

  it('may write these events', () => {
    for (const event of [
      {
        type: 'stage',
        stage: 'research',
        status: 'working',
        agent: 'researcher',
        message: 'Reading.',
      },
      {
        type: 'decision',
        agent: 'validator',
        stage: 'checks',
        kind: 'sent_back',
        message: 'No source.',
      },
      { type: 'cost', step: 'researcher', microUsd: 1200, totalMicroUsd: 1200 },
      {
        type: 'artifact',
        kind: 'mp4',
        path: 'renders/a.mp4',
        contentType: 'video/mp4',
        version: 1,
        variantKey: '16:9.main.none',
      },
      { type: 'script_ready', version: 1, campaignPath: 'campaign.json', unconfirmedClaims: [] },
      { type: 'qc', format: '16:9', verdict: 'pass', routable: 0, issues: [] },
      { type: 'delivered', version: 1, variants: ['16:9.main.none'] },
      { type: 'error', code: 'qc_failed', message: 'Blocked.', stage: 'review', retryable: false },
    ]) {
      expect(parseFilmEvent(line(event)), JSON.stringify(event)).toMatchObject({ ok: true });
    }
  });

  it('may not leave the run dir, move the film into approval, or speak for the customer', () => {
    const refused = [
      {
        type: 'artifact',
        kind: 'still',
        path: '../../.boiler-room.env',
        contentType: 'image/png',
        version: 1,
      },
      {
        type: 'artifact',
        kind: 'still',
        path: '/etc/passwd',
        contentType: 'image/png',
        version: 1,
      },
      { type: 'artifact', kind: 'mp4', path: 'a.mp4', contentType: 'video/mp4', version: 1 },
      {
        type: 'artifact',
        kind: 'mp4',
        path: 'a.mp4',
        contentType: 'text/html',
        version: 1,
        variantKey: 'x',
      },
      { type: 'stage', stage: 'approval', status: 'working', agent: 'director', message: 'x' },
      {
        type: 'decision',
        agent: 'customer',
        stage: 'script',
        kind: 'decision',
        message: 'Approved.',
      },
      { type: 'shell', command: 'rm -rf /' },
    ];
    for (const event of refused) {
      expect(parseFilmEvent(line(event)), JSON.stringify(event)).toMatchObject({ ok: false });
    }
    expect(parseFilmEvent('not json')).toMatchObject({ ok: false });
  });

  it('names files safely', () => {
    expect(safeName('../Contact Sheet (16:9).PNG')).toBe('contact-sheet-16-9-.png');
    expect(safeName('...')).toBe('file');
  });
});
