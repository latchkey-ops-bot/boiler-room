import sample from '@boiler-room/schema/examples/nova.campaign.json';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filmRuns, runEvents, runFiles, runnerNonces } from '../src/db/schema.ts';
import type { Principal } from '../src/server/api/context.ts';
import { createFilm } from '../src/server/api/films.ts';
import {
  canonicalString,
  deriveRunKey,
  deriveWatchdogKey,
  EMPTY_SHA256,
  fromHex,
  HEADERS,
  LAUNCH_COMMAND,
  STOP_COMMAND,
  sha256Hex,
  signedHeaders,
  signParts,
  signWatchdog,
  UPLOAD_KINDS,
  variantKey,
  verifyParts,
} from '../src/server/runner/contract.ts';
import { readAtMost, watchdogRoute } from '../src/server/runner/routes.ts';
import {
  boundAppRequest,
  isRunnerPath,
  MAX_APP_BODY_BYTES,
  runnerFetch,
} from '../src/server/runner/worker-routes.ts';
import { startWorkerEnv } from './helpers.ts';
import { body, type Harness, runnerClient, runnerHarness, SECRET } from './runner-helpers.ts';

type Proxy = Awaited<ReturnType<typeof startWorkerEnv>>;
let proxy: Proxy;

beforeAll(async () => {
  proxy = await startWorkerEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});

const ROOMY = {
  MAX_REAL_GLOBAL: '100',
  MAX_REAL_PER_ACCOUNT: '100',
  ACCOUNT_DAILY_CAP_USD: '1000',
  GLOBAL_DAILY_CAP_USD: '1000',
};

let users = 0;
const newUser = (): Principal => {
  users += 1;
  return { userId: `user_routes_${users}`, orgId: null };
};

async function realFilm(harness: Harness, user: Principal) {
  const ctx = await harness.context(user);
  const { film } = await createFilm(ctx, { url: 'nova.com' });
  await harness.flush();
  const run = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.filmId, film.id) });
  const boot = harness.naive.bootstrap(run?.computerId as string);
  return { film, run: run as NonNullable<typeof run>, boot, runner: runnerClient(harness, boot) };
}

describe('the signature contract', () => {
  const parts = {
    method: 'PUT',
    pathAndQuery:
      '/api/runner/v1/films/flm_4k8d2m7q9x1z3c5v6b8n/files?kind=mp4&version=1&variant=16%3A9.main.start-free',
    filmId: 'flm_4k8d2m7q9x1z3c5v6b8n',
    runId: 'run_7w2e4r6t8y1u3i5o7p9a',
    ts: 1794120000,
    nonce: '00112233445566778899aabbccddeeff',
    bodySha256: EMPTY_SHA256,
    contentLength: 0,
  };

  it('signs one fixed canonical string, a field per line, with the query exactly as sent', () => {
    expect(canonicalString(parts)).toBe(
      [
        'BR1',
        'PUT',
        '/api/runner/v1/films/flm_4k8d2m7q9x1z3c5v6b8n/files?kind=mp4&version=1&variant=16%3A9.main.start-free',
        'flm_4k8d2m7q9x1z3c5v6b8n',
        'run_7w2e4r6t8y1u3i5o7p9a',
        '1794120000',
        '00112233445566778899aabbccddeeff',
        EMPTY_SHA256,
        '0',
      ].join('\n'),
    );
    // The runner builds its query with URLSearchParams and signs what URL serialises.
    const url = new URL('https://x.test/api/runner/v1/films/flm_4k8d2m7q9x1z3c5v6b8n/files');
    url.search = new URLSearchParams({
      kind: 'mp4',
      version: '1',
      variant: '16:9.main.start-free',
    }).toString();
    expect(url.pathname + url.search).toBe(parts.pathAndQuery);
  });

  it('pins the per-run key and a signature, so the runner can check its copy against them', async () => {
    const key = await deriveRunKey(SECRET, parts.filmId, parts.runId);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await deriveRunKey(SECRET, parts.filmId, parts.runId)).toBe(key);
    expect(await deriveRunKey(SECRET, parts.filmId, 'run_other0000000000000')).not.toBe(key);
    expect(await deriveRunKey(SECRET, 'flm_other0000000000000', parts.runId)).not.toBe(key);
    expect(await deriveWatchdogKey(SECRET)).not.toBe(key);
    const signature = await signParts(key, parts);
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(await verifyParts(key, parts, signature)).toBe(true);
    for (const change of [
      { ts: parts.ts + 1 },
      { nonce: 'ffffffffffffffffffffffffffffffff' },
      { pathAndQuery: parts.pathAndQuery.replace('16%3A9', '9%3A16') },
      { contentLength: 1 },
      { method: 'POST' },
    ]) {
      expect(await verifyParts(key, { ...parts, ...change }, signature)).toBe(false);
    }
    expect(await verifyParts(key, parts, 'v1=00')).toBe(false);
    expect(await sha256Hex('')).toBe(EMPTY_SHA256);
    expect(fromHex('00ff').length).toBe(2);
    expect(variantKey('16:9', null, 'start-free')).toBe('16:9.main.start-free');
  });

  it('puts no secret in the commands the website runs on a computer', () => {
    for (const command of [LAUNCH_COMMAND, STOP_COMMAND]) {
      expect(command).not.toMatch(/key|secret|token|https?:/i);
    }
    expect(LAUNCH_COMMAND).toContain('setsid');
    expect(LAUNCH_COMMAND).toContain('flock -n');
  });
});

describe('runner routes', () => {
  it('accepts a signed call and refuses a forged, changed or stale one', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { runner, boot } = await realFilm(harness, user);
    expect((await runner.hello('script')).status).toBe(200);

    // A key that is not this run's.
    const forged = await runner.send('instructions', undefined, { key: 'ab'.repeat(32) });
    expect(forged.status).toBe(401);
    expect(await body(forged)).toMatchObject({ error: { code: 'unauthorized' } });
    // A signature changed after signing.
    const changed = await runner.send('instructions', undefined, {
      tamper: (headers) => {
        headers[HEADERS.signature] = `v1=${'0'.repeat(64)}`;
      },
    });
    expect(changed.status).toBe(401);
    // A declared body hash changed after signing: the signature covers the hash.
    const swapped = await runner.send(
      'events',
      {
        runId: boot.runId,
        events: [{ seq: 50, at: '', phase: 'script', type: 'runner.heartbeat' }],
      },
      {
        tamper: (headers) => {
          headers[HEADERS.bodySha256] = 'cd'.repeat(32);
        },
      },
    );
    expect(swapped.status).toBe(401);

    // More than five minutes off the server clock, either way.
    const now = Math.floor(harness.clock.now().getTime() / 1000);
    for (const ts of [now - 301, now + 301]) {
      const stale = await runner.send('instructions', undefined, { ts });
      expect(stale.status).toBe(401);
      expect(await body(stale)).toMatchObject({ error: { code: 'stale' }, serverTime: now });
    }
    expect((await runner.send('instructions', undefined, { ts: now - 299 })).status).toBe(200);
  });

  it('refuses a body that does not match its signed hash, before storing anything', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { runner, boot, run } = await realFilm(harness, user);
    await runner.hello('script');
    const real = new TextEncoder().encode(
      JSON.stringify({
        runId: boot.runId,
        events: [
          {
            seq: 9,
            at: '',
            phase: 'script',
            type: 'stage',
            stage: 'research',
            agent: 'researcher',
            message: 'x',
          },
        ],
      }),
    );
    const other = new TextEncoder().encode(
      JSON.stringify({
        runId: boot.runId,
        events: [
          {
            seq: 9,
            at: '',
            phase: 'script',
            type: 'stage',
            stage: 'research',
            agent: 'researcher',
            message: 'y',
          },
        ],
      }),
    );
    expect(real.byteLength).toBe(other.byteLength);
    const { request, handle, filmId } = await runner.build('events', undefined, { body: real });
    const mutated = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: other,
    });
    const response = await handle(mutated, { params: Promise.resolve({ filmId }) });
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: 'body_hash' } });
    const rows = await harness.db.select().from(runEvents).where(eq(runEvents.runId, run.id));
    expect(rows.map((row) => row.type)).toEqual(['runner.hello']);
  });

  it('refuses a replay: the same signed request twice', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { runner, boot, run } = await realFilm(harness, user);
    await runner.hello('script');
    const payload = {
      runId: boot.runId,
      events: [
        {
          seq: 20,
          at: '',
          phase: 'script',
          type: 'decision',
          agent: 'researcher',
          kind: 'decision',
          message: 'Once.',
        },
      ],
    };
    const nonce = 'aa'.repeat(16);
    const first = await runner.send('events', payload, { nonce });
    expect(first.status).toBe(200);
    const replay = await runner.send('events', payload, { nonce });
    expect(replay.status).toBe(409);
    expect(await body(replay)).toMatchObject({ error: { code: 'replay' } });
    // A resend with a new nonce (a lost answer) is accepted and changes nothing.
    expect((await runner.send('events', payload)).status).toBe(200);
    const decisions = await harness.db.select().from(runEvents).where(eq(runEvents.runId, run.id));
    expect(decisions.filter((row) => row.type === 'decision')).toHaveLength(1);
    const nonces = await harness.db
      .select()
      .from(runnerNonces)
      .where(eq(runnerNonces.nonce, nonce));
    expect(nonces).toHaveLength(1);
  });

  it("never lets one film's computer act for another film", async () => {
    const alice = newUser();
    const bob = newUser();
    const harness = runnerHarness(proxy, { realUsers: [alice.userId, bob.userId], vars: ROOMY });
    const a = await realFilm(harness, alice);
    const b = await realFilm(harness, bob);
    await a.runner.hello('script');
    await b.runner.hello('script');

    // Film A's key, run and headers, sent to film B's path: the path and the header disagree.
    expect((await a.runner.send('instructions', undefined, { pathFilm: b.film.id })).status).toBe(
      400,
    );
    // Film A's key, claiming to be film B: B's run is not A's, and A's key does not sign for B.
    const claimB = await a.runner.send('instructions', undefined, {
      pathFilm: b.film.id,
      filmHeader: b.film.id,
      runHeader: b.boot.runId,
    });
    expect(claimB.status).toBe(401);
    // Film A's run id with film B's film id: the run does not belong to that film.
    const mixed = await a.runner.send('instructions', undefined, {
      pathFilm: b.film.id,
      filmHeader: b.film.id,
    });
    expect(mixed.status).toBe(401);
    // The answer for a run that does not exist is the same as for a bad signature.
    const unknown = await a.runner.send('instructions', undefined, {
      runHeader: 'run_00000000000000000000',
    });
    expect(unknown.status).toBe(401);
    expect(await body(unknown)).toEqual(await body(claimB));

    // An event batch naming another run is refused.
    const wrongBody = await a.runner.send('events', {
      runId: b.boot.runId,
      events: [{ seq: 99, at: '', phase: 'script', type: 'runner.heartbeat' }],
    });
    expect(wrongBody.status).toBe(400);
    // Nothing the runner sends names an owner: B's film is still B's.
    const filmB = await harness.db.query.films.findFirst({
      where: (t, { eq: is }) => is(t.id, b.film.id),
    });
    expect(filmB?.createdBy).toBe(bob.userId);
  });

  it('refuses calls in the wrong state, and from a run that is no longer the film’s', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { runner, run } = await realFilm(harness, user);
    // Events before hello: the run is launching.
    const early = await runner.events('script', [
      { type: 'stage', stage: 'research', agent: 'researcher', message: 'x' },
    ]);
    expect(early.status).toBe(409);
    expect(await body(early)).toMatchObject({ error: { code: 'wrong_state' } });
    // The wrong phase.
    expect((await runner.hello('render')).status).toBe(409);
    expect((await runner.hello('script')).status).toBe(200);
    // An MP4 during the script phase.
    const mp4 = await runner.upload(
      { kind: 'mp4', version: '1', variant: '16:9.main.start-free' },
      new TextEncoder().encode('v'),
      'video/mp4',
    );
    expect(mp4.status).toBe(409);
    // Once the film points at another run, the old run's key is worthless.
    await harness.db.update(filmRuns).set({ state: 'failed' }).where(eq(filmRuns.id, run.id));
    const { films } = await import('../src/db/schema.ts');
    await harness.db
      .update(films)
      .set({ pipelineRunId: 'run_replaced0000000000' })
      .where(eq(films.id, run.filmId));
    const stale = await runner.send('instructions');
    expect(stale.status).toBe(409);
    expect(await body(stale)).toMatchObject({ error: { code: 'wrong_run' } });
  });

  it('stores an upload only when R2 confirms its signed hash', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { runner, film, run } = await realFilm(harness, user);
    await runner.hello('script');
    const bytes = new TextEncoder().encode(JSON.stringify(sample));
    // The declared hash is another body's: R2 refuses the put.
    const bad = await runner.upload({ kind: 'campaign', version: '1' }, bytes, 'application/json', {
      tamper: (headers) => {
        headers[HEADERS.bodySha256] = EMPTY_SHA256;
      },
    });
    expect(bad.status).toBe(401);
    // Signed over the wrong hash, so the signature passes and R2 is the check.
    const url = new URL(
      `https://staging.test/api/runner/v1/films/${film.id}/files?kind=campaign&version=1`,
    );
    const headers = await signedHeaders({
      keyHex: (await deriveRunKey(SECRET, film.id, run.id)) as string,
      method: 'PUT',
      url: url.toString(),
      filmId: film.id,
      runId: run.id,
      body: bytes,
      nowSeconds: Math.floor(harness.clock.now().getTime() / 1000),
    });
    headers[HEADERS.bodySha256] = 'ab'.repeat(32);
    const { runnerRoute, files } = await import('../src/server/runner/routes.ts');
    // Re-sign with the wrong hash in the canonical string, as a runner with a bug would.
    const { signParts: sign } = await import('../src/server/runner/contract.ts');
    headers[HEADERS.signature] = await sign(await deriveRunKey(SECRET, film.id, run.id), {
      method: 'PUT',
      pathAndQuery: url.pathname + url.search,
      filmId: film.id,
      runId: run.id,
      ts: Number(headers[HEADERS.ts]),
      nonce: headers[HEADERS.nonce] as string,
      bodySha256: 'ab'.repeat(32),
      contentLength: bytes.byteLength,
    });
    const request = new Request(url, {
      method: 'PUT',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'content-length': String(bytes.byteLength),
      },
      body: bytes,
    });
    const refused = await runnerRoute(
      harness.deps,
      { jsonLimit: null },
      files,
    )(request, {
      params: Promise.resolve({ filmId: film.id }),
    });
    expect(refused.status).toBe(400);
    expect(await body(refused)).toMatchObject({ error: { code: 'checksum' } });
    expect(await proxy.env.FILMS.head(`films/${film.id}/v1/campaign.json`)).toBeNull();
    expect(await harness.db.select().from(runFiles).where(eq(runFiles.runId, run.id))).toEqual([]);

    // The same body with its own hash is stored.
    const good = await runner.upload({ kind: 'campaign', version: '1' }, bytes, 'application/json');
    expect(good.status).toBe(200);
    expect(await proxy.env.FILMS.head(`films/${film.id}/v1/campaign.json`)).not.toBeNull();
  });

  it('refuses an upload that is too large, of the wrong type or kind, before reading it', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { runner } = await realFilm(harness, user);
    await runner.hello('script');
    const small = new TextEncoder().encode('{}');
    expect(
      (await runner.upload({ kind: 'campaign', version: '1' }, small, 'text/plain')).status,
    ).toBe(415);
    expect(
      (await runner.upload({ kind: 'nonsense', version: '1' }, small, 'application/json')).status,
    ).toBe(400);
    expect(
      (await runner.upload({ kind: 'campaign', version: '2' }, small, 'application/json')).status,
    ).toBe(409);
    // A declared length over the kind's limit is refused on the header alone.
    const huge = await runner.upload(
      { kind: 'campaign', version: '1' },
      small,
      'application/json',
      {
        tamper: (headers) => {
          headers['content-length'] = String(2 * 1024 * 1024);
        },
      },
    );
    expect([401, 413]).toContain(huge.status);
  });

  it('answers the same with or without a Clerk session: the middleware leaves runner routes alone', async () => {
    const { config } = await import('../src/middleware.ts');
    // Next compiles each matcher as a path pattern; these are the regular expressions it yields.
    const [pages, api] = config.matcher as string[];
    const asRegex = (pattern: string) => new RegExp(`^${pattern.replace(/\(\.\*\)/g, '(.*)')}$`);
    expect(asRegex(pages as string).test('/api/runner/v1/films/flm_x/events')).toBe(false);
    expect(asRegex(api as string).test('/api/runner/v1/films/flm_x/events')).toBe(false);
    expect(asRegex(api as string).test('/api/films')).toBe(true);
    expect(asRegex(pages as string).test('/films')).toBe(true);
  });
});

describe('the watchdog route', () => {
  it('runs a tick only when the cron signed it, and only once', async () => {
    const harness = runnerHarness(proxy, { vars: ROOMY });
    const route = watchdogRoute(harness.deps);
    const url = 'https://staging.test/api/runner/v1/watchdog';
    const tick = JSON.stringify({ tick: harness.clock.now().getTime() });
    const now = Math.floor(harness.clock.now().getTime() / 1000);
    const headers = await signWatchdog(SECRET, url, tick, now);
    const ok = await route(new Request(url, { method: 'POST', headers, body: tick }));
    expect(ok.status).toBe(200);
    expect(await body(ok)).toHaveProperty('actions');
    const again = await route(new Request(url, { method: 'POST', headers, body: tick }));
    expect(again.status).toBe(409);
    const wrong = await signWatchdog('another-secret-that-is-long-enough-to-use', url, tick, now);
    expect(
      (await route(new Request(url, { method: 'POST', headers: wrong, body: tick }))).status,
    ).toBe(401);
    // A run's key cannot sign for the watchdog.
    const runKey = await deriveRunKey(SECRET, 'watchdog', 'watchdog');
    const asRun = await signedHeaders({
      keyHex: runKey,
      method: 'POST',
      url,
      filmId: 'watchdog',
      runId: 'watchdog',
      body: new TextEncoder().encode(tick),
      nowSeconds: now,
    });
    expect(
      (
        await route(
          new Request(url, {
            method: 'POST',
            headers: { ...asRun, 'content-type': 'application/json' },
            body: tick,
          }),
        )
      ).status,
    ).toBe(401);
  });
});

describe('the runner routes in front of OpenNext', () => {
  const env = () => ({ DB: proxy.env.DB, FILMS: proxy.env.FILMS });
  const ctx = { waitUntil: () => undefined };

  /** A body that fails the test if anything reads it. */
  const unread = () =>
    new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('The body was read.');
      },
    });

  it('answers an unsigned 90 MiB upload from its headers alone, without reading the body', async () => {
    const harness = runnerHarness(proxy);
    const request = new Request(
      'https://staging.test/api/runner/v1/films/flm_aaaaaaaaaaaaaaaaaaaa/files?kind=mp4',
      {
        method: 'PUT',
        headers: { 'content-length': String(90 * 1024 * 1024), 'content-type': 'video/mp4' },
        body: unread(),
        duplex: 'half',
      } as RequestInit,
    );
    const response = await runnerFetch(request, env(), ctx, harness.deps);
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: 'bad_signature_headers' } });
  });

  it('routes only the runner’s own calls, each with its one method', async () => {
    const harness = runnerHarness(proxy);
    const call = (method: string, path: string) =>
      runnerFetch(new Request(`https://staging.test${path}`, { method }), env(), ctx, harness.deps);
    expect(isRunnerPath('/api/runner/v1/films/x/hello')).toBe(true);
    expect(isRunnerPath('/api/runnerish')).toBe(false);
    expect((await call('GET', '/api/runner/v1/films/flm_aaaaaaaaaaaaaaaaaaaa/hello')).status).toBe(
      405,
    );
    expect((await call('GET', '/api/runner/v1/watchdog')).status).toBe(405);
    expect((await call('POST', '/api/runner/v1/films/flm_x/elsewhere')).status).toBe(404);
  });

  it('refuses a JSON body over its limit as it reads, with or without a length', async () => {
    const big = new Uint8Array(300 * 1024);
    const chunked = new Request('https://staging.test/x', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(big);
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    await expect(readAtMost(chunked, 256 * 1024)).rejects.toMatchObject({ status: 413 });
    const small = new Request('https://staging.test/x', { method: 'POST', body: '{"a":1}' });
    expect(new TextDecoder().decode(await readAtMost(small, 256 * 1024))).toBe('{"a":1}');
  });

  it('turns away a body over 1 MiB for any other route before OpenNext reads it', async () => {
    const declared = new Request('https://staging.test/api/films', {
      method: 'POST',
      headers: { 'content-length': String(MAX_APP_BODY_BYTES + 1) },
      body: unread(),
      duplex: 'half',
    } as RequestInit);
    const refused = boundAppRequest(declared);
    expect(refused).toBeInstanceOf(Response);
    expect((refused as Response).status).toBe(413);
    const fine = new Request('https://staging.test/api/films', {
      method: 'POST',
      headers: { 'content-length': '2' },
      body: '{}',
    });
    expect(boundAppRequest(fine)).toBe(fine);
    const endless = new Request('https://staging.test/api/films', {
      method: 'POST',
      body: new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(64 * 1024));
        },
      }),
      duplex: 'half',
    } as RequestInit);
    const bounded = boundAppRequest(endless) as Request;
    await expect(bounded.arrayBuffer()).rejects.toThrow(/too large/);
  });

  it('caps an MP4 at 60 MiB, the one limit both ends read', () => {
    expect(UPLOAD_KINDS.mp4.maxBytes).toBe(60 * 1024 * 1024);
  });
});

describe('a runner the website will not take', () => {
  it('fails the film at once when the runner speaks another contract', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { run, runner } = await realFilm(harness, user);
    const refused = await runner.hello(null, { contract: undefined });
    expect(refused.status).toBe(409);
    expect(await body(refused)).toMatchObject({ error: { code: 'runner_mismatch' } });
    await harness.flush();
    const failed = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, run.id) });
    expect(failed).toMatchObject({ failureCode: 'runner_outdated', launchAttempts: 1 });
  });

  it('keeps a hello that names its phase only when it is the run’s', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { runner } = await realFilm(harness, user);
    expect((await runner.hello('render')).status).toBe(409);
    expect((await runner.hello(null)).status).toBe(200);
  });
});
