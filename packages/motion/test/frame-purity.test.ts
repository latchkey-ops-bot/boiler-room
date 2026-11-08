import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => ({ file, text: readFileSync(path.join(SRC, file), 'utf8') }));

/** Strips comments, which may name what the code must not do. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('source rules that keep frames pure', () => {
  it.each([
    ['the clock', /\bDate\.now\b|\bnew Date\b|\bperformance\.now\b/],
    ['randomness', /\bMath\.random\b/],
    ['timers', /\bset(?:Timeout|Interval)\b|\brequestAnimationFrame\b/],
    ['3D transforms', /perspective\(|rotate[XY]\(|translate3d\(|translateZ\(|preserve-3d/],
    ['seconds times fps', /\*\s*fps\b|\bfps\s*\*/],
  ])('never uses %s', (_name, pattern) => {
    const offenders = sources
      .filter(({ text }) => pattern.test(code(text)))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
