import { describe, expect, it } from 'vitest';
import { blend, contrast } from '../src/capture/color.ts';
import { deriveColors, pickBackground, pickRadius } from '../src/capture/tokens.ts';
import type { RawCta, RawStyles } from '../src/capture/types.ts';

const color = (hex: string, alpha = 1) => ({ hex, alpha });

function cta(overrides: Partial<RawCta> = {}): RawCta {
  return {
    text: 'Start free',
    href: 'https://example.org/signup',
    placement: 'hero',
    background: null,
    color: color('#FFFFFF'),
    border: null,
    radius: 8,
    pill: false,
    area: 4000,
    ...overrides,
  };
}

function styles(overrides: Partial<RawStyles> = {}): RawStyles {
  return {
    root: '#FFFFFF',
    backgrounds: [{ ...color('#FFFFFF'), weight: 100 }],
    texts: [{ ...color('#1F2937'), weight: 2000, heading: false }],
    links: [],
    ctas: [],
    cardRadii: [],
    colorVariables: [],
    colorScheme: 'normal',
    ...overrides,
  };
}

describe('pickBackground', () => {
  it('keeps the body colour when a large dark product shot covers much of the first screen', () => {
    const result = pickBackground(
      styles({
        root: '#FBFBFD',
        backgrounds: [
          { ...color('#FBFBFD'), weight: 48 },
          { ...color('#0E1117'), weight: 64 },
        ],
      }),
    );
    expect(result.hex).toBe('#FBFBFD');
    expect(result.surfaces).toEqual(['#0E1117', '#FBFBFD']);
  });

  it('uses the painted colour when the site paints a wrapper and not the body', () => {
    expect(
      pickBackground(
        styles({
          root: '#FFFFFF',
          backgrounds: [
            { ...color('#010101'), weight: 140 },
            { ...color('#FFFFFF'), weight: 4 },
          ],
        }),
      ).hex,
    ).toBe('#010101');
  });

  it('falls back to the body colour when nothing was sampled', () => {
    expect(pickBackground(styles({ root: '#0B0B0C', backgrounds: [] })).hex).toBe('#0B0B0C');
  });
});

describe('deriveColors', () => {
  it('finds the brand colour from button fills, without any CSS variables', () => {
    const result = deriveColors(
      styles({
        ctas: [
          cta({ background: color('#4F46E5'), placement: 'nav' }),
          cta({ background: color('#4F46E5') }),
        ],
        links: [{ ...color('#4F46E5'), weight: 6 }],
      }),
    );
    expect(result).toMatchObject({
      background: '#FFFFFF',
      foreground: '#1F2937',
      primary: '#4F46E5',
      mode: 'light',
      cssVariables: false,
    });
    expect(result.candidates[0]?.sources).toEqual(['nav button fill', 'hero button fill', 'links']);
  });

  it('does not assume the main call to action is the brand colour', () => {
    // A dark site whose hero button is white and whose brand colour is on the nav button and headings.
    const result = deriveColors(
      styles({
        root: '#010101',
        backgrounds: [{ ...color('#010101'), weight: 120 }],
        texts: [
          { ...color('#FBFBFD'), weight: 3000, heading: false },
          { ...color('#BED263'), weight: 60, heading: true },
        ],
        ctas: [
          cta({ background: color('#FBFBFD'), color: color('#010101') }),
          cta({ placement: 'nav', background: color('#BED263'), color: color('#010101') }),
        ],
      }),
    );
    expect(result).toMatchObject({
      background: '#010101',
      foreground: '#FBFBFD',
      primary: '#BED263',
      mode: 'dark',
    });
  });

  it('reads colour custom properties named for the brand when the site has them', () => {
    const result = deriveColors(
      styles({
        colorVariables: [
          { name: '--brand-primary', hex: '#E11D48', alpha: 1 },
          { name: '--gray-100', hex: '#F3F4F6', alpha: 1 },
        ],
      }),
    );
    expect(result.primary).toBe('#E11D48');
    expect(result.cssVariables).toBe(true);
  });

  it('ignores browser default link colours', () => {
    const result = deriveColors(styles({ links: [{ ...color('#0000EE'), weight: 20 }] }));
    expect(result.primary).toBe('#1F2937');
    expect(result.notes).toContain(
      'The site uses no saturated colour, so the text colour is primary.',
    );
  });

  it('uses the next real brand colour when the first fails 3:1 on the background', () => {
    const result = deriveColors(
      styles({
        ctas: [
          cta({ background: color('#FDE047'), color: color('#111111') }),
          cta({ placement: 'nav', background: color('#FDE047') }),
        ],
        links: [{ ...color('#2563EB'), weight: 5 }],
      }),
    );
    expect(result.primary).toBe('#2563EB');
    expect(result.accents).toContain('#FDE047');
    expect(contrast(result.primary, result.background)).toBeGreaterThanOrEqual(3);
    expect(result.notes.join(' ')).toContain('#FDE047');
  });

  it('switches to a real page surface when the brand colour only works there', () => {
    const result = deriveColors(
      styles({
        backgrounds: [
          { ...color('#FFFFFF'), weight: 70 },
          { ...color('#111827'), weight: 30 },
        ],
        texts: [
          { ...color('#1F2937'), weight: 2000, heading: false },
          { ...color('#F9FAFB'), weight: 800, heading: false },
        ],
        ctas: [cta({ background: color('#FDE047'), color: color('#111111') })],
      }),
    );
    expect(result.background).toBe('#111827');
    expect(result.primary).toBe('#FDE047');
    expect(result.foreground).toBe('#F9FAFB');
  });

  it('keeps a readable foreground, blending translucent text over the background', () => {
    const result = deriveColors(
      styles({
        root: '#000000',
        backgrounds: [{ ...color('#000000'), weight: 10 }],
        texts: [{ ...color('#FFFFFF', 0.9), weight: 500, heading: false }],
      }),
    );
    expect(result.foreground).toBe(blend('#FFFFFF', 0.9, '#000000'));
    expect(contrast(result.foreground, result.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('notes when no text colour is readable and uses black or white', () => {
    const result = deriveColors(
      styles({ texts: [{ ...color('#DDDDDD'), weight: 900, heading: false }] }),
    );
    expect(result.foreground).toBe('#000000');
    expect(result.notes[0]).toContain('No text colour');
  });

  it('separates a distinct accent and a muted text colour', () => {
    const result = deriveColors(
      styles({
        texts: [
          { ...color('#111827'), weight: 3000, heading: false },
          { ...color('#6B7280'), weight: 900, heading: false },
        ],
        ctas: [cta({ background: color('#4F46E5') }), cta({ background: color('#4F46E5') })],
        links: [{ ...color('#F97316'), weight: 4 }],
      }),
    );
    expect(result).toMatchObject({ primary: '#4F46E5', accent: '#F97316', muted: '#6B7280' });
  });
});

describe('pickRadius', () => {
  it('takes the most common button radius, with 999 for pills', () => {
    expect(
      pickRadius(styles({ ctas: [cta({ radius: 6 }), cta({ radius: 6 }), cta({ radius: 0 })] })),
    ).toBe(6);
    expect(
      pickRadius(
        styles({ ctas: [cta({ radius: 24, pill: true }), cta({ radius: 24, pill: true })] }),
      ),
    ).toBe(999);
  });

  it('falls back to cards, and to null when nothing was measured', () => {
    expect(
      pickRadius(
        styles({
          cardRadii: [
            { px: 12, weight: 5 },
            { px: 0, weight: 2 },
          ],
        }),
      ),
    ).toBe(12);
    expect(pickRadius(styles())).toBeNull();
  });
});
