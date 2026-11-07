import { describe, expect, it } from 'vitest';
import { type FitRequest, fitBlock, type TextMeasure } from '../src/layout/fit.ts';

/** A monospace font, wide enough to measure by hand: each character is 0.6 of the size. */
const ADVANCE = 0.6;
const widthOf = (line: string, size: number) => line.length * size * ADVANCE;

/** What `fitTextOnNLines` does, for that font. */
function monospace(text: string, maxWidth: number, maxSize: number): TextMeasure {
  const words = text.split(' ');
  return {
    widthOf,
    fitLines: (maxLines) => {
      for (let size = maxSize; size > 0.5; size -= 0.5) {
        const lines: string[] = [];
        let line = '';
        let fits = true;
        for (const word of words) {
          const next = line ? `${line} ${word}` : word;
          if (widthOf(next, size) <= maxWidth) line = next;
          else if (widthOf(word, size) > maxWidth) fits = false;
          else {
            lines.push(line);
            line = word;
          }
        }
        lines.push(line);
        if (fits && lines.length <= maxLines) return { fontSize: size, lines };
      }
      return { fontSize: 0, lines: [] };
    },
  };
}

const request = (text: string, overrides: Partial<FitRequest> = {}): FitRequest => ({
  text,
  maxWidth: 600,
  maxHeight: 400,
  maxSize: 120,
  maxLines: 3,
  lineHeight: 1.1,
  ...overrides,
});

const fitted = (req: FitRequest) => fitBlock(req, monospace(req.text, req.maxWidth, req.maxSize));

describe('fitBlock', () => {
  it.each([
    'Ship it.',
    'Your builds are waiting.',
    'Quillhaven Manuscript Studio keeps every draft in one quiet room',
    'Supercalifragilisticexpialidocious',
  ])('keeps "%s" inside its box', (text) => {
    const req = request(text);
    const result = fitted(req);
    expect(result.fontSize).toBeGreaterThan(0);
    expect(result.lines.length).toBeLessThanOrEqual(req.maxLines);
    expect(result.height).toBeLessThanOrEqual(req.maxHeight);
    for (const line of result.lines) {
      expect(widthOf(line, result.fontSize)).toBeLessThanOrEqual(req.maxWidth);
    }
    expect(result.lines.join(' ')).toBe(text);
  });

  it('never sets text larger than its role allows', () => {
    expect(fitted(request('Hi', { maxSize: 80 })).fontSize).toBe(80);
  });

  it('makes long text smaller rather than letting it out of its box', () => {
    const short = fitted(request('Finish the book.'));
    const long = fitted(request('Finish the book you started three winters ago, at last.'));
    expect(long.fontSize).toBeLessThan(short.fontSize);
  });

  it('respects a short box by setting smaller type', () => {
    const result = fitted(request('Every draft, kept in one quiet room.', { maxHeight: 60 }));
    expect(result.height).toBeLessThanOrEqual(60);
  });

  it('balances lines, so no word is left on its own', () => {
    const result = fitted(request('Revise without losing a single word', { maxSize: 60 }));
    const lengths = result.lines.map((line) => line.length);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(12);
  });

  it('is a pure function of its input', () => {
    const req = request('Your builds are waiting.');
    expect(fitted(req)).toEqual(fitted(req));
  });
});
