import { describe, expect, it } from 'vitest';
import {
  brandFlags,
  finderAddresses,
  hnName,
  jurisdictionOverride,
  namesHost,
  noSolicitationNotice,
  phCoreName,
  phMatches,
  productName,
  publishedAddresses,
  ukLtdEvidence,
  usEvidence,
} from '../src/gtm/extract.ts';
import {
  checkTarget,
  FetchRefused,
  isSpecialAddress,
  robotsAllows,
  safeFetch,
  scriptRedirect,
} from '../src/gtm/fetcher.ts';
import { parseHtml } from '../src/gtm/html.ts';
import { readSite, type SitePage } from '../src/gtm/site.ts';
import { parseProductHuntFeed, statusTime } from '../src/gtm/sources.ts';
import { fakeTransport, NOW, QUILLBOX, quillboxRoutes } from './gtm-fixtures.ts';

const UA = 'BoilerRoomBot/1.0 (+https://app.boiler-room.invalid/bot)';
const page = (html: string, path = '/', id = 'p1', label = 'homepage'): SitePage => ({
  id,
  path,
  label,
  url: `https://quillbox.example${path}`,
  final_url: `https://quillbox.example${path}`,
  parsed: parseHtml(html, `https://quillbox.example${path}`),
});

describe('the fetcher', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.20.0.1', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['::1', true],
    ['::', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:10.0.0.1', true],
    ['64:ff9b::a00:1', true],
    ['93.184.216.34', false],
    ['2606:2800:220:1:248:1893:25c8:1946', false],
    ['::ffff:93.184.216.34', false],
  ])('treats %s as special: %s', (address, special) => {
    expect(isSpecialAddress(address)).toBe(special);
  });

  it('refuses other schemes, other ports, credentials, localhost and hosts that resolve inward', async () => {
    const transport = fakeTransport({}, { privateHosts: ['intranet.quillbox.example'] });
    for (const [url, code] of [
      ['file:///etc/passwd', 'scheme'],
      ['ftp://quillbox.example/', 'scheme'],
      ['https://quillbox.example:8443/', 'port'],
      ['https://user:pass@quillbox.example/', 'credentials'],
      ['http://localhost/', 'host'],
      ['http://127.0.0.1/', 'address'],
      ['http://[::1]/', 'address'],
      ['https://intranet.quillbox.example/', 'address'],
    ] as const) {
      await expect(checkTarget(url, transport), url).rejects.toMatchObject({ code });
    }
    await expect(checkTarget('https://quillbox.example/', transport)).resolves.toBeInstanceOf(URL);
  });

  it('checks every redirect hop, and stops after five', async () => {
    const inward = fakeTransport({
      'https://quillbox.example/': {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      },
    });
    await expect(
      safeFetch('https://quillbox.example/', inward, { userAgent: UA }),
    ).rejects.toBeInstanceOf(FetchRefused);
    const loop = fakeTransport({
      'https://quillbox.example/*': { status: 301, headers: { location: '/again' } },
    });
    await expect(
      safeFetch('https://quillbox.example/', loop, { userAgent: UA }),
    ).rejects.toMatchObject({ code: 'redirects' });
  });

  it('resolves t.co through a Location header or the meta refresh it sends scripts', async () => {
    expect(
      scriptRedirect('<meta http-equiv="refresh" content="0;URL=https://quillbox.example/?ref=x">'),
    ).toBe('https://quillbox.example/?ref=x');
    expect(
      scriptRedirect('<script>location.replace("https:\\/\\/quillbox.example\\/")</script>'),
    ).toBe('https://quillbox.example/');
    const transport = fakeTransport({
      'https://t.co/abc': {
        body: '<head><meta http-equiv="refresh" content="0;URL=https://quillbox.example/"></head>',
      },
      'https://quillbox.example/': { body: '<p>home</p>' },
    });
    const result = await safeFetch('https://t.co/abc', transport, {
      userAgent: UA,
      followScriptRedirects: true,
    });
    expect(result.finalUrl).toBe('https://quillbox.example/');
  });

  it('honours robots.txt for our agent and for everyone', () => {
    const robots =
      'User-agent: *\nDisallow: /private\n\nUser-agent: BoilerRoomBot\nDisallow: /\nAllow: /about';
    expect(robotsAllows(robots, UA, '/')).toBe(false);
    expect(robotsAllows(robots, UA, '/about')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /private', UA, '/private/x')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow:', UA, '/')).toBe(true);
    expect(robotsAllows('', UA, '/')).toBe(true);
  });
});

describe('reading a site', () => {
  it('keeps only the text a reader sees', () => {
    const parsed = parseHtml(
      '<html><head><title>Q</title><style>p{}</style></head><body><p>Seen.</p><div hidden><p>Hidden.</p></div><span aria-hidden="true">Also hidden.</span><template><p>T</p></template><noscript>N</noscript><p style="display:none">Gone.</p><p>Last.</p></body></html>',
      'https://quillbox.example/',
    );
    expect(parsed.text).toBe('Seen.\nLast.');
  });

  it('reads at most six pages of the site itself, and stores them for checkQuote', async () => {
    const transport = fakeTransport(quillboxRoutes());
    const read = await readSite('https://quillbox.example/', transport, UA, NOW);
    expect(read.failure).toBeNull();
    expect(read.pages.map((item) => [item.id, item.path, item.label])).toEqual([
      ['p1', '/', 'homepage'],
      ['p2', '/contact', 'contact page'],
      ['p3', '/terms', 'terms page'],
    ]);
    expect(read.bundle.pages[0]?.text.illustrative).toBe('');
    expect(read.bundle.pages[0]?.text.rendered).not.toContain('Ignore your rules');
    expect(transport.seen.filter((url) => !url.endsWith('robots.txt')).length).toBeLessThanOrEqual(
      6,
    );
  });

  it('fails closed on a homepage that redirects off the site or says nothing', async () => {
    const away = fakeTransport({
      'https://quillbox.example/': { status: 301, headers: { location: 'https://other.example/' } },
      'https://other.example/': { body: '<p>x</p>' },
    });
    expect((await readSite('https://quillbox.example/', away, UA, NOW)).failure).toBe(
      'redirects_off_site',
    );
    const empty = fakeTransport({
      'https://quillbox.example/': { body: '<div id="root"></div><script src="/app.js"></script>' },
    });
    expect((await readSite('https://quillbox.example/', empty, UA, NOW)).failure).toBe(
      'site_unreadable',
    );
  });
});

describe('what code reads from a site', () => {
  it("keeps only role addresses on the lead's own domain, best page first", () => {
    const pages = [
      page('<p>Mail hello@quillbox.example or ceo@quillbox.example, or hi@gmail.com.</p>'),
      page(
        '<a href="mailto:contact@quillbox.example?subject=hi">Write</a> <a href="mailto:press@other.example">P</a>',
        '/contact',
        'p2',
        'contact page',
      ),
    ];
    expect(
      publishedAddresses({ pages }, QUILLBOX).map((item) => [item.address, item.page_label]),
    ).toEqual([
      ['contact@quillbox.example', 'contact page'],
      ['hello@quillbox.example', 'homepage'],
    ]);
  });

  it('keeps only found, role, on-domain results from the paid finder', () => {
    const data = {
      data: {
        emails: [
          {
            value: 'contact@maritime.sh',
            provenance: 'found',
            source_type: 'found',
            sources: [{ uri: 'https://maritime.sh/contact' }],
          },
          {
            value: 'dinesh@maritime.sh',
            provenance: 'inferred',
            source_type: 'generated',
            sources: [],
          },
          {
            value: 'press@maritime.sh',
            provenance: 'found',
            source_type: 'found',
            sources: [{ uri: 'https://shipseason.org' }],
          },
          {
            value: 'maria@maritime.sh',
            provenance: 'found',
            source_type: 'found',
            sources: [{ uri: 'https://maritime.sh/team' }],
          },
        ],
      },
    };
    expect(finderAddresses(data, 'maritime.sh').map((item) => item.address)).toEqual([
      'contact@maritime.sh',
    ]);
  });

  it('closes the email lane on a no-solicitation notice', () => {
    expect(noSolicitationNotice({ pages: [page('<p>No solicitations, please.</p>')] })).toBe('p1');
    expect(
      noSolicitationNotice({
        pages: [page('<p>We will not sell, share or transfer your email address to anyone.</p>')],
      }),
    ).toBe('p1');
    expect(
      noSolicitationNotice({ pages: [page('<p>We do not accept unsolicited proposals.</p>')] }),
    ).toBe('p1');
    expect(noSolicitationNotice({ pages: [page('<p>We never sell your data.</p>')] })).toBeNull();
  });

  it('takes the product name from the homepage title, site name or first heading only', () => {
    const home = page(
      '<html><head><title>Quillbox – shared shopping lists</title></head><body><h1>Lists that work offline</h1></body></html>',
    );
    expect(productName(home, 'Quillbox')).toBe('Quillbox');
    expect(productName(home, null)).toBe('Quillbox');
    const noisy = page(
      '<html><head><title>Show HN: I built a thing!!</title></head><body><h1>Welcome</h1></body></html>',
    );
    expect(productName(noisy, null)).toBeNull();
    expect(hnName('Show HN: Quillbox – shared shopping lists that work offline')).toBe('Quillbox');
    expect(hnName('Show HN: I built a tiny list app over a weekend')).toBeNull();
    // A name that reads as a domain would be linked by X and is never used in copy.
    expect(
      productName(
        page('<html><head><title>logo.deal</title></head><body><h1>logo.deal</h1></body></html>'),
        null,
      ),
    ).toBeNull();
  });

  it('matches a Product Hunt entry only to a site that carries its name, and its tagline or a Product Hunt link', () => {
    const entry = {
      name: 'Sequence Tool',
      tagline: 'Edit with words: long recordings into polished stories',
    };
    const right = page(
      '<html><head><title>Sequence Tool</title></head><body><p>Edit with words: long recordings into polished stories.</p></body></html>',
    );
    const wrong = page(
      '<html><head><title>Sequence Tool</title></head><body><p>Industrial sequencing since the sixties.</p></body></html>',
    );
    const linked = page(
      '<html><head><title>Sequence Tool</title></head><body><a href="https://www.producthunt.com/products/x">PH</a></body></html>',
    );
    expect(phMatches(right, entry)).toBe(true);
    expect(phMatches(wrong, entry)).toBe(false);
    expect(phMatches(linked, { ...entry, tagline: 'anything' })).toBe(true);
  });

  it('drops a news site or a rival that has the tagline or a Product Hunt link but not the name', () => {
    // Seen live on 2026-11-08: "Zigzag Browser" resolved to a news aggregator that links to Product
    // Hunt, and "NotchX" to a rival notch app whose page has the tagline's words.
    const aggregator = page(
      '<html><head><title>freshnews - fresh tech news from around the web</title></head><body><a href="https://www.producthunt.com/">PH</a><p>Zigzag Browser: The polished, native Mac browser for life after Arc</p></body></html>',
    );
    expect(
      phMatches(aggregator, {
        name: 'Zigzag Browser',
        tagline: 'The polished, native Mac browser for life after Arc',
      }),
    ).toBe(false);
    const rival = page(
      '<html><head><title>Dynamic Island for Mac | seam</title><meta property="og:site_name" content="Seam"></head><body><p>Turn your MacBook notch into a hub for music and calls.</p></body></html>',
    );
    expect(
      phMatches(rival, {
        name: 'NotchX',
        tagline: "Turn your MacBook's notch into a hub for music and calls",
      }),
    ).toBe(false);
    // The host alone can carry the name: zigzag's own site need not repeat "Browser".
    const own: SitePage = {
      ...page(
        '<html><head><title>Zigzag</title></head><body><p>The polished, native Mac browser for life after Arc.</p></body></html>',
      ),
      final_url: 'https://zigzag.example/',
    };
    expect(
      phMatches(own, {
        name: 'Zigzag Browser',
        tagline: 'The polished, native Mac browser for life after Arc',
      }),
    ).toBe(true);
  });

  it('reads a Product Hunt name without its maker or edition', () => {
    expect(phCoreName('Sage2 by Levanto Labs')).toBe('Sage2');
    expect(phCoreName('Rex (Beta)')).toBe('Rex');
    expect(phCoreName('DocsAlot for customer support')).toBe('DocsAlot');
    expect(phCoreName('Agent Clan')).toBe('Agent Clan');
  });

  it('takes a name from the title or heading only when it names the host', () => {
    expect(namesHost('Where Were We', 'https://wherewerewe.app/')).toBe(true);
    expect(namesHost('Seam', 'https://getseam.app/')).toBe(true);
    expect(namesHost('VidTier', 'https://vidtier.eamag.me/')).toBe(true);
    expect(namesHost('Board', 'https://zenmemes.com/')).toBe(false);
    expect(namesHost('freshnews', 'https://www.freshnews.org/')).toBe(true);
    const forum = (url: string): SitePage => ({
      ...page('<html><head><title>Board</title></head><body><p>A garage.</p></body></html>'),
      final_url: url,
    });
    expect(productName(forum('https://zenmemes.com/'), null)).toBeNull();
    expect(productName(forum('https://board.example/'), null)).toBe('Board');
    // A name the source gives, or the site's own og:site_name, needs no match with the host.
    expect(productName(forum('https://zenmemes.com/'), 'Board')).toBe('Board');
  });

  it('needs a state of incorporation or a US address for us, and a UK registration for uk_ltd', () => {
    expect(usEvidence('Quillbox, Inc., a Delaware corporation')).toBe(true);
    expect(usEvidence('Quillbox Inc.')).toBe(false);
    expect(usEvidence('548 Market St, San Francisco, CA 94104')).toBe(true);
    expect(ukLtdEvidence('Quillbox Ltd is registered in England and Wales.')).toBe(true);
    expect(ukLtdEvidence('Quillbox Ltd, company number 12345678')).toBe(true);
    expect(ukLtdEvidence('Quillbox Limited, Dublin')).toBe(false);
  });

  it('overrides to de, eu or other from the TLD, an imprint page, or an EU or Canadian address', () => {
    const plain = { pages: [page('<p>Lists.</p>')] };
    expect(jurisdictionOverride('quillbox.de', plain)).toBe('de');
    expect(jurisdictionOverride('quillbox.fr', plain)).toBe('eu');
    expect(jurisdictionOverride('quillbox.ca', plain)).toBe('other');
    expect(jurisdictionOverride('quillbox.example', plain)).toBeNull();
    expect(
      jurisdictionOverride('quillbox.example', {
        pages: [page('<p>x</p>', '/impressum', 'p2', 'imprint page')],
      }),
    ).toBe('de');
    expect(
      jurisdictionOverride('quillbox.example', {
        pages: [page('<p>12 Main Street, Dublin, Ireland</p>')],
      }),
    ).toBe('eu');
    expect(
      jurisdictionOverride('quillbox.example', {
        pages: [page('<p>Registered in Northern Ireland.</p>')],
      }),
    ).toBeNull();
    expect(
      jurisdictionOverride('quillbox.example', { pages: [page('<p>Toronto, Ontario</p>')] }),
    ).toBe('other');
  });

  it('flags unsafe brands by word, not by substring', () => {
    expect(brandFlags('The best online casino bonus')).toEqual(['gambling:casino']);
    expect(brandFlags('Token presale opens Friday')).toEqual(['crypto_sale:presale']);
    expect(brandFlags('Scunthorpe planning, specialist software, ammonite')).toEqual([]);
  });
});

describe('sources', () => {
  it('reads name, tagline and date from the Product Hunt feed', () => {
    const xml = `<feed><entry><published>2026-11-06T06:55:13-08:00</published><link rel="alternate" type="text/html" href="https://www.producthunt.com/products/sequence-tool"/><title>Sequence Tool</title><content type="html">&lt;p&gt;
            Edit with words: long recordings into polished stories
          &lt;/p&gt;</content></entry></feed>`;
    expect(parseProductHuntFeed(xml)).toEqual([
      {
        name: 'Sequence Tool',
        tagline: 'Edit with words: long recordings into polished stories',
        published: '2026-11-06T06:55:13-08:00',
        link: 'https://www.producthunt.com/products/sequence-tool',
      },
    ]);
  });

  it('dates an X post from its status id', () => {
    expect(statusTime('2119015824379818494')?.toISOString().slice(0, 10)).toBe('2026-11-07');
    expect(statusTime('not-an-id')).toBeNull();
  });
});
