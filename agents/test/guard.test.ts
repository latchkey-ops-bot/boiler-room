import { describe, expect, it } from 'vitest';
import {
  checkUrl,
  isFontHost,
  isPublicUrl,
  privateAddress,
  UrlGuard,
} from '../src/capture/guard.ts';
import { fetchableFontCss, sitemapAddress, sitemapChild } from '../src/capture/run.ts';

const resolveTo =
  (table: Record<string, string[]>) =>
  async (host: string): Promise<string[]> => {
    const found = table[host];
    if (!found) throw new Error(`getaddrinfo ENOTFOUND ${host}`);
    return found;
  };

describe('privateAddress', () => {
  it.each([
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', 'unspecified'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['10.0.0.1', 'RFC 1918'],
    ['172.16.0.1', 'RFC 1918'],
    ['172.31.255.255', 'RFC 1918'],
    ['192.168.1.1', 'RFC 1918'],
    ['169.254.169.254', 'link-local'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['100.127.255.255', 'carrier-grade NAT'],
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local'],
    ['fe80::1', 'link-local'],
    ['febf:ffff::1', 'link-local'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:7f00:1', 'loopback'],
    ['::ffff:169.254.169.254', 'link-local'],
    ['0:0:0:0:0:ffff:a00:1', 'RFC 1918'],
    ['fe80::1%eth0', 'link-local'],
  ])('refuses %s as %s', (address, reason) => {
    expect(privateAddress(address)).toContain(reason);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.255.255',
    '172.32.0.0',
    '100.63.255.255',
    '100.128.0.0',
    '169.253.255.255',
    '192.169.0.1',
    '11.0.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    'fec0::1',
    'fb00::1',
  ])('lets the public address %s through', (address) => {
    expect(privateAddress(address)).toBeNull();
  });
});

describe('checkUrl', () => {
  const resolve = resolveTo({
    'example.com': ['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
    'metadata.example.net': ['169.254.169.254'],
    'split.example.net': ['93.184.215.14', '10.0.0.5'],
    'loopback.example.net': ['::1'],
  });

  it('allows http and https on a host that resolves only to public addresses', async () => {
    expect(await checkUrl('https://example.com/pricing', { resolve })).toBeNull();
    expect(await isPublicUrl('http://example.com/', { resolve })).toBe(true);
  });

  it.each([
    'ftp://example.com/file',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hi',
    'chrome://settings',
    'not a url',
  ])('refuses %s, which is not an http(s) address', async (url) => {
    expect(await isPublicUrl(url, { resolve })).toBe(false);
  });

  it.each([
    ['http://127.0.0.1:8080/', 'loopback'],
    ['http://0.0.0.0/', 'unspecified'],
    ['http://169.254.169.254/latest/meta-data/', 'link-local'],
    ['http://[::1]/', 'loopback'],
    ['http://[::ffff:127.0.0.1]/', 'loopback'],
    ['http://[fd00::1]/', 'unique local'],
    ['http://10.1.2.3/', 'RFC 1918'],
    ['http://100.100.100.200/', 'carrier-grade NAT'],
  ])('refuses the bare address in %s', async (url, reason) => {
    expect(await checkUrl(url, { resolve })).toContain(reason);
  });

  it('refuses a name that resolves privately, even when one of its addresses is public', async () => {
    expect(await checkUrl('http://metadata.example.net/', { resolve })).toContain('link-local');
    expect(await checkUrl('https://split.example.net/', { resolve })).toContain('10.0.0.5');
    expect(await checkUrl('https://loopback.example.net/', { resolve })).toContain('::1');
  });

  it('refuses a name that does not resolve', async () => {
    expect(await checkUrl('https://nowhere.invalid/', { resolve })).toMatch(/does not resolve/);
    expect(await checkUrl('https://empty.example/', { resolve: async () => [] })).toMatch(
      /does not resolve/,
    );
  });

  it('lets through only the private hosts it is told to, by exact name', async () => {
    const allow = { resolve, allowPrivateHosts: ['127.0.0.1.nip.io'] };
    expect(await checkUrl('http://127.0.0.1.nip.io:8787/', allow)).toBeNull();
    expect(await checkUrl('http://127.0.0.1:8787/', allow)).toContain('loopback');
    expect(await checkUrl('http://metadata.example.net/', allow)).toContain('link-local');
  });
});

describe('UrlGuard', () => {
  it('looks each host up once', async () => {
    let lookups = 0;
    const guard = new UrlGuard({
      resolve: async () => {
        lookups += 1;
        return ['93.184.215.14'];
      },
    });
    await guard.check('https://example.com/a.css');
    await guard.check('https://example.com/b.js');
    expect(await guard.check('https://example.com/c.png')).toBeNull();
    expect(lookups).toBe(1);
    expect(await guard.check('file:///etc/hosts')).toBe('not an http(s) address');
  });
});

describe('font hosts', () => {
  it.each([
    'https://fonts.googleapis.com/css2?family=Inter',
    'https://fonts.gstatic.com/s/inter/v20/a.woff2',
    'https://use.typekit.net/abc1234.css',
    'https://p.typekit.net/p.css?s=1',
  ])('fetches font stylesheets from %s', (href) => {
    expect(isFontHost(href)).toBe(true);
  });

  it.each([
    'https://fonts.googleapis.com.attacker.example/css',
    'https://attacker.example/?u=fonts.googleapis.com',
    'https://attacker.example/typekit.net/a.css',
    'https://typekit.net.attacker.example/a.css',
    'https://eviltypekit.net/a.css',
    'http://169.254.169.254/fonts.gstatic.com',
  ])('does not take %s for a font host', (href) => {
    expect(isFontHost(href)).toBe(false);
  });

  it('fetches only the site’s own unreadable stylesheets and the font hosts’', () => {
    const site = 'https://www.example.com/';
    expect(
      fetchableFontCss(
        [
          'https://example.com/assets/site.css',
          'https://fonts.googleapis.com/css2?family=Inter',
          'https://cdn.attacker.example/fonts.googleapis.com.css',
          'http://169.254.169.254/latest?typekit.net',
        ],
        site,
      ),
    ).toEqual([
      'https://example.com/assets/site.css',
      'https://fonts.googleapis.com/css2?family=Inter',
    ]);
  });
});

describe('sitemaps', () => {
  const site = 'https://www.example.com/';

  it('reads the first sitemap robots.txt names on the site, and never one off it', () => {
    const robots = [
      'User-agent: *',
      'Sitemap: http://169.254.169.254/latest/meta-data/',
      'Sitemap: https://attacker.example/sitemap.xml',
      'Sitemap: https://example.com/sitemap-pages.xml',
    ].join('\n');
    expect(sitemapAddress(robots, site)).toBe('https://example.com/sitemap-pages.xml');
  });

  it('falls back to the site’s own sitemap when robots.txt names none on the site', () => {
    expect(sitemapAddress('Sitemap: http://10.0.0.1/s.xml', site)).toBe(
      'https://www.example.com/sitemap.xml',
    );
    expect(sitemapAddress('', site)).toBe('https://www.example.com/sitemap.xml');
  });

  it('follows a sitemap index only to children on the site', () => {
    const index = `<sitemapindex>
      <sitemap><loc>http://169.254.169.254/pages.xml</loc></sitemap>
      <sitemap><loc>https://attacker.example/main.xml</loc></sitemap>
      <sitemap><loc>https://example.com/blog.xml</loc></sitemap>
      <sitemap><loc>https://example.com/pages.xml</loc></sitemap>
    </sitemapindex>`;
    expect(sitemapChild(index, site)).toBe('https://example.com/pages.xml');
    expect(
      sitemapChild('<sitemapindex><loc>http://127.0.0.1/main.xml</loc></sitemapindex>', site),
    ).toBeUndefined();
  });
});
