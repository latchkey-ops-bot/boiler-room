import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE = path.resolve(import.meta.dirname, '..');
const NOVA = path.resolve(PACKAGE, '../../packages/schema/examples/nova.campaign.json');

/** Runs the render CLI on a campaign file, with no Naive key, and collects what it printed. */
function runCli(file: string) {
  const env = { ...process.env };
  delete env.NAIVE_API_KEY;
  const child = spawn(
    path.join(PACKAGE, 'node_modules/.bin/tsx'),
    ['src/cli.ts', file, '--dry-run', '--local'],
    { cwd: PACKAGE, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return new Promise<{ code: number | null; stderr: string }>((resolve) => {
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

describe('the render CLI', () => {
  it('prints a rejected campaign one issue a line, every issue with its fix', async () => {
    const campaign = JSON.parse(readFileSync(NOVA, 'utf8'));
    campaign.scenes[0].text[0].value = 'Builds wait 12 minutes.';
    campaign.scenes[1].text[0].value = '90% faster builds';
    const dir = mkdtempSync(path.join(os.tmpdir(), 'boiler-room-cli-'));
    const file = path.join(dir, 'unbacked.campaign.json');
    writeFileSync(file, JSON.stringify(campaign));

    const { code, stderr } = await runCli(file);
    expect(code).toBe(1);
    const lines = stderr.trimEnd().split('\n');
    const header = lines.findIndex((line) =>
      line.startsWith('This campaign cannot be rendered: validateCampaign found 2 error(s).'),
    );
    expect(header).toBeGreaterThanOrEqual(0);
    const issues = lines.slice(header + 1, header + 3);
    expect(issues).toEqual([
      expect.stringMatching(/^- CLAIM_UNBACKED at scenes\[0\]\.text\[0\]\.value: .+/),
      expect.stringMatching(/^- CLAIM_UNBACKED at scenes\[1\]\.text\[0\]\.value: .+/),
    ]);
  }, 60_000);
});
