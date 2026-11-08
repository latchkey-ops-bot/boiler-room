import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FILM_LIMITS,
  type FilmLedger,
  ledgerPath,
  mayStart,
  readLedger,
  recordSpend,
  rounds,
  routable,
  spentMicroUsd,
} from '../src/pipeline/ledger.ts';
import type { QcIssue } from '../src/quality/output.ts';

const entry = (step: FilmLedger['entries'][number]['step'], microUsd: number) => ({
  step,
  microUsd,
  at: '2026-11-07T00:00:00Z',
  session: null,
  note: '',
});

describe('the film ledger', () => {
  it('records each step beside the campaign and adds up sessions and media', () => {
    const file = ledgerPath(mkdtempSync(join(tmpdir(), 'ledger-')));
    recordSpend(file, 'linear-launch', {
      step: 'director',
      microUsd: 556_400,
      session: 'ses_d',
      note: '',
    });
    recordSpend(file, 'linear-launch', {
      step: 'art-images',
      microUsd: 73_000,
      session: null,
      note: '5 images',
    });
    const ledger = readLedger(file, 'linear-launch');
    expect(spentMicroUsd(ledger)).toBe(629_400);
    expect(JSON.parse(readFileSync(file, 'utf8')).entries).toHaveLength(2);
  });

  it('lets a first pass and one route-back run, and stops after two Quality Check rounds', () => {
    const ledger: FilmLedger = { film: 'f', entries: [] };
    expect(mayStart(ledger, 'director')).toEqual({ ok: true });
    ledger.entries.push(entry('director', 500_000), entry('quality-check', 160_000));
    expect(rounds(ledger)).toBe(1);
    expect(mayStart(ledger, 'director')).toEqual({ ok: true });
    ledger.entries.push(entry('director', 500_000), entry('quality-check', 160_000));
    expect(mayStart(ledger, 'director')).toMatchObject({
      ok: false,
      why: expect.stringMatching(/2 Quality Check round/),
    });
    expect(mayStart(ledger, 'quality-check').ok).toBe(false);
  });

  it('stops every step once the film has spent its limit, media included', () => {
    const ledger: FilmLedger = {
      film: 'f',
      entries: [
        entry('director', 4_900_000),
        entry('art-images', FILM_LIMITS.maxMicroUsd - 4_900_000),
      ],
    };
    expect(mayStart(ledger, 'art-director')).toMatchObject({
      ok: false,
      why: expect.stringMatching(/limit of \$5\.00/),
    });
  });
});

describe('routing', () => {
  const issue = (
    check: string,
    owner: QcIssue['owner'],
    severity: QcIssue['severity'] = 'major',
  ): QcIssue => ({
    severity,
    check,
    owner,
    sceneId: null,
    frame: null,
    timecode: null,
    what: 'w',
    fix: 'f',
    source: 'model',
  });

  it('never sends a film back for motion placeholder failures or minor notes', () => {
    const byOwner = routable({
      issues: [
        issue('frame-0', 'director'),
        issue('lines', 'motion'),
        issue('words-recovered', 'motion'),
        issue('scene-registry', 'motion', 'minor'),
        issue('accent-ration', 'art-director', 'minor'),
        issue('claims-research', 'director', 'blocker'),
        issue('flash-frames', 'motion'),
      ],
    });
    expect(
      [...byOwner.entries()].map(([owner, list]) => [owner, list.map((each) => each.check)]),
    ).toEqual([
      ['director', ['claims-research']],
      ['motion', ['flash-frames']],
    ]);
  });
});
