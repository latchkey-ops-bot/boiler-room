import { describe, expect, it } from 'vitest';
import { clampUnit } from '../src/core/clamp-unit.ts';

describe('clampUnit', () => {
  it('keeps a value inside the unit interval', () => {
    expect(clampUnit(0.25)).toBe(0.25);
    expect(clampUnit(0)).toBe(0);
    expect(clampUnit(1)).toBe(1);
  });

  it('clamps a value below 0 or above 1', () => {
    expect(clampUnit(-0.5)).toBe(0);
    expect(clampUnit(1.5)).toBe(1);
  });
});
