/**
 * The stand-in keeps the contract the real film command must keep, and what it hands the website
 * passes the website's own checks.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { campaignSchema, validateCampaign } from '../../../packages/schema/src/index.ts';
import { FILM_EXIT, filmCommandArgs, parseFilmEvent } from '../src/contract.ts';
import { tempDir } from './helpers.ts';

const STANDIN = fileURLToPath(new URL('../standin/film.ts', import.meta.url));

function standin(args: string[]) {
  return spawnSync(process.execPath, [STANDIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, STANDIN_PACE_MS: '0' },
  });
}

function events(file: string) {
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const parsed = parseFilmEvent(line);
      if (!parsed.ok) throw new Error(`${parsed.reason}: ${line}`);
      return parsed.event;
    });
}

describe('the stand-in film command', () => {
  it('writes only events the contract accepts, numbered from 1, and a campaign the website accepts', async () => {
    const runDir = tempDir();
    const eventsFile = join(runDir, 'events-all-1.jsonl');
    const result = standin(
      filmCommandArgs({ url: 'https://linear.app/', phase: 'all', runDir, eventsFile, maxUsd: 2 }),
    );
    expect(result.status, result.stderr).toBe(FILM_EXIT.ok);
    const written = events(eventsFile);
    expect(written.map((event) => event.seq)).toEqual(written.map((_, index) => index + 1));
    expect(written.map((event) => event.type)).toEqual(
      expect.arrayContaining(['script_ready', 'delivered', 'qc']),
    );
    const campaign = campaignSchema.parse(
      JSON.parse(readFileSync(join(runDir, 'campaign.json'), 'utf8')),
    );
    const validation = await validateCampaign(campaign);
    expect(validation.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(validation.ok).toBe(true);
    for (const event of written) {
      if ('message' in event) expect(event.message.startsWith('Stand-in:')).toBe(true);
    }
  });

  it('refuses an approval for another version with exit 2', () => {
    const runDir = tempDir();
    const eventsFile = join(runDir, 'events.jsonl');
    expect(
      standin(
        filmCommandArgs({
          url: 'https://linear.app/',
          phase: 'script',
          runDir,
          eventsFile,
          maxUsd: 2,
        }),
      ).status,
    ).toBe(0);
    const approvalFile = join(runDir, 'approval.json');
    writeFileSync(
      approvalFile,
      JSON.stringify({
        version: 3,
        hookId: null,
        ctaId: null,
        formats: ['16:9'],
        confirmedClaimIds: [],
      }),
    );
    const result = standin(
      filmCommandArgs({
        url: 'https://linear.app/',
        phase: 'render',
        runDir,
        eventsFile,
        approvalFile,
        maxUsd: 2,
      }),
    );
    expect(result.status).toBe(FILM_EXIT.badInput);
    expect(events(eventsFile).at(-1)).toMatchObject({ type: 'error', code: 'bad_input' });
  });

  it('writes the next version on a note', () => {
    const runDir = tempDir();
    const eventsFile = join(runDir, 'events.jsonl');
    standin(
      filmCommandArgs({
        url: 'https://linear.app/',
        phase: 'script',
        runDir,
        eventsFile,
        maxUsd: 2,
      }),
    );
    const reviseFile = join(runDir, 'revise.json');
    writeFileSync(reviseFile, JSON.stringify({ version: 1, note: 'Shorter, please.' }));
    const result = standin(
      filmCommandArgs({
        url: 'https://linear.app/',
        phase: 'script',
        runDir,
        eventsFile,
        reviseFile,
        maxUsd: 2,
      }),
    );
    expect(result.status).toBe(0);
    expect(events(eventsFile).at(-1)).toMatchObject({ type: 'script_ready', version: 2 });
  });

  it('refuses a call without the contract’s arguments', () => {
    expect(standin(['https://linear.app/']).status).toBe(FILM_EXIT.badInput);
  });
});
