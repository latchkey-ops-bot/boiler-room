import { describe, expect, it } from 'vitest';
import { LRM, RLM, textDirection, wordMarks } from '../src/layout/bidi.ts';

describe('textDirection', () => {
  it.each([
    ['Ship the work that matters', 'ltr'],
    ['שלחו את העבודה', 'rtl'],
    ['أطلق العمل الذي يهم', 'rtl'],
    ['ދިވެހި', 'rtl'],
    ['让构建更快', 'ltr'],
    ['40% מהר יותר', 'rtl'],
    ['“Nova” מהיר', 'ltr'],
    ['2026', 'ltr'],
  ] as const)('reads "%s" as %s, from its first strong letter', (text, direction) => {
    expect(textDirection(text)).toBe(direction);
  });
});

describe('wordMarks', () => {
  it('marks each word with the direction of its own letters', () => {
    expect(wordMarks(['אב', 'גגגג', 'דדדד'], 'rtl')).toEqual([RLM, RLM, RLM]);
    expect(wordMarks(['Ship', 'it'], 'ltr')).toEqual([LRM, LRM]);
  });

  it('keeps a Latin name in its own order inside a right-to-left line', () => {
    expect(wordMarks(['מהיר', 'עם', 'Nova', 'Cloud'], 'rtl')).toEqual([RLM, RLM, LRM, LRM]);
  });

  it('lets a number follow the letters before it, as the bidi algorithm does', () => {
    expect(wordMarks(['Nova', '2', 'מהיר'], 'rtl')).toEqual([LRM, LRM, RLM]);
    expect(wordMarks(['40%', 'מהר'], 'rtl')).toEqual(['', RLM]);
  });

  it('leaves punctuation to its neighbours', () => {
    expect(wordMarks(['—', 'שלום'], 'rtl')).toEqual(['', RLM]);
  });
});
