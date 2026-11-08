import sample from '@boiler-room/schema/examples/nova.campaign.json';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filmRuns, runFiles } from '../src/db/schema.ts';
import { type Principal, pipelineKindFor } from '../src/server/api/context.ts';
import {
  createFilm,
  downloadDeliverable,
  getFilmDetail,
  requestRevision,
  reviewScript,
} from '../src/server/api/films.ts';
import { LAUNCH_COMMAND, SCRUB_COMMAND, sha256Hex } from '../src/server/runner/contract.ts';
import { startWorkerEnv } from './helpers.ts';
import { body, type Harness, HOME, runnerClient, runnerHarness } from './runner-helpers.ts';

type Proxy = Awaited<ReturnType<typeof startWorkerEnv>>;
let proxy: Proxy;

beforeAll(async () => {
  proxy = await startWorkerEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});

let users = 0;
const newUser = (): Principal => {
  users += 1;
  return { userId: `user_flow_${users}`, orgId: null };
};

/** Caps wide enough that the films in this file never meet each other. */
const ROOMY = {
  MAX_REAL_GLOBAL: '100',
  MAX_REAL_PER_ACCOUNT: '100',
  ACCOUNT_DAILY_CAP_USD: '1000',
  GLOBAL_DAILY_CAP_USD: '1000',
};

const campaignBytes = new TextEncoder().encode(JSON.stringify(sample));
const approve = {
  decision: 'approve' as const,
  version: 1,
  hookId: null,
  ctaId: 'start-free',
  formats: ['16:9' as const, '1:1' as const],
  // The sample's price is cited but nobody has confirmed it.
  confirmedClaimIds: ['pricing'],
};

async function startRealFilm(harness: Harness, user: Principal) {
  const ctx = await harness.context(user);
  const detail = await createFilm(ctx, { url: 'nova.com' });
  await harness.flush();
  const run = await harness.db.query.filmRuns.findFirst({
    where: eq(filmRuns.filmId, detail.film.id),
  });
  if (!run?.computerId) throw new Error('The film has no computer');
  const runner = runnerClient(harness, harness.naive.bootstrap(run.computerId));
  return { ctx, film: detail.film, run, runner };
}

async function runScriptPhase(harness: Harness, runner: ReturnType<typeof runnerClient>) {
  expect((await runner.hello('script')).status).toBe(200);
  const events = await runner.events('script', [
    { type: 'stage', stage: 'research', agent: 'researcher', message: 'Reading nova.com.' },
    {
      type: 'decision',
      agent: 'researcher',
      kind: 'decision',
      message: 'Read 9 pages of nova.com and kept 14 claims.',
    },
    { type: 'cost', step: 'researcher', microUsd: 400_000, totalMicroUsd: 400_000 },
    { type: 'stage', stage: 'script', agent: 'director', message: 'Writing the script.' },
  ]);
  expect(events.status).toBe(200);
  const upload = await runner.upload(
    { kind: 'campaign', version: '1' },
    campaignBytes,
    'application/json',
  );
  expect(upload.status).toBe(200);
  const { fileId } = (await body(upload)) as { fileId: string };
  const ready = await runner.events('script', [
    {
      type: 'decision',
      agent: 'validator',
      kind: 'passed',
      message: 'Every number is backed by a quote.',
    },
    { type: 'script_ready', version: 1, campaignFileId: fileId, unconfirmedClaims: ['pricing'] },
    { type: 'runner.exit', exitCode: 0, signal: null, durationMs: 1000 },
  ]);
  expect(ready.status).toBe(200);
  await harness.flush();
}

describe('a real film, end to end', () => {
  it('researches, pauses for approval, resumes, renders and delivers real files', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { ctx, film, run, runner } = await startRealFilm(harness, user);

    // The film is real: no simulated label, and this founder's banner is off.
    expect(film).toMatchObject({ pipeline: 'naive', simulated: false });
    expect(pipelineKindFor(harness.bindings, user)).toBe('naive');
    expect(pipelineKindFor(harness.bindings, newUser())).toBe('simulated');

    // One computer, forked from the base snapshot, named for the film, and the runner launched.
    expect(harness.naive.calls[0]).toMatchObject({ op: 'create', detail: 'snp_base' });
    expect([...harness.naive.computers.values()][0]?.name).toBe(`br-film-staging-${film.id}`);
    expect(harness.naive.ops()).toEqual([
      'create',
      'get',
      'inspect',
      'fs/mkdir',
      'fs/write',
      'exec',
    ]);
    expect(harness.naive.calls.at(-1)?.detail).toBe(LAUNCH_COMMAND);
    // Where the runner reads it: `<home>/br-run/bootstrap.json`, in a directory made first.
    expect(harness.naive.calls.slice(3, 5).map((call) => call.detail)).toEqual([
      `${HOME}/br-run`,
      `${HOME}/br-run/bootstrap.json`,
    ]);
    // The bootstrap names this film and run only, and the launch command carries no key.
    const boot = harness.naive.bootstrap(run.computerId as string);
    expect(boot).toMatchObject({ v: 1, filmId: film.id, runId: run.id });
    expect(boot.callbackBase).toBe('https://staging.test/api/runner/v1');
    expect(LAUNCH_COMMAND).not.toContain(boot.key);
    expect((await getFilmDetail(ctx, film.id)).film).toMatchObject({
      status: 'working',
      stage: 'research',
    });

    const instructions = await body(await runner.send('instructions'));
    expect(instructions).toMatchObject({
      phase: 'script',
      mode: 'customer',
      url: 'https://nova.com/',
      approval: null,
    });

    await runScriptPhase(harness, runner);

    // The approval gate: delete any key left on the disk, checkpoint, then pause. A paused
    // computer costs nothing.
    const gated = harness.naive.calls.slice(6);
    expect(gated.map((call) => call.op)).toEqual(['exec', 'snapshot', 'pause']);
    expect(gated[0]?.detail).toBe(SCRUB_COMMAND);
    let detail = await getFilmDetail(ctx, film.id);
    expect(detail.film).toMatchObject({ status: 'needs_you', stage: 'approval', scriptVersion: 1 });
    expect(detail.campaign?.brand.name).toBe('Nova');
    // The crew's real decisions are on the feed, in order, and nothing simulated is.
    expect(detail.events.map((event) => [event.agent, event.kind])).toEqual([
      ['coordinator', 'started'],
      ['researcher', 'started'],
      ['researcher', 'decision'],
      ['director', 'started'],
      ['validator', 'passed'],
      ['coordinator', 'needs_you'],
    ]);
    expect(detail.events[2]?.message).toBe('Read 9 pages of nova.com and kept 14 claims.');
    expect(detail.events.at(-1)?.message).toContain('Version 1 of the script is ready for you.');

    // The founder approves on the script review page. The computer comes back.
    detail = await reviewScript(ctx, film.id, approve);
    expect(detail.film).toMatchObject({ status: 'working', stage: 'art_direction' });
    await harness.flush();
    expect(harness.naive.ops().slice(9)).toEqual([
      'get',
      'resume',
      'inspect',
      'fs/mkdir',
      'fs/write',
      'exec',
    ]);

    expect((await runner.hello()).status).toBe(200);
    const render = await body(await runner.send('instructions'));
    expect(render).toMatchObject({
      phase: 'render',
      approval: {
        version: 1,
        hookId: null,
        ctaId: 'start-free',
        formats: ['16:9', '1:1'],
        confirmedClaimIds: ['pricing'],
      },
    });

    // A cut that was not approved is refused; the approved ones are stored.
    const mp4 = new TextEncoder().encode('not really a video');
    const refused = await runner.upload(
      { kind: 'mp4', version: '1', variant: '9:16.main.start-free' },
      mp4,
      'video/mp4',
    );
    expect(refused.status).toBe(409);
    // Delivered before the files are in: refused, so the runner uploads and sends it again.
    const early = await runner.events('render', [
      { type: 'delivered', version: 1, variants: ['16:9.main.start-free'] },
    ]);
    expect(early.status).toBe(409);
    for (const variant of ['16:9.main.start-free', '1:1.main.start-free']) {
      const stored = await runner.upload({ kind: 'mp4', version: '1', variant }, mp4, 'video/mp4');
      expect(stored.status).toBe(200);
    }
    const delivered = await runner.events('render', [
      { type: 'stage', stage: 'render', agent: 'render', message: 'Rendering two shapes.' },
      { type: 'qc', format: '16:9', verdict: 'pass', routable: 0, issues: [] },
      { type: 'qc', format: '1:1', verdict: 'pass', routable: 0, issues: [] },
      { type: 'delivered', version: 1, variants: ['16:9.main.start-free', '1:1.main.start-free'] },
      { type: 'runner.exit', exitCode: 0, signal: null, durationMs: 2000 },
    ]);
    expect(delivered.status).toBe(200);
    await harness.flush();

    detail = await getFilmDetail(ctx, film.id);
    expect(detail.film).toMatchObject({ status: 'done', stage: 'delivery', simulated: false });
    expect(detail.deliverables.map((file) => file.format).sort()).toEqual(['16:9', '1:1']);
    for (const file of detail.deliverables) expect(file.downloadUrl).not.toBeNull();
    const response = await downloadDeliverable(ctx, film.id, detail.deliverables[0]?.id ?? '');
    expect(await response.text()).toBe('not really a video');
    expect(detail.events.map((event) => event.agent)).toContain('account_manager');
    expect(detail.events.find((event) => event.agent === 'customer')?.message).toContain(
      'You approved version 1',
    );

    // The end: computer destroyed, checkpoint deleted, nothing left on Naive.
    expect(harness.naive.live()).toEqual([]);
    expect(harness.naive.snapshots.size).toBe(0);
    const ended = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, run.id) });
    expect(ended).toMatchObject({ state: 'ended', computerState: 'destroyed', checkpointId: null });

    // Revisions of a real film are not built yet: 503, and nothing is recorded.
    await expect(
      requestRevision(ctx, film.id, { version: 1, note: 'Bigger logo' }),
    ).rejects.toThrow('Revisions of real films');
  });

  it('forks the checkpoint when Naive destroyed the paused computer before approval', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { ctx, film, run, runner } = await startRealFilm(harness, user);
    await runScriptPhase(harness, runner);
    const paused = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, run.id) });
    expect(paused).toMatchObject({ state: 'awaiting_approval', computerState: 'paused' });
    // Naive destroys every computer 12 hours after it was made.
    for (const computer of harness.naive.computers.values()) computer.status = 'destroyed';

    await reviewScript(ctx, film.id, approve);
    await harness.flush();
    const creates = harness.naive.calls.filter((call) => call.op === 'create');
    expect(creates.map((call) => call.detail)).toEqual(['snp_base', paused?.checkpointId]);
    const back = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, run.id) });
    expect(back).toMatchObject({ state: 'launching', computerState: 'running' });
    expect(back?.computerId).not.toBe(run.computerId);
    // The new computer got a bootstrap for the same film and run.
    expect(harness.naive.bootstrap(back?.computerId as string)).toMatchObject({
      filmId: film.id,
      runId: run.id,
    });
  });

  it('fails the film plainly when the computer and its checkpoint are both gone', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { ctx, film, run, runner } = await startRealFilm(harness, user);
    harness.naive.failNext('snapshot', 500);
    await runScriptPhase(harness, runner);
    const paused = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, run.id) });
    expect(paused).toMatchObject({ state: 'awaiting_approval', checkpointId: null });
    expect(paused?.lastError).toContain('checkpoint_failed');
    for (const computer of harness.naive.computers.values()) computer.status = 'destroyed';

    await reviewScript(ctx, film.id, approve);
    await harness.flush();
    const detail = await getFilmDetail(ctx, film.id);
    expect(detail.film.status).toBe('failed');
    expect(detail.events.at(-1)?.message).toContain('expired while the script waited for you');
  });

  it('keeps the approval when Naive refuses to resume, and the cron brings the computer back', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { ctx, film, run, runner } = await startRealFilm(harness, user);
    await runScriptPhase(harness, runner);
    harness.naive.failNext('resume', 402, 'insufficient_credits');
    // The approval is recorded even though the computer did not come back yet.
    const detail = await reviewScript(ctx, film.id, approve);
    expect(detail.approvals).toHaveLength(1);
    await harness.flush();
    let state = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, run.id) });
    expect(state).toMatchObject({ state: 'render_queued' });
    expect(state?.lastError).toContain('resume_refused');

    const { advance } = await import('../src/server/runner/advance.ts');
    await advance(harness.deps(), run.id);
    state = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, run.id) });
    expect(state).toMatchObject({ state: 'launching', phase: 'render' });
  });

  it('runs a GTM sample film straight through, with no approval pause', async () => {
    const harness = runnerHarness(proxy, { vars: ROOMY });
    const user = newUser();
    const ctx = await harness.context(user);
    // A sample is started by the GTM routes, on the pipeline directly.
    const { films } = await import('../src/db/schema.ts');
    const id = 'flm_sample00000000000000'.slice(0, 24);
    const now = harness.clock.now();
    await harness.db.insert(films).values({
      id,
      accountId: ctx.account.id,
      createdBy: user.userId,
      url: 'https://nova.com/',
      status: 'queued',
      stage: 'research',
      pipeline: 'naive',
      createdAt: now,
      updatedAt: now,
    });
    const { runId } = await ctx
      .pipelineFor('naive')
      .start({ filmId: id, url: 'https://nova.com/', mode: 'sample' });
    await harness.flush();
    const run = await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, runId) });
    const runner = runnerClient(harness, harness.naive.bootstrap(run?.computerId as string));
    expect((await runner.hello('all')).status).toBe(200);
    expect(await body(await runner.send('instructions'))).toMatchObject({
      phase: 'all',
      mode: 'sample',
      sampleFormats: ['16:9'],
    });

    const upload = await runner.upload(
      { kind: 'campaign', version: '1' },
      campaignBytes,
      'application/json',
    );
    const { fileId } = (await body(upload)) as { fileId: string };
    expect(
      (
        await runner.events('all', [
          { type: 'script_ready', version: 1, campaignFileId: fileId, unconfirmedClaims: [] },
        ])
      ).status,
    ).toBe(200);
    // No pause: the run carries on.
    expect(harness.naive.ops()).not.toContain('pause');
    expect(
      (await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, runId) }))?.state,
    ).toBe('render_running');
    // A sample is cut to 16:9 only.
    const mp4 = new TextEncoder().encode('sample video');
    expect(
      (
        await runner.upload(
          { kind: 'mp4', version: '1', variant: '9:16.main.start-free' },
          mp4,
          'video/mp4',
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await runner.upload(
          { kind: 'mp4', version: '1', variant: '16:9.main.start-free' },
          mp4,
          'video/mp4',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await runner.events('all', [
          { type: 'delivered', version: 1, variants: ['16:9.main.start-free'] },
          { type: 'runner.exit', exitCode: 0, signal: null, durationMs: 1 },
        ])
      ).status,
    ).toBe(200);
    await harness.flush();
    expect(
      (await harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, runId) }))?.state,
    ).toBe('ended');
    expect(harness.naive.live()).toEqual([]);
  });

  it('fails a film whose campaign does not pass validateCampaign, and cleans up', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { ctx, film, runner } = await startRealFilm(harness, user);
    await runner.hello('script');
    const broken = new TextEncoder().encode(JSON.stringify({ ...sample, scenes: [] }));
    const upload = await runner.upload(
      { kind: 'campaign', version: '1' },
      broken,
      'application/json',
    );
    const { fileId } = (await body(upload)) as { fileId: string };
    await runner.events('script', [
      { type: 'script_ready', version: 1, campaignFileId: fileId, unconfirmedClaims: [] },
    ]);
    await harness.flush();
    const detail = await getFilmDetail(ctx, film.id);
    expect(detail.film.status).toBe('failed');
    expect(detail.campaign).toBeNull();
    expect(harness.naive.live()).toEqual([]);
  });

  it("ends a film with the crew's own error message on the feed", async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { ctx, film, runner } = await startRealFilm(harness, user);
    await runner.hello('script');
    const answer = await runner.events('script', [
      {
        type: 'error',
        code: 'researcher_busy',
        message: 'The Researcher is busy with another film.',
        retryable: false,
      },
    ]);
    expect((await body(answer)).control).toMatchObject({ stop: true });
    await harness.flush();
    const detail = await getFilmDetail(ctx, film.id);
    expect(detail.film.status).toBe('failed');
    expect(detail.events.at(-1)).toMatchObject({
      kind: 'failed',
      message: 'The Researcher is busy with another film.',
    });
    expect(harness.naive.live()).toEqual([]);
  });

  it('stores each upload under a key the website picks, with its hash', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { film, run, runner } = await startRealFilm(harness, user);
    await runner.hello('script');
    await runner.upload(
      { kind: 'research', name: '../../escape' },
      new TextEncoder().encode('{}'),
      'application/json',
    );
    const rows = await harness.db.select().from(runFiles).where(eq(runFiles.runId, run.id));
    expect(rows.map((row) => row.r2Key)).toEqual([`films/${film.id}/research.json`]);
    expect(rows[0]?.sha256).toBe(await sha256Hex(new TextEncoder().encode('{}')));
  });
});

describe('the script runner still exiting when the founder approves', () => {
  it('takes its last batch after the approval, and a resend of it never fails the render', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { ctx, film, run, runner } = await startRealFilm(harness, user);
    expect((await runner.hello()).status).toBe(200);
    const upload = await runner.upload(
      { kind: 'campaign', version: '1' },
      campaignBytes,
      'application/json',
    );
    const { fileId } = (await body(upload)) as { fileId: string };
    await runner.events('script', [
      { type: 'script_ready', version: 1, campaignFileId: fileId, unconfirmedClaims: ['pricing'] },
    ]);
    await harness.flush();
    expect((await runOf(harness, run.id))?.state).toBe('script_ready');
    // A scripted approval lands before the script runner's runner.exit.
    await reviewScript(ctx, film.id, approve);
    await harness.flush();
    expect((await runOf(harness, run.id))?.state).toBe('render_queued');

    // The script runner's last batch: taken (not 409), and it says the runner exited.
    const exit = { type: 'runner.exit', exitCode: 0, signal: null, durationMs: 1 };
    const late = await runner.events('script', [
      { type: 'cost', step: 'director', microUsd: 300_000, totalMicroUsd: 700_000 },
      exit,
    ]);
    expect(late.status).toBe(200);
    expect(await body(late)).toMatchObject({ ok: true, control: { stop: false } });
    const queued = await runOf(harness, run.id);
    expect(queued?.exitedAt).not.toBeNull();
    // Its cost still counts; nothing else of it does.
    expect(queued?.costCrewMicroUsd).toBe(700_000);

    // With the exit in, the computer comes back without waiting out the grace.
    await harness.flush();
    const { watchdogTick } = await import('../src/server/runner/watchdog.ts');
    await watchdogTick(harness.deps());
    await harness.flush();
    expect((await runOf(harness, run.id))?.state).toBe('launching');
    expect((await runner.hello()).status).toBe(200);
    expect((await runOf(harness, run.id))?.state).toBe('render_running');

    // An old runner.exit sent again, as an outbox might: stored, and the render goes on.
    const again = await runner.events('script', [exit]);
    expect(again.status).toBe(200);
    await harness.flush();
    expect((await runOf(harness, run.id))?.state).toBe('render_running');
    const errorFirst = await runner.events('script', [
      { type: 'error', code: 'stopped', message: 'Stopped.', stage: null, retryable: false },
    ]);
    expect(errorFirst.status).toBe(200);
    await harness.flush();
    expect((await runOf(harness, run.id))?.state).toBe('render_running');
  });

  it('takes an error that names no stage, as a runner stopped before its first stage sends it', async () => {
    const user = newUser();
    const harness = runnerHarness(proxy, { realUsers: [user.userId], vars: ROOMY });
    const { run, runner } = await startRealFilm(harness, user);
    expect((await runner.hello()).status).toBe(200);
    const stopped = await runner.events('script', [
      { type: 'error', code: 'stopped', message: 'Stopped.', stage: null, retryable: false },
    ]);
    expect(stopped.status).toBe(200);
    await harness.flush();
    expect(await runOf(harness, run.id)).toMatchObject({ failureCode: 'stopped' });
  });
});

const runOf = (harness: Harness, runId: string) =>
  harness.db.query.filmRuns.findFirst({ where: eq(filmRuns.id, runId) });
