import { describe, expect, it } from 'vitest';
import { checkQuote, PageIndex, verifyResearch } from '../src/researcher/verify.ts';
import { bundle, output, SITE } from './fixtures.ts';

const codes = (out = output(), pages = bundle()) =>
  verifyResearch(out, pages).map((failure) => failure.code);

describe('verifyResearch', () => {
  it('passes a result whose quotes are all in the stored text', () => {
    expect(verifyResearch(output(), bundle())).toEqual([]);
  });

  it('matches a quote across a line break, since whitespace is normalised', () => {
    const page = new PageIndex(bundle()).find(SITE);
    if (!page) throw new Error('fixture page missing');
    expect(checkQuote(page, 'Schedule posts without the spreadsheet')).toBe('found');
    expect(checkQuote(page, '  Schedule\tposts\n\nwithout   the spreadsheet ')).toBe('found');
    expect(checkQuote(page, 'Schedule posts without the​ spreadsheet')).toBe('found');
  });

  it('finds quotes in hidden text and in meta text', () => {
    const out = output();
    out.claims.push({
      id: 'meta-line',
      text: 'Orbitly is for small teams',
      sourceUrl: SITE,
      quote: 'Orbitly helps small teams plan social posts.',
      status: 'extracted',
    });
    expect(codes(out)).toEqual([]);
  });

  it('matches the source page with or without a trailing slash or fragment', () => {
    const out = output();
    const claim = out.claims[2];
    if (!claim) throw new Error('fixture claim missing');
    claim.sourceUrl = 'https://ORBITLY.example.org/pricing/#plans';
    expect(codes(out)).toEqual([]);
  });

  describe('tampering', () => {
    const tampered = (change: (quote: string) => string, index = 0) => {
      const out = output();
      const claim = out.claims[index];
      if (!claim) throw new Error('fixture claim missing');
      claim.quote = change(claim.quote);
      return verifyResearch(out, bundle());
    };

    it('rejects a quote with one number changed, and the brief number it backed', () => {
      const failures = tampered((quote) => quote.replace('10 minutes', '5 minutes'), 1);
      expect(failures.map((failure) => [failure.code, failure.path, failure.claimId])).toEqual([
        ['QUOTE_NOT_FOUND', 'claims[1].quote', 'plan-speed'],
        ['NUMBER_UNBACKED', 'brief.features[0]', undefined],
      ]);
    });

    it('rejects a quote with one word changed', () => {
      expect(
        tampered((quote) => quote.replace('posts', 'updates')).map((failure) => failure.code),
      ).toEqual(['QUOTE_NOT_FOUND']);
    });

    it('rejects a quote that changes case or punctuation', () => {
      expect(tampered((quote) => quote.toUpperCase()).map((failure) => failure.code)).toEqual([
        'QUOTE_NOT_FOUND',
      ]);
      expect(tampered((quote) => `${quote}!`).map((failure) => failure.code)).toEqual([
        'QUOTE_NOT_FOUND',
      ]);
    });

    it('rejects a quote stitched together from two places', () => {
      expect(
        tampered(() => 'Orbitly plans a month of social posts. Trusted by 3,200 small teams.').map(
          (failure) => failure.code,
        ),
      ).toEqual(['QUOTE_NOT_FOUND']);
    });

    it('rejects a quote that is true on another page but cited to this one', () => {
      const out = output();
      const claim = out.claims[2];
      if (!claim) throw new Error('fixture claim missing');
      claim.sourceUrl = SITE;
      expect(verifyResearch(out, bundle()).map((failure) => failure.code)).toEqual([
        'QUOTE_NOT_FOUND',
      ]);
    });

    it('rejects every claim once the stored text no longer holds the quote', () => {
      const pages = bundle();
      const home = pages.pages[0];
      if (!home) throw new Error('fixture page missing');
      home.text = {
        rendered: 'Page changed',
        dom: 'Page changed',
        meta: '',
        clean: 'Page changed',
        illustrative: '',
      };
      expect(codes(output(), pages)).toEqual([
        'QUOTE_NOT_FOUND',
        'QUOTE_NOT_FOUND',
        'QUOTE_NOT_FOUND',
        'CTA_NOT_FOUND',
      ]);
    });
  });

  it('rejects a source that was never captured', () => {
    const out = output();
    const claim = out.claims[0];
    if (!claim) throw new Error('fixture claim missing');
    claim.sourceUrl = 'https://orbitly.example.org/blog';
    const failures = verifyResearch(out, bundle());
    expect(failures.map((failure) => failure.code)).toEqual(['SOURCE_NOT_CAPTURED']);
    expect(failures[0]?.fix).toContain('https://orbitly.example.org/pricing/');
  });

  it('accepts a quote from customer material cited by its file address', () => {
    const out = output();
    out.claims.push({
      id: 'uptime',
      text: 'Orbitly had 99.9% uptime in 2025',
      sourceUrl: 'https://api.vetta.sh/v1/files/fil_material1',
      quote: 'Orbitly reached 99.9% uptime in 2025.',
      status: 'extracted',
    });
    expect(codes(out)).toEqual([]);
  });

  it('treats a figure that only appears in a product mockup as a non-claim', () => {
    const out = output();
    out.claims.push({
      id: 'followers',
      text: 'Followers grew',
      sourceUrl: SITE,
      quote: 'Followers this week: 12,480',
      status: 'extracted',
    });
    expect(verifyResearch(out, bundle()).map((failure) => [failure.code, failure.claimId])).toEqual(
      [['QUOTE_ILLUSTRATIVE', 'followers']],
    );
  });

  it('accepts a figure that appears outside the mockup too', () => {
    const out = output();
    out.claims.push({
      id: 'teams',
      text: '3,200 small teams use it',
      sourceUrl: SITE,
      quote: 'Trusted by 3,200 small teams.',
      status: 'extracted',
    });
    expect(codes(out)).toEqual([]);
  });

  it('refuses a claim the Researcher marked approved', () => {
    const out = output();
    const claim = out.claims[0];
    if (!claim) throw new Error('fixture claim missing');
    claim.status = 'approved';
    expect(codes(out)).toEqual(['CLAIM_STATUS']);
  });

  it('checks that brief items cite claims that exist and state their numbers', () => {
    const out = output();
    const feature = out.brief.features[0];
    if (!feature) throw new Error('fixture feature missing');
    feature.what_it_does = 'Plans a month of posts in 7 minutes';
    feature.claim_ids.push('no-such-claim');
    const plan = out.brief.pricing?.plans[1];
    if (!plan) throw new Error('fixture plan missing');
    plan.claim_ids = [];
    expect(verifyResearch(out, bundle()).map((failure) => [failure.code, failure.path])).toEqual([
      ['CLAIM_UNKNOWN', 'brief.features[0]'],
      ['NUMBER_UNBACKED', 'brief.features[0]'],
      ['NUMBER_UNBACKED', 'brief.pricing.plans[1]'],
    ]);
  });

  it('accepts a plan price backed by a claim on the pricing section', () => {
    const out = output();
    if (!out.brief.pricing) throw new Error('fixture pricing missing');
    const plan = out.brief.pricing.plans[1];
    if (!plan) throw new Error('fixture plan missing');
    plan.claim_ids = [];
    out.brief.pricing.claim_ids = ['team-price'];
    expect(codes(out)).toEqual([]);
  });

  it('requires calls to action to be verbatim on their page', () => {
    const out = output();
    out.brief.ctas.push({
      label: 'Book a demo',
      href: 'https://orbitly.example.org/demo',
      source_url: SITE,
      placement: 'hero',
    });
    out.brief.ctas.push({
      label: 'Choose Team',
      href: 'https://orbitly.example.org/signup',
      source_url: 'https://orbitly.example.org/pricing/',
      placement: 'pricing',
    });
    expect(verifyResearch(out, bundle()).map((failure) => [failure.code, failure.path])).toEqual([
      ['CTA_NOT_FOUND', 'brief.ctas[1].label'],
    ]);
  });

  it('checks references between the brief, assets, needs and evidence', () => {
    const out = output();
    out.brief.product_ui.asset_ids = ['missing-shot'];
    const need = out.needs_upload[0];
    if (!need) throw new Error('fixture need missing');
    out.needs_upload.push({ ...need });
    out.evidence.logo.asset_id = 'home-screen';
    expect(codes(out)).toEqual(['ASSET_UNKNOWN', 'NEED_DUPLICATE', 'LOGO_MISMATCH']);
  });
});
