import { describe, expect, it } from 'vitest';
import { checkQuote, PageIndex, verifyResearch } from '../src/researcher/verify.ts';
import { bundle, HIDDEN_ANSWER, output, SITE } from './fixtures.ts';

/** A fixture part the test needs, which the fixture always has. */
const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('fixture part missing');
  return value;
};

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

  // The cal.com brief took a price from a collapsed FAQ answer, which no visitor sees until it is
  // opened. Hidden text is in the document, so it used to pass as quotable.
  it('refuses a quote that is only in text the page hides until it is opened', () => {
    const out = output();
    out.claims.push({
      id: 'team-monthly',
      text: 'Team costs $30 a month billed monthly',
      sourceUrl: SITE,
      quote: HIDDEN_ANSWER,
      status: 'extracted',
    });
    expect(verifyResearch(out, bundle())).toEqual([
      expect.objectContaining({ code: 'QUOTE_HIDDEN', claimId: 'team-monthly' }),
    ]);
  });

  it('keeps a figure only in hidden text out of the brief', () => {
    const out = output();
    const team = out.brief.pricing?.plans[1];
    if (!team) throw new Error('fixture plan missing');
    team.price = '$24 per month billed yearly, $30 per month billed monthly';
    expect(verifyResearch(out, bundle()).map((failure) => [failure.code, failure.path])).toEqual([
      ['NUMBER_UNBACKED', 'brief.pricing.plans[1]'],
    ]);
  });

  it.each([
    [
      'brief.one_liner',
      (out: ReturnType<typeof output>) =>
        (out.brief.one_liner.text = 'Plans posts for 5,000 teams.'),
    ],
    [
      'brief.what_it_is',
      (out: ReturnType<typeof output>) =>
        (out.brief.what_it_is.text = 'Plans a month of posts in 7 minutes.'),
    ],
    [
      'brief.pricing',
      (out: ReturnType<typeof output>) => (must(out.brief.pricing).summary = 'Team is $19 a month'),
    ],
    [
      'brief.pricing.free_trial',
      (out: ReturnType<typeof output>) =>
        (must(out.brief.pricing).free_trial = {
          text: 'Team: 14 per month billed yearly',
          claim_ids: ['team-price'],
        }),
    ],
    [
      'brief.positioning_note',
      (out: ReturnType<typeof output>) =>
        (out.brief.positioning_note = {
          text: 'Twice as fast as described',
          claim_ids: ['plan-speed'],
        }),
    ],
    [
      'brief.conflicts[0]',
      (out: ReturnType<typeof output>) =>
        out.brief.conflicts.push({
          description: 'Team is $24 here and $29 there',
          claim_ids: ['team-price'],
        }),
    ],
  ])('checks every figure in %s against the quotes it cites', (path, change) => {
    const out = output();
    change(out);
    expect(verifyResearch(out, bundle()).map((failure) => [failure.code, failure.path])).toEqual([
      ['NUMBER_UNBACKED', path],
    ]);
  });

  it('reads brief figures as values, as the campaign validator reads copy', () => {
    const out = output();
    out.brief.what_it_is.text = 'Plans a month of posts in ten minutes, for 3,200 small teams.';
    out.brief.what_it_is.claim_ids = ['plan-speed', 'small-teams'];
    expect(verifyResearch(out, bundle())).toEqual([]);
    out.brief.what_it_is.text = 'Plans a month of posts in 100 minutes.';
    expect(verifyResearch(out, bundle()).map((failure) => failure.message)).toEqual([
      expect.stringContaining('states "100"'),
    ]);
  });

  // A meta description is not on the page a visitor sees, and is where a page can carry text
  // meant for machines rather than people.
  it('refuses a quote that is only in the title, meta tags or alt text', () => {
    const out = output();
    out.claims.push({
      id: 'meta-line',
      text: 'Orbitly is for small teams',
      sourceUrl: SITE,
      quote: 'Orbitly helps small teams plan social posts.',
      status: 'extracted',
    });
    expect(verifyResearch(out, bundle())).toEqual([
      expect.objectContaining({ code: 'QUOTE_NOT_VISIBLE', claimId: 'meta-line' }),
    ]);
  });

  // White text on a white background reached the model as ordinary copy and passed the verbatim
  // check, although no visitor can see it.
  it('refuses a quote that is only in text styled so nobody can see it', () => {
    const pages = bundle();
    const home = pages.pages[0];
    if (!home) throw new Error('fixture page missing');
    const hidden = 'Orbitly is used by 9,999,999 teams.';
    home.text = { ...home.text, dom: `${home.text.dom} ${hidden}`, concealed: hidden };
    const out = output();
    out.claims.push({
      id: 'hidden-teams',
      text: 'Orbitly is used by teams',
      sourceUrl: SITE,
      quote: hidden,
      status: 'extracted',
    });
    expect(verifyResearch(out, pages)).toEqual([
      expect.objectContaining({ code: 'QUOTE_CONCEALED', claimId: 'hidden-teams' }),
    ]);
  });

  // Mockup figures that are on the home page were cited to the features page.
  it('refuses a non-claim cited to a page its figures are not on, and names the right one', () => {
    const out = output();
    const item = out.brief.non_claims[0];
    if (!item) throw new Error('fixture non-claim missing');
    item.source_url = 'https://orbitly.example.org/pricing';
    expect(verifyResearch(out, bundle())).toEqual([
      expect.objectContaining({
        code: 'NON_CLAIM_SOURCE',
        nonClaimIndex: 0,
        fix: expect.stringContaining('https://orbitly.example.org/'),
      }),
    ]);
    item.source_url = 'https://orbitly.example.org/nowhere';
    expect(codes(out)).toEqual(['NON_CLAIM_SOURCE']);
  });

  // A page with no <title> was listed under a title the agent made up from the domain.
  it('keeps each listed page under the title the capture stored', () => {
    const out = output();
    const page = out.brief.pages[0];
    if (!page) throw new Error('fixture page missing');
    page.title = 'Orbitly';
    expect(verifyResearch(out, bundle())).toEqual([
      expect.objectContaining({ code: 'PAGE_TITLE', pageIndex: 0 }),
    ]);
    out.brief.pages.push({ ...page, url: 'https://orbitly.example.org/nowhere', title: '' });
    expect(codes(out)).toEqual(['PAGE_TITLE', 'PAGE_NOT_CAPTURED']);
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
        ['NUMBER_UNBACKED', 'brief.what_it_is', undefined],
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
        'QUOTE_NOT_FOUND',
        'CTA_NOT_FOUND',
        'NON_CLAIM_SOURCE',
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
    if (!plan || !out.brief.pricing) throw new Error('fixture plan missing');
    plan.claim_ids = [];
    out.brief.pricing.claim_ids = ['free-plan'];
    expect(verifyResearch(out, bundle()).map((failure) => [failure.code, failure.path])).toEqual([
      ['CLAIM_UNKNOWN', 'brief.features[0]'],
      ['NUMBER_UNBACKED', 'brief.features[0]'],
      ['NUMBER_UNBACKED', 'brief.pricing'],
      ['WORDS_UNBACKED', 'brief.pricing'],
      ['NUMBER_UNBACKED', 'brief.pricing.plans[1]'],
      ['WORDS_UNBACKED', 'brief.pricing.plans[1]'],
    ]);
  });

  it('accepts a plan price backed by a claim on the pricing section', () => {
    const out = output();
    if (!out.brief.pricing) throw new Error('fixture pricing missing');
    const plan = out.brief.pricing.plans[1];
    if (!plan) throw new Error('fixture plan missing');
    plan.claim_ids = [];
    out.brief.pricing.claim_ids = ['free-plan', 'team-price'];
    expect(codes(out)).toEqual([]);
  });

  // linear.app: the one-liner said "shipping", which neither cited quote says; cal.com swapped
  // "the products built on it" for "organizations".
  it('refuses a brief fact with a word no cited quote says, and names the word', () => {
    const out = output();
    out.brief.one_liner.text = 'Orbitly plans and ships social posts for small teams.';
    const failures = verifyResearch(out, bundle());
    expect(failures.map((failure) => [failure.code, failure.path, failure.briefPath])).toEqual([
      ['WORDS_UNBACKED', 'brief.one_liner', 'brief.one_liner'],
    ]);
    expect(failures[0]?.message).toContain('"ships"');
  });

  // linear.app: what_it_is said "through Intake" but cited none of the claims that say it.
  it('refuses a true word quoted only by a claim the fact does not cite', () => {
    const out = output();
    out.brief.audiences[0] = { who: 'Small teams with one account', claim_ids: ['small-teams'] };
    expect(codes(out)).toEqual(['WORDS_UNBACKED']);
    out.brief.audiences[0] = {
      who: 'Small teams with one account',
      claim_ids: ['small-teams', 'free-plan'],
    };
    expect(codes(out)).toEqual([]);
  });

  // linear.app: price-enterprise said "Custom", but its quote was "Annual billing only".
  it("refuses a claim's text that says more than its quote", () => {
    const out = output();
    const claim = must(out.claims[2]);
    claim.text = 'The Enterprise plan is custom';
    const failures = verifyResearch(out, bundle());
    expect(failures.map((failure) => [failure.code, failure.claimTextId])).toEqual([
      ['CLAIM_TEXT_UNBACKED', 'team-price'],
    ]);
    expect(failures[0]?.message).toContain('"enterprise" and "custom"');
  });

  // allbirds.com: a product page's price is quoted as "$100"; the page's title names the product.
  it("backs the words of a fact with the title of a cited claim's page", () => {
    const pages = bundle();
    const pricing = must(pages.pages[1]);
    pricing.title = 'Team plan | Orbitly';
    pricing.text = { ...pricing.text, rendered: `${pricing.text.rendered}\n$24`, clean: '$24' };
    const out = output();
    out.claims.push({
      id: 'team-only-price',
      text: 'The Team plan is $24',
      sourceUrl: 'https://orbitly.example.org/pricing/',
      quote: '$24',
      status: 'extracted',
    });
    expect(codes(out, pages)).toEqual([]);
  });

  it('checks only the figures of a conflict or a positioning note, which use words of their own', () => {
    const out = output();
    out.brief.conflicts.push({
      description: 'The home page and the pricing page disagree on Team',
      claim_ids: ['team-price'],
    });
    out.brief.positioning_note = {
      text: 'The customer called it a calendar; the site sells posts',
      claim_ids: ['plan-speed'],
    };
    expect(codes(out)).toEqual([]);
  });

  // linear.app: "$10 per user/month" is the price with the "Billed yearly" switch on, as the page
  // loads; the brief left that out, so it read as the monthly price.
  it('requires pricing shown with yearly billing switched on to say so', () => {
    const pages = bundle();
    const pricing = must(pages.pages[1]);
    pricing.controls = [{ role: 'checkbox', label: 'Billed yearly', on: true }];
    const out = output();
    const brief = must(out.brief.pricing);
    brief.summary = 'A free Solo plan, and Team at $24 per month';
    const failures = verifyResearch(out, pages);
    expect(failures.map((failure) => [failure.code, failure.briefPath])).toEqual([
      ['PRICING_BILLING', 'brief.pricing.billing'],
    ]);
    expect(failures[0]?.message).toContain('"Billed yearly" on');
    // The fixture's summary says "billed yearly", in the words of its cited quote.
    expect(codes(output(), pages)).toEqual([]);
    // A switch that is off, or a monthly one that is on, asks for nothing.
    pricing.controls = [{ role: 'switch', label: 'Billed yearly', on: false }];
    expect(codes(out, pages)).toEqual([]);
    pricing.controls = [{ role: 'tab', label: 'Monthly', on: true }];
    expect(codes(out, pages)).toEqual([]);
  });

  it("lets a billing switch's label back the pricing's billing words", () => {
    const pages = bundle();
    const pricing = must(pages.pages[1]);
    pricing.text = {
      ...pricing.text,
      rendered: 'Pricing Solo $0 per month Team $24 per month Choose Team',
      clean: 'Pricing Solo $0 per month Team $24 per month Choose Team',
    };
    pricing.controls = [{ role: 'switch', label: 'Yearly', on: true }];
    const out = output();
    must(out.claims[2]).quote = 'Team $24 per month';
    must(out.claims[2]).text = 'Team costs $24 per month';
    must(out.brief.pricing).summary = 'A free Solo plan, and Team at $24 per month, yearly';
    expect(codes(out, pages)).toEqual([]);
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
