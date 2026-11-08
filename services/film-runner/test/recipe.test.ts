import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkInput, LOCK_SUDO_SCRIPT, readyCheck, setupScript } from '../scripts/recipe.ts';

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
      'ca-certificates ffmpeg',
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
    // Quality Check reads the film with ffmpeg and ffprobe: a fork without them never reviews it.
    expect(check).toContain('ffmpeg -hide_banner -version > /dev/null');
    expect(check).toContain('ffprobe -hide_banner -version > /dev/null');
    expect(check).toContain('node src/main.ts --self-test');
    // A snapshot of the real film command checks it answers with the runner's contract.
    expect(check).toContain(`grep -q '"adapter": "film"' "$HOME/.film-runner.json"`);
    expect(check).toContain('help="$(CI=1 pnpm run --silent film --help)"');
    expect(check).toContain("grep -qF -- '--phase script|render|all'");
    expect(check.trim().endsWith('echo READY')).toBe(true);
  });

  it('leaves the film user one sudo rule, swapon of the swap file, and checks a fork has no more', () => {
    expect(LOCK_SUDO_SCRIPT).toContain('NOPASSWD: $swapon_bin /swapfile');
    expect(LOCK_SUDO_SCRIPT).toContain('visudo -cqf "$rule"');
    expect(LOCK_SUDO_SCRIPT).toContain('visudo -cqf "$main"');
    expect(LOCK_SUDO_SCRIPT).toContain('gpasswd -d');
    expect(LOCK_SUDO_SCRIPT).toContain(
      'if sudo -n true 2>/dev/null; then echo "sudo: still open"; exit 1; fi',
    );
    expect(readyCheck()).not.toContain('sudo -n true');
    const fork = readyCheck({ sudoLocked: true });
    expect(fork).toContain('if sudo -n true 2>/dev/null; then echo "sudo: still open"; exit 1; fi');
    expect(fork).toContain('sudo -n -l');
    // The runner's own swapon is the one command the rule allows.
    const runner = readFileSync(new URL('../src/runner.ts', import.meta.url), 'utf8');
    expect(runner).toContain("spawnSync('sudo', ['-n', 'swapon', swapfile]");
  });

  it('never puts a Naive key into the snapshot', () => {
    const build = readFileSync(new URL('../scripts/build-snapshot.ts', import.meta.url), 'utf8');
    expect(build).not.toMatch(/NAIVE_RUNNER_KEY|NAIVE_API_KEY=\$\{/);
    expect(build).not.toMatch(/writeFile\(api, builder, `\$\{home\}\/\.boiler-room\.env/);
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
