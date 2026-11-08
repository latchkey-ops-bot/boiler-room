import { describe, expect, it } from 'vitest';
import * as schema from '../src/index.ts';

describe('@boiler-room/schema', () => {
  it('exports the whole public surface', () => {
    expect(Object.keys(schema).sort()).toEqual(
      [
        'ASSET_KINDS',
        'ASSET_PROVENANCES',
        'CLAIM_STATUSES',
        'DARK_BASE',
        'DEFAULT_TEXT_LIMITS',
        'FORMATS',
        'GROUND_TINT',
        'ISSUE_CODES',
        'KINETIC_PLATE_MAX_L',
        'LIGHT_BASE',
        'MIN_CONTRAST',
        'NEUTRAL_CUT_MIN_L',
        'STYLE_FAMILIES',
        'SUPERLATIVE_WORDS',
        'TEXT_ROLES',
        'campaignJsonSchema',
        'campaignSchema',
        'contrastRatio',
        'extractNumericTokens',
        'isBacked',
        'fromOklch',
        'mixOklch',
        'oklchLightness',
        'readableOn',
        'researchPartsSchema',
        'sceneRegistry',
        'sceneFrames',
        'styleFamily',
        'superlativeForms',
        'tintedGround',
        'toFrame',
        'toOklch',
        'validateCampaign',
        'validateResearchParts',
      ].sort(),
    );
  });
});
