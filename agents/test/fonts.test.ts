import { describe, expect, it } from 'vitest';
import {
  describeSubstitute,
  facesFromRaw,
  families,
  genericOf,
  isSystemFamily,
  keepDownloadable,
  methodOf,
  parseFontFaces,
  pickFace,
  type ResolvedFont,
  resolveFonts,
  sniffFont,
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

// A framework stylesheet under a nested path names its font relative to itself. Resolved against
// the page, the address lost its path prefix and answered 404.
describe('facesFromRaw', () => {
  it('resolves each source against the stylesheet it is in, not the page', () => {
    const faces = facesFromRaw(
      [
        {
          family: 'Brand Sans',
          src: 'url("../media/brand-sans.woff2?v=3") format("woff2")',
          base: 'https://site.example.org/_site/_next/static/css/app.css',
          weight: '400',
          style: 'normal',
          unicodeRange: '',
        },
        {
          family: 'Inline Face',
          src: 'url(/fonts/inline.woff2) format("woff2")',
          weight: '400',
          style: 'normal',
          unicodeRange: '',
        },
      ],
      'https://site.example.org/',
    );
    expect(faces.map((face) => face.url)).toEqual([
      'https://site.example.org/_site/_next/static/media/brand-sans.woff2?v=3',
      'https://site.example.org/fonts/inline.woff2',
    ]);
  });
});

describe('sniffFont', () => {
  const bytes = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)));
  it('tells font files from an HTML page served in their place', () => {
    expect(sniffFont(bytes('wOF2....'))).toBe('woff2');
    expect(sniffFont(bytes('wOFF....'))).toBe('woff');
    expect(sniffFont(bytes('OTTO....'))).toBe('otf');
    expect(sniffFont(new Uint8Array([0, 1, 0, 0, 0, 12]))).toBe('ttf');
    expect(sniffFont(bytes('<!doctype html><title>404</title>'))).toBeNull();
    expect(sniffFont(new Uint8Array())).toBeNull();
  });
});

describe('keepDownloadable', () => {
  const faces = parseFontFaces(GOOGLE_CSS, 'https://site.example.org/assets/app.css');
  const font = (url: string): ResolvedFont => ({
    role: 'display',
    family: 'Brand Sans',
    weight: 700,
    method: 'self-hosted',
    url,
    siteFamily: null,
  });

  it('switches to another file of the family when the chosen one does not download', async () => {
    const resolved = [font('https://site.example.org/fonts/brand-sans.woff2')];
    const notes = await keepDownloadable(resolved, faces, 'site.example.org', async (url) =>
      url.endsWith('.woff2') ? { ok: false, status: 404 } : { ok: true, status: 200 },
    );
    expect(resolved[0]).toMatchObject({
      url: 'https://site.example.org/fonts/brand-sans.woff',
      method: 'self-hosted',
    });
    expect(notes.join(' ')).toContain('could not be downloaded');
  });

  it('marks the role for a substitute, with the failed address, when no file downloads', async () => {
    const resolved = [font('https://site.example.org/fonts/brand-sans.woff2')];
    await keepDownloadable(resolved, faces, 'site.example.org', async () => ({
      ok: false,
      status: 404,
    }));
    expect(resolved[0]).toMatchObject({
      method: 'system',
      reason: 'unreachable',
      url: null,
      failed: { url: 'https://site.example.org/fonts/brand-sans.woff2', status: 404 },
    });
  });

  it('leaves a file that downloads alone', async () => {
    const resolved = [font('https://site.example.org/fonts/brand-sans.woff2')];
    const notes = await keepDownloadable(resolved, faces, 'site.example.org', async () => ({
      ok: true,
      status: 200,
    }));
    expect(resolved[0]?.url).toBe('https://site.example.org/fonts/brand-sans.woff2');
    expect(notes).toEqual([]);
  });
});

describe('describeSubstitute', () => {
  const base: ResolvedFont = {
    role: 'body',
    family: 'Source Serif 4',
    weight: 400,
    method: 'substitute',
    url: 'https://fonts.gstatic.com/s/x.woff2',
    siteFamily: '"Times New Roman"',
  };
  it('says why the stand-in is used, in plain words', () => {
    expect(describeSubstitute({ ...base, reason: 'browser-default' })).toBe(
      'Body text uses the browser\'s default font ("Times New Roman"): the site sets no font of its own, so Source Serif 4 stands in.',
    );
    expect(
      describeSubstitute({
        ...base,
        role: 'display',
        siteFamily: 'Brand Sans',
        reason: 'unreachable',
        failed: { url: 'https://site.example.org/f.woff2', status: 404 },
      }),
    ).toContain('its file https://site.example.org/f.woff2 could not be downloaded (HTTP 404)');
    expect(describeSubstitute({ ...base, siteFamily: 'Brand Sans', reason: 'no-file' })).toContain(
      'the site loads no file for it',
    );
    expect(
      describeSubstitute({ ...base, siteFamily: '-apple-system', reason: 'system' }),
    ).toContain('system fonts');
  });
});
