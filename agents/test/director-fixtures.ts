import { readFileSync } from 'node:fs';
import type { Campaign } from '@boiler-room/schema';
import type { DirectorBrief, Handoff } from '../src/director/output.ts';
import type { ResearchOutput } from '../src/researcher/output.ts';

const skill = new URL('../../skills/director/SKILL.md', import.meta.url);

/** A fresh copy of the worked example in the Director skill: a Short customer order. */
export function workedExample(): Campaign {
  const body = readFileSync(skill, 'utf8');
  const block = /^```json\n([\s\S]*?)^```$/m.exec(body)?.[1];
  if (!block) throw new Error('skills/director/SKILL.md has no fenced JSON block');
  return JSON.parse(block) as Campaign;
}

/** Research the worked example could have been written from: its brand, assets and claims. */
export function exampleResearch(): ResearchOutput {
  const { brand, assets, claims } = workedExample();
  const { 'music-bed': _music, ...captured } = assets;
  return {
    brand,
    assets: captured,
    claims,
    brand_details: {
      mode: 'light',
      accents: [],
      fonts: [],
      radius_px: 14,
      css_variables: false,
      notes: [],
    },
    brief: {
      product_name: 'Fernhook',
      one_liner: {
        text: 'Fernhook gives every pull request a live preview.',
        claim_ids: [claims[0]?.id ?? 'preview-speed'],
      },
      what_it_is: {
        text: 'Live previews for pull requests.',
        claim_ids: [claims[0]?.id ?? 'preview-speed'],
      },
      audiences: [],
      features: [],
      pricing: null,
      ctas: [],
      headline_claim_id: 'preview-speed',
      positioning_note: null,
      non_claims: [],
      conflicts: [],
      pages: [
        {
          url: 'https://fernhook.example.com',
          kind: 'home',
          title: 'Fernhook',
          screenshot_asset_id: 'home',
        },
        {
          url: 'https://fernhook.example.com/product',
          kind: 'product',
          title: 'Product',
          screenshot_asset_id: 'pr-panel',
        },
      ],
      product_ui: {
        status: 'public',
        notes: 'Product page crops.',
        asset_ids: ['pr-panel', 'preview-link'],
      },
    },
    needs_upload: [],
    evidence: {
      pages_file_id: 'fil_pages',
      capture_file_id: 'fil_capture',
      logo: { asset_id: 'logo', source: 'svg', url: 'https://fernhook.example.com' },
      material: [],
    },
  };
}

/** The brief the worked example answers: a customer order with the example's music track. */
export function exampleBrief(): DirectorBrief {
  return {
    kind: 'customer-order',
    audience: null,
    citeExtracted: false,
    formats: ['16:9'],
    ctaPages: ['https://fernhook.example.com/signup'],
    narrationPaid: false,
    asksFor45s: false,
    music: {
      assetId: 'music-bed',
      src: 'assets/audio/bed-120.mp3',
      provenance: 'stock',
      license: 'Example Stock Audio License',
    },
  };
}

/** The handoff the skill gives with the worked example, as typed data. */
export function exampleHandoff(): Handoff {
  return {
    template: 'Short',
    reason: 'Rule 2: a customer order with 2 usable claims.',
    counts: {
      usableClaims: 2,
      verifiedClaims: 1,
      numericClaims: 2,
      productSurfaces: 2,
      capturedTiles: 3,
    },
    substitutions: [],
    tier4SceneIds: ['feature-review'],
    noNumericProof: false,
    formatsBeyond16x9: [],
    issuesLeft: [],
    notes: '',
  };
}

export const exampleSubmission = () => ({ campaign: workedExample(), handoff: exampleHandoff() });
