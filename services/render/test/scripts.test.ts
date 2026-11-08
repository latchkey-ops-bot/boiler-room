import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const scripts = (file: string) =>
  (
    JSON.parse(readFileSync(path.resolve(import.meta.dirname, file), 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts;

// pnpm does not pass SIGTERM on to a script's process. It ends its own child, so a script that
// replaces its shell with tsx (`exec`) is that child and gets the signal, and tsx passes it to the
// CLI. A second pnpm in between, or a shell left in place, would leave the CLI rendering headless.
describe('the render scripts', () => {
  it.each([
    ['the workspace', '../../../package.json'],
    ['the render package', '../package.json'],
  ])('in %s run tsx in place of their shell, with no pnpm in between', (_where, file) => {
    const render = scripts(file).render ?? '';
    expect(render).toMatch(/(^|&& )exec \S*tsx src\/cli\.ts$/);
    expect(render).not.toMatch(/\bpnpm\b/);
  });
});
