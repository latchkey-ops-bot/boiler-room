import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Campaign, sceneFrames, sceneRegistry, validateCampaign } from '../src/index.ts';
import { directorExample } from './director-example.ts';

const textItem = (campaign: Campaign, id: string) => {
  const item = campaign.scenes.flatMap((scene) => scene.text).find((each) => each.id === id);
  if (!item) throw new Error(`the example has no text item "${id}"`);
  return item;
};

describe('the Director skill worked example', () => {
  it('passes validateCampaign with sceneRegistry and no issues', async () => {
    const { ok, issues } = await validateCampaign(directorExample(), { sceneRegistry });
    expect(issues).toEqual([]);
    expect(ok).toBe(true);
  });

  it("sits on the Short template's frames", () => {
    const frames = sceneFrames(directorExample());
    expect(frames.durationInFrames).toBe(750);
    expect(frames.scenes.map(({ from }) => from)).toEqual([
      0, 90, 150, 234, 285, 357, 429, 525, 564, 612, 655,
    ]);
    expect(frames.scenes.map(({ durationInFrames }) => durationInFrames)).toEqual([
      90, 60, 84, 51, 72, 72, 96, 39, 48, 43, 95,
    ]);
  });

  // The edits and the output that director-copy-and-claims quotes as real validator output.
  it.each([
    {
      edit: (campaign: Campaign) => {
        textItem(campaign, 'proof-number').value = 'Under 60 s';
      },
      expected: {
        code: 'CLAIM_UNBACKED',
        severity: 'error',
        path: 'scenes[6].text[0].value',
        message: '"Under 60 s" states "60", but the quotes of preview-speed do not state it.',
      },
    },
    {
      edit: (campaign: Campaign) => {
        textItem(campaign, 'payoff-line').value = 'The best previews.';
      },
      expected: {
        code: 'CLAIM_SUPERLATIVE',
        severity: 'warning',
        path: 'scenes[7].text[0].value',
        message: '"The best previews." makes a superlative claim without citing one.',
      },
    },
    {
      edit: (campaign: Campaign) => {
        const [, cta] = campaign.variants.ctas;
        if (!cta) throw new Error('the example has no second CTA');
        cta.label = 'Try it free for 14 days';
      },
      expected: {
        code: 'CLAIM_UNBACKED',
        severity: 'error',
        path: 'variants.ctas[1].label',
        message: '"Try it free for 14 days" states "14", but it cites no claim.',
      },
    },
  ])('reports $expected.code at $expected.path', async ({ edit, expected }) => {
    const campaign = directorExample();
    edit(campaign);
    const { issues } = await validateCampaign(campaign, { sceneRegistry });
    expect(issues).toEqual([expect.objectContaining(expected)]);
  });

  it('passes a cited superlative its quote does not state, which the Director must reject', async () => {
    const campaign = directorExample();
    const line = textItem(campaign, 'value-line');
    expect(line.claimIds).toEqual(['preview-speed']);
    line.value = 'The fastest previews anywhere.';
    expect(await validateCampaign(campaign, { sceneRegistry })).toMatchObject({
      ok: true,
      issues: [],
    });
  });
});

describe('bin/validate.ts', () => {
  const bin = fileURLToPath(new URL('../bin/validate.ts', import.meta.url));
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
  const write = (content: string) => {
    const file = join(mkdtempSync(join(tmpdir(), 'campaign-')), 'campaign.json');
    writeFileSync(file, content);
    return file;
  };

  it('prints ok and no issues, and exits 0, for a campaign that passes', () => {
    const result = run(write(JSON.stringify(directorExample())));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, issues: [] });
  });

  it('checks scene limits from sceneRegistry, and exits 1 on a failure', () => {
    const campaign = directorExample();
    textItem(campaign, 'proof-number').value = 'Under 90 seconds';
    const result = run(write(JSON.stringify(campaign)));
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: 'TEXT_TOO_LONG', path: 'scenes[6].text[0].value' })],
    });
  });

  it('exits 2 with a message when the file is not JSON', () => {
    const result = run(write('{ not json'));
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^Cannot read .* as JSON: /);
  });

  it('exits 2 with usage when no file is given', () => {
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^Usage: /);
  });
});
