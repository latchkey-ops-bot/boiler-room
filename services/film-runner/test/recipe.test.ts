import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkInput, readyCheck, setupScript } from '../scripts/recipe.ts';

const input = {
  repoUrl: 'https://github.com/example/boiler-room',
  filmCommit: 'b'.repeat(40),
  runnerCommit: 'a'.repeat(40),
  adapter: 'auto' as const,
};

describe('the base snapshot recipe', () => {
  it('installs what a film needs, at pinned commits, with no credential', () => {
    const script = setupScript(input);
    for (const step of [
      'libnss3',
      'fonts-noto-cjk',
      'git util-linux',
      'mkswap /swapfile',
      "'/swapfile none swap sw 0 0'",
      'pnpm@10.30.3',
      `checkout --quiet --detach ${input.filmCommit}`,
      `checkout --quiet --detach ${input.runnerCommit}`,
      'ln -s "$HOME/film-runner-src/services/film-runner" "$HOME/film-runner"',
      'pnpm install --frozen-lockfile',
      'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1',
      'r.ensureBrowser()',
      '"$HOME/.film-runner.json"',
      'setup: done',
    ]) {
      expect(script, step).toContain(step);
    }
    expect(script).toMatch(/^set -euo pipefail/);
    expect(script).not.toMatch(/token|password|NAIVE_API_KEY=/i);
  });

  it('checks a fork the way the website will use it', () => {
    const check = readyCheck();
    expect(check).toContain("swapon --show=NAME --noheadings | grep -qx '/swapfile'");
    expect(check).toContain("r.openBrowser('chrome')");
    expect(check).toContain('node src/main.ts --self-test');
    expect(check.trim().endsWith('echo READY')).toBe(true);
  });

  it('refuses a private URL or a short commit', () => {
    expect(() =>
      checkInput({ ...input, repoUrl: 'git@github.com:example/boiler-room.git' }),
    ).toThrow();
    expect(() => checkInput({ ...input, filmCommit: 'abc123' })).toThrow();
  });

  it('keeps every exec in the scripts under 600 s', () => {
    const dir = fileURLToPath(new URL('../scripts/', import.meta.url));
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
      const text = readFileSync(`${dir}${file}`, 'utf8');
      for (const match of text.matchAll(/exec\(api, [^,]+, [^)]*?, ([\d_]+)\)/g)) {
        expect(Number(match[1]?.replaceAll('_', '')), `${file}: ${match[0]}`).toBeLessThanOrEqual(
          600_000,
        );
      }
    }
  });
});
