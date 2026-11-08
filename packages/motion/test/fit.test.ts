import { describe, expect, it } from 'vitest';
import { type FitRequest, fitBlock, type TextMeasure } from '../src/layout/fit.ts';

/** A monospace font, wide enough to measure by hand: each character is 0.6 of the size. */
const ADVANCE = 0.6;
const widthOf = (line: string, size: number) => line.length * size * ADVANCE;

const monospace: TextMeasure = { widthOf };

const request = (text: string, overrides: Partial<FitRequest> = {}): FitRequest => ({
  text,
  maxWidth: 600,
  maxHeight: 400,
  maxSize: 120,
  maxLines: 3,
  lineHeight: 1.1,
  ...overrides,
});

const fitted = (req: FitRequest) => fitBlock(req, monospace);

/** The copy's characters in order, which no line break may change. */
const characters = (text: string) => text.replaceAll(' ', '');

describe('fitBlock', () => {
  it.each([
    'Ship it.',
    'Your builds are waiting.',
    'Quillhaven Manuscript Studio keeps every draft in one quiet room',
    'Supercalifragilisticexpialidocious',
    '把真正重要的工作交付出去让团队每天都能专注于最有价值的事情',
    'Antidisestablishmentarianism-grade-infrastructure-automation',
    'W'.repeat(100),
  ])('keeps "%s" inside its box', (text) => {
    const req = request(text);
    const result = fitted(req);
    expect(result.fontSize).toBeGreaterThan(0);
    expect(result.lines.length).toBeLessThanOrEqual(req.maxLines);
    expect(result.height).toBeLessThanOrEqual(req.maxHeight);
    for (const line of result.lines) {
      expect(widthOf(line, result.fontSize)).toBeLessThanOrEqual(req.maxWidth);
    }
    expect(characters(result.lines.join(''))).toBe(characters(text));
  });

  it('breaks lines only at spaces in copy that has them', () => {
    const text = 'Quillhaven Manuscript Studio keeps every draft in one quiet room';
    expect(fitted(request(text)).lines.join(' ')).toBe(text);
  });

  it('breaks Chinese between words, rather than shrinking it onto one line', () => {
    const text = '把真正重要的工作交付出去让团队每天都能专注于最有价值的事情';
    const result = fitted(request(text));
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.lines.join('')).toBe(text);
    // On one line it would be set at 600 / (29 × 0.6), under 35.
    expect(result.fontSize).toBeGreaterThan(50);
  });

  it('never starts a line with closing punctuation', () => {
    const result = fitted(
      request('让每一次构建都更快，让团队把时间花在真正重要的工作上。', { maxSize: 60 }),
    );
    expect(result.lines.length).toBeGreaterThan(1);
    for (const line of result.lines) expect(line).not.toMatch(/^[，。、！？）」]/u);
  });

  it('breaks a hyphenated compound after a hyphen', () => {
    const text = 'Antidisestablishmentarianism-grade-infrastructure-automation';
    // As wide as a portrait headline box is against its largest size.
    const result = fitted(request(text, { maxWidth: 900 }));
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.lines.join('')).toBe(text);
    for (const line of result.lines.slice(0, -1)) expect(line).toMatch(/-$/);
  });

  it('keeps a number with its sign or unit', () => {
    const result = fitted(request('From $29 a seat, 40% faster, 1,200 teams', { maxSize: 60 }));
    for (const token of ['$29', '40%', '1,200']) {
      expect(result.lines.some((line) => line.includes(token))).toBe(true);
    }
  });

  it('breaks a word between characters only when it would otherwise be set below a third of its size', () => {
    const unbroken = fitted(request('W'.repeat(100)));
    expect(unbroken.lines.length).toBeGreaterThan(1);
    // On one line it would be set at 600 / (100 × 0.6), which is 10; on three of 34, at 29.
    expect(unbroken.fontSize).toBeGreaterThanOrEqual(29);
    // A long word that fits above that is shrunk, as any text is, and kept whole.
    expect(fitted(request('Supercalifragilistic')).lines).toEqual(['Supercalifragilistic']);
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
