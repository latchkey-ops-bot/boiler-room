import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES = join(import.meta.dirname, '..', 'src', 'styles');

/** Every selector in a stylesheet, with comments removed. */
function selectors(file: string): string[] {
  const css = readFileSync(join(STYLES, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{/g)]
    .map((match) => (match[1] ?? '').trim())
    .filter((head) => !head.startsWith('@'))
    .flatMap((head) => head.split(',').map((part) => part.trim()));
}

// The script review and the delivery screen each have a player with the same class names. Next
// keeps a page's styles loaded after a client-side navigation, so an unscoped rule in one file
// restyles the other screen's player.
describe('the two players keep their styles to their own screen', () => {
  for (const [file, scope] of [
    ['script-review.css', '.script-review'],
    ['delivery.css', '.delivery-player'],
  ] as const) {
    it(`${file} scopes every .player and .stage rule to ${scope}`, () => {
      const loose = selectors(file).filter(
        (selector) =>
          /(^|\s)\.(player|stage)(?![\w-])/.test(selector) && !selector.startsWith(`${scope} `),
      );
      expect(loose).toEqual([]);
    });
  }
});
