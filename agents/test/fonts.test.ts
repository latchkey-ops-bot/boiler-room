import { describe, expect, it } from 'vitest';
import {
  families,
  genericOf,
  isSystemFamily,
  methodOf,
  parseFontFaces,
  pickFace,
  resolveFonts,
  substituteCssUrl,
} from '../src/capture/fonts.ts';
import type { RawFonts } from '../src/capture/types.ts';

// The shape Google Fonts serves: one block per unicode subset and weight.
const GOOGLE_CSS = `
/* cyrillic */
@font-face { font-family: 'Sora'; font-style: normal; font-weight: 400 700; font-display: swap;
  src: url(https://fonts.gstatic.com/s/sora/v12/cyrillic.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F; }
/* latin */
@font-face { font-family: 'Sora'; font-style: normal; font-weight: 400 700; font-display: swap;
  src: url(https://fonts.gstatic.com/s/sora/v12/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2000-206F; }
@font-face { font-family: "Brand Sans"; src: url("/fonts/brand-sans.woff") format("woff"), url(/fonts/brand-sans.woff2) format("woff2"); font-weight: bold; }
@font-face { font-family: Icons; src: url(data:font/woff2;base64,AAAA) format('woff2'); }
`;

describe('parseFontFaces', () => {
  const faces = parseFontFaces(GOOGLE_CSS, 'https://site.example.org/assets/app.css');

  it('reads every source of every face and resolves relative URLs', () => {
    expect(faces.map((face) => [face.family, face.url, face.format])).toEqual([
      ['Sora', 'https://fonts.gstatic.com/s/sora/v12/cyrillic.woff2', 'woff2'],
      ['Sora', 'https://fonts.gstatic.com/s/sora/v12/latin.woff2', 'woff2'],
      ['Brand Sans', 'https://site.example.org/fonts/brand-sans.woff', 'woff'],
      ['Brand Sans', 'https://site.example.org/fonts/brand-sans.woff2', 'woff2'],
    ]);
  });

  it('picks the Latin subset, the nearest weight and woff2', () => {
    expect(pickFace(faces, 'sora', 600)?.url).toBe(
      'https://fonts.gstatic.com/s/sora/v12/latin.woff2',
    );
    expect(pickFace(faces, 'Brand Sans', 700)?.url).toBe(
      'https://site.example.org/fonts/brand-sans.woff2',
    );
    expect(pickFace(faces, 'Missing', 400)).toBeUndefined();
  });
});

describe('font helpers', () => {
  it('splits stacks and knows system families', () => {
    expect(families('"Inter Tight", Inter, system-ui, sans-serif')).toEqual([
      'Inter Tight',
      'Inter',
      'system-ui',
      'sans-serif',
    ]);
    expect(isSystemFamily('-apple-system')).toBe(true);
    expect(isSystemFamily('Inter')).toBe(false);
    expect(genericOf('Georgia, serif')).toBe('serif');
    expect(genericOf('ui-monospace, Menlo, monospace')).toBe('mono');
    expect(genericOf('-apple-system, sans-serif')).toBe('sans');
  });

  it('names how a font is loaded', () => {
    expect(methodOf('https://fonts.gstatic.com/s/x.woff2', 'site.example.org')).toBe(
      'google-fonts',
    );
    expect(methodOf('https://use.typekit.net/af/x.woff2', 'site.example.org')).toBe('adobe-fonts');
    expect(methodOf('https://www.site.example.org/f.woff2', 'site.example.org')).toBe(
      'self-hosted',
    );
    expect(methodOf('https://cdn.other.example/f.woff2', 'site.example.org')).toBe('other-host');
  });

  it('builds a Google Fonts address for a substitute', () => {
    expect(substituteCssUrl('Source Serif 4', [400, 640])).toBe(
      'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600&display=swap',
    );
  });
});

describe('resolveFonts', () => {
  const raw = (uses: RawFonts['uses'], loaded: string[] = []): RawFonts => ({
    uses,
    loaded: loaded.map((family) => ({ family, weight: '400', style: 'normal' })),
    stylesheets: [],
    faces: [],
    unreadable: [],
  });
  const faces = parseFontFaces(GOOGLE_CSS, 'https://site.example.org/app.css');

  it('maps each role to the loaded family and its file', () => {
    const resolved = resolveFonts(
      raw([
        { role: 'display', stack: 'Sora, sans-serif', weight: 700 },
        { role: 'body', stack: '"Brand Sans", Arial, sans-serif', weight: 400 },
      ]),
      faces,
      'site.example.org',
    );
    expect(resolved.map((font) => [font.role, font.family, font.method, font.url])).toEqual([
      ['display', 'Sora', 'google-fonts', 'https://fonts.gstatic.com/s/sora/v12/latin.woff2'],
      ['body', 'Brand Sans', 'self-hosted', 'https://site.example.org/fonts/brand-sans.woff2'],
    ]);
  });

  it('marks a system stack, so the capture can find a substitute', () => {
    const resolved = resolveFonts(
      raw([
        { role: 'body', stack: '-apple-system, system-ui, "Segoe UI", sans-serif', weight: 400 },
      ]),
      faces,
      'site.example.org',
    );
    expect(resolved).toEqual([
      {
        role: 'body',
        family: '-apple-system',
        weight: 400,
        method: 'system',
        url: null,
        siteFamily: null,
      },
    ]);
  });
});
