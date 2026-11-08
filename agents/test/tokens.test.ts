import { describe, expect, it } from 'vitest';
import { blend, contrast } from '../src/capture/color.ts';
import { deriveColors, pickBackground, pickRadius, variableRole } from '../src/capture/tokens.ts';
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

  it('keeps what html and body paint unless one wrapper covers most of the first screens', () => {
    const mixed = [
      { ...color('#222222'), weight: 50 },
      { ...color('#C9B79C'), weight: 40 },
      { ...color('#ECE9E2'), weight: 20 },
    ];
    expect(pickBackground(styles({ root: '#ECE9E2', rootSet: true, backgrounds: mixed })).hex).toBe(
      '#ECE9E2',
    );
    const wrapped = [
      { ...color('#222222'), weight: 70 },
      { ...color('#ECE9E2'), weight: 10 },
    ];
    expect(
      pickBackground(styles({ root: '#ECE9E2', rootSet: true, backgrounds: wrapped })).hex,
    ).toBe('#222222');
  });

  it('takes the most sampled surface when html and body paint nothing', () => {
    const samples = [
      { ...color('#0B0B0F'), weight: 30 },
      { ...color('#FFFFFF'), weight: 10 },
    ];
    expect(
      pickBackground(styles({ root: '#FFFFFF', rootSet: false, backgrounds: samples })).hex,
    ).toBe('#0B0B0F');
  });

  it('notes the overlays hidden before the colours were measured', () => {
    const colors = deriveColors(styles({ root: '#FFFFFF', overlays: 2 }));
    expect(colors.notes.join(' ')).toMatch(/^2 cookie banner/);
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

  it('ignores browser default link colours, and says so', () => {
    const result = deriveColors(styles({ links: [{ ...color('#0000EE'), weight: 20 }] }));
    expect(result.primary).toBe('#1F2937');
    expect(result.notes).toContain(
      "The site sets no brand colour of its own: its links use the browser's default #0000EE, so the text colour is primary.",
    );
  });

  it('says a site with no saturated colour at all has none', () => {
    expect(deriveColors(styles()).notes).toContain(
      'The site uses no saturated colour, so the text colour is primary.',
    );
  });

  // A plain list of links: the browser's blue link text outnumbers the black body text seven to
  // one, and was taken as the text colour.
  it('takes the text colour from the body copy, not from link text', () => {
    const result = deriveColors(
      styles({
        texts: [
          { ...color('#0000EE'), weight: 7800, heading: false, link: true },
          { ...color('#000000'), weight: 1050, heading: false },
        ],
        links: [{ ...color('#0000EE'), weight: 212 }],
      }),
    );
    expect(result.foreground).toBe('#000000');
    expect(result.primary).toBe('#000000');
    expect(result.muted).toBeNull();
  });

  // A dark site whose descriptions are in a tertiary grey: the grey has the most characters, but
  // the headlines and primary text are near-white.
  it('takes the strongest of the main text colours, so headlines are not set in a dim grey', () => {
    const result = deriveColors(
      styles({
        root: '#08090A',
        backgrounds: [{ ...color('#08090A'), weight: 140 }],
        texts: [
          { ...color('#8A8F98'), weight: 1600, heading: false },
          { ...color('#D0D6E0'), weight: 700, heading: false },
          { ...color('#F7F8F8'), weight: 300, heading: true },
          { ...color('#F7F8F8'), weight: 900, heading: false, chrome: true },
        ],
      }),
    );
    expect(result.foreground).toBe('#F7F8F8');
    expect(result.muted).toBe('#8A8F98');
  });

  it('never makes muted brighter than the foreground', () => {
    const result = deriveColors(
      styles({
        root: '#08090A',
        backgrounds: [{ ...color('#08090A'), weight: 140 }],
        texts: [
          { ...color('#F7F8F8'), weight: 500, heading: true },
          { ...color('#FFFFFF'), weight: 30, heading: false },
          { ...color('#8A8F98'), weight: 1600, heading: false },
        ],
      }),
    );
    expect(contrast(result.muted ?? '#000000', result.background)).toBeLessThan(
      contrast(result.foreground, result.background),
    );
  });

  it('ignores text in the navigation and footer when there is enough body copy', () => {
    const result = deriveColors(
      styles({
        texts: [
          { ...color('#6B7280'), weight: 4000, heading: false, chrome: true },
          { ...color('#111827'), weight: 900, heading: false },
        ],
      }),
    );
    expect(result.foreground).toBe('#111827');
  });

  // A monochrome brand: its declared --primary is the near-black its buttons are painted with,
  // and an orange accent variable must not take the primary role from it.
  it('keeps a neutral primary the site declares and paints its buttons with', () => {
    const result = deriveColors(
      styles({
        texts: [
          { ...color('#242424'), weight: 3500, heading: false },
          { ...color('#CC4510'), weight: 40, heading: true },
        ],
        ctas: [
          cta({ placement: 'nav', background: color('#242424') }),
          cta({ background: color('#242424') }),
        ],
        colorVariables: [
          { name: '--primary', hex: '#242424', alpha: 1 },
          { name: '--primary-foreground', hex: '#FFFFFF', alpha: 1 },
          { name: '--color-site-accent', hex: '#CC4510', alpha: 1 },
        ],
      }),
    );
    expect(result).toMatchObject({ primary: '#242424', accent: '#CC4510' });
  });

  it('does not make neutral buttons primary unless the site declares them its brand colour', () => {
    const result = deriveColors(
      styles({
        root: '#08090A',
        backgrounds: [{ ...color('#08090A'), weight: 140 }],
        texts: [{ ...color('#F7F8F8'), weight: 900, heading: false }],
        ctas: [
          cta({ placement: 'nav', background: color('#E5E5E6'), color: color('#08090A') }),
          cta({ background: color('#E5E5E6'), color: color('#08090A') }),
        ],
        colorVariables: [
          { name: '--color-text-primary', hex: '#F7F8F8', alpha: 1 },
          { name: '--color-bg-primary', hex: '#08090A', alpha: 1 },
          { name: '--color-accent-hover', hex: '#828FFF', alpha: 1 },
          { name: '--color-accent', hex: '#7170FF', alpha: 1 },
          { name: '--color-brand-bg', hex: '#5E6AD2', alpha: 1 },
        ],
      }),
    );
    expect(result.primary).toBe('#5E6AD2');
  });

  it('notes a page that declares both light and dark colour schemes', () => {
    expect(deriveColors(styles({ colorScheme: 'light dark' })).notes.join(' ')).toContain(
      'both light and dark',
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
  const fill = { background: color('#4F46E5') };

  it('takes the most common button radius, with 999 for pills', () => {
    expect(
      pickRadius(
        styles({
          ctas: [
            cta({ ...fill, radius: 6 }),
            cta({ ...fill, radius: 6 }),
            cta({ ...fill, radius: 0 }),
          ],
        }),
      ),
    ).toBe(6);
    expect(
      pickRadius(
        styles({
          ctas: [
            cta({ ...fill, radius: 24, pill: true }),
            cta({ ...fill, radius: 24, pill: true }),
          ],
        }),
      ),
    ).toBe(999);
  });

  // Twenty square menu toggles with no fill and no border showed no corners at all, and outvoted
  // the pill-shaped buttons the site actually draws.
  it('counts only buttons that are drawn, with a fill or a border', () => {
    const toggles = Array.from({ length: 20 }, () => cta({ placement: 'body', radius: 0 }));
    expect(
      pickRadius(
        styles({
          ctas: [
            ...toggles,
            cta({ placement: 'nav', background: color('#E5E5E6'), radius: 9999, pill: true }),
            cta({ border: color('#2E2E32'), radius: 16, pill: true }),
          ],
        }),
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

describe('variableRole', () => {
  it('reads the brand colour from names that declare it', () => {
    for (const name of [
      '--primary',
      '--color-primary',
      '--brand',
      '--color-brand-bg',
      '--main-color',
    ])
      expect(variableRole(name), name).toEqual({ role: 'brand', weight: 8 });
    expect(variableRole('--color-primary-600')).toEqual({ role: 'brand', weight: 3 });
    expect(variableRole('--color-site-accent')).toEqual({ role: 'accent', weight: 2 });
  });

  it('ignores text, border, state and surface colours that only mention primary or accent', () => {
    for (const name of [
      '--color-text-primary',
      '--primary-foreground',
      '--color-fg-primary',
      '--color-bg-primary',
      '--color-border-primary',
      '--color-link-primary',
      '--color-accent-hover',
      '--color-accent-ink',
      '--sidebar-primary',
      '--color-brand-text',
      '--gray-100',
    ])
      expect(variableRole(name), name).toBeNull();
  });
});
