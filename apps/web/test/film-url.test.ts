import { describe, expect, it } from 'vitest';
import { parseFilmUrl } from '../src/lib/film-url.ts';

describe('parseFilmUrl', () => {
  it.each([
    ['nova.com', 'https://nova.com/'],
    ['  https://www.Nova.com/pricing#plans ', 'https://www.nova.com/pricing'],
    ['http://nova.co.uk', 'http://nova.co.uk/'],
    ['https://app.nova.example.com/path?q=1', 'https://app.nova.example.com/path?q=1'],
    ['xn--bcher-kva.example.com', 'https://xn--bcher-kva.example.com/'],
  ])('accepts %s', (input, url) => {
    expect(parseFilmUrl(input)).toEqual({ ok: true, url });
  });

  it.each([
    ['', 'empty'],
    ['ftp://nova.com', 'not http'],
    ['javascript:alert(1)', 'a script'],
    ['file:///etc/passwd', 'a file'],
    ['data:text/html,hi', 'data'],
    ['https://user:pass@nova.com', 'credentials'],
    ['https://nova.com:8443', 'a port'],
    ['localhost', 'localhost'],
    ['http://localhost:3000', 'localhost with a port'],
    ['https://app.localhost', 'a .localhost name'],
    ['http://127.0.0.1', 'loopback'],
    ['http://10.0.0.8', 'a private address'],
    ['http://169.254.169.254/latest/meta-data', 'the metadata service'],
    ['http://2130706433', 'a decimal IP'],
    ['http://0x7f.1', 'a hex IP'],
    ['http://[::1]/', 'IPv6 loopback'],
    ['http://[fd00::1]/', 'IPv6 private'],
    ['https://printer.local', 'mDNS'],
    ['https://metadata.google.internal', 'an internal name'],
    ['https://router.home.arpa', 'home.arpa'],
    ['https://intranet', 'a single label'],
    ['https://nova.test', 'a reserved TLD'],
    ['https://-nova.com', 'a bad label'],
    [`https://nova.com/${'a'.repeat(2100)}`, 'too long'],
  ])('refuses %s (%s)', (input) => {
    const result = parseFilmUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });
});
