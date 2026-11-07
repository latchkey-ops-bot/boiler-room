import { contrastRatio, MIN_CONTRAST } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { mix, withAlpha } from '../src/brand/color.ts';
import { rejectLogo, resolveLogo } from '../src/brand/logo.ts';
import { resolveTheme } from '../src/brand/theme.ts';
import { novaCopy, quillhavenCopy } from './fixtures.ts';

const wordmark = { kind: 'wordmark', reason: 'missing' } as const;

/** Saturated, with nothing muted about it. It still passes the validator's contrast rules. */
const loudBrand = () => {
  const brand = novaCopy().brand;
  brand.colors = {
    background: '#FFE500',
    foreground: '#111111',
    primary: '#2B00FF',
    accent: '#FF2D55',
    muted: '#FFF7B0',
  };
  return brand;
};

describe('mix and withAlpha', () => {
  it('mixes two colours', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
  });

  it('adds an alpha channel', () => {
    expect(withAlpha('#7c9cff', 0.5)).toBe('#7C9CFF80');
    expect(withAlpha('#7C9CFF', 2)).toBe('#7C9CFFFF');
  });
});

describe('resolveTheme', () => {
  const cases = {
    dark: novaCopy().brand,
    light: quillhavenCopy().brand,
    loud: loudBrand(),
  };

  it.each(Object.entries(cases))('reads %s brands correctly', (name, brand) => {
    const theme = resolveTheme(brand, wordmark);
    expect(theme.isDark).toBe(name === 'dark');
  });

  it.each(Object.entries(cases))('keeps every %s text colour readable', (_name, brand) => {
    const { colors } = resolveTheme(brand, wordmark);
    expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.muted, colors.background)).toBeGreaterThanOrEqual(
      MIN_CONTRAST.foreground,
    );
    expect(contrastRatio(colors.onPrimary, colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.accent, colors.background)).toBeGreaterThanOrEqual(3);
  });

  it('keeps a muted colour the brand chose when it can be read', () => {
    expect(resolveTheme(novaCopy().brand, wordmark).colors.muted).toBe('#8A93A8');
  });

  it('replaces a muted colour that cannot be read with a mix of the brand colours', () => {
    const brand = quillhavenCopy().brand;
    const muted = resolveTheme(brand, wordmark).colors.muted;
    expect(muted).not.toBe(brand.colors.muted);
    expect(muted).not.toBe(brand.colors.foreground);
  });

  it('takes every colour, font and radius from the brand', () => {
    const brand = quillhavenCopy().brand;
    const theme = resolveTheme(brand, wordmark);
    expect(theme.colors.background).toBe(brand.colors.background);
    expect(theme.colors.primary).toBe(brand.colors.primary);
    expect(theme.fonts).toEqual({ display: '"Fraunces"', body: '"Source Serif 4"' });
    expect(theme.radius).toBe(4);
  });

  it('falls back to primary for an accent that would vanish', () => {
    const brand = novaCopy().brand;
    brand.colors.accent = '#0C1122';
    expect(resolveTheme(brand, wordmark).colors.accent).toBe(brand.colors.primary);
  });
});

describe('logo', () => {
  const background = '#0B1020';

  it.each([
    ['missing', { loaded: false }],
    ['too-small', { loaded: true, width: 32, height: 32 }],
    ['wrong-shape', { loaded: true, width: 2000, height: 40 }],
    ['blank', { loaded: true, width: 400, height: 100, coverage: 0 }],
    [
      'invisible',
      {
        loaded: true,
        width: 400,
        height: 100,
        coverage: 0.3,
        palette: [{ color: '#0D1222', share: 1 }],
      },
    ],
  ] as const)('rejects a logo that is %s', (reason, probe) => {
    expect(rejectLogo(probe, background)).toBe(reason);
    expect(resolveLogo(probe, 'logo.png', background)).toEqual({ kind: 'wordmark', reason });
  });

  it('rejects a two tone logo that loses its name on this background', () => {
    const probe = {
      loaded: true,
      width: 373,
      height: 112,
      coverage: 0.4,
      palette: [
        { color: '#7799FF', share: 0.6 },
        { color: '#FFFFFF', share: 0.4 },
      ],
    };
    expect(rejectLogo(probe, '#0B1020')).toBeUndefined();
    expect(rejectLogo(probe, '#FFE500')).toBe('invisible');
  });

  it('keeps a logo with only a small faint detail', () => {
    const probe = {
      loaded: true,
      width: 373,
      height: 112,
      palette: [
        { color: '#7799FF', share: 0.9 },
        { color: '#0B1020', share: 0.1 },
      ],
    };
    expect(rejectLogo(probe, '#0B1020')).toBeUndefined();
  });

  it('uses a logo that can be seen, at its own aspect', () => {
    const probe = {
      loaded: true,
      width: 400,
      height: 100,
      coverage: 0.3,
      palette: [{ color: '#F4F6FB', share: 1 }],
    };
    expect(resolveLogo(probe, 'logo.svg', background)).toEqual({
      kind: 'image',
      src: 'logo.svg',
      aspect: 4,
    });
  });

  it('uses a logo whose pixels the browser would not let it read', () => {
    expect(rejectLogo({ loaded: true, width: 400, height: 100 }, background)).toBeUndefined();
  });
});
