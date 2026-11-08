import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checkProvenance,
  checkResearch,
  type Evidence,
  prunable,
  unfinished,
  withoutClaims,
  withoutFailures,
} from '../src/researcher/gate.ts';
import { bundle, output } from './fixtures.ts';

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
    expect(result.output?.claims).toHaveLength(4);
  });

  it('runs the campaign validator on brand, assets and claims', async () => {
    const out = output();
    out.brand.colors.primary = '#F4F4F5';
    out.brand.logoAssetId = 'home-screen';
    out.evidence.logo.asset_id = 'home-screen';
    const { failures } = await checkResearch(out, bundle());
    expect(failures.map((failure) => [failure.code, failure.path])).toEqual([
      ['CONTRAST_LOW', 'brand.colors.primary'],
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
    out.brief.one_liner = 'TODO';
    expect(unfinished(raw).map((failure) => [failure.code, failure.path])).toEqual([
      ['PLACEHOLDER', 'assets.logo.src'],
      ['TODO', 'brief.one_liner'],
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
  it('drops claims and every reference to them', async () => {
    const trimmed = withoutClaims(output(), new Set(['plan-speed', 'home-headline']));
    expect(trimmed.claims.map((claim) => claim.id)).toEqual(['team-price', 'free-plan']);
    expect(trimmed.brief.features[0]?.claim_ids).toEqual([]);
    expect(trimmed.brief.headline_claim_id).toBeNull();
    const { failures } = await checkResearch(trimmed, bundle());
    expect(failures.map((failure) => [failure.code, failure.path])).toEqual([
      ['NUMBER_UNBACKED', 'brief.features[0]'],
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

  it('cannot settle a failure that does not belong to a claim, a non-claim or a page', () => {
    expect(prunable({ code: 'SCHEMA_INVALID', path: '$', message: '', fix: '' })).toBe(false);
  });
});
