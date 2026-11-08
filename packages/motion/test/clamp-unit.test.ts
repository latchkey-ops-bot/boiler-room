import { describe, expect, it } from 'vitest';
import { clampUnit } from '../src/core/clamp-unit.ts';

describe('clampUnit', () => {
  it('gives 0 below 0', () => {
    expect(clampUnit(-0.5)).toBe(0);
  });

  it('gives 1 above 1', () => {
    expect(clampUnit(1.5)).toBe(1);
  });

  it('leaves a value inside unchanged', () => {
    expect(clampUnit(0.25)).toBe(0.25);
  });

  it('keeps both bounds', () => {
    expect(clampUnit(0)).toBe(0);
    expect(clampUnit(1)).toBe(1);
  });
});
