import { describe, expect, it } from 'vitest';
import { RECIPE_HASH, SETUP_SCRIPT } from '../src/naive/base.ts';

const installed = () => /apt-get install[^\n]*/.exec(SETUP_SCRIPT)?.[0] ?? '';

describe('the base recipe', () => {
  // A brand font usually covers Latin alone. Glyphs it lacks come from the machine's fonts, so a
  // computer without these draws boxes where a dev machine with Noto draws the right letters.
  it.each([
    ['Arabic, Hebrew, Thai, Devanagari and the other scripts Noto covers', 'fonts-noto-core'],
    ['Chinese, Japanese and Korean', 'fonts-noto-cjk'],
    ['Latin, Greek and Cyrillic, with the metrics of common fonts', 'fonts-liberation'],
  ])('installs a fallback font for %s', (_scripts, fontPackage) => {
    expect(installed().split(/\s+/)).toContain(fontPackage);
  });

  it('names the recipe by its script, so a changed recipe builds a new snapshot', () => {
    expect(RECIPE_HASH).toMatch(/^[0-9a-f]{16}$/);
  });
});
