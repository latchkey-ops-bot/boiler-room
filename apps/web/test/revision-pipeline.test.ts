import { describe, expect, it } from 'vitest';
import {
  type ScriptDecision,
  SimulatedPipeline,
  type SimulatedRun,
  timeline,
} from '../src/server/pipeline/simulated.ts';
import { PipelineConflictError } from '../src/server/pipeline/types.ts';
import { testClock } from './helpers.ts';

/** A simulated run the test drives by hand: the customer approves, gets files, asks for changes. */
function setup() {
  const clock = testClock();
  const run: SimulatedRun = {
    url: 'https://www.nova.com/',
    startedAt: clock.now(),
    decisions: [],
    revisions: [],
  };
  const pipeline = new SimulatedPipeline({ run: async () => run }, { clock: clock.now });
  const approve = (version: number, formats: ScriptDecision['formats'] = ['16:9', '9:16']) =>
    run.decisions.push({
      version,
      decision: 'approved',
      note: null,
      hookId: null,
      ctaId: 'start-free',
      formats,
      at: clock.now(),
    });
  const revise = (version: number, note: string) =>
    run.revisions?.push({ version, note, at: clock.now() });
  /** Script ready, approved, rendered and delivered: version 1 is done. */
  const deliverFirstCut = () => {
    clock.advance(31);
    approve(1);
    clock.advance(41);
  };
  return { clock, run, pipeline, approve, revise, deliverFirstCut };
}

describe('SimulatedPipeline revisions', () => {
  it('takes a delivered film back to the script, and delivers the next version', async () => {
    const { clock, pipeline, approve, revise, deliverFirstCut } = setup();
    deliverFirstCut();
    expect(await pipeline.status('sim_1')).toMatchObject({ status: 'done', scriptVersion: 1 });

    await pipeline.requestRevision('sim_1', { version: 1, note: 'Bigger logo at the end' });
    revise(1, 'Bigger logo at the end');

    clock.advance(1);
    expect(await pipeline.status('sim_1')).toMatchObject({ stage: 'script', status: 'working' });
    // The first cut's files are not offered as new files while the crew works.
    expect(await pipeline.deliverables('sim_1')).toEqual([]);

    clock.advance(11);
    expect(await pipeline.status('sim_1')).toMatchObject({
      stage: 'approval',
      status: 'needs_you',
      scriptVersion: 2,
    });

    approve(2, ['1:1']);
    clock.advance(41);
    expect(await pipeline.status('sim_1')).toMatchObject({ status: 'done', scriptVersion: 2 });
    const files = await pipeline.deliverables('sim_1');
    expect(files).toEqual([
      expect.objectContaining({
        variantKey: '1:1.main.start-free',
        fileName: 'nova-com-1x1-main-v2.mp4',
        scriptVersion: 2,
        r2Key: null,
      }),
    ]);
  });

  it('names the Account Manager and quotes the note in the feed', async () => {
    const { clock, pipeline, revise, deliverFirstCut } = setup();
    deliverFirstCut();
    revise(1, 'Bigger logo at the end');
    clock.advance(12);
    const events = await pipeline.events('sim_1');
    const after = events.slice(events.findIndex((event) => event.kind === 'delivered') + 1);
    expect(after.map((event) => event.agent)).toEqual([
      'customer',
      'account_manager',
      'director',
      'validator',
      'account_manager',
    ]);
    expect(after[0]?.message).toContain('Bigger logo at the end');
    expect(after[2]?.message).toContain('version 2');
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  });

  it('stamps the first cut with version 1 and keeps its file names', async () => {
    const { pipeline, deliverFirstCut } = setup();
    deliverFirstCut();
    const files = await pipeline.deliverables('sim_1');
    expect(files.map((file) => [file.fileName, file.scriptVersion])).toEqual([
      ['nova-com-16x9-main.mp4', 1],
      ['nova-com-9x16-main.mp4', 1],
    ]);
  });

  it('refuses a revision before delivery, or on a version that is not the delivered one', async () => {
    const { clock, pipeline, approve } = setup();
    clock.advance(31);
    await expect(pipeline.requestRevision('sim_1', { version: 1, note: 'x' })).rejects.toThrow(
      'not delivered',
    );
    approve(1);
    clock.advance(41);
    await expect(
      pipeline.requestRevision('sim_1', { version: 2, note: 'x' }),
    ).rejects.toBeInstanceOf(PipelineConflictError);
  });

  it('ignores a revision asked before delivery, or on another version', () => {
    const start = new Date('2026-11-07T12:00:00Z');
    const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
    const approved: ScriptDecision = {
      version: 1,
      decision: 'approved',
      note: null,
      hookId: null,
      ctaId: 'start-free',
      formats: ['16:9'],
      at: at(40),
    };
    const early: SimulatedRun = {
      url: 'https://nova.com/',
      startedAt: start,
      decisions: [approved],
      // Delivery lands at 80 seconds.
      revisions: [{ version: 1, note: 'too soon', at: at(60) }],
    };
    expect(timeline('sim_1', early).at(-1)?.status).toBe('done');

    const wrong: SimulatedRun = { ...early, revisions: [{ version: 2, note: 'x', at: at(90) }] };
    expect(timeline('sim_1', wrong).at(-1)?.status).toBe('done');
  });
});
