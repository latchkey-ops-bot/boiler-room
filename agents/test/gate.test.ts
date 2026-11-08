import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checkProvenance,
  checkResearch,
  type Evidence,
  prunable,
  unfinished,
  withMeasuredColors,
  withoutClaims,
  withoutFailures,
  withStoredTitles,
} from '../src/researcher/gate.ts';
import { unmeasuredColors } from '../src/researcher/verify.ts';
import { bundle, measured, output } from './fixtures.ts';

/** A fixture part the test needs, which the fixture always has. */
const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('fixture part missing');
  return value;
};

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  const digest = sha(JSON.stringify(bundle()));
  return {
    bundleSha256: digest,
    captureDigests: new Set([digest]),
    published: new Map([
      ['fil_pages1', '/home/tenki/br/out/orbitly.example.org/pages.json'],
      ['fil_capture1', '/home/tenki/br/out/orbitly.example.org/capture.json'],
      ['fil_logo1', '/home/tenki/br/out/orbitly.example.org/logo.svg'],
      ['fil_home1', '/home/tenki/br/out/orbitly.example.org/shots/home.png'],
    ]),
    material: new Set(['fil_material1']),
    ...overrides,
  };
}

describe('checkResearch', () => {
  it('passes a complete result', async () => {
    const result = await checkResearch(output(), bundle(), { fileExists: () => true });
    expect(result.failures).toEqual([]);
    expect(result.output?.claims).toHaveLength(5);
  });

  it('runs the campaign validator on brand, assets and claims', async () => {
    const out = output();
    out.brand.colors.primary = '#F4F4F5';
    out.brand.logoAssetId = 'home-screen';
    out.evidence.logo.asset_id = 'home-screen';
    const { failures } = await checkResearch(out, bundle());
    expect(failures.map((failure) => [failure.code, failure.path])).toEqual([
      ['CONTRAST_LOW', 'brand.colors.primary'],
      ['COLOR_UNMEASURED', 'brand.colors.primary'],
    ]);

    const missing = output();
    missing.brand.logoAssetId = 'nope';
    missing.evidence.logo.asset_id = 'nope';
    expect(
      (await checkResearch(missing, bundle())).failures.map((failure) => failure.code),
    ).toEqual(['ASSET_UNDECLARED']);
  });

  it('checks that every asset file exists in Naive files', async () => {
    const { failures } = await checkResearch(output(), bundle(), {
      fileExists: (id) => id !== 'fil_home1',
    });
    expect(failures.map((failure) => [failure.code, failure.path])).toEqual([
      ['ASSET_UNAVAILABLE', 'assets.home-screen.src'],
    ]);
  });

  it('refuses an asset that is not a Naive file', async () => {
    const out = output();
    const asset = out.assets['home-screen'];
    if (!asset) throw new Error('fixture asset missing');
    asset.src = 'https://orbitly.example.org/shot.png';
    expect((await checkResearch(out, bundle())).failures.map((failure) => failure.code)).toEqual([
      'ASSET_SRC',
    ]);
  });

  it('reports schema problems with paths and stops there', async () => {
    const raw = {
      ...output(),
      extra: true,
      claims: [{ id: 'Bad Id', text: '', sourceUrl: 'nope', quote: 'x', status: 'extracted' }],
    };
    const { output: parsed, failures } = await checkResearch(raw, bundle());
    expect(parsed).toBeUndefined();
    expect(failures.every((failure) => failure.code === 'SCHEMA_INVALID')).toBe(true);
    expect(failures.map((failure) => failure.path)).toEqual(
      expect.arrayContaining(['claims[0].id', 'claims[0].text', 'claims[0].sourceUrl', '$']),
    );
  });

  it('lists placeholders and TODO fields left from the template', () => {
    const raw = output() as unknown as Record<string, unknown>;
    const out = raw as unknown as ReturnType<typeof output>;
    const asset = out.assets.logo;
    if (!asset) throw new Error('fixture asset missing');
    asset.src = 'naive://files/PUBLISH:logo.svg';
    out.brief.one_liner.text = 'TODO';
    expect(unfinished(raw).map((failure) => [failure.code, failure.path])).toEqual([
      ['PLACEHOLDER', 'assets.logo.src'],
      ['TODO', 'brief.one_liner.text'],
    ]);
  });
});

describe('checkProvenance', () => {
  it('passes files this session published from the capture output', () => {
    expect(checkProvenance(output(), evidence())).toEqual([]);
  });

  it('refuses a pages.json that differs from what the capture tool wrote', () => {
    const edited = bundle();
    const home = edited.pages[0];
    if (!home) throw new Error('fixture page missing');
    home.text.rendered += '\nOrbitly is the fastest scheduler on Earth.';
    const failures = checkProvenance(
      output(),
      evidence({ bundleSha256: sha(JSON.stringify(edited)) }),
    );
    expect(failures.map((failure) => failure.code)).toEqual(['CAPTURE_UNBOUND']);
  });

  it('refuses evidence and assets the session did not publish', () => {
    const published = new Map(evidence().published);
    published.delete('fil_home1');
    published.set('fil_pages1', '/home/tenki/br/out/orbitly.example.org/my-notes.json');
    const failures = checkProvenance(output(), evidence({ published }));
    expect(failures.map((failure) => [failure.code, failure.path])).toEqual([
      ['EVIDENCE_UNPUBLISHED', 'evidence.pages_file_id'],
      ['ASSET_PROVENANCE', 'assets.home-screen.src'],
    ]);
  });

  it('requires provenance "uploaded" for customer material, and only for it', () => {
    const out = output();
    out.assets['customer-shot'] = {
      kind: 'image',
      src: 'naive://files/fil_material1',
      provenance: 'captured',
    };
    const logo = out.assets.logo;
    if (!logo) throw new Error('fixture asset missing');
    logo.provenance = 'uploaded';
    expect(checkProvenance(out, evidence()).map((failure) => [failure.code, failure.path])).toEqual(
      [
        ['ASSET_PROVENANCE', 'assets.logo.provenance'],
        ['ASSET_PROVENANCE', 'assets.customer-shot.provenance'],
      ],
    );
  });
});

describe('withoutClaims', () => {
  it('drops claims and every reference to them, and every brief fact left with no backing', () => {
    const trimmed = withoutClaims(output(), new Set(['team-price', 'home-headline']));
    expect(trimmed.claims.map((claim) => claim.id)).toEqual([
      'plan-speed',
      'free-plan',
      'small-teams',
    ]);
    expect(trimmed.brief.headline_claim_id).toBeNull();
    expect(trimmed.brief.pricing?.claim_ids).toEqual(['free-plan']);
    expect(trimmed.brief.pricing?.plans.map((plan) => plan.name)).toEqual(['Solo']);
    const priceless = withoutClaims(output(), new Set(['team-price', 'free-plan']));
    expect(priceless.brief.pricing).toBeNull();
  });

  it('keeps an uncited one-liner, which then fails the schema', async () => {
    const trimmed = withoutClaims(output(), new Set(['plan-speed']));
    expect(trimmed.brief.features).toEqual([]);
    expect(trimmed.brief.one_liner.claim_ids).toEqual(['small-teams']);
    expect(trimmed.brief.what_it_is.claim_ids).toEqual([]);
    const { failures } = await checkResearch(trimmed, bundle());
    expect(failures.map((failure) => [failure.code, failure.path])).toEqual([
      ['SCHEMA_INVALID', 'brief.what_it_is.claim_ids'],
    ]);
    expect(failures[0]?.message).toMatch(/must cite the claims that back it/);
  });
});

describe('brief citations', () => {
  it.each([
    [
      'one-liner',
      (out: ReturnType<typeof output>) => (out.brief.one_liner.claim_ids = []),
      'brief.one_liner.claim_ids',
    ],
    [
      'audience',
      (out: ReturnType<typeof output>) => (must(out.brief.audiences[0]).claim_ids = []),
      'brief.audiences[0].claim_ids',
    ],
    [
      'plan',
      (out: ReturnType<typeof output>) => (must(must(out.brief.pricing).plans[0]).claim_ids = []),
      'brief.pricing.plans[0].claim_ids',
    ],
    [
      'free trial',
      (out: ReturnType<typeof output>) =>
        (must(out.brief.pricing).free_trial = { text: 'Free for 14 days', claim_ids: [] }),
      'brief.pricing.free_trial.claim_ids',
    ],
  ])('refuses a %s that cites no claim', async (_name, change, path) => {
    const out = output();
    change(out);
    const { failures } = await checkResearch(out, bundle());
    expect(failures.map((failure) => [failure.code, failure.path])).toEqual([
      ['SCHEMA_INVALID', path],
    ]);
  });
});

// Out of repair rounds, a non-claim cited to the wrong page or a made-up page title must not fail
// a result whose claims are all verified.
describe('withoutFailures', () => {
  it('drops failing non-claims and uncaptured pages and resets titles, and then passes', async () => {
    const out = output();
    const nonClaim = out.brief.non_claims[0];
    const page = out.brief.pages[0];
    if (!nonClaim || !page) throw new Error('fixture missing');
    nonClaim.source_url = 'https://orbitly.example.org/nowhere';
    page.title = 'Orbitly';
    out.brief.pages.push({ ...page, url: 'https://orbitly.example.org/nowhere' });
    const first = await checkResearch(out, bundle());
    expect(first.failures.map((failure) => failure.code)).toEqual([
      'NON_CLAIM_SOURCE',
      'PAGE_TITLE',
      'PAGE_NOT_CAPTURED',
    ]);
    expect(first.failures.every(prunable)).toBe(true);
    const settled = withoutFailures(out, first.failures, bundle());
    expect(settled.brief.non_claims).toEqual([]);
    expect(settled.brief.pages).toEqual([{ ...page, title: 'Orbitly | Social scheduling' }]);
    expect((await checkResearch(settled, bundle())).failures).toEqual([]);
  });

  // Out of repair rounds, a brief or a claim text that says more than its quotes is cut back to
  // what the quotes say, so a result whose claims are verified is never failed for its wording,
  // and wording no quote backs never reaches the output.
  it('settles wording in the quotes’ own words, and then passes', async () => {
    const out = output();
    must(out.claims[2]).text = 'The Enterprise plan is custom';
    out.brief.one_liner.text = 'Orbitly ships social posts.';
    out.brief.what_it_is.text = 'A calendar for posts.';
    out.brief.features.push({
      name: 'Analytics',
      what_it_does: 'Charts every post',
      claim_ids: ['plan-speed'],
    });
    const pricing = must(out.brief.pricing);
    pricing.summary = 'Cheap plans for everyone';
    pricing.plans.push({ name: 'Agency', price: '$24 per month', claim_ids: ['team-price'] });
    const first = await checkResearch(out, bundle());
    expect(first.failures.map((failure) => [failure.code, failure.path])).toEqual([
      ['CLAIM_TEXT_UNBACKED', 'claims[2].text'],
      ['WORDS_UNBACKED', 'brief.one_liner'],
      ['WORDS_UNBACKED', 'brief.what_it_is'],
      ['WORDS_UNBACKED', 'brief.features[1]'],
      ['WORDS_UNBACKED', 'brief.pricing'],
      ['WORDS_UNBACKED', 'brief.pricing.plans[2]'],
    ]);
    expect(first.failures.every(prunable)).toBe(true);
    const settled = withoutFailures(out, first.failures, bundle());
    expect(settled.claims[2]?.text).toBe('Team $24 per month, billed yearly');
    expect(settled.brief.one_liner).toEqual({
      text: 'Orbitly plans a month of social posts in 10 minutes.',
      claim_ids: ['plan-speed'],
    });
    expect(settled.brief.what_it_is.text).toBe(
      'Orbitly plans a month of social posts in 10 minutes.',
    );
    expect(settled.brief.features.map((feature) => feature.name)).toEqual(['Planning']);
    expect(settled.brief.pricing?.plans.map((plan) => plan.name)).toEqual(['Solo', 'Team']);
    expect(settled.brief.pricing?.summary).toBe('Solo Free; Team $24 per month');
    expect(settled.brief.pricing?.claim_ids).toEqual(['free-plan', 'team-price']);
    expect((await checkResearch(settled, bundle())).failures).toEqual([]);
  });

  it('settles prices shown with yearly billing on in the words of the switch', async () => {
    const pages = bundle();
    must(pages.pages[1]).controls = [{ role: 'checkbox', label: 'Billed yearly', on: true }];
    const out = output();
    must(out.brief.pricing).summary = 'A free Solo plan, and Team at $24 per month';
    const first = await checkResearch(out, pages);
    expect(first.failures.map((failure) => failure.code)).toEqual(['PRICING_BILLING']);
    const settled = withoutFailures(out, first.failures, pages);
    expect(settled.brief.pricing?.summary).toBe(
      'A free Solo plan, and Team at $24 per month. Billed yearly.',
    );
    expect((await checkResearch(settled, pages)).failures).toEqual([]);
  });

  it('lists the prices the claims quote when the brief left pricing out', async () => {
    const out = output();
    out.brief.pricing = null;
    const first = await checkResearch(out, bundle());
    expect(first.failures.map((failure) => failure.code)).toEqual(['PRICING_MISSING']);
    const settled = withoutFailures(out, first.failures, bundle());
    expect(settled.brief.pricing).toEqual({
      summary: 'Pricing | Orbitly Team $24 per month, billed yearly',
      free_trial: null,
      plans: [
        {
          name: 'Pricing | Orbitly',
          price: 'Team $24 per month, billed yearly',
          claim_ids: ['team-price'],
        },
      ],
      claim_ids: ['team-price'],
    });
    expect((await checkResearch(settled, bundle())).failures).toEqual([]);
  });

  it('keeps every listed page under its stored title, character for character', () => {
    const pages = bundle();
    must(pages.pages[0]).title = 'Orbitly |\u00a0Social scheduling';
    const settled = withStoredTitles(output(), pages);
    expect(settled.brief.pages[0]?.title).toBe('Orbitly |\u00a0Social scheduling');
  });

  it('cannot settle a failure that does not belong to a claim, a non-claim or a page', () => {
    expect(prunable({ code: 'SCHEMA_INVALID', path: '$', message: '', fix: '' })).toBe(false);
  });
});

describe('measured colours', () => {
  const codes = async (out: ReturnType<typeof output>, pages = bundle()) =>
    (await checkResearch(out, pages)).failures.map((failure) => [failure.code, failure.path]);

  // The first real film's research measured #D3DAC6 and the film was given #F7F7F7, which
  // nothing on the site paints.
  it('refuses a background the capture did not measure as a page surface', async () => {
    const out = output();
    out.brand.colors.background = '#F7F7F7';
    const { failures } = await checkResearch(out, bundle());
    expect(failures.map((failure) => [failure.code, failure.path])).toEqual([
      ['COLOR_UNMEASURED', 'brand.colors.background'],
    ]);
    expect(failures[0]?.message).toContain('Measured surfaces: #FFFFFF, #F3F4F6');
    expect(failures[0]?.fix).toContain('Set brand.colors.background to #FFFFFF');
  });

  it('accepts another measured surface, and refuses a measured text colour as the background', async () => {
    const surface = output();
    surface.brand.colors.background = '#F3F4F6';
    expect(await codes(surface)).toEqual([]);

    const text = output();
    text.brand.colors.background = '#111827';
    text.brand.colors.foreground = '#FFFFFF';
    expect(await codes(text)).toContainEqual(['COLOR_UNMEASURED', 'brand.colors.background']);
  });

  it('lets the foreground be black or white, which the capture picks when no text reads well', async () => {
    const out = output();
    out.brand.colors.foreground = '#000000';
    expect(await codes(out)).toEqual([]);
    out.brand.colors.foreground = '#1F2937';
    expect(await codes(out)).toEqual([['COLOR_UNMEASURED', 'brand.colors.foreground']]);
  });

  it('refuses accents that were not measured', async () => {
    const out = output();
    out.brand_details.accents = ['#F59E0B', '#22C55E'];
    expect(await codes(out)).toEqual([['COLOR_UNMEASURED', 'brand_details.accents[1]']]);
  });

  it('refuses a measured list that differs from the one the capture stored', async () => {
    const out = output();
    const moved = must(out.brand_details.measured[0]);
    moved.y = 900;
    expect(await codes(out)).toEqual([['MEASURED_CHANGED', 'brand_details.measured']]);

    const invented = output();
    invented.brand_details.measured.push({
      ...must(invented.brand_details.measured[0]),
      hex: '#F7F7F7',
      tokens: [],
    });
    invented.brand.colors.background = '#F7F7F7';
    expect(await codes(invented)).toEqual([
      ['MEASURED_CHANGED', 'brand_details.measured'],
      ['COLOR_UNMEASURED', 'brand.colors.background'],
    ]);
  });

  it('cannot vouch for any colour with a bundle from before colours carried points', async () => {
    const { measured_colors: _gone, ...older } = bundle();
    expect(await codes(output(), older)).toEqual([['COLORS_UNMEASURED', 'brand_details.measured']]);
  });

  it('sets unmeasured colours back to the capture’s when repair rounds run out, and then passes', async () => {
    const out = output();
    out.brand.colors.background = '#F7F7F7';
    out.brand.colors.accent = '#22C55E';
    out.brand_details.accents = ['#22C55E', '#F59E0B'];
    must(out.brand_details.measured[1]).share = 0.5;
    const first = await checkResearch(out, bundle());
    expect(first.failures.every(prunable)).toBe(true);
    const settled = withoutFailures(out, first.failures, bundle());
    expect(settled.brand.colors).toMatchObject({ background: '#FFFFFF', accent: '#F59E0B' });
    expect(settled.brand_details.accents).toEqual(['#F59E0B']);
    expect(settled.brand_details.measured).toEqual(measured());
    expect((await checkResearch(settled, bundle())).failures).toEqual([]);
  });

  it('drops an unmeasured muted colour the capture had none for', () => {
    const out = output();
    out.brand.colors.muted = '#9CA3AF';
    expect(withMeasuredColors(out, bundle()).brand.colors.muted).toBeUndefined();
  });

  it('names every colour a downstream agent made up', () => {
    const list = measured();
    expect(
      unmeasuredColors(
        { background: '#F7F7F7', foreground: '#111827', primary: '#4F46E5', accent: '#F59E0B' },
        list,
        ['#F59E0B'],
      ),
    ).toEqual([{ path: 'brand.colors.background', token: 'background', hex: '#F7F7F7' }]);
    expect(unmeasuredColors({ background: '#ffffff', primary: '#4f46e5' }, list)).toEqual([]);
  });
});
