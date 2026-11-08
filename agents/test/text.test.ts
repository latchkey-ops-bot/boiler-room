import { describe, expect, it } from 'vitest';
import { htmlTitle, htmlToText } from '../src/capture/text-extract.ts';
import {
  normaliseUrl,
  normaliseWhitespace,
  numbersIn,
  siteHost,
  slugify,
} from '../src/researcher/text.ts';

describe('text helpers', () => {
  it('normalises whitespace only', () => {
    expect(normaliseWhitespace('  A\n\tquote with ​gaps.  ')).toBe('A quote with gaps.');
    expect(normaliseWhitespace('Case Stays, “quotes” too')).toBe('Case Stays, “quotes” too');
  });

  it('normalises page addresses', () => {
    expect(normaliseUrl('https://WWW.Site.example.org/Pricing/#plans')).toBe(
      'https://www.site.example.org/Pricing',
    );
    expect(normaliseUrl('https://site.example.org')).toBe('https://site.example.org/');
    expect(normaliseUrl('https://site.example.org/a?b=1')).toBe('https://site.example.org/a?b=1');
    expect(normaliseUrl('mailto:x@y.z')).toBeUndefined();
    expect(normaliseUrl('not a url')).toBeUndefined();
  });

  it('files a run under the bare host', () => {
    expect(siteHost('https://www.Site.example.org/x')).toBe('site.example.org');
  });

  it('makes slugs from paths', () => {
    expect(slugify('/docs/Getting Started/')).toBe('docs-getting-started');
    expect(slugify('///')).toBe('page');
  });

  it('reads numbers without thousands separators', () => {
    expect(numbersIn('From $1,200.50 to 3,5 for 10,000+ teams in 2025')).toEqual([
      '1200.50',
      '3,5',
      '10000',
      '2025',
    ]);
  });

  it('turns customer HTML into text', () => {
    const html =
      '<html><head><title>Press &amp; news</title><style>p{}</style></head><body><h1>Launch</h1><p>We grew 3&times; &#8212; fast.<script>x()</script></p></body></html>';
    expect(htmlTitle(html)).toBe('Press & news');
    expect(htmlToText(html)).toBe('Launch\nWe grew 3× — fast.');
  });
});
