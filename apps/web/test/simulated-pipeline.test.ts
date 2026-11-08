import { validateCampaign } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import {
  SAMPLE_CAMPAIGN,
  type ScriptDecision,
  SimulatedPipeline,
  type SimulatedRun,
  timeline,
} from '../src/server/pipeline/simulated.ts';
import { PipelineConflictError } from '../src/server/pipeline/types.ts';
import { testClock } from './helpers.ts';

function setup() {
  const clock = testClock();
  const run: SimulatedRun = { url: 'https://www.nova.com/', startedAt: clock.now(), decisions: [] };
  const pipeline = new SimulatedPipeline({ run: async () => run }, { clock: clock.now });
  const decide = (decision: Omit<ScriptDecision, 'at'>) =>
    run.decisions.push({ ...decision, at: clock.now() });
  return { clock, run, pipeline, decide };
}

const approval = {
  decision: 'approved' as const,
  note: null,
  hookId: null,
  ctaId: 'start-free',
  formats: ['16:9' as const, '9:16' as const],
};

describe('SimulatedPipeline', () => {
  it('starts one run per film', async () => {
    const { pipeline } = setup();
    expect(await pipeline.start({ filmId: 'flm_a', url: 'https://nova.com/' })).toEqual({
      runId: 'sim_flm_a',
    });
  });

  it('walks research, script and checks, then waits for the customer', async () => {
    const { clock, pipeline } = setup();
    expect((await pipeline.status('sim_1')).stage).toBe('research');

    clock.advance(13);
    let status = await pipeline.status('sim_1');
    expect(status).toMatchObject({ stage: 'script', status: 'working', scriptVersion: 0 });
    expect(status.campaign).toBeNull();

    clock.advance(10);
    status = await pipeline.status('sim_1');
    expect(status.stage).toBe('script');
    expect(status.campaign).toEqual(SAMPLE_CAMPAIGN);

    clock.advance(10);
    status = await pipeline.status('sim_1');
    expect(status).toMatchObject({ stage: 'approval', status: 'needs_you', scriptVersion: 1 });

    // It stays paused, however long the customer takes.
    clock.advance(3600);
    expect((await pipeline.status('sim_1')).status).toBe('needs_you');
  });

  it('writes the crew decisions feed, naming the site', async () => {
    const { clock, pipeline } = setup();
    clock.advance(31);
    const events = await pipeline.events('sim_1');
    // The cast is the landing page's crew: no one the founder was never introduced to.
    expect(events.map((event) => event.agent)).toEqual([
      'account_manager',
      'researcher',
      'researcher',
      'researcher',
      'director',
      'validator',
      'director',
      'validator',
      'account_manager',
    ]);
    // It names the site the founder typed, and says the script comes from the sample site.
    expect(events[0]?.message).toBe(
      'Started a simulated film for nova.com. The crew works from the sample site, nova.example.com.',
    );
    expect(events[1]?.message).toBe('Read 6 pages on nova.example.com.');
    // A caught number reads as the system working, and the pass agrees with the open claim.
    expect(events[5]?.message).toContain('It never reached your script.');
    expect(events[7]?.message).toBe(
      'Every number is backed by a quote from nova.example.com. "Plans start at $29 per seat" needs you to confirm it.',
    );
    expect(events.find((event) => event.kind === 'sent_back')?.agent).toBe('validator');
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  });

  it('returns only the events after a cursor', async () => {
    const { clock, pipeline } = setup();
    clock.advance(31);
    const all = await pipeline.events('sim_1');
    const rest = await pipeline.events('sim_1', { after: all[4]?.id });
    expect(rest).toEqual(all.slice(5));
  });

  it('makes and delivers the film once the script is approved', async () => {
    const { clock, pipeline, decide } = setup();
    clock.advance(31);
    await pipeline.approveScript('sim_1', {
      version: 1,
      hookId: null,
      ctaId: 'start-free',
      formats: ['16:9'],
      confirmedClaimIds: ['pricing'],
    });
    decide({ version: 1, ...approval });

    clock.advance(1);
    expect(await pipeline.status('sim_1')).toMatchObject({
      stage: 'art_direction',
      status: 'working',
    });
    expect(await pipeline.deliverables('sim_1')).toEqual([]);

    clock.advance(30);
    expect((await pipeline.status('sim_1')).stage).toBe('review');

    clock.advance(10);
    expect(await pipeline.status('sim_1')).toMatchObject({ stage: 'delivery', status: 'done' });
    const files = await pipeline.deliverables('sim_1');
    expect(files.map((file) => file.variantKey)).toEqual([
      '16:9.main.start-free',
      '9:16.main.start-free',
    ]);
    expect(files.every((file) => file.r2Key === null)).toBe(true);
    expect(files[0]?.fileName).toBe('nova-com-16x9-main.mp4');
  });

  it('rewrites on a note and asks again with the next version', async () => {
    const { clock, pipeline, decide } = setup();
    clock.advance(31);
    await pipeline.sendBackScript('sim_1', { version: 1, note: 'Punchier opening' });
    decide({
      version: 1,
      decision: 'changes_requested',
      note: 'Punchier opening',
      hookId: null,
      ctaId: null,
      formats: [],
    });

    clock.advance(2);
    expect(await pipeline.status('sim_1')).toMatchObject({ stage: 'script', status: 'working' });
    clock.advance(7);
    expect(await pipeline.status('sim_1')).toMatchObject({
      stage: 'approval',
      status: 'needs_you',
      scriptVersion: 2,
    });
    const events = await pipeline.events('sim_1');
    expect(events.some((event) => event.message.includes('Punchier opening'))).toBe(true);
  });

  it('refuses a decision when the script is not waiting, or on an old version', async () => {
    const { clock, pipeline } = setup();
    await expect(
      pipeline.approveScript('sim_1', {
        version: 1,
        hookId: null,
        ctaId: null,
        formats: ['16:9'],
        confirmedClaimIds: [],
      }),
    ).rejects.toBeInstanceOf(PipelineConflictError);

    clock.advance(31);
    await expect(pipeline.sendBackScript('sim_1', { version: 2, note: 'x' })).rejects.toThrow(
      'Version 2 is not the latest script',
    );
  });

  it('ignores a decision made before the script was ready', () => {
    const start = new Date('2026-11-07T12:00:00Z');
    const run: SimulatedRun = {
      url: 'https://nova.com/',
      startedAt: start,
      decisions: [{ version: 1, ...approval, at: new Date(start.getTime() + 5000) }],
    };
    const events = timeline('sim_1', run);
    expect(events[events.length - 1]?.status).toBe('needs_you');
  });

  it('runs at any pace', async () => {
    const clock = testClock();
    const run: SimulatedRun = { url: 'https://nova.com/', startedAt: clock.now(), decisions: [] };
    const fast = new SimulatedPipeline({ run: async () => run }, { clock: clock.now, pace: 10 });
    clock.advance(3.1);
    expect((await fast.status('sim_1')).status).toBe('needs_you');
  });

  it('serves a sample script that passes the campaign schema', async () => {
    const result = await validateCampaign(SAMPLE_CAMPAIGN);
    expect(result.issues.filter((issue) => issue.code === 'SCHEMA_INVALID')).toEqual([]);
  });
});
