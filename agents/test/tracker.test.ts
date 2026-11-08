import { describe, expect, it } from 'vitest';
import { captureDoneLine } from '../src/capture/run.ts';
import { EventTracker } from '../src/researcher/run.ts';

const DIGEST = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const SITE = 'https://orbitly.example.org/';

describe('EventTracker', () => {
  it('maps published files to their paths and collects capture digests and submissions', () => {
    const tracker = new EventTracker(SITE);
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
          output: `CAPTURE DONE\n${captureDoneLine(DIGEST, 3, SITE, SITE)}\nBR_JOB_DONE capture ok`,
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
    const tracker = new EventTracker(SITE);
    tracker.handle({
      type: 'tool.completed',
      data: {
        tool_call_id: 'x',
        name: 'bash',
        is_error: true,
        output: captureDoneLine(DIGEST, 3, SITE, SITE),
      },
    });
    expect(tracker.digests.size).toBe(0);
  });

  // A wait on a shared computer printed another site's capture summary; its digest must never bind
  // this run's result.
  it('trusts only digests printed for the site this run researches', () => {
    const tracker = new EventTracker('https://www.orbitly.example.org');
    const completed = (output: string) =>
      tracker.handle({
        type: 'tool.completed',
        data: { tool_call_id: 'w', name: 'bash', is_error: false, output },
      });
    completed(
      captureDoneLine(OTHER, 13, 'https://nightjar.example.net/', 'https://nightjar.example.net'),
    );
    completed(`BR_CAPTURE_DONE sha256=${'c'.repeat(64)} pages=2`);
    completed(
      captureDoneLine(DIGEST, 4, 'https://orbitly.example.org/', 'https://orbitly.example.org'),
    );
    expect([...tracker.digests]).toEqual([DIGEST]);
    expect(tracker.foreign.get(OTHER)).toBe('nightjar.example.net');
    expect(tracker.foreign.has('c'.repeat(64))).toBe(true);
  });

  it('accepts a capture whose home page redirected to another domain, by the address requested', () => {
    const tracker = new EventTracker('https://orbitly.example.org');
    tracker.handle({
      type: 'tool.completed',
      data: {
        tool_call_id: 'w',
        name: 'bash',
        is_error: false,
        output: captureDoneLine(
          DIGEST,
          4,
          'https://orbitly-app.example.com/',
          'https://orbitly.example.org',
        ),
      },
    });
    expect([...tracker.digests]).toEqual([DIGEST]);
  });
});
