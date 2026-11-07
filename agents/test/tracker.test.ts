import { describe, expect, it } from 'vitest';
import { EventTracker } from '../src/researcher/run.ts';

const DIGEST = 'a'.repeat(64);

describe('EventTracker', () => {
  it('maps published files to their paths and collects capture digests and submissions', () => {
    const tracker = new EventTracker();
    const events = [
      {
        type: 'tool.started',
        data: {
          tool_call_id: 't1',
          name: 'publish_file',
          args: { path: '/home/tenki/br/out/site/pages.json' },
        },
      },
      {
        type: 'tool.started',
        data: { tool_call_id: 't2', name: 'bash', args: { command: 'node br-research.mjs wait' } },
      },
      {
        type: 'tool.completed',
        data: {
          tool_call_id: 't2',
          name: 'bash',
          is_error: false,
          output: `CAPTURE DONE\nBR_CAPTURE_DONE sha256=${DIGEST} pages=3\nBR_JOB_DONE capture ok`,
        },
      },
      {
        type: 'tool.completed',
        data: {
          tool_call_id: 't1',
          name: 'publish_file',
          is_error: false,
          output: 'published as fil_abc123 (pages.json, 4265 bytes)',
        },
      },
      {
        type: 'tool.completed',
        data: {
          tool_call_id: 't3',
          name: 'submit_output',
          is_error: true,
          output: 'does not match the schema',
        },
      },
      {
        type: 'tool.completed',
        data: {
          tool_call_id: 't4',
          name: 'submit_output',
          is_error: false,
          output: 'Final result recorded.',
        },
      },
    ];
    for (const event of events) tracker.handle(event);
    expect(tracker.published).toEqual(
      new Map([['fil_abc123', '/home/tenki/br/out/site/pages.json']]),
    );
    expect(tracker.digests).toEqual(new Set([DIGEST]));
    expect(tracker.submissions).toBe(1);
  });

  it('ignores digests printed by a failed tool call', () => {
    const tracker = new EventTracker();
    tracker.handle({
      type: 'tool.completed',
      data: {
        tool_call_id: 'x',
        name: 'bash',
        is_error: true,
        output: `BR_CAPTURE_DONE sha256=${DIGEST}`,
      },
    });
    expect(tracker.digests.size).toBe(0);
  });
});
